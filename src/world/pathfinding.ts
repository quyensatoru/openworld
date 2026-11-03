// A* over a 0.25 m navigation grid built from the shared obstacle rectangles.
import { WORLD_D as OFFICE_D, WORLD_W as OFFICE_W, PLAYER_RADIUS, obstacleRects, type Rect } from '../../shared/map';

const CELL = 0.25;
const GW = Math.ceil(OFFICE_W / CELL);
const GH = Math.ceil(OFFICE_D / CELL);

export class NavGrid {
  readonly rects: Rect[] = obstacleRects();
  private blocked = new Uint8Array(GW * GH);

  constructor() {
    // mark cells per obstacle (fast even for the 160 m wide logical world)
    const pad = PLAYER_RADIUS + 0.04;
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x = (i + 0.5) * CELL;
        const z = (j + 0.5) * CELL;
        if (x < 0.3 || z < 0.3 || x > OFFICE_W - 0.3 || z > OFFICE_D - 0.3) this.blocked[j * GW + i] = 1;
      }
    }
    for (const r of this.rects) {
      const i0 = Math.max(0, Math.floor((r.x0 - pad) / CELL - 0.5));
      const i1 = Math.min(GW - 1, Math.ceil((r.x1 + pad) / CELL - 0.5));
      const j0 = Math.max(0, Math.floor((r.z0 - pad) / CELL - 0.5));
      const j1 = Math.min(GH - 1, Math.ceil((r.z1 + pad) / CELL - 0.5));
      for (let j = j0; j <= j1; j++) {
        const z = (j + 0.5) * CELL;
        if (!(z > r.z0 - pad && z < r.z1 + pad)) continue;
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * CELL;
          if (x > r.x0 - pad && x < r.x1 + pad) this.blocked[j * GW + i] = 1;
        }
      }
    }
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.max(0, Math.min(GW - 1, Math.floor(x / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(z / CELL)))];
  }

  isFree(x: number, z: number): boolean {
    const [i, j] = this.cellOf(x, z);
    return !this.blocked[j * GW + i];
  }

  /** Nearest free cell centre (spiral search). */
  nearestFree(x: number, z: number): { x: number; z: number } | null {
    const [ci, cj] = this.cellOf(x, z);
    for (let rad = 0; rad < 24; rad++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let j = cj - rad; j <= cj + rad; j++) {
        for (let i = ci - rad; i <= ci + rad; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== rad) continue;
          if (i < 0 || j < 0 || i >= GW || j >= GH || this.blocked[j * GW + i]) continue;
          const d = (i - ci) ** 2 + (j - cj) ** 2;
          if (d < bestD) {
            bestD = d;
            best = [i, j];
          }
        }
      }
      if (best) return { x: (best[0] + 0.5) * CELL, z: (best[1] + 0.5) * CELL };
    }
    return null;
  }

  private lineFree(ax: number, az: number, bx: number, bz: number): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] | null {
    const goal = this.isFree(tx, tz) ? { x: tx, z: tz } : this.nearestFree(tx, tz);
    if (!goal) return null;
    const start = this.isFree(sx, sz) ? { x: sx, z: sz } : this.nearestFree(sx, sz) ?? { x: sx, z: sz };
    if (this.lineFree(start.x, start.z, goal.x, goal.z)) return [goal];

    const [si, sj] = this.cellOf(start.x, start.z);
    const [gi, gj] = this.cellOf(goal.x, goal.z);
    const N = GW * GH;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const sIdx = sj * GW + si;
    const gIdx = gj * GW + gi;
    g[sIdx] = 0;
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - gi);
      const dz = Math.abs(j - gj);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    heap.push(sIdx, h(si, sj));
    let found = false;
    let iterations = 0;
    while (heap.size && iterations++ < 40000) {
      const cur = heap.pop();
      if (cur === gIdx) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % GW;
      const cj = (cur / GW) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const n = nj * GW + ni;
          if (this.blocked[n] || closed[n]) continue;
          if (di && dj && (this.blocked[cj * GW + ni] || this.blocked[nj * GW + ci])) continue; // no corner cutting
          const cost = g[cur] + (di && dj ? Math.SQRT2 : 1);
          if (cost < g[n]) {
            g[n] = cost;
            came[n] = cur;
            heap.push(n, cost + h(ni, nj));
          }
        }
      }
    }
    if (!found) return null;
    const cells: { x: number; z: number }[] = [];
    for (let c = gIdx; c !== -1 && c !== sIdx; c = came[c]) cells.push({ x: ((c % GW) + 0.5) * CELL, z: (((c / GW) | 0) + 0.5) * CELL });
    cells.reverse();
    cells[cells.length - 1] = goal;
    // String-pulling: keep only the waypoints needed for straight segments.
    const out: { x: number; z: number }[] = [];
    let ax = start.x;
    let az = start.z;
    let k = 0;
    while (k < cells.length) {
      let far = k;
      for (let m = cells.length - 1; m > k; m--) {
        if (this.lineFree(ax, az, cells[m].x, cells[m].z)) {
          far = m;
          break;
        }
      }
      out.push(cells[far]);
      ax = cells[far].x;
      az = cells[far].z;
      k = far + 1;
    }
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < n && keys[l] < mk) {
          m = l;
          mk = keys[l];
        }
        if (r < n && keys[r] < mk) m = r;
        if (m === i) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
