// Fallback character built from soft primitives with a joint hierarchy and procedural animation.
// Used until (or if) the Quaternius character models are not available.
import * as THREE from 'three';
import { makeProp } from './props';
import type { AvatarConfig } from '../../../shared/avatar';
import type { Emote } from '../../../shared/protocol';
import { buildAccessories } from './accessories';
import type { Avatar, DriveState } from './types';

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'lUpper', 'lFore', 'lHand', 'rUpper', 'rFore', 'rHand', 'lThigh', 'lShin', 'lFoot', 'rThigh', 'rShin', 'rFoot'] as const;
type Joint = (typeof JOINTS)[number];
interface V3 {
  x: number;
  y: number;
  z: number;
}
type Pose = Record<Joint, V3> & { hp: V3 };

const HIP = 0.94;
const SIT_HIP = 0.56;
const TAU = Math.PI * 2;

function newPose(): Pose {
  const p = { hp: { x: 0, y: HIP, z: 0 } } as Pose;
  for (const j of JOINTS) p[j] = { x: 0, y: 0, z: 0 };
  return p;
}
function lerpPose(out: Pose, a: Pose, b: Pose, t: number) {
  for (const k of [...JOINTS, 'hp'] as const) {
    out[k].x = a[k].x + (b[k].x - a[k].x) * t;
    out[k].y = a[k].y + (b[k].y - a[k].y) * t;
    out[k].z = a[k].z + (b[k].z - a[k].z) * t;
  }
}
function copyPose(out: Pose, a: Pose) {
  lerpPose(out, a, a, 0);
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const EMOTE_LEN: Record<Emote, number> = { wave: 2.4, clap: 2.4, cheer: 2.6, dance: 5, think: 3, heart: 2.6, coffee: 4, laugh: 2.4, jump: 0.7, toast: 3.2 };

export class ProceduralAvatar implements Avatar {
  readonly root = new THREE.Group();
  readonly height = 1.78;
  private body = new THREE.Group();
  private j = {} as Record<Joint, THREE.Object3D>;
  private mats: Record<'skin' | 'top' | 'bottom' | 'shoes' | 'hair' | 'brow' | 'sleeve', THREE.MeshStandardMaterial>;
  private hairGroup = new THREE.Group();
  private accGroup = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  private cup: THREE.Object3D;
  private micProp: THREE.Object3D;

  private t = Math.random() * 10;
  private phase = 0;
  private moveW = 0;
  private runW = 0;
  private sitW = 0;
  private headYaw = 0;
  private headPitch = 0;
  private idleLook = 0;
  private idleLookTimer = 3;
  private blinkTimer = 2;
  private emoteName: Emote | null = null;
  private emoteT = 0;
  private pBase = newPose();
  private pSit = newPose();
  private pMix = newPose();
  private pEmo = newPose();

  constructor(cfg: AvatarConfig) {
    const std = (color: string, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    this.mats = {
      skin: std(cfg.skin, 0.6),
      top: std(cfg.top, 0.85),
      bottom: std(cfg.bottom, 0.85),
      shoes: std(cfg.shoes, 0.6),
      hair: std(cfg.hairColor, 0.65),
      brow: std(cfg.hairColor, 0.8),
      sleeve: std(cfg.skin, 0.75),
    };
    this.root.add(this.body);
    this.build();
    const cup = new THREE.Group();
    const cupMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }));
    cup.add(cupMesh);
    cup.position.set(0, -0.06, 0.05);
    cup.visible = false;
    this.j.rHand.add(cup);
    this.cup = cup;
    const micProp = makeProp('mic');
    micProp.position.set(0, -0.12, 0.04);
    micProp.visible = false;
    this.j.rHand.add(micProp);
    this.micProp = micProp;
    this.setConfig(cfg);
  }

  // ------------------------------------------------------------------ build
  private part(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private joint(name: Joint, parent: THREE.Object3D, x: number, y: number, z: number) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    this.j[name] = o;
    return o;
  }

  private build() {
    const { skin, top, bottom, shoes, brow, sleeve } = this.mats;
    const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14);
    const sphere = (r: number) => new THREE.SphereGeometry(r, 24, 16);

    const hips = this.joint('hips', this.body, 0, HIP, 0);
    this.part(hips, cap(0.125, 0.1), bottom, 0, 0.0, 0, 1, 1, 0.82).rotation.z = Math.PI / 2;
    const spine = this.joint('spine', hips, 0, 0.06, 0);
    this.part(spine, cap(0.135, 0.12), top, 0, 0.1, 0, 1.05, 1, 0.8);
    const chest = this.joint('chest', spine, 0, 0.2, 0);
    this.part(chest, cap(0.15, 0.1), top, 0, 0.08, 0, 1.22, 1, 0.82);
    const neck = this.joint('neck', chest, 0, 0.24, 0);
    this.part(neck, cap(0.045, 0.06), skin, 0, 0.02, 0);
    const head = this.joint('head', neck, 0, 0.07, 0);
    this.part(head, sphere(0.118), skin, 0, 0.1, 0.005, 0.94, 1.06, 1.0);
    // face
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(sx * 0.042, 0.105, 0.103);
      head.add(eye);
      this.part(eye, sphere(0.018), new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.3 }), 0, 0, 0, 1, 1.15, 0.55);
      this.part(eye, sphere(0.006), new THREE.MeshBasicMaterial({ color: '#ffffff' }), sx * 0.006, 0.007, 0.009);
      this.eyes.push(eye);
      const b = this.part(head, new THREE.CapsuleGeometry(0.006, 0.03, 4, 8), brow, sx * 0.043, 0.142, 0.108);
      b.rotation.z = Math.PI / 2 + sx * 0.12;
      this.part(head, sphere(0.022), new THREE.MeshStandardMaterial({ color: '#ff9f9f', roughness: 1, transparent: true, opacity: 0.35 }), sx * 0.068, 0.068, 0.093, 1, 0.6, 0.3);
      this.part(head, sphere(0.024), skin, sx * 0.112, 0.1, 0.0, 0.5, 1, 0.8);
    }
    this.part(head, sphere(0.014), skin, 0, 0.085, 0.118, 1, 1, 0.9);
    const mouth = this.part(head, new THREE.TorusGeometry(0.02, 0.0045, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: '#a0524d', roughness: 0.6 }), 0, 0.058, 0.108);
    mouth.rotation.z = Math.PI;
    head.add(this.hairGroup);
    head.add(this.accGroup);

    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      this.part(chest, sphere(0.062), top, sx * 0.19, 0.17, 0);
      const up = this.joint(`${side}Upper` as Joint, chest, sx * 0.205, 0.17, 0);
      this.part(up, cap(0.05, 0.2), top, 0, -0.13, 0);
      const fore = this.joint(`${side}Fore` as Joint, up, 0, -0.29, 0);
      this.part(fore, sphere(0.046), top, 0, 0, 0); // elbow (sleeve)
      this.part(fore, cap(0.042, 0.19), sleeve, 0, -0.125, 0);
      const hand = this.joint(`${side}Hand` as Joint, fore, 0, -0.265, 0);
      this.part(hand, sphere(0.047), skin, 0, -0.035, 0.005, 0.75, 1.05, 0.55);

      const thigh = this.joint(`${side}Thigh` as Joint, hips, sx * 0.095, -0.03, 0);
      this.part(thigh, cap(0.072, 0.29), bottom, 0, -0.205, 0);
      const shin = this.joint(`${side}Shin` as Joint, thigh, 0, -0.43, 0);
      this.part(shin, sphere(0.064), bottom, 0, 0, 0); // knee
      this.part(shin, cap(0.057, 0.3), bottom, 0, -0.2, 0);
      const foot = this.joint(`${side}Foot` as Joint, shin, 0, -0.42, 0);
      this.part(foot, cap(0.05, 0.15), shoes, 0, -0.04, 0.05, 1.05, 0.75, 1).rotation.x = Math.PI / 2;
    }
  }

  private buildHair(style: string) {
    this.hairGroup.clear();
    const m = this.mats.hair;
    const R = 0.128;
    const add = (geo: THREE.BufferGeometry, x = 0, y = 0.1, z = 0, sx = 1, sy = 1, sz = 1) => this.part(this.hairGroup, geo, m, x, y, z, sx, sy, sz);
    const capTop = (theta: number) => new THREE.SphereGeometry(R, 28, 18, 0, TAU, 0, theta);
    const back = (theta: number, wrap = 0) => new THREE.SphereGeometry(R + 0.004, 28, 18, Math.PI - wrap, Math.PI + wrap * 2, 0, theta);
    switch (style) {
      case 'none':
        return;
      case 'long':
        add(capTop(Math.PI * 0.42), 0, 0.105, -0.004, 0.97, 1.05, 1.03);
        add(back(Math.PI * 0.85, 0.35), 0, 0.105, -0.004, 0.98, 1.08, 1.05);
        add(new THREE.CapsuleGeometry(0.11, 0.2, 6, 14), 0, -0.05, -0.07, 1.05, 1, 0.5);
        break;
      case 'bob':
        add(capTop(Math.PI * 0.45), 0, 0.105, 0, 0.98, 1.06, 1.03);
        add(back(Math.PI * 0.68, 0.45), 0, 0.1, 0, 1.02, 1.1, 1.06);
        break;
      case 'bun':
        add(capTop(Math.PI * 0.42), 0, 0.105, -0.004, 0.97, 1.05, 1.03);
        add(back(Math.PI * 0.6, 0.2), 0, 0.105, -0.004, 0.97, 1.06, 1.03);
        add(new THREE.SphereGeometry(0.06, 18, 12), 0, 0.24, -0.06);
        break;
      case 'ponytail': {
        add(capTop(Math.PI * 0.42), 0, 0.105, -0.004, 0.97, 1.05, 1.03);
        add(back(Math.PI * 0.62, 0.2), 0, 0.105, -0.004, 0.97, 1.06, 1.03);
        const tail = add(new THREE.CapsuleGeometry(0.04, 0.18, 6, 12), 0, 0.06, -0.15);
        tail.rotation.x = 0.35;
        add(new THREE.SphereGeometry(0.03, 12, 10), 0, 0.16, -0.125);
        break;
      }
      case 'curly': {
        const n = 46;
        for (let i = 0; i < n; i++) {
          const y = 1 - (i / (n - 1)) * 1.25;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const a = i * 2.399963;
          const px = Math.cos(a) * r;
          const pz = Math.sin(a) * r;
          if (pz > 0.45 && y < 0.55) continue; // keep the face clear
          add(new THREE.SphereGeometry(0.045, 10, 8), px * R * 0.98, 0.1 + y * R * 1.05, pz * R * 0.98 - 0.005);
        }
        break;
      }
      case 'spiky': {
        add(capTop(Math.PI * 0.4), 0, 0.105, 0, 0.97, 1.04, 1.02);
        add(back(Math.PI * 0.55, 0.1), 0, 0.105, 0, 0.97, 1.04, 1.02);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          const cone = add(new THREE.ConeGeometry(0.035, 0.1, 8), Math.cos(a) * 0.07, 0.22, Math.sin(a) * 0.07 - 0.02);
          cone.rotation.set(Math.sin(a) * 0.6 - 0.2, 0, -Math.cos(a) * 0.6);
        }
        break;
      }
      default: {
        // short, side-swept fringe
        add(capTop(Math.PI * 0.42), 0, 0.106, -0.004, 0.97, 1.05, 1.03);
        add(back(Math.PI * 0.58, 0.2), 0, 0.105, -0.004, 0.97, 1.05, 1.03);
        const fringe = add(new THREE.CapsuleGeometry(0.03, 0.12, 6, 10), 0.02, 0.19, 0.095);
        fringe.rotation.set(0.3, 0, Math.PI / 2 - 0.25);
      }
    }
  }

  setConfig(cfg: AvatarConfig) {
    this.mats.skin.color.set(cfg.skin);
    this.mats.top.color.set(cfg.top);
    this.mats.bottom.color.set(cfg.bottom);
    this.mats.shoes.color.set(cfg.shoes);
    this.mats.hair.color.set(cfg.hairColor);
    this.mats.brow.color.set(cfg.hairColor);
    this.mats.sleeve.color.set(cfg.sleeves === 'long' ? cfg.top : cfg.skin);
    this.buildHair(PROCEDURAL_HAIR.some((h) => h.id === cfg.hair) ? cfg.hair : 'short');
    this.accGroup.clear();
    this.accGroup.add(buildAccessories(cfg.accessories.filter((a) => a !== 'beard'), { headCenterY: 0.1, headRadius: 0.122, eyeY: 0.105, faceZ: 0.118 }));
    this.body.scale.setScalar(cfg.height);
  }

  cancelEmote() {
    if (this.emoteName) this.emoteT = Math.max(this.emoteT, EMOTE_LEN[this.emoteName] - 0.35);
  }

  emote(e: Emote) {
    this.emoteName = e;
    this.emoteT = 0;
  }

  // ------------------------------------------------------------------ animation
  update(dt: number, s: DriveState) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    const sitting = s.anim === 'sit';
    const speed = sitting ? 0 : s.speed;
    this.moveW = damp(this.moveW, clamp(speed / 0.7, 0, 1), 10, dt);
    this.runW = damp(this.runW, clamp((speed - 2.4) / 1.2, 0, 1), 6, dt);
    this.sitW = damp(this.sitW, sitting ? 1 : 0, 7, dt);
    const stride = 1.3 + this.runW * 0.8;
    this.phase = (this.phase + (speed * dt * TAU) / stride) % TAU;

    this.locomotion(this.pBase, t);
    if (this.sitW > 0.001) {
      this.sitPose(this.pSit, t, s);
      lerpPose(this.pMix, this.pBase, this.pSit, this.sitW);
    } else copyPose(this.pMix, this.pBase);

    let out = this.pMix;
    if (this.emoteName) {
      this.emoteT += dt;
      const len = EMOTE_LEN[this.emoteName];
      if (this.emoteT >= len) {
        this.emoteName = null;
        this.cup.visible = false;
      } else {
        const w = clamp(Math.min(this.emoteT / 0.25, (len - this.emoteT) / 0.35), 0, 1);
        copyPose(this.pEmo, this.pMix);
        this.emotePose(this.pEmo, this.emoteName, this.emoteT, this.sitW > 0.5);
        lerpPose(this.pEmo, this.pMix, this.pEmo, w);
        out = this.pEmo;
        this.cup.visible = (this.emoteName === 'coffee' || this.emoteName === 'toast') && w > 0.3;
      }
    }

    // karaoke mic: hand up under the chin
    if (s.hold === 'mic') {
      if (out === this.pMix) {
        copyPose(this.pEmo, this.pMix);
        out = this.pEmo;
      }
      out.rUpper.x = -0.75;
      out.rUpper.z = -0.15;
      out.rUpper.y = 0.25;
      out.rFore.x = -1.9;
      out.rFore.y = 0.35;
      this.cup.visible = false;
    }
    this.micProp.visible = s.hold === 'mic';

    // Head: look at a target (someone talking / nearby) or glance around while idle.
    let wantYaw = 0;
    let wantPitch = 0;
    if (s.lookAt) {
      const local = this.root.worldToLocal(s.lookAt.clone());
      wantYaw = clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      wantPitch = clamp(-Math.atan2(local.y - 1.55, Math.hypot(local.x, local.z)) * 0.6, -0.3, 0.3);
    } else {
      this.idleLookTimer -= dt;
      if (this.idleLookTimer <= 0) {
        this.idleLookTimer = 3 + Math.random() * 5;
        this.idleLook = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.2;
      }
      wantYaw = this.idleLook * (1 - this.moveW);
    }
    this.headYaw = damp(this.headYaw, wantYaw, 5, dt);
    this.headPitch = damp(this.headPitch, wantPitch, 5, dt);
    out.neck.y += this.headYaw * 0.4;
    out.head.y += this.headYaw * 0.6;
    out.head.x += this.headPitch;

    // Blink
    this.blinkTimer -= dt;
    const blink = this.blinkTimer < 0.12 ? 0.12 : 1;
    if (this.blinkTimer < 0) this.blinkTimer = 2.2 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = blink;

    this.apply(out);
  }

  private locomotion(p: Pose, t: number) {
    const mw = this.moveW;
    const rw = this.runW;
    const idle = 1 - mw;
    for (const side of ['l', 'r'] as const) {
      const ph = this.phase + (side === 'l' ? 0 : Math.PI);
      const sx = side === 'l' ? 1 : -1;
      const thighX = -Math.sin(ph) * (0.42 + 0.38 * rw) * mw;
      const kneeX = mw * (0.07 + (0.7 + 0.65 * rw) * Math.pow(Math.max(0, Math.cos(ph)), 1.5));
      const toeOff = Math.exp(-(wrap(ph + 1.25) ** 2) / 0.3) * 0.45 * mw;
      p[`${side}Thigh`].x = thighX;
      p[`${side}Thigh`].y = 0;
      p[`${side}Thigh`].z = sx * 0.02 * idle;
      p[`${side}Shin`].x = kneeX;
      p[`${side}Shin`].y = 0;
      p[`${side}Shin`].z = 0;
      p[`${side}Foot`].x = -(thighX + kneeX) + toeOff - 0.1 * mw * Math.max(0, Math.cos(ph));
      p[`${side}Foot`].y = 0;
      p[`${side}Foot`].z = 0;

      // Arms swing opposite to the leg on the same side.
      const armA = (0.32 + 0.45 * rw) * mw;
      const upX = Math.sin(ph) * armA + Math.sin(t * 1.1 + sx) * 0.02 * idle;
      p[`${side}Upper`].x = upX;
      p[`${side}Upper`].y = 0;
      p[`${side}Upper`].z = sx * (0.1 + 0.03 * rw + Math.sin(t * 1.7) * 0.008);
      p[`${side}Fore`].x = -(0.16 + 0.2 * mw + 1.05 * rw) + 0.5 * Math.min(0, upX);
      p[`${side}Fore`].y = 0;
      p[`${side}Fore`].z = 0;
      p[`${side}Hand`].x = 0;
      p[`${side}Hand`].y = 0;
      p[`${side}Hand`].z = -sx * 0.1;
    }
    const ph = this.phase;
    p.hp.x = Math.sin(t * 0.35) * 0.012 * idle;
    p.hp.y = HIP - mw * (0.022 + 0.025 * rw) * Math.sin(ph) ** 2 + rw * Math.abs(Math.sin(ph)) * 0.02;
    p.hp.z = 0;
    p.hips.x = 0;
    p.hips.y = -0.11 * Math.sin(ph) * mw;
    p.hips.z = Math.sin(t * 0.35) * 0.02 * idle + 0.035 * Math.cos(ph) * mw;
    p.spine.x = mw * (0.04 + 0.16 * rw);
    p.spine.y = 0.07 * Math.sin(ph) * mw;
    p.spine.z = -p.hips.z * 0.6;
    p.chest.x = Math.sin(t * 1.7) * 0.012 * idle;
    p.chest.y = 0.09 * Math.sin(ph) * mw;
    p.chest.z = 0;
    p.neck.x = -p.spine.x * 0.4;
    p.neck.y = -p.chest.y * 0.5 - p.spine.y * 0.5;
    p.neck.z = 0;
    p.head.x = -p.spine.x * 0.4 + Math.sin(ph * 2) * 0.015 * mw;
    p.head.y = -p.hips.y * 0.4;
    p.head.z = -p.hips.z * 0.5;
  }

  private sitPose(p: Pose, t: number, s: DriveState) {
    const desk = s.seatKind === 'desk' || s.seatKind === 'focus';
    const lounge = s.seatKind === 'sofa';
    copyPose(p, this.pBase);
    p.hp.x = 0;
    p.hp.y = lounge ? 0.5 : SIT_HIP;
    p.hp.z = lounge ? -0.12 : -0.07;
    p.hips.x = p.hips.y = p.hips.z = 0;
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      p[`${side}Thigh`].x = -Math.PI / 2 + (lounge ? 0.25 : 0.06);
      p[`${side}Thigh`].z = sx * 0.06;
      p[`${side}Thigh`].y = sx * 0.05;
      p[`${side}Shin`].x = Math.PI / 2 - 0.05 + (lounge ? 0.0 : 0.08) + Math.sin(t * 0.7 + sx) * 0.02;
      p[`${side}Foot`].x = -(p[`${side}Thigh`].x + p[`${side}Shin`].x);
      p[`${side}Foot`].z = 0;
      if (desk) {
        const tap = Math.sin(t * 13 + sx * 1.7) * 0.05 * (Math.sin(t * 0.9 + sx) > -0.3 ? 1 : 0.2);
        p[`${side}Upper`].x = -0.55;
        p[`${side}Upper`].y = 0;
        p[`${side}Upper`].z = sx * 0.2;
        p[`${side}Fore`].x = -1.05 + tap;
        p[`${side}Fore`].y = -sx * 0.25;
        p[`${side}Fore`].z = 0;
        p[`${side}Hand`].x = 0.15 - tap;
        p[`${side}Hand`].z = 0;
      } else {
        const talk = s.talking ? Math.sin(t * 3 + sx) * 0.12 : 0;
        p[`${side}Upper`].x = -0.3 + talk;
        p[`${side}Upper`].y = 0;
        p[`${side}Upper`].z = sx * 0.12;
        p[`${side}Fore`].x = -0.75 + talk * 1.5;
        p[`${side}Fore`].y = -sx * 0.35;
        p[`${side}Fore`].z = 0;
        p[`${side}Hand`].x = 0.1;
      }
    }
    p.spine.x = desk ? 0.06 : lounge ? -0.16 : 0;
    p.spine.y = 0;
    p.spine.z = 0;
    p.chest.x = Math.sin(t * 1.7) * 0.012;
    p.chest.y = 0;
    p.head.x = desk ? 0.1 : -p.spine.x * 0.5;
  }

  private emotePose(p: Pose, e: Emote, et: number, seated: boolean) {
    const sin = Math.sin;
    switch (e) {
      case 'wave':
        p.rUpper.x = -0.25;
        p.rUpper.z = -2.55;
        p.rUpper.y = 0.2;
        p.rFore.x = -0.25;
        p.rFore.y = 0;
        p.rFore.z = sin(et * 11) * 0.5 - 0.15;
        p.rHand.z = 0;
        p.head.z += 0.08;
        p.head.y += -0.15;
        break;
      case 'cheer': {
        const b = Math.abs(sin(et * 7));
        p.lUpper.x = -0.2;
        p.lUpper.z = 2.6 + sin(et * 7) * 0.15;
        p.rUpper.x = -0.2;
        p.rUpper.z = -2.6 - sin(et * 7) * 0.15;
        p.lFore.x = -0.35;
        p.rFore.x = -0.35;
        p.lFore.y = p.rFore.y = 0;
        if (!seated) {
          p.hp.y += b * 0.08;
          p.lShin.x = p.rShin.x = (1 - b) * 0.25;
          p.lThigh.x = p.rThigh.x = -(1 - b) * 0.12;
          p.lFoot.x = p.rFoot.x = -(p.lThigh.x + p.lShin.x);
        }
        p.head.x -= 0.15;
        break;
      }
      case 'clap': {
        const c = (sin(et * 15) + 1) / 2;
        for (const side of ['l', 'r'] as const) {
          const sx = side === 'l' ? 1 : -1;
          p[`${side}Upper`].x = -1.0;
          p[`${side}Upper`].z = sx * (0.05 + 0.2 * c);
          p[`${side}Upper`].y = -sx * 0.5;
          p[`${side}Fore`].x = -0.7;
          p[`${side}Fore`].y = -sx * 0.4;
          p[`${side}Fore`].z = 0;
        }
        break;
      }
      case 'dance': {
        const k = et * 6;
        p.hp.x += sin(k) * 0.06;
        p.hips.z += sin(k) * 0.12;
        p.hips.y += sin(k * 0.5) * 0.3;
        p.spine.z -= sin(k) * 0.16;
        p.lUpper.z = 1.3 + sin(k) * 0.7;
        p.rUpper.z = -1.3 + sin(k) * 0.7;
        p.lUpper.x = -0.3;
        p.rUpper.x = -0.3;
        p.lFore.x = -1.2 - sin(k * 2) * 0.3;
        p.rFore.x = -1.2 + sin(k * 2) * 0.3;
        if (!seated) {
          const bounce = (1 + sin(k * 2)) / 2;
          p.hp.y -= bounce * 0.05;
          p.lThigh.x = p.rThigh.x = -bounce * 0.2;
          p.lShin.x = p.rShin.x = bounce * 0.4;
          p.lFoot.x = p.rFoot.x = -(p.lThigh.x + p.lShin.x);
        }
        p.head.z += sin(k) * 0.15;
        break;
      }
      case 'think':
        p.rUpper.x = -0.95;
        p.rUpper.z = -0.15;
        p.rUpper.y = 0.35;
        p.rFore.x = -2.2;
        p.rFore.y = 0.2;
        p.lUpper.x = -0.55;
        p.lUpper.z = 0.2;
        p.lUpper.y = -0.4;
        p.lFore.x = -1.4;
        p.lFore.y = -0.6;
        p.head.z += 0.16;
        p.head.x += 0.06;
        p.head.y += sin(et * 1.4) * 0.2;
        break;
      case 'heart':
        p.lUpper.x = -0.35;
        p.lUpper.z = 2.35;
        p.rUpper.x = -0.35;
        p.rUpper.z = -2.35;
        p.lFore.x = -0.2;
        p.lFore.z = 1.5;
        p.rFore.x = -0.2;
        p.rFore.z = -1.5;
        p.head.z += sin(et * 3) * 0.08;
        break;
      case 'laugh':
        p.chest.x = -0.18 + sin(et * 20) * 0.04;
        p.head.x -= 0.25;
        p.lUpper.x = -0.25;
        p.rUpper.x = -0.25;
        p.lFore.x = -1.4;
        p.rFore.x = -1.4;
        p.lFore.y = -0.6;
        p.rFore.y = 0.6;
        p.hp.y += Math.abs(sin(et * 10)) * 0.01;
        break;
      case 'toast':
        p.rUpper.x = -1.25;
        p.rUpper.z = -0.2;
        p.rFore.x = -0.9;
        break;
      case 'coffee': {
        const sip = Math.max(0, sin(et * 1.6 - 0.8));
        p.rUpper.x = -0.45 - 0.45 * sip;
        p.rUpper.z = -0.15;
        p.rUpper.y = 0.25;
        p.rFore.x = -1.3 - 0.75 * sip;
        p.rFore.y = 0.35;
        p.head.x -= 0.15 * sip;
        break;
      }
    }
  }

  private apply(p: Pose) {
    for (const k of JOINTS) {
      const r = p[k];
      this.j[k].rotation.set(r.x, r.y, r.z);
    }
    this.j.hips.position.set(p.hp.x, p.hp.y, p.hp.z);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as THREE.Material;
        mat.dispose();
      }
    });
  }
}

export const PROCEDURAL_HAIR = [
  { id: 'short', label: 'Tóc ngắn' },
  { id: 'spiky', label: 'Tóc dựng' },
  { id: 'curly', label: 'Tóc xoăn' },
  { id: 'bob', label: 'Tóc bob' },
  { id: 'long', label: 'Tóc dài' },
  { id: 'ponytail', label: 'Buộc đuôi ngựa' },
  { id: 'bun', label: 'Búi tóc' },
  { id: 'none', label: 'Không tóc' },
];
