// VRM characters (VRoid models) for players and the bar staff. The same Universal Animation Library clips the
// other avatars use are retargeted onto the VRM's normalised humanoid rig (UAL is a +z-facing T-pose,
// like Mixamo, so three-vrm's retarget recipe applies). Faces blink and smile, eyes follow the camera,
// hair and skirts swing with VRM spring bones.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Emote } from '../../../shared/protocol';
import type { Avatar, DriveState } from './types';
import { makeProp, placeInHand } from './props';
import { aimBone } from './bone-utils';
import { mergeSkinnedPieces } from './merge';

/** UAL (Unreal mannequin names) → VRM humanoid bones. */
const MAP: Record<string, VRMHumanBoneName> = {
  pelvis: 'hips',
  spine_01: 'spine',
  spine_02: 'chest',
  spine_03: 'upperChest',
  neck_01: 'neck',
  Head: 'head',
  clavicle_l: 'leftShoulder',
  upperarm_l: 'leftUpperArm',
  lowerarm_l: 'leftLowerArm',
  hand_l: 'leftHand',
  clavicle_r: 'rightShoulder',
  upperarm_r: 'rightUpperArm',
  lowerarm_r: 'rightLowerArm',
  hand_r: 'rightHand',
  thigh_l: 'leftUpperLeg',
  calf_l: 'leftLowerLeg',
  foot_l: 'leftFoot',
  ball_l: 'leftToes',
  thigh_r: 'rightUpperLeg',
  calf_r: 'rightLowerLeg',
  foot_r: 'rightFoot',
  ball_r: 'rightToes',
};
const CLIPS = {
  idle: 'Idle_Loop',
  talk: 'Idle_Talking_Loop',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sitDown: 'Sitting_Enter',
  sit: 'Sitting_Idle_Loop',
  sitTalk: 'Sitting_Talking_Loop',
  standUp: 'Sitting_Exit',
  dance: 'Dance_Loop',
  jump: 'Jump_Loop',
} as const;
type Role = keyof typeof CLIPS;
/** Sitting clips keep their hip travel (back onto the chair); everything else plays in place. */
const KEEP_ROOT = new Set<Role>(['sitDown', 'sit', 'sitTalk', 'standUp']);
const ONE_SHOT = new Set<Role>(['sitDown', 'standUp', 'jump']);
/** Same seat compensation as the built-in bodies (metres at 1.7 m height). */
const SIT_OFFSET = { y: 0.05, z: 0.3 };
const WALK_SPEED = 0.975;
const RUN_SPEED = 5.36;
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
let anims: Promise<GLTF> | null = null;
const plainLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // anims.glb is meshopt-compressed

function retarget(clip: THREE.AnimationClip, rig: THREE.Object3D, vrm: VRM, keepRoot: boolean): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const restInv = new THREE.Quaternion();
  const parentRest = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const vrm0 = vrm.meta?.metaVersion === '0';
  const rest = rig.getObjectByName('pelvis')!.getWorldPosition(new THREE.Vector3());
  const srcHipsY = rest.y;
  const vrmHipsY = vrm.humanoid.normalizedRestPose.hips?.position?.[1] ?? srcHipsY;
  const scale = vrmHipsY / srcHipsY;
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const target = MAP[bone];
    const node = target ? vrm.humanoid.getNormalizedBoneNode(target) : null;
    const src = rig.getObjectByName(bone);
    if (!node || !src?.parent) continue;
    src.getWorldQuaternion(restInv).invert();
    src.parent.getWorldQuaternion(parentRest);
    if (prop === 'quaternion') {
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(parentRest).multiply(restInv);
        values[i] = vrm0 ? -q.x : q.x;
        values[i + 1] = q.y;
        values[i + 2] = vrm0 ? -q.z : q.z;
        values[i + 3] = q.w;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, Array.from(track.times), Array.from(values)));
    } else if (prop === 'position' && target === 'hips') {
      // the UAL rig is z-up inside a rotated armature: work in world space. Locomotion keeps only
      // the up/down bounce (the game moves the character); sitting keeps the travel onto the chair.
      const v0 = track.values;
      const values = new Float32Array(v0.length);
      const flip = vrm0 ? -1 : 1;
      for (let i = 0; i < v0.length; i += 3) {
        v.fromArray(v0, i).applyMatrix4(src.parent.matrixWorld);
        values[i] = keepRoot ? (v.x - rest.x) * scale * flip : 0;
        values[i + 1] = v.y * scale;
        values[i + 2] = keepRoot ? (v.z - rest.z) * scale * flip : 0;
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, Array.from(track.times), Array.from(values)));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

interface ToonLike {
  isOutline?: boolean;
  shadingToonyFactor?: number;
  shadeColorFactor?: THREE.Color;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  map?: THREE.Texture | null;
}
interface GlowMat {
  mat: THREE.Material & ToonLike;
  col: THREE.Color;
}
const EMOTE_LEN: Partial<Record<Emote, number>> = { toast: 3.2, wave: 2.4, cheer: 2.4, clap: 2.4, think: 2.6, coffee: 3, heart: 2.4, laugh: 2.2, dance: 5.5, jump: 0.7 };

export class VrmAvatar implements Avatar {
  readonly root = new THREE.Group();
  readonly height: number;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<Role, THREE.AnimationAction>();
  private moveW = 0;
  private runW = 0;
  private sitW = 0;
  private talkW = 0;
  private seatBlend = 0;
  private sitState: 'stand' | 'down' | 'sit' | 'up' = 'stand';
  private transT = 0;
  private baseY: number;
  private emoteName: Emote | null = null;
  private emoteT = 0;
  private blinkT = 2;
  private blink = 0;
  private smile = 0;
  private t = Math.random() * 10;
  private bones: Partial<Record<VRMHumanBoneName, THREE.Object3D>> = {};
  private mirror: number;
  private flute: THREE.Group;
  private mug: THREE.Group;
  private mic: THREE.Group;
  private holdW = 0;
  private rawHand: THREE.Object3D | null;
  private rawFore: THREE.Object3D | null;
  private rawGrip: THREE.Object3D[] = [];
  private hand: Partial<Record<VRMHumanBoneName, THREE.Object3D | null>> = {};
  private tq = new THREE.Quaternion();
  private te = new THREE.Euler();

  private constructor(
    private vrm: VRM,
    clips: Map<Role, THREE.AnimationClip>,
    height: number,
  ) {
    this.height = height;
    this.mirror = vrm.meta?.metaVersion === '0' ? 1 : -1;
    this.baseY = vrm.scene.position.y;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    for (const [role, clip] of clips) {
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(role)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      } else a.play();
      a.setEffectiveWeight(role === 'idle' ? 1 : 0);
      this.actions.set(role, a);
    }
    for (const b of ['rightUpperArm', 'rightLowerArm', 'leftUpperArm', 'leftLowerArm', 'head', 'spine', 'rightHand', 'leftHand'] as VRMHumanBoneName[]) {
      const n = vrm.humanoid.getNormalizedBoneNode(b);
      if (n) this.bones[b] = n;
    }
    this.root.add(vrm.scene);
    this.rawHand = vrm.humanoid.getRawBoneNode('rightHand');
    this.rawFore = vrm.humanoid.getRawBoneNode('rightLowerArm');
    this.rawGrip = (['rightMiddleProximal', 'rightMiddleIntermediate', 'rightIndexIntermediate', 'rightRingIntermediate'] as VRMHumanBoneName[])
      .map((n) => vrm.humanoid.getRawBoneNode(n))
      .filter((n): n is THREE.Object3D => !!n);
    for (const f of ['Index', 'Middle', 'Ring', 'Little', 'Thumb'])
      for (const j of f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal']) {
        const name = `right${f}${j}` as VRMHumanBoneName;
        this.hand[name] = vrm.humanoid.getNormalizedBoneNode(name);
      }
    this.hand.rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
    this.flute = makeProp('flute');
    this.mug = makeProp('mug');
    this.mic = makeProp('mic');
    this.flute.visible = this.mug.visible = this.mic.visible = false;
    this.root.add(this.flute, this.mug, this.mic);
  }

  /** Load a VRM, fit it to `height` metres, retarget the shared clips. */
  static async load(url: string, height: number, lookTarget?: THREE.Object3D): Promise<VrmAvatar> {
    anims ??= plainLoader.loadAsync('/models/anims.glb');
    const [gltf, animGltf] = await Promise.all([loader.loadAsync(url), anims]);
    const vrm = gltf.userData.vrm as VRM;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons?.(gltf.scene);
    mergeSkinnedPieces(gltf.scene, true); // ~100 hair / body pieces → one per material
    VRMUtils.rotateVRM0(vrm); // VRM 0.x faces -z; the game expects +z
    const glowMats: GlowMat[] = [];
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const t = mat as THREE.Material & ToonLike;
        // no ink outlines: they make the characters look drawn-on next to the soft 3D office
        if (t.isOutline) {
          t.visible = false;
          continue;
        }
        // softer, less banded shading
        if (typeof t.shadingToonyFactor === 'number') t.shadingToonyFactor = Math.min(t.shadingToonyFactor, 0.55);
        if (t.shadeColorFactor?.isColor && t.color?.isColor) t.shadeColorFactor.lerp(t.color.clone().multiplyScalar(0.72), 0.5);
        if (!t.emissive?.isColor) continue;
        // emission = own colours, scaled by how dark the room is (see VrmAvatar.glow). VRoid ships a
        // black emission map; hair textures are grey with the colour in the factor.
        if (t.map) t.emissiveMap = t.map;
        glowMats.push({ mat: t, col: t.color?.isColor ? t.color.clone() : new THREE.Color(1, 1, 1) });
        t.needsUpdate = true;
      }
    });
    // scale to the wanted height (rest pose head top ≈ head bone + a bit)
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const h = Math.max(0.5, box.max.y - box.min.y);
    const s = height / h;
    vrm.scene.scale.setScalar(s);
    vrm.scene.position.y = -box.min.y * s;
    if (vrm.lookAt && lookTarget) vrm.lookAt.target = lookTarget;
    // retarget clips (the anims file carries the UAL rig in its rest pose)
    const rig = animGltf.scene;
    rig.updateMatrixWorld(true);
    const clips = new Map<Role, THREE.AnimationClip>();
    for (const [role, name] of Object.entries(CLIPS) as [Role, string][]) {
      const c = animGltf.animations.find((a) => a.name === name);
      if (c) clips.set(role, retarget(c, rig, vrm, KEEP_ROOT.has(role)));
    }
    const av = new VrmAvatar(vrm, clips, height);
    av.glowMats = glowMats;
    return av;
  }

  /** Self-illumination for all VRM characters: low in daylight, higher in the dark bar / cinema. */
  static glow = 0.06;
  private glowMats: GlowMat[] = [];
  private appliedGlow = -1;

  emote(e: Emote) {
    this.emoteName = e;
    this.emoteT = 0;
    if (e === 'jump' && this.sitState === 'stand') this.actions.get('jump')?.reset().play();
  }

  cancelEmote() {
    if (this.emoteName) this.emoteT = Math.max(this.emoteT, (EMOTE_LEN[this.emoteName] ?? 2) - 0.35);
  }

  setConfig() {
    /* VRM characters are fixed */
  }

  update(dt: number, s: DriveState) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    // emote envelope
    let ew = 0;
    if (this.emoteName) {
      this.emoteT += dt;
      const len = EMOTE_LEN[this.emoteName] ?? 2;
      if (this.emoteT >= len) this.emoteName = null;
      else ew = Math.min(1, this.emoteT / 0.3, (len - this.emoteT) / 0.4);
    }
    // ---- sitting state machine (as the built-in bodies): down → sit → up → stand
    const sitting = s.anim === 'sit';
    const down = this.actions.get('sitDown');
    const up = this.actions.get('standUp');
    if (sitting && (this.sitState === 'stand' || this.sitState === 'up')) {
      this.sitState = down ? 'down' : 'sit';
      this.transT = 0;
      down?.reset().play();
    } else if (!sitting && (this.sitState === 'sit' || this.sitState === 'down')) {
      this.sitState = up ? 'up' : 'stand';
      this.transT = 0;
      up?.reset().play();
    }
    this.transT += dt;
    if (this.sitState === 'down' && this.transT > down!.getClip().duration - 0.15) this.sitState = 'sit';
    if (this.sitState === 'up' && this.transT > up!.getClip().duration - 0.1) this.sitState = 'stand';

    const speed = sitting ? 0 : s.speed;
    const hk = this.height / 1.7;
    this.moveW = damp(this.moveW, clamp(speed / 0.6, 0, 1), 8, dt);
    this.runW = damp(this.runW, clamp((speed - 2.3) / 1.0, 0, 1), 6, dt);
    this.sitW = damp(this.sitW, this.sitState === 'sit' ? 1 : 0, 8, dt);
    this.talkW = damp(this.talkW, s.talking ? 1 : 0, 2.5, dt);
    const transClip = this.sitState === 'down' ? down : this.sitState === 'up' ? up : null;
    const transW = transClip ? clamp(this.transT / 0.18, 0, 1) * (this.sitState === 'up' ? clamp((up!.getClip().duration - this.transT) / 0.25, 0, 1) : 1) : 0;
    const seatTarget = this.sitState === 'sit' ? 1 : this.sitState === 'down' ? clamp(this.transT / (down!.getClip().duration * 0.8), 0, 1) : this.sitState === 'up' ? 1 - clamp(this.transT / (up!.getClip().duration * 0.7), 0, 1) : 0;
    this.seatBlend = damp(this.seatBlend, seatTarget, 12, dt);

    // clip emotes (dance, jump) take over while standing; arm emotes are layered on later
    const dancing = this.emoteName === 'dance';
    const clipEmote = this.sitState === 'stand' && this.moveW < 0.5 && (dancing || this.emoteName === 'jump') ? this.emoteName : null;
    const clipW = clipEmote ? ew : 0;
    const base = (1 - clipW) * (1 - transW);
    const loco = base * (1 - this.sitW);
    const seat = base * this.sitW;
    const wRun = this.runW * this.moveW;
    const wWalk = (1 - this.runW) * this.moveW;
    const wStill = 1 - this.moveW;
    const weights: Partial<Record<Role, number>> = {
      idle: loco * wStill * (1 - this.talkW),
      talk: loco * wStill * this.talkW,
      walk: loco * wWalk,
      run: loco * wRun,
      sit: seat * (1 - this.talkW),
      sitTalk: seat * this.talkW,
      dance: clipEmote === 'dance' ? clipW : 0,
      jump: clipEmote === 'jump' ? clipW : 0,
      sitDown: this.sitState === 'down' ? (1 - clipW) * transW : 0,
      standUp: this.sitState === 'up' ? (1 - clipW) * transW : 0,
    };
    for (const [role, a] of this.actions) a.setEffectiveWeight(weights[role] ?? 0);
    this.actions.get('walk')?.setEffectiveTimeScale(clamp(speed / (WALK_SPEED * hk), 0.6, 1.7));
    this.actions.get('run')?.setEffectiveTimeScale(clamp(speed / (RUN_SPEED * hk), 0.65, 1.3));
    // seated: the clip moves the hips back, the root goes forward onto the chair (as built-in bodies)
    this.vrm.scene.position.z = SIT_OFFSET.z * hk * this.seatBlend;
    this.vrm.scene.position.y = this.baseY + SIT_OFFSET.y * hk * this.seatBlend;
    this.mixer.update(dt);

    // arm emotes on top of the clip (normalised bones: rotations are relative to a T-pose)
    const e = this.emoteName;
    if (e && e !== 'dance' && ew > 0) this.armEmote(e, ew);
    // karaoke: hold the mic up to the mouth
    this.holdW = damp(this.holdW, s.hold === 'mic' ? 1 : 0, 6, dt);
    if (this.holdW > 0.01) this.micPose(this.holdW);

    // face: blink every few seconds, smile while having fun
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = 2.2 + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const happy = dancing || e === 'cheer' || e === 'wave' || e === 'laugh' || e === 'clap' || e === 'heart' || e === 'coffee';
    this.smile += ((happy ? 1 : 0.35) - this.smile) * (1 - Math.exp(-4 * dt));
    const em = this.vrm.expressionManager;
    if (em) {
      em.setValue('blink', Math.min(1, this.blink * 1.6));
      // lips move while talking (voice)
      em.setValue('aa', s.talking ? 0.12 + 0.38 * Math.abs(Math.sin(this.t * 11) * Math.sin(this.t * 3.7)) : 0);
      em.setValue(happy ? 'happy' : 'relaxed', this.smile);
      em.setValue(happy ? 'relaxed' : 'happy', 0);
    }
    if (Math.abs(VrmAvatar.glow - this.appliedGlow) > 0.01) {
      this.appliedGlow = VrmAvatar.glow;
      for (const g of this.glowMats) g.mat.emissive!.copy(g.col).multiplyScalar(this.appliedGlow);
    }
    this.vrm.update(dt);
    // a glass for toasts / a mug for coffee / the karaoke mic, held in the right hand
    const want = this.holdW > 0.5 ? this.mic : ew > 0.3 ? (e === 'toast' ? this.flute : e === 'coffee' ? this.mug : null) : null;
    for (const prop of [this.flute, this.mug, this.mic]) {
      prop.visible = prop === want && !!this.rawHand;
      if (prop.visible) placeInHand(prop, this.root, this.rawHand!, this.rawFore, this.rawGrip, prop === this.mic ? 0.7 : 0);
    }
  }

  /**
   * Arm emotes as absolute target poses (the normalised rig's rest is a T-pose), blended in from
   * whatever the clip is doing. Adding rotations on top of the clip twisted the arms.
   * VRM 0.x rigs face -z inside the model (rotateVRM0 turns the whole model), so the right arm
   * points +x there and raising it is +z; `mirror` flips that for VRM 1.0 rigs.
   */
  private armEmote(e: Emote, w: number) {
    const b = this.bones;
    const t = this.emoteT;
    const m = this.mirror;
    const pose = (n: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!n) return;
      this.tq.setFromEuler(this.te.set(x, y, z * m));
      n.quaternion.slerp(this.tq, w);
    };
    if (e === 'wave') {
      pose(b.rightUpperArm, 0, 0.3, 1.2);
      pose(b.rightLowerArm, 0, 0, 0.35 + Math.sin(t * 9) * 0.4);
    } else if (e === 'cheer' || e === 'heart') {
      const k = Math.sin(t * 6) * 0.12;
      pose(b.rightUpperArm, 0, 0.15, 1.3 + k);
      pose(b.leftUpperArm, 0, -0.15, -1.3 - k);
      pose(b.rightLowerArm, 0, 0, 0.25);
      pose(b.leftLowerArm, 0, 0, -0.25);
    } else if (e === 'clap') {
      const c = Math.max(0, Math.sin(t * 14)) * 0.25;
      pose(b.rightUpperArm, 0, 1.15, -0.45);
      pose(b.leftUpperArm, 0, -1.15, 0.45);
      pose(b.rightLowerArm, 0, 0.75 + c, 0);
      pose(b.leftLowerArm, 0, -0.75 - c, 0);
    } else if (e === 'toast') {
      // arm reaching forward and up, glass held out in front (clink forward around 1 s)
      const clink = Math.max(0, 1 - Math.abs(t - 1.1) * 4);
      pose(b.rightUpperArm, 0, 1.15 + 0.1 * clink, 0.55);
      pose(b.rightLowerArm, 0, 0.25, 0.3 - 0.2 * clink);
    } else if (e === 'think') {
      b.head?.rotateX(0.12 * w);
    } else if (e === 'laugh') {
      b.spine?.rotateX((-0.1 + Math.sin(t * 12) * 0.04) * w);
    }
    // 'coffee' (served a drink): smile only, the arms keep the clip's natural pose
    if (e === 'toast' || e === 'coffee') this.grip(w);
  }

  /** Mic to the mouth: aim the (normalised) arm bones in world space, then close the fist. */
  private micPose(w: number) {
    const b = this.bones;
    if (!b.rightUpperArm || !b.rightLowerArm || !b.rightHand) return;
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(this.tq.clone());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(rootQ);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = (x: number, y: number, z: number) => right.clone().multiplyScalar(x).addScaledVector(up, y).addScaledVector(fwd, z).normalize();
    const sway = Math.sin(this.t * 2.2) * 0.04;
    aimBone(b.rightUpperArm, b.rightLowerArm, dir(0.22, -0.72, 0.42 + sway), w);
    aimBone(b.rightLowerArm, b.rightHand, dir(-0.55, 0.6, 0.55), w);
    this.grip(w);
  }

  /** Close the right hand around a glass: fingers curled, wrist turned thumb-up. */
  private grip(w: number) {
    const m = this.mirror;
    const set = (n: THREE.Object3D | null | undefined, x: number, y: number, z: number) => {
      if (!n) return;
      this.tq.setFromEuler(this.te.set(x, y, z));
      n.quaternion.slerp(this.tq, w);
    };
    set(this.hand.rightHand, (Math.PI / 2) * m, 0, 0);
    for (const f of ['Index', 'Middle', 'Ring', 'Little'] as const) {
      set(this.hand[`right${f}Proximal`], 0, 0, -1.2 * m);
      set(this.hand[`right${f}Intermediate`], 0, 0, -1.35 * m);
      set(this.hand[`right${f}Distal`], 0, 0, -0.9 * m);
    }
    set(this.hand.rightThumbMetacarpal, 0, -0.5 * m, -0.3 * m);
    set(this.hand.rightThumbProximal, 0, -0.6 * m, 0);
    set(this.hand.rightThumbDistal, 0, -0.5 * m, 0);
  }

  dispose() {
    this.mixer.stopAllAction();
    VRMUtils.deepDispose(this.vrm.scene);
  }
}
