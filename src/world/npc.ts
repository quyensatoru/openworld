// Bar staff: three non-player characters in the Office Bar (a bartender behind the counter, a waitress
// doing rounds between the tables, a DJ at the decks). Their routines are pure functions of the
// shared server clock, so everyone in the bar sees them in the same place doing the same thing.
import * as THREE from 'three';
import type { AvatarConfig } from '../../shared/avatar';
import { FLOOR_H, visualX } from '../../shared/map';
import type { AnimState, Emote, PlayerState } from '../../shared/protocol';
import { avatars } from './avatar/manifest';
import type { Avatar } from './avatar/types';
import { VrmAvatar } from './avatar/vrm-avatar';
import { blobShadow } from './blob';
import { NameTag } from './overlays';
import { attach } from './attach';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** What the camera sees this frame (from the engine). */
export interface StaffView {
  inView(p: THREE.Vector3, h: number): boolean;
  cam: THREE.Vector3;
  /** the camera is in the cinema: the bar is behind a wall */
  hideBar: boolean;
}

interface Pose {
  x: number;
  z: number;
  ry: number;
  moving: boolean;
}

interface Staff {
  name: string;
  role: string;
  cfg: AvatarConfig;
  pose(t: number): Pose;
  /** Emote to start at second `t` of the routine (checked once per whole second). */
  emoteAt?(sec: number): Emote | null;
  holder: THREE.Group;
  avatar: Avatar | null;
  /** VRoid character (loaded the first time you go upstairs); otherwise a built-in body. */
  vrm?: { url: string; height: number };
  tag: NameTag;
  x: number;
  z: number;
  speed: number;
  lastSec: number;
  override: { x: number; until: number; line: string | null } | null;
  /** animation time not yet given to the avatar (off screen / far away) */
  animAcc: number;
  lod: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (t: number) => t * t * (3 - 2 * t);
function hash(n: number): number {
  let h = Math.imul(n ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------------- routines
const BAR_SPOTS = [88.8, 90.6, 92.4, 94.2, 96.0];
const BAR_Z = 1.75;
const BAR_PERIOD = 9;
function bartenderPose(t: number): Pose {
  const k = Math.floor(t / BAR_PERIOD);
  const from = BAR_SPOTS[Math.floor(hash(k - 1) * BAR_SPOTS.length)];
  const to = BAR_SPOTS[Math.floor(hash(k) * BAR_SPOTS.length)];
  const s = t - k * BAR_PERIOD;
  const walk = Math.abs(to - from) / 1.0;
  if (s < walk) return { x: lerp(from, to, ease(s / walk)), z: BAR_Z, ry: to > from ? Math.PI / 2 : -Math.PI / 2, moving: true };
  return { x: to, z: BAR_Z, ry: 0, moving: false };
}

// waitress: rounds around the dance floor, pausing at the booths, the high tables and the counter
const LOOP: { x: number; z: number; ry: number; pause: number }[] = [
  { x: 87.8, z: 6.3, ry: -Math.PI / 2, pause: 4 },
  { x: 87.8, z: 10.5, ry: -Math.PI / 2, pause: 4 },
  { x: 87.8, z: 14.6, ry: -Math.PI / 2, pause: 4 },
  { x: 88.6, z: 15.8, ry: Math.PI * 0.85, pause: 3 },
  { x: 96.0, z: 15.8, ry: Math.PI * 0.2, pause: 4 },
  { x: 96.0, z: 6.0, ry: Math.PI, pause: 3 },
  { x: 91.5, z: 5.6, ry: Math.PI, pause: 5 },
];
const WALK = 1.05;
const LEGS = LOOP.map((p, i) => {
  const n = LOOP[(i + 1) % LOOP.length];
  return { from: p, to: n, walk: Math.hypot(n.x - p.x, n.z - p.z) / WALK };
});
const LOOP_T = LEGS.reduce((a, l) => a + l.from.pause + l.walk, 0);
function waitressPose(t: number): Pose {
  let s = ((t % LOOP_T) + LOOP_T) % LOOP_T;
  for (const l of LEGS) {
    if (s < l.from.pause) return { x: l.from.x, z: l.from.z, ry: l.from.ry, moving: false };
    s -= l.from.pause;
    if (s < l.walk) {
      const k = s / l.walk;
      return { x: lerp(l.from.x, l.to.x, k), z: lerp(l.from.z, l.to.z, k), ry: Math.atan2(l.to.x - l.from.x, l.to.z - l.from.z), moving: true };
    }
    s -= l.walk;
  }
  return { x: LOOP[0].x, z: LOOP[0].z, ry: LOOP[0].ry, moving: false };
}

/** Dancers on the corners of the LED floor, facing the middle and swaying. */
const FLOOR_C = { x: 92, z: 10.5 };
function dancerPose(x: number, z: number, phase: number) {
  const base = Math.atan2(FLOOR_C.x - x, FLOOR_C.z - z);
  return (t: number): Pose => ({ x, z, ry: base + Math.sin(t * 0.7 + phase) * 0.6, moving: false });
}
function dancerMoves(offset: number) {
  return (sec: number): Emote | null => {
    if ((sec + offset) % 5 !== 0) return null;
    const r = hash(sec * 31 + offset);
    return r < 0.12 ? 'cheer' : r < 0.2 ? 'clap' : 'dance';
  };
}

const VRM = (file: string, height = 1.6) => ({ url: `/models/vrm/${file}`, height });
/** Bar staff played by VRoid sample characters (CC0, see assets-src/vrm). */
const STAFF_VRM: Record<string, { url: string; height: number }> = {
  Linh: VRM('sendagaya-shino.vrm', 1.62),
  Mai: VRM('vivi.vrm', 1.56),
  'DJ Vy': VRM('vita.vrm', 1.6),
  Hà: VRM('victoria-rubin.vrm', 1.6),
  Trang: VRM('darkness-shibu.vrm', 1.6),
  Ngân: VRM('sendagaya-shibu.vrm', 1.58),
};

function cfg(over: Partial<AvatarConfig>): AvatarConfig {
  const female = (over.body ?? 'female') === 'female';
  return {
    body: 'female',
    hair: 'long',
    skin: '#ffe0c7',
    ...(female ? { look: 'model' as const } : {}),
    hairColor: '#1f1a17',
    top: '#2d3142',
    bottom: '#333333',
    shoes: '#333333',
    sleeves: 'short',
    build: 'slim',
    accessories: [],
    height: 0.98,
    ...over,
  };
}

export class BarStaff {
  private staff: Staff[] = [];
  private visible = false;
  private loading = false;
  private loadingDone: Promise<void> | null = null;

  constructor(
    private scene: THREE.Scene,
    private lookTarget?: THREE.Object3D,
  ) {
    this.add('Linh', '🍸 Pha chế', cfg({ hair: 'buns', top: '#14121a', bottom: '#14121a', shoes: '#14121a', sleeves: 'long' }), bartenderPose, (sec) => {
      const r = hash(sec * 7 + 3);
      return r < 0.05 ? 'wave' : r < 0.12 ? 'think' : null;
    });
    this.add('Mai', '🍹 Phục vụ', cfg({ hair: 'long', hairColor: '#6b4426', top: '#ff3ea5', bottom: '#1d1b22', skin: '#f6cfae' }), waitressPose, (sec) => (hash(sec * 13 + 1) < 0.035 ? 'wave' : null));
    this.add(
      'DJ Vy',
      '🎧 DJ',
      cfg({ hair: 'pixie', hairColor: '#d46aa6', top: '#2de2e6', bottom: '#2de2e6', shoes: '#1d1b22', accessories: ['headphones'], height: 1.0, outfit: 'swim' }),
      () => ({ x: 99.45, z: 10.5, ry: -Math.PI / 2, moving: false }),
      (sec) => (sec % 6 === 0 ? (hash(sec) < 0.25 ? 'cheer' : 'dance') : null),
    );
    // dance crew: party outfits, on opposite corners of the LED floor (the two male dancers were
    // dropped — the bar was the heaviest room in the office)
    this.add('Hà', '💃 Vũ công', cfg({ hair: 'long', hairColor: '#d9b26f', top: '#e8c547', bottom: '#e8c547', shoes: '#e8c547', outfit: 'swim' }), dancerPose(89.7, 8.2, 0), dancerMoves(0));
    this.add('Trang', '💃 Vũ công', cfg({ hair: 'buns', hairColor: '#a23b3b', top: '#ff3ea5', bottom: '#ff3ea5', shoes: '#ff3ea5', outfit: 'swim' }), dancerPose(94.3, 12.8, 3.1), dancerMoves(1));
    this.add('Ngân', '🌸 Lễ tân', cfg({}), () => ({ x: 93.4, z: 18.4, ry: -0.97, moving: false }), (sec) => (sec % 9 === 0 ? (hash(sec) < 0.5 ? 'wave' : 'heart') : null));
  }

  private add(name: string, role: string, c: AvatarConfig, pose: (t: number) => Pose, emoteAt?: (sec: number) => Emote | null) {
    const holder = new THREE.Group();
    holder.visible = false;
    this.scene.add(holder);
    const tag = new NameTag(false);
    tag.update({ name, status: 'online', media: { mic: false, cam: false, screen: false }, statusText: role, pomo: null } as unknown as PlayerState, null);
    const vrm = STAFF_VRM[name];
    tag.object.position.set(0, vrm ? vrm.height + 0.28 : 1.95 * c.height, 0);
    holder.add(tag.object);
    holder.add(blobShadow()); // shown on battery saver only (no shadow map then)
    const s: Staff = { name, role, cfg: c, pose, emoteAt, holder, avatar: null, tag, x: 0, z: 0, speed: 0, lastSec: -1, override: null, vrm, animAcc: 0, lod: this.staff.length % 2 };
    this.staff.push(s);
    if (!vrm)
      avatars.create(c).then((av) => {
        s.avatar = av;
        holder.add(av.root);
      });
  }

  /**
   * Fetch the VRoid models one by one in the background (started right after you enter the
   * office), handing each to `warm` so its shaders/textures are ready before anyone goes upstairs.
   */
  preload(warm?: (root: THREE.Object3D) => Promise<void>): Promise<void> {
    this.loadingDone ??= this.loadVrms(warm);
    return this.loadingDone;
  }

  /** All character holders (for a one-off warm-up render). */
  holders(): THREE.Group[] {
    return this.staff.map((s) => s.holder);
  }

  /** Put every loaded character back into the scene (a warm-up render); update() takes out the ones not drawn. */
  attachAll() {
    for (const s of this.staff) if (s.avatar) s.holder.add(s.avatar.root);
  }

  /** The loaded characters (culled one by one while off screen). */
  roots(): THREE.Object3D[] {
    return this.staff.flatMap((s) => (s.avatar ? [s.avatar.root] : []));
  }

  /** Name tags (placed by the engine). */
  tagObjects(out: CSS2DObject[]) {
    for (const s of this.staff) out.push(s.tag.object);
  }

  private async loadVrms(warm?: (root: THREE.Object3D) => Promise<void>) {
    this.loading = true;
    for (const s of this.staff) {
      if (!s.vrm || s.avatar) continue;
      try {
        const av = await VrmAvatar.load(s.vrm.url, s.vrm.height, this.lookTarget);
        // shaders and textures first, then into the scene: whoever is in the bar sees her appear
        // ready, instead of the frame that first draws her compiling and uploading everything
        await warm?.(av.root);
        s.avatar = av;
        s.holder.add(av.root);
      } catch (err) {
        // fall back to the built-in body
        console.warn('[staff] VRM failed, using the default body', s.name, err);
        const av = await avatars.create(s.cfg);
        s.avatar = av;
        s.holder.add(av.root);
      }
      await new Promise((r) => setTimeout(r, 250)); // let a few frames through between models
    }
  }

  /** A staff member within reach of (x, z) raises her glass back at you; returns her name. */
  toastNear(x: number, z: number, reach = 2.6): string | null {
    let best: Staff | null = null;
    let bd = reach;
    for (const s of this.staff) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd && s.avatar) (bd = d), (best = s);
    }
    if (!best) return null;
    best.avatar!.emote('toast');
    best.tag.confetti();
    return best.name;
  }

  /** The bartender comes over to (logical) x on the counter and hands over a drink. */
  serve(x: number, now: number, line: string) {
    const b = this.staff[0];
    b.override = { x: Math.min(96, Math.max(88.4, x)), until: now + 9, line };
  }

  /**
   * `now`: shared clock in seconds. `show`: you are upstairs (otherwise they are hidden and idle).
   * Eight people, six of them detailed VRoid models: only the ones on screen are drawn and animated,
   * the far ones every other frame, and none while the camera is in the cinema.
   */
  update(dt: number, now: number, show: boolean, view?: StaffView) {
    const on = show && !view?.hideBar;
    if (on !== this.visible) {
      this.visible = on;
      for (const s of this.staff) {
        s.holder.visible = on;
        s.lastSec = -1; // back in sight: snap to where the routine is now
      }
    }
    if (show && !this.loading && !this.loadingDone) void this.preload();
    if (!on) {
      for (const s of this.staff) if (s.avatar) attach(s.avatar.root, s.holder, false);
      return;
    }
    for (const s of this.staff) {
      let p = s.pose(now);
      const o = s.override;
      if (o) {
        if (now > o.until) s.override = null;
        else {
          const d = o.x - s.x;
          const moving = Math.abs(d) > 0.08;
          p = { x: moving ? s.x + Math.sign(d) * Math.min(Math.abs(d), 1.2 * dt) : o.x, z: BAR_Z, ry: moving ? (d > 0 ? Math.PI / 2 : -Math.PI / 2) : 0, moving };
          if (!moving && o.line) {
            s.tag.say(o.line);
            s.avatar?.emote('coffee');
            o.line = null;
          }
        }
      }
      const px = s.x;
      const pz = s.z;
      // first frame: snap; afterwards follow the routine smoothly
      if (s.lastSec < 0) {
        s.x = p.x;
        s.z = p.z;
      } else {
        s.x += (p.x - s.x) * Math.min(1, dt * 12);
        s.z += (p.z - s.z) * Math.min(1, dt * 12);
      }
      const inst = dt > 0 ? Math.hypot(s.x - px, s.z - pz) / dt : 0;
      s.speed += ((p.moving ? Math.max(inst, 0.9) : 0) - s.speed) * Math.min(1, dt * 8);
      s.holder.position.set(visualX(s.x), FLOOR_H, s.z);
      const dr = Math.atan2(Math.sin(p.ry - s.holder.rotation.y), Math.cos(p.ry - s.holder.rotation.y));
      s.holder.rotation.y += dr * Math.min(1, dt * 7);
      const sec = Math.floor(now);
      if (sec !== s.lastSec) {
        if (s.lastSec >= 0 && !p.moving) {
          const e = s.emoteAt?.(sec);
          if (e) s.avatar?.emote(e);
        }
        s.lastSec = sec;
      }
      const anim: AnimState = s.speed > 0.15 ? 'walk' : 'idle';
      const seen = !view || view.inView(s.holder.position, s.vrm?.height ?? 1.75 * s.cfg.height);
      if (s.avatar) attach(s.avatar.root, s.holder, seen);
      s.animAcc = Math.min(0.1, s.animAcc + dt);
      if (!seen) continue;
      s.lod ^= 1;
      const d2 = view ? view.cam.distanceToSquared(s.holder.position) : 0;
      if (s.lod && d2 > 12 * 12) continue;
      const adt = s.animAcc;
      s.animAcc = 0;
      s.avatar?.update(adt, { speed: s.speed, anim, seatKind: null, lookAt: null, talking: false, far: d2 > 15 * 15, mid: d2 > 7 * 7 });
    }
  }
}
