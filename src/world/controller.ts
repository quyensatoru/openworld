// Local player movement: keyboard (camera-relative), click-to-move paths, smooth sit/stand, and
// the vertical half — gravity, jumping and standing on top of the furniture.
import {
  COYOTE_TIME,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_V0,
  PLAYER_RADIUS,
  STEP_UP,
  groundAt,
  resolveCollision,
  supportAt,
  type Rect,
  type Seat,
} from '../../shared/map';
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
  /** Feet height, in world units: the floor you are on plus anything you have climbed onto. */
  y: number;
  /** Surface right under the feet — equal to `y` unless you are in the air. */
  supportY: number;
  ry: number;
  vx = 0;
  vz = 0;
  /** Vertical speed (jumping / falling). */
  vy = 0;
  /** Feet on something solid. */
  onGround = true;
  speed = 0;
  anim: AnimState = 'idle';
  seat: Seat | null = null;
  keys = new Set<string>();
  /** analog stick (phones): x = right, y = forward, both -1..1 */
  stick = { x: 0, y: 0 };
  run = false;
  private path: { x: number; z: number }[] | null = null;
  private pathRun = false;
  private onArrive: (() => void) | null = null;
  private trans: { from: { x: number; z: number; ry: number }; to: { x: number; z: number; ry: number }; t: number; dur: number; done: () => void } | null = null;

  /** Jump pressed a moment ago — used as soon as the feet are back on something. */
  private jumpBuf = 0;
  /** Time left to still jump after walking off an edge. */
  private coyote = 0;

  /** Called when the player starts moving away from a seat. */
  onStandUp: (() => void) | null = null;
  /** Called the moment a jump actually leaves the ground (plays and broadcasts the animation). */
  onJump: (() => void) | null = null;
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
    this.y = this.supportY = groundAt(x, z);
  }

  /** In the air (jumping or falling) — the avatar holds its jump pose. */
  get airborne(): boolean {
    return !this.onGround;
  }

  /** Space / the phone's jump button. Buffered, so pressing just before landing still works. */
  requestJump() {
    if (this.seat || this.trans || this.locked) return;
    this.jumpBuf = JUMP_BUFFER;
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
    this.groundTo(groundAt(seat.x, seat.z));
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
      this.groundTo(groundAt(this.x, this.z));
      if (tr.t >= tr.dur) {
        this.trans = null;
        tr.done();
      }
      return;
    }

    if (this.locked) {
      // frozen (a meeting) or riding the lift — put the feet down; a lift ride overwrites our
      // height right after this, in the engine's updateFloors
      this.vx = this.vz = 0;
      this.speed = 0;
      this.anim = 'idle';
      this.groundTo(supportAt(this.x, this.z, this.y + STEP_UP));
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
    // the on-screen stick: pushed far = run
    const sm = Math.hypot(this.stick.x, this.stick.y);
    let stickRun = false;
    if (!ix && !iy && sm > 0.18) {
      ix = this.stick.x;
      iy = this.stick.y;
      stickRun = sm > 0.85;
    }

    if (this.seat) {
      this.groundTo(groundAt(this.x, this.z));
      if (ix || iy) this.standUp();
      return;
    }

    let wx = 0;
    let wz = 0;
    let running = this.run || stickRun;
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
    // whatever we are standing on is walked over, not bumped into; in the air we only clear what
    // our feet are actually above, so we don't slide through the side of a desk on the way up
    const res = resolveCollision(this.rects, nx, nz, PLAYER_RADIUS, this.y + (this.onGround ? STEP_UP : 0.05));
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
    this.fall(dt);
  }

  /** Seated / riding / being moved about: feet flat on `y`, nothing in flight. */
  private groundTo(y: number) {
    this.y = this.supportY = y;
    this.vy = 0;
    this.onGround = true;
    this.jumpBuf = 0;
    this.coyote = 0;
  }

  /** Gravity, jumping, landing — and walking up small steps or down slopes without leaving the floor. */
  private fall(dt: number) {
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    const wasOnGround = this.onGround;
    // how far up we can reach from here: a step while walking, nothing much while flying up
    const reach = this.vy > 0 ? 0.02 : STEP_UP;
    const sup = supportAt(this.x, this.z, this.y + reach);

    if (this.jumpBuf > 0 && (this.onGround || this.coyote > 0)) {
      this.jumpBuf = 0;
      this.coyote = 0;
      this.vy = JUMP_V0;
      this.onGround = false;
      this.onJump?.();
    }

    // midpoint step: the arc reaches exactly JUMP_H whatever the frame rate is — plain Euler loses
    // a third of the height at 10 fps, which is the difference between landing on a desk and not
    let ny = this.y + (this.vy - 0.5 * GRAVITY * dt) * dt;
    this.vy -= GRAVITY * dt;
    // walking down a slope or a shallow step: stay glued to it instead of taking off
    const glue = wasOnGround && this.vy <= 0 ? Math.max(0.06, this.speed * dt * 1.6) : 0;
    if (this.vy <= 0 && ny <= sup + glue) {
      ny = sup;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    this.y = ny;
    this.supportY = sup;
  }
}
