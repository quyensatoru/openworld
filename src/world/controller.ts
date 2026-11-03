// Local player movement: keyboard (camera-relative), click-to-move paths, smooth sit/stand.
import { resolveCollision, type Rect, type Seat } from '../../shared/map';
import type { AnimState } from '../../shared/protocol';
import type { NavGrid } from './pathfinding';

export const WALK_SPEED = 1.3;
export const RUN_SPEED = 4.2;

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export const angleDamp = (cur: number, target: number, rate: number, dt: number) => {
  const d = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  return cur + d * (1 - Math.exp(-rate * dt));
};
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Point where you stand before sitting down / after getting up. */
export function seatApproach(seat: Seat): { x: number; z: number } {
  const fx = Math.sin(seat.ry);
  const fz = Math.cos(seat.ry);
  const d = seat.kind === 'sofa' || seat.kind === 'cinema' ? 0.7 : -0.7; // sofas/cinema rows: in front; chairs at tables: behind
  return { x: seat.x + fx * d, z: seat.z + fz * d };
}

export class LocalController {
  x: number;
  z: number;
  ry: number;
  vx = 0;
  vz = 0;
  speed = 0;
  anim: AnimState = 'idle';
  seat: Seat | null = null;
  keys = new Set<string>();
  run = false;
  private path: { x: number; z: number }[] | null = null;
  private pathRun = false;
  private onArrive: (() => void) | null = null;
  private trans: { from: { x: number; z: number; ry: number }; to: { x: number; z: number; ry: number }; t: number; dur: number; done: () => void } | null = null;

  /** Called when the player starts moving away from a seat. */
  onStandUp: (() => void) | null = null;
  /** Riding the lift: no walking, the engine moves us. */
  locked = false;

  constructor(
    x: number,
    z: number,
    ry: number,
    private nav: NavGrid,
    private rects: Rect[],
  ) {
    this.x = x;
    this.z = z;
    this.ry = ry;
  }

  get busy(): boolean {
    return this.trans != null;
  }

  get hasPath(): boolean {
    return this.path != null;
  }

  goTo(x: number, z: number, onArrive?: () => void, forceRun?: boolean): boolean {
    if (this.seat) this.standUp();
    const path = this.nav.findPath(this.x, this.z, x, z);
    if (!path || !path.length) return false;
    this.path = path;
    const dist = path.reduce((acc, p, i) => acc + Math.hypot(p.x - (i ? path[i - 1].x : this.x), p.z - (i ? path[i - 1].z : this.z)), 0);
    this.pathRun = forceRun ?? dist > 9;
    this.onArrive = onArrive ?? null;
    return true;
  }

  cancelPath() {
    this.path = null;
    this.onArrive = null;
  }

  /** Change floor (logical x jumps by ±UP_DX; the drawn position does not move). */
  shiftX(dx: number) {
    this.x += dx;
    if (this.path) for (const p of this.path) p.x += dx;
    if (this.trans) {
      this.trans.from.x += dx;
      this.trans.to.x += dx;
    }
  }

  sitOn(seat: Seat) {
    this.cancelPath();
    this.seat = seat;
    this.anim = 'sit';
    this.trans = {
      from: { x: this.x, z: this.z, ry: this.ry },
      to: { x: seat.x, z: seat.z, ry: seat.ry },
      t: 0,
      dur: 0.45,
      done: () => {},
    };
  }

  /** Server confirmed a seat (e.g. after reconnect) — snap without animation. */
  snapSeat(seat: Seat) {
    this.seat = seat;
    this.anim = 'sit';
    this.x = seat.x;
    this.z = seat.z;
    this.ry = seat.ry;
  }

  standUp(after?: () => void) {
    if (!this.seat) return;
    const seat = this.seat;
    const a = seatApproach(seat);
    const free = this.nav.isFree(a.x, a.z) ? a : this.nav.nearestFree(a.x, a.z) ?? a;
    this.seat = null;
    this.anim = 'idle';
    this.onStandUp?.();
    this.trans = {
      from: { x: this.x, z: this.z, ry: this.ry },
      to: { x: free.x, z: free.z, ry: seat.ry },
      t: 0,
      dur: 0.5,
      done: () => after?.(),
    };
  }

  /** `turnMode` (first person): A/D and ←/→ turn instead of strafing, so they are ignored here. */
  update(dt: number, camYaw: number, turnMode = false) {
    // seated / transitions lock movement
    if (this.trans) {
      const tr = this.trans;
      tr.t += dt;
      const k = ease(Math.min(1, tr.t / tr.dur));
      this.x = tr.from.x + (tr.to.x - tr.from.x) * k;
      this.z = tr.from.z + (tr.to.z - tr.from.z) * k;
      this.ry = tr.from.ry + Math.atan2(Math.sin(tr.to.ry - tr.from.ry), Math.cos(tr.to.ry - tr.from.ry)) * k;
      this.vx = this.vz = 0;
      this.speed = 0;
      if (tr.t >= tr.dur) {
        this.trans = null;
        tr.done();
      }
      return;
    }

    if (this.locked) {
      this.vx = this.vz = 0;
      this.speed = 0;
      this.anim = 'idle';
      return;
    }

    let ix = 0;
    let iy = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (!turnMode) {
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    }

    if (this.seat) {
      if (ix || iy) this.standUp();
      return;
    }

    let wx = 0;
    let wz = 0;
    let running = this.run;
    if (ix || iy) {
      this.cancelPath();
      const fx = -Math.sin(camYaw);
      const fz = -Math.cos(camYaw);
      const rx = Math.cos(camYaw);
      const rz = -Math.sin(camYaw);
      wx = rx * ix + fx * iy;
      wz = rz * ix + fz * iy;
      const l = Math.hypot(wx, wz);
      wx /= l;
      wz /= l;
    } else if (this.path) {
      running = this.pathRun || this.run;
      const wp = this.path[0];
      const dx = wp.x - this.x;
      const dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      const last = this.path.length === 1;
      if (d < (last ? 0.08 : 0.3)) {
        this.path.shift();
        if (!this.path.length) {
          this.path = null;
          const cb = this.onArrive;
          this.onArrive = null;
          cb?.();
        }
      } else {
        wx = dx / d;
        wz = dz / d;
        // slow down on the final approach for a soft stop
        if (last && d < 0.6) {
          wx *= Math.max(0.35, d / 0.6);
          wz *= Math.max(0.35, d / 0.6);
        }
      }
    }

    const target = running ? RUN_SPEED : WALK_SPEED;
    const accel = wx || wz ? 9 : 12;
    this.vx = damp(this.vx, wx * target, accel, dt);
    this.vz = damp(this.vz, wz * target, accel, dt);
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const res = resolveCollision(this.rects, nx, nz);
    // keep velocity consistent with what actually happened (sliding along walls)
    if (dt > 0) {
      this.vx = (res.x - this.x) / dt;
      this.vz = (res.z - this.z) / dt;
    }
    this.x = res.x;
    this.z = res.z;
    this.speed = Math.hypot(this.vx, this.vz);
    if (this.speed > 0.05) this.ry = angleDamp(this.ry, Math.atan2(this.vx, this.vz), 11, dt);
    this.anim = this.speed > 3 ? 'run' : this.speed > 0.12 ? 'walk' : 'idle';
  }
}
