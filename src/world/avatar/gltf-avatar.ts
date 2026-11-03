// Rigged glTF character (Quaternius Universal Base Characters + Universal Animation Library).
// Locomotion is a speed-driven blend of idle/walk/jog clips; sitting uses enter/idle/exit clips;
// talking blends in the "talking" idles; a few procedural layers (head look, typing, arm emotes)
// are added on top in world space so they work on any rig.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { AvatarConfig } from '../../../shared/avatar';
import type { Emote } from '../../../shared/protocol';
import { buildAccessories } from './accessories';
import { aimBone, findBone, rotateBoneWorld } from './bone-utils';
import { shapedGeometry } from './body-shape';
import { makeProp, placeInHand } from './props';
import { addClothWeights, applyClothShader, makeClothUniforms, textureAverage, tintColor, type ClothUniforms } from './clothing';
import type { BodyEntry, CharacterManifest, ClipRole, MaterialSlots } from './manifest';
import type { Avatar, DriveState } from './types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const UP = new THREE.Vector3(0, 1, 0);
const EMOTE_LEN: Record<Emote, number> = { wave: 2.4, clap: 2.6, cheer: 2.8, dance: 5.5, think: 3, heart: 2.6, coffee: 4, laugh: 2.6, jump: 0.75, toast: 3.2 };
const ONE_SHOT: ClipRole[] = ['sitDown', 'standUp', 'wave', 'clap', 'cheer', 'think', 'heart', 'laugh', 'coffee', 'jump'];
const LOOPED_BASE: ClipRole[] = ['idle', 'talk', 'walk', 'run', 'sit', 'sitTalk'];

export interface GltfResources {
  manifest: CharacterManifest;
  entry: BodyEntry;
  body: GLTF;
  bodyTargetHeight: number; // metres at height factor 1
  hair: GLTF | null;
  clips: Map<ClipRole, THREE.AnimationClip>;
  bodyHeight: number; // model-space height in bind pose
  bodyMinY: number;
}

type BoneKey = 'head' | 'neck' | 'hips' | 'lUpper' | 'rUpper' | 'lFore' | 'rFore' | 'lHand' | 'rHand';

export class GltfAvatar implements Avatar {
  readonly root = new THREE.Group();
  height = 1.78;
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipRole, THREE.AnimationAction>();
  private bones: Record<BoneKey, THREE.Object3D | null>;
  private bodyMeshes: THREE.SkinnedMesh[] = []; // used to measure the head
  private shapeMeshes: THREE.SkinnedMesh[] = []; // textured base bodies that support slim/regular/athletic
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private hairMats: THREE.MeshStandardMaterial[] = [];
  /** Flat-coloured materials of dressed characters, by slot. */
  private flat = new Map<keyof MaterialSlots, THREE.MeshStandardMaterial[]>();
  private clothing: boolean;
  private walkSpeed: number;
  private runSpeed: number;
  private sitOffset: { y: number; z: number };
  private hairstyles: boolean;
  private builds: boolean;
  private cloth: ClothUniforms = makeClothUniforms();
  private flute: THREE.Group;
  private mug: THREE.Group;
  private mic: THREE.Group;
  private holdW = 0;
  private accessories = new THREE.Group();
  private accAnchor = new THREE.Object3D(); // child of the head bone, oriented like the character (y up, z forward)
  private attached = new Map<string, THREE.Object3D>(); // hair / beard meshes by node name
  private headDims: { centerY: number; radius: number; eyeY: number; faceZ: number } | null = null;
  /** Rest rotations of the bones the procedural layers touch. Restored every frame so the layers never
   * accumulate on bones the clips don't animate (otherwise e.g. the head spins forever). */
  private restQuats: [THREE.Object3D, THREE.Quaternion][] = [];
  private anchorRest: { quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null;
  private m: CharacterManifest;
  private scale = 1;
  private cfgHeight = 1;

  private moveW = 0;
  private runW = 0;
  private sitW = 0;
  private talkW = 0;
  private seatBlend = 0; // how much of the seated root offset is applied
  private sitState: 'stand' | 'down' | 'sit' | 'up' = 'stand';
  private transT = 0;
  private emoteName: Emote | null = null;
  private emoteT = 0;
  private emoteAction: THREE.AnimationAction | null = null;
  private headYaw = 0;
  private headPitch = 0;
  private t = Math.random() * 10;
  private idleLook = 0;
  private idleLookTimer = 2;

  constructor(private res: GltfResources, cfg: AvatarConfig) {
    this.m = res.manifest;
    const e = res.entry;
    this.clothing = e.clothing ?? !!this.m.clothing;
    this.walkSpeed = e.walkSpeed ?? this.m.walkSpeed;
    this.runSpeed = e.runSpeed ?? this.m.runSpeed;
    this.sitOffset = e.sitOffset ?? this.m.sitOffset ?? { y: 0, z: 0 };
    this.hairstyles = e.hairstyles ?? true;
    this.builds = e.builds ?? true;
    this.model = SkeletonUtils.clone(res.body.scene);
    const slots = e.materials ?? this.m.materials;
    const skinRe = slots.skin ? new RegExp(slots.skin, 'i') : null;
    const hairRe = slots.hair ? new RegExp(slots.hair, 'i') : null;
    const flatRes = (['top', 'top2', 'bottom', 'shoes'] as const).map((k) => [k, slots[k] ? new RegExp(slots[k]!, 'i') : null] as const);
    const classify = (name: string): keyof MaterialSlots | undefined =>
      skinRe?.test(name) ? 'skin' : hairRe?.test(name) ? 'hair' : flatRes.find(([, re]) => re?.test(name))?.[0];
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds are unreliable while animating
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let isBody = false;
      const owned = list.map((m0) => {
        const mat = (m0 as THREE.MeshStandardMaterial).clone();
        const slot = classify(mat.name);
        if (slot && slot !== 'hair') isBody = true;
        if (slot === 'skin' && mat.map) {
          // textured base body (UBC): tint the texture, optionally paint clothes over it
          this.bodyMats.push(mat);
          if (mesh.isSkinnedMesh && this.clothing && !Array.isArray(mesh.material)) {
            this.shapeMeshes.push(mesh);
            addClothWeights(mesh);
            applyClothShader(mat, this.cloth);
            const sc = new THREE.Vector3().setFromMatrixScale(mesh.bindMatrix);
            this.cloth.uInflate.value = 0.011 / ((sc.x + sc.y + sc.z) / 3 || 1);
          }
        } else if (slot === 'hair' && mat.map) {
          this.hairMats.push(mat);
        } else if (slot) {
          // dressed low-poly characters: plain colours
          const arr = this.flat.get(slot) ?? [];
          arr.push(mat);
          this.flat.set(slot, arr);
        }
        return mat;
      });
      mesh.material = Array.isArray(mesh.material) ? owned : owned[0];
      if (mesh.isSkinnedMesh && isBody) this.bodyMeshes.push(mesh);
    });
    this.root.add(this.model);
    this.flute = makeProp('flute');
    this.mug = makeProp('mug');
    this.mic = makeProp('mic');
    this.flute.visible = this.mug.visible = this.mic.visible = false;
    this.root.add(this.flute, this.mug, this.mic);

    const b = this.m.bones;
    const find = (name: string | undefined, fallback: RegExp[]) => findBone(this.model, [...(name ? [name] : []), ...fallback]);
    this.bones = {
      head: find(b.head, [/^head$/i, /head$/i]),
      neck: find(b.neck, [/^neck_01$/i, /^neck$/i, /neck/i]),
      hips: find(b.hips, [/^pelvis$/i, /hips$/i]),
      lUpper: find(b.lUpperArm, [/^upperarm_l$/i, /^upperarml$/i, /leftarm$/i]),
      rUpper: find(b.rUpperArm, [/^upperarm_r$/i, /^upperarmr$/i, /rightarm$/i]),
      lFore: find(b.lForeArm, [/^lowerarm_l$/i, /^lowerarml$/i, /leftforearm$/i]),
      rFore: find(b.rForeArm, [/^lowerarm_r$/i, /^lowerarmr$/i, /rightforearm$/i]),
      lHand: find(b.lHand, [/^hand_l$/i, /^palml$/i, /lefthand$/i]),
      rHand: find(b.rHand, [/^hand_r$/i, /^palmr$/i, /righthand$/i]),
    };
    for (const b of Object.values(this.bones)) if (b) this.restQuats.push([b, b.quaternion.clone()]);
    this.accAnchor.add(this.accessories);
    if (this.bones.head) {
      this.bones.head.add(this.accAnchor);
      this.measureRest();
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [role, clip] of res.clips) {
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.includes(role)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.enabled = true;
      a.setEffectiveWeight(0);
      if (LOOPED_BASE.includes(role)) {
        a.play();
        a.time = Math.random() * clip.duration; // people should not breathe in sync
      }
      this.actions.set(role, a);
    }
    this.actions.get('idle')?.setEffectiveWeight(1);
    this.setConfig(cfg);
  }

  // ------------------------------------------------------------------ customisation
  setConfig(cfg: AvatarConfig) {
    this.cfgHeight = cfg.height;
    this.scale = (this.res.bodyTargetHeight * cfg.height) / this.res.bodyHeight;
    this.model.scale.setScalar(this.scale);
    this.model.position.y = -this.res.bodyMinY * this.scale;
    this.height = this.res.bodyTargetHeight * cfg.height;

    // body build: thinner/thicker variants of the same mesh
    // the stock female body is a "superhero": unless you ask for athletic, give her a model's figure
    const modelLook = cfg.look === 'model' || (cfg.body === 'female' && cfg.build !== 'athletic');
    if (this.builds) for (const m of this.shapeMeshes) m.geometry = shapedGeometry(m, modelLook ? 'model' : cfg.build);
    // dressed characters: plain colours per material slot
    const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
    for (const [slot, mats] of this.flat) {
      const col =
        slot === 'skin' ? shade(cfg.skin, 0.92) : slot === 'hair' ? new THREE.Color(cfg.hairColor) : slot === 'top' ? new THREE.Color(cfg.top) : slot === 'top2' ? shade(cfg.top, 0.62) : slot === 'bottom' ? new THREE.Color(cfg.bottom) : new THREE.Color(cfg.shoes);
      for (const mm of mats) mm.color.copy(col);
    }

    // skin tone: keep the texture's detail, move its average colour to the chosen tone
    for (const mat of this.bodyMats) {
      mat.color.copy(tintColor(cfg.skin, textureAverage(mat.map))).multiplyScalar(modelLook ? 0.97 : 0.9);
      // model look: smooth, slightly glossy skin (the base normal map carves superhero muscles)
      if (mat.userData.baseNormalScale === undefined) mat.userData.baseNormalScale = mat.normalScale.x;
      if (mat.userData.baseRough === undefined) mat.userData.baseRough = mat.roughness;
      mat.normalScale.setScalar(mat.userData.baseNormalScale * (modelLook ? 0.18 : 1));
      mat.roughness = modelLook ? Math.min(mat.userData.baseRough, 0.55) : mat.userData.baseRough;
    }
    this.cloth.uTop.value.set(cfg.top);
    this.cloth.uBottom.value.set(cfg.bottom);
    this.cloth.uShoes.value.set(cfg.shoes);
    this.cloth.uLongSleeve.value = cfg.sleeves === 'long' ? 1 : 0;
    this.cloth.uSwim.value = cfg.outfit === 'swim' ? 1 : 0;

    // hairstyle + beard (separate skinned meshes bound to our skeleton)
    const style = this.m.hair.find((h) => h.id === cfg.hair) ?? this.m.hair[0];
    const want = new Set<string>();
    if (style?.node && this.hairstyles) want.add(style.node);
    if (cfg.accessories.includes('beard') && this.m.beardNode && this.hairstyles) want.add(this.m.beardNode);
    for (const [name, obj] of this.attached) {
      if (!want.has(name)) {
        obj.removeFromParent();
        this.attached.delete(name);
      }
    }
    for (const name of want) if (!this.attached.has(name)) this.attachSkinned(name);
    for (const mat of this.hairMats) mat.color.copy(tintColor(cfg.hairColor, textureAverage(mat.map, '#8f8f8d')));

    // accessories (glasses, hats…) in head space
    this.accessories.clear();
    const acc = cfg.accessories.filter((a) => a !== 'beard');
    if (this.bones.head && acc.length) {
      const h = this.m.head ?? this.headDims!;
      if (this.anchorRest) {
        this.accAnchor.position.set(0, 0, 0);
        this.accAnchor.quaternion.copy(this.anchorRest.quat);
        this.accAnchor.scale.copy(this.anchorRest.scale).divideScalar(this.scale);
      }
      this.accessories.add(buildAccessories(acc, { headCenterY: h.centerY * this.scale, headRadius: h.radius * this.scale, eyeY: h.eyeY * this.scale, faceZ: h.faceZ * this.scale }));
    }
  }

  private attachSkinned(nodeName: string) {
    const src = this.res.hair?.scene.getObjectByName(nodeName);
    if (!src) return;
    const clone = src.clone(true);
    const byName = new Map<string, THREE.Bone>();
    this.model.traverse((o) => (o as THREE.Bone).isBone && byName.set(o.name, o as THREE.Bone));
    clone.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isMesh) return;
      sm.castShadow = true;
      sm.frustumCulled = false;
      const mat = (sm.material as THREE.MeshStandardMaterial).clone();
      sm.material = mat;
      this.hairMats.push(mat);
      if (sm.isSkinnedMesh) {
        // GLTFLoader renames duplicate node names (root_1, Head_2…) when several skeletons share a file.
        const bones = sm.skeleton.bones.map((bn) => byName.get(bn.name) ?? byName.get(bn.name.replace(/_\d+$/, '')) ?? bn);
        sm.bind(new THREE.Skeleton(bones, sm.skeleton.boneInverses), sm.bindMatrix);
      }
    });
    clone.position.set(0, 0, 0);
    this.model.add(clone);
    this.attached.set(nodeName, clone);
  }

  /**
   * Measured once in the rest pose (before any animation) at model scale 1:
   * the accessory anchor orientation (character space: y up, z forward) and the head size.
   */
  private measureRest() {
    const head = this.bones.head!;
    this.model.scale.setScalar(1);
    this.model.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const pos = head.getWorldPosition(new THREE.Vector3());
    const want = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    const local = head.matrixWorld.clone().invert().multiply(want);
    const p = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    local.decompose(p, quat, scale);
    this.anchorRest = { quat, scale };
    const box = new THREE.Box3();
    for (const m of this.bodyMeshes) box.expandByObject(m, true);
    const h = clamp(box.max.y - pos.y, 0.1, 0.4);
    const r = h * 0.5;
    this.headDims = { centerY: h * 0.45, radius: r, eyeY: h * 0.42, faceZ: r * 1.0 };
  }

  cancelEmote() {
    if (this.emoteName) this.emoteT = Math.max(this.emoteT, EMOTE_LEN[this.emoteName] - 0.35);
  }

  emote(e: Emote) {
    this.emoteName = e;
    this.emoteT = 0;
    this.emoteAction?.fadeOut(0.2);
    this.emoteAction = null;
    const a = this.actions.get(e as ClipRole);
    if (a && this.sitState === 'stand') {
      a.reset();
      a.setEffectiveWeight(0);
      a.play();
      this.emoteAction = a;
    }
  }

  // ------------------------------------------------------------------ animation
  update(dt: number, s: DriveState) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const sitting = s.anim === 'sit';
    const speed = sitting ? 0 : s.speed;
    const walkSpeed = this.walkSpeed * this.cfgHeight;
    const runSpeed = this.runSpeed * this.cfgHeight;

    // sit state machine (transition clips are optional)
    const down = this.actions.get('sitDown');
    const up = this.actions.get('standUp');
    if (sitting && (this.sitState === 'stand' || this.sitState === 'up')) {
      this.sitState = down ? 'down' : 'sit';
      this.transT = 0;
      up?.stop();
      if (down) down.reset().play();
    } else if (!sitting && (this.sitState === 'sit' || this.sitState === 'down')) {
      this.sitState = up ? 'up' : 'stand';
      this.transT = 0;
      down?.stop();
      if (up) up.reset().play();
    }
    this.transT += dt;
    if (this.sitState === 'down' && this.transT > down!.getClip().duration - 0.15) this.sitState = 'sit';
    if (this.sitState === 'up' && this.transT > up!.getClip().duration - 0.1) {
      this.sitState = 'stand';
      up!.stop();
    }

    this.moveW = damp(this.moveW, clamp(speed / 0.6, 0, 1), 8, dt);
    this.runW = damp(this.runW, clamp((speed - 2.3) / 1.0, 0, 1), 6, dt);
    this.sitW = damp(this.sitW, this.sitState === 'sit' ? 1 : 0, 8, dt);
    this.talkW = damp(this.talkW, s.talking ? 1 : 0, 2.5, dt);
    const transClip = this.sitState === 'down' ? down : this.sitState === 'up' ? up : null;
    const transW = transClip ? clamp(this.transT / 0.18, 0, 1) * (this.sitState === 'up' ? clamp((up!.getClip().duration - this.transT) / 0.25, 0, 1) : 1) : 0;
    // seated root offset follows the pelvis: in while sitting down, out while standing up
    const seatTarget = this.sitState === 'sit' ? 1 : this.sitState === 'down' ? clamp(this.transT / (down!.getClip().duration * 0.8), 0, 1) : this.sitState === 'up' ? 1 - clamp(this.transT / (up!.getClip().duration * 0.7), 0, 1) : 0;
    this.seatBlend = damp(this.seatBlend, seatTarget, 12, dt);

    // emote envelope
    let emoteW = 0;
    if (this.emoteName) {
      this.emoteT += dt;
      const len = EMOTE_LEN[this.emoteName];
      if (this.emoteT >= len) {
        this.emoteName = null;
        this.emoteAction?.fadeOut(0.3);
        this.emoteAction = null;
      } else emoteW = clamp(Math.min(this.emoteT / 0.25, (len - this.emoteT) / 0.35), 0, 1);
    }
    const clipEmoteW = this.emoteAction ? emoteW : 0;

    // weights (always sum to 1, otherwise the bind pose leaks in)
    const base = (1 - clipEmoteW) * (1 - transW);
    const loco = base * (1 - this.sitW);
    const seat = base * this.sitW;
    const wRun = this.runW * this.moveW;
    const wWalk = (1 - this.runW) * this.moveW;
    const wStill = 1 - this.moveW;
    const has = (r: ClipRole) => this.actions.has(r);
    const talk = has('talk') ? this.talkW : 0;
    const sitTalk = has('sitTalk') ? this.talkW : 0;
    const w: Partial<Record<ClipRole, number>> = {
      idle: loco * wStill * (1 - talk),
      talk: loco * wStill * talk,
      walk: loco * wWalk,
      run: loco * wRun,
      sit: seat * (1 - sitTalk),
      sitTalk: seat * sitTalk,
    };
    if (!has('run')) (w.walk! += w.run!), (w.run = 0);
    if (!has('walk')) (w.idle! += w.walk!), (w.walk = 0);
    if (!has('sit')) (w.idle! += w.sit!), (w.sit = 0);
    for (const r of LOOPED_BASE) this.actions.get(r)?.setEffectiveWeight(w[r] ?? 0);
    if (transClip) transClip.setEffectiveWeight((1 - clipEmoteW) * transW);
    if (this.emoteAction) this.emoteAction.setEffectiveWeight(clipEmoteW);

    const walk = this.actions.get('walk');
    const run = this.actions.get('run');
    if (walk) walk.timeScale = clamp(speed / walkSpeed, 0.6, 1.7);
    if (run) run.timeScale = clamp(speed / runSpeed, 0.65, 1.3);

    for (const [b, q] of this.restQuats) b.quaternion.copy(q);
    this.mixer.update(dt);

    // seated: shift the body so the pelvis lands on the chair the root stands on
    const so = this.sitOffset;
    this.model.position.z = so.z * this.cfgHeight * this.seatBlend;
    this.model.position.y = -this.res.bodyMinY * this.scale + so.y * this.cfgHeight * this.seatBlend;
    this.root.updateMatrixWorld(true);

    // ---- procedural layers in world space
    this.headLayer(dt, s);
    if (this.sitState === 'sit' && (s.seatKind === 'desk' || s.seatKind === 'focus' || s.seatKind === 'pc') && !s.talking) this.typingLayer();
    if (this.emoteName && !this.emoteAction) this.proceduralEmote(this.emoteName, this.emoteT, emoteW);
    // karaoke: mic up to the mouth (overrides the right arm of any emote)
    this.holdW = damp(this.holdW, s.hold === 'mic' ? 1 : 0, 6, dt);
    if (this.holdW > 0.01) this.micPose(this.holdW);
    this.mic.visible = this.holdW > 0.5 && !!this.bones.rHand;
    if (this.mic.visible) placeInHand(this.mic, this.root, this.bones.rHand!, this.bones.rFore, [], 0.7);
    // a glass for toasts, a mug for coffee
    const want = emoteW > 0.3 && this.holdW < 0.5 ? (this.emoteName === 'toast' ? 'flute' : this.emoteName === 'coffee' ? 'mug' : null) : null;
    for (const [kind, prop] of [['flute', this.flute], ['mug', this.mug]] as const) {
      prop.visible = want === kind && !!this.bones.rHand;
      if (prop.visible) placeInHand(prop, this.root, this.bones.rHand!, this.bones.rFore);
    }
  }

  private headLayer(dt: number, s: DriveState) {
    const head = this.bones.head;
    if (!head) return;
    let wantYaw = 0;
    let wantPitch = 0;
    if (s.lookAt) {
      const local = this.root.worldToLocal(s.lookAt.clone());
      wantYaw = clamp(Math.atan2(local.x, local.z), -0.75, 0.75);
      wantPitch = clamp(Math.atan2(local.y - 1.5, Math.hypot(local.x, local.z)) * 0.4, -0.2, 0.2);
    } else {
      this.idleLookTimer -= dt;
      if (this.idleLookTimer <= 0) {
        this.idleLookTimer = 5 + Math.random() * 7;
        this.idleLook = Math.random() < 0.55 ? 0 : (Math.random() - 0.5) * 0.6;
      }
      wantYaw = this.idleLook * (1 - this.moveW) * (this.sitState === 'sit' ? 0.4 : 1);
    }
    this.headYaw = damp(this.headYaw, wantYaw, 2.5, dt);
    this.headPitch = damp(this.headPitch, wantPitch, 2.5, dt);
    if (this.bones.neck) rotateBoneWorld(this.bones.neck, UP, this.headYaw * 0.4);
    rotateBoneWorld(head, UP, this.headYaw * 0.6);
    if (Math.abs(this.headPitch) > 0.01) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
      rotateBoneWorld(head, right, -this.headPitch);
    }
  }

  /** Hands forward on the keyboard with small finger-tapping motion. */
  private typingLayer() {
    const t = this.t;
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    const charRight = right.clone().negate();
    const { lUpper, lFore, rUpper, rFore, lHand, rHand } = this.bones;
    const dir = (x: number, y: number, z: number) => charRight.clone().multiplyScalar(x).addScaledVector(UP, y).addScaledVector(fwd, z).normalize();
    const w = this.sitW;
    if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.1, -0.62, 0.72), w);
    if (lUpper && lFore) aimBone(lUpper, lFore, dir(-0.1, -0.62, 0.72), w);
    if (rFore && rHand) aimBone(rFore, rHand, dir(-0.32, -0.22, 1), w);
    if (lFore && lHand) aimBone(lFore, lHand, dir(0.32, -0.22, 1), w);
    for (const [hand, phase] of [[lHand, 0], [rHand, 1.7]] as const) {
      if (!hand) continue;
      const active = Math.sin(t * 0.9 + phase) > -0.3 ? 1 : 0.2;
      rotateBoneWorld(hand, right, Math.sin(t * 13 + phase) * 0.1 * active * w);
    }
  }

  /** Holding a mic: upper arm down along the chest, forearm up so the fist sits under the chin. */
  private micPose(w: number) {
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const charRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(rootQ);
    const dir = (x: number, y: number, z: number) => charRight.clone().multiplyScalar(x).addScaledVector(UP, y).addScaledVector(fwd, z).normalize();
    const { rUpper, rFore, rHand } = this.bones;
    const sway = Math.sin(this.t * 2.2) * 0.04;
    if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.22, -0.72, 0.42 + sway), w);
    if (rFore && rHand) aimBone(rFore, rHand, dir(-0.55, 0.6, 0.55), w);
  }

  /** Arm-only emotes for roles without a clip (works seated too). */
  private proceduralEmote(e: Emote, et: number, w: number) {
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const charRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(rootQ);
    const { rUpper, rFore, lUpper, lFore, rHand, lHand } = this.bones;
    const dir = (x: number, y: number, z: number) => charRight.clone().multiplyScalar(x).addScaledVector(UP, y).addScaledVector(fwd, z).normalize();
    switch (e) {
      case 'wave':
        if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.75, 0.55, 0.15), w);
        if (rFore && rHand) aimBone(rFore, rHand, dir(0.2 + Math.sin(et * 11) * 0.45, 1, 0.15), w);
        break;
      case 'cheer':
      case 'heart':
        if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.35, 1, 0.05), w);
        if (lUpper && lFore) aimBone(lUpper, lFore, dir(-0.35, 1, 0.05), w);
        if (e === 'heart') {
          if (rFore && rHand) aimBone(rFore, rHand, dir(-0.8, 0.45, 0.1), w);
          if (lFore && lHand) aimBone(lFore, lHand, dir(0.8, 0.45, 0.1), w);
        } else {
          if (rFore && rHand) aimBone(rFore, rHand, dir(0.1, 1, 0.1 + Math.sin(et * 9) * 0.25), w);
          if (lFore && lHand) aimBone(lFore, lHand, dir(-0.1, 1, 0.1 + Math.sin(et * 9) * 0.25), w);
        }
        break;
      case 'clap': {
        const c = (Math.sin(et * 15) + 1) / 2;
        if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.3, -0.5, 0.8), w);
        if (lUpper && lFore) aimBone(lUpper, lFore, dir(-0.3, -0.5, 0.8), w);
        if (rFore && rHand) aimBone(rFore, rHand, dir(-0.45 - 0.35 * (1 - c), 0.3, 0.8), w);
        if (lFore && lHand) aimBone(lFore, lHand, dir(0.45 + 0.35 * (1 - c), 0.3, 0.8), w);
        break;
      }
      case 'toast': {
        // raise the glass towards whoever is in front; a little clink forward around 1 s
        const clink = Math.max(0, 1 - Math.abs(et - 1.1) * 4);
        if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.35, -0.05 + 0.1 * clink, 0.85), w);
        if (rFore && rHand) aimBone(rFore, rHand, dir(-0.1, 0.55, 0.8 + 0.3 * clink), w);
        break;
      }
      case 'coffee':
      case 'think': {
        const sip = e === 'coffee' ? Math.max(0, Math.sin(et * 1.6 - 0.8)) : 1;
        if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.15, -0.6, 0.6), w);
        if (rFore && rHand) aimBone(rFore, rHand, dir(-0.3, 0.2 + 0.8 * sip, 0.3), w);
        break;
      }
      case 'dance':
      case 'laugh': {
        const k = Math.sin(et * 6);
        if (rUpper && rFore) aimBone(rUpper, rFore, dir(0.7, 0.3 + k * 0.5, 0.2), w);
        if (lUpper && lFore) aimBone(lUpper, lFore, dir(-0.7, 0.3 - k * 0.5, 0.2), w);
        break;
      }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of [...this.bodyMats, ...this.hairMats]) m.dispose();
  }
}
