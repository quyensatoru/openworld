// Builds the whole office scene from shared/map.ts and exposes its dynamic parts.
// Two floors: the ground floor is drawn as-is; everything with a logical x >= 50 (the upper floor)
// goes into `upstairs`, a group shifted by (-UP_DX, FLOOR_H, 0) so it sits right above the office.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  FURNITURE,
  INTERACTABLES,
  OFFICE_D,
  OFFICE_W,
  SEATS,
  WALLS,
  WALL_H,
  WALL_T,
  ZONES,
  ZONE_BY_ID,
  BAR,
  CINEMA,
  CINEMA_SCREEN,
  CINEMA_WALL_H,
  DOORS,
  DOOR_H,
  FLOOR_H,
  HALL4,
  KARA,
  KARA_SCREEN,
  LIFTS,
  NET,
  ROOF4,
  ROOF5,
  WOLF,
  NET_SCREEN,
  STAIRWAYS,
  TOP,
  type Stairway,
  STAIR_STEPS,
  UP,
  UP_DX,
  UP_WALL_H,
  floorOf,
  type Door,
  type Lift,
  type Rect,
  type Seat,
  type Wall,
} from '../../shared/map';
import { COLUMNS, PRIORITY_META, type Task } from '../../shared/protocol';
import { ROOM_META, type MoleRoom } from '../../shared/mole';
import { BarFx } from './bar';
import { KaraokeFx, WolfFx } from './floor4';
import { Floor5Fx } from './floor5';
import { buildFurniture, rbox, seatModel, tree, type Dynamic } from './furniture';
import { C, canvasTexture, codeScreenTexture, floorTexture, mat, type FloorKind } from './materials';
import { drawSnake, gameScreenTexture } from '../arcade/draw';
import type { SnakeFrame } from '../../shared/arcade';

const FLOOR_TINT: Record<string, string> = {
  library: '#c3cce0',
  lounge: '#e2d3bf',
  workspace: '#d9b98c',
  meetA: '#c9d2e6',
  meetB: '#e0cbd4',
  pantry: '#ece4d6',
  lobby: '#e2dbcd',
  cinema: '#3a2d44',
  bar: '#4a3a33',
  hall2: '#ddd6cb',
  netcafe: '#2a2f45',
  hall3: '#d6d9df',
  karaoke: '#3a2a52',
  wolfroom: '#7a5a40',
  hall4: '#ddd8cf',
};

/** Openings in each floor's slab (logical coords of that floor): the stairwell below + the lift. */
const HOLES: Rect[][] = [0, 1, 2, 3, 4].map((f) => [
  ...STAIRWAYS.filter((s) => s.lower === f - 1).map((s) => ({ x0: s.x0 + f * UP_DX, z0: s.z0, x1: s.x1 + f * UP_DX, z1: OFFICE_D })),
  ...LIFTS.filter((l) => f > 0 && l.floor === f).map((l) => ({ x0: l.x0, z0: l.z0, x1: l.x1, z1: l.z1 })),
]);
/** The openings of the floor above, in this floor's coords (holes in this floor's ceiling). */
const holesAbove = (f: number): Rect[] => (HOLES[f + 1] ?? []).map((h) => ({ ...h, x0: h.x0 - UP_DX, x1: h.x1 - UP_DX }));
/** Floor 3 only covers the bar + hall: an L around the cinema's roof. */
const TOP_PARTS: Rect[] = [
  { x0: NET.x0, z0: TOP.z0, x1: TOP.x1, z1: NET.z1 },
  { x0: TOP.x0, z0: NET.z1, x1: TOP.x1, z1: TOP.z1 },
];

/** rect minus holes → list of rects (simple guillotine cut). */
function subtract(r: Rect, holes: Rect[]): Rect[] {
  let parts: Rect[] = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const p of parts) {
      if (h.x1 <= p.x0 || h.x0 >= p.x1 || h.z1 <= p.z0 || h.z0 >= p.z1) {
        next.push(p);
        continue;
      }
      if (h.z0 > p.z0) next.push({ ...p, z1: h.z0 });
      if (h.z1 < p.z1) next.push({ ...p, z0: h.z1 });
      const z0 = Math.max(p.z0, h.z0);
      const z1 = Math.min(p.z1, h.z1);
      if (h.x0 > p.x0) next.push({ x0: p.x0, x1: h.x0, z0, z1 });
      if (h.x1 < p.x1) next.push({ x0: h.x1, x1: p.x1, z0, z1 });
    }
    parts = next;
  }
  return parts.filter((p) => p.x1 - p.x0 > 0.01 && p.z1 - p.z0 > 0.01);
}

export interface FadeWall {
  mesh: THREE.Mesh;
  material: THREE.Material & { opacity: number };
  target: number;
}

export interface Pickable {
  object: THREE.Object3D;
  floor: number;
  seat?: Seat;
  interact?: string;
  monitor?: string; // desk id
  tv?: string; // meeting room zone id
  /** index into STAIRWAYS */
  stairs?: number;
}

export class OfficeScene {
  readonly group = new THREE.Group();
  /** Floor 2 (hidden while you are downstairs, so the camera can look into the office). */
  readonly upstairs = new THREE.Group();
  /** Floor 3 (game room + hall). */
  readonly top = new THREE.Group();
  /** Floor 4 (karaoke, werewolf village, hall). */
  readonly roof4 = new THREE.Group();
  /** Floor 5 (the "Nội Gián" game). */
  readonly roof5 = new THREE.Group();
  /** Ground-floor interior (hidden while you are upstairs; stairs, floors and the outside stay). */
  readonly downstairs = new THREE.Group();
  /** Per floor: the group holding its interior. */
  readonly levels: THREE.Group[];
  readonly pickables: Pickable[] = [];
  readonly fadeWalls: FadeWall[] = [];
  /** Invisible click-to-move planes, one per floor (userData.floor). */
  readonly floors: THREE.Mesh[] = [];
  /** Click-to-move targets that are not at floor level (cinema steps). */
  readonly steps: THREE.Mesh[] = [];
  private monitors = new Map<string, THREE.Mesh>();
  private monitorOn = new Map<string, THREE.Material>();
  private monitorOff = mat('#151922', { rough: 0.4 });
  private tvs = new Map<string, { mesh: THREE.Mesh; idle: THREE.CanvasTexture; video: THREE.VideoTexture | null; label: string }>();
  private kanban: { mesh: THREE.Mesh; tex: THREE.CanvasTexture | null } | null = null;
  private whiteboard: { mesh: THREE.Mesh; tex: THREE.CanvasTexture | null } | null = null;
  private arcades: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; t: number; floor: number }[] = [];
  private arcAcc = 0;
  private clockAcc = 0;
  private monitorOverride = new Map<string, THREE.Material>();
  private occupied = new Set<string>();
  cinemaScreen: THREE.Mesh | null = null;
  private cinemaIdle: THREE.Material | null = null;
  private cinemaHole = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, fog: false, toneMapped: false });
  private marquees: THREE.MeshBasicMaterial[] = [];
  /** Ceiling + light panels only exist for the first-person view (invisible from above anyway). */
  private ceilings = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];
  /** Lift cars parked on each floor, and the one that carries you during a ride. */
  private cars: THREE.Group[] = [];
  private rideCar: THREE.Group;
  readonly bar: BarFx;
  readonly karaFx: KaraokeFx;
  readonly wolfFx: WolfFx;
  private wolfBoardMesh: THREE.Mesh | null = null;
  private moleBoardMesh: THREE.Mesh | null = null;
  readonly f5: Floor5Fx;
  private shadowFloor = -1;
  private doors: { door: Door; left: THREE.Mesh; right: THREE.Mesh; open: number }[] = [];

  constructor() {
    this.group.name = 'office';
    this.upstairs.name = 'floor-2';
    this.upstairs.position.set(-UP_DX, FLOOR_H, 0);
    this.top.name = 'floor-3';
    this.top.position.set(-2 * UP_DX, 2 * FLOOR_H, 0);
    this.roof4.name = 'floor-4';
    this.roof4.position.set(-3 * UP_DX, 3 * FLOOR_H, 0);
    this.roof5.name = 'floor-5';
    this.roof5.position.set(-4 * UP_DX, 4 * FLOOR_H, 0);
    this.downstairs.name = 'floor-1';
    this.group.add(this.downstairs, this.upstairs, this.top, this.roof4, this.roof5);
    this.levels = [this.downstairs, this.upstairs, this.top, this.roof4, this.roof5];
    const statics = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];
    const staticOut = new THREE.Group(); // always drawn: trees, skirting, the first staircase
    const layer = (x: number) => ({ root: this.levels[floorOf(x)], stat: statics[floorOf(x)] });

    // ---------------- ground outside + floors
    const ground = new THREE.Mesh(new THREE.CircleGeometry(140, 48), mat(C.grass, { rough: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(OFFICE_W / 2, -0.02, OFFICE_D / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 30), mat('#e9e2d6', { rough: 1 }));
    path.rotation.x = -Math.PI / 2;
    path.position.set(20, -0.01, OFFICE_D + 15);
    path.receiveShadow = true;
    this.group.add(path);

    for (const z of ZONES) {
      const zf = floorOf(z.x0);
      const tint = z.id.startsWith('f5-') ? ROOM_META[z.id.slice(3) as MoleRoom]?.tint : FLOOR_TINT[z.id];
      const base = floorTexture(z.floor as FloorKind, tint ?? '#eeeeee');
      for (const r of subtract(z, HOLES[zf])) {
        const w = r.x1 - r.x0;
        const d = r.z1 - r.z0;
        const tex = base.clone();
        tex.needsUpdate = true;
        tex.repeat.set(w / 2, d / 2);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: z.floor === 'tile' ? 0.45 : z.kind === 'bar' ? 0.55 : 0.85 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set((r.x0 + r.x1) / 2, 0.001, (r.z0 + r.z1) / 2);
        m.receiveShadow = true;
        m.userData.zone = z.id;
        (zf ? this.levels[zf] : this.group).add(m);
      }
    }
    // slabs between floors (never cast: they would put the floor below in shadow)
    const slabMat = mat('#e4ddd2', { rough: 0.95 });
    const slabT = FLOOR_H - WALL_H;
    const addSlab = (r: Rect, root: THREE.Group, y: number, material: THREE.Material) => {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, slabT, r.z1 - r.z0), material);
      slab.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
      slab.receiveShadow = true;
      slab.userData.noShadow = true;
      root.add(slab);
    };
    for (const r of subtract(UP, HOLES[1])) addSlab(r, this.upstairs, -slabT / 2 - 0.003, slabMat);
    for (const part of TOP_PARTS) for (const r of subtract(part, HOLES[2])) addSlab(r, this.top, -slabT / 2 - 0.003, slabMat);
    for (const r of subtract(ROOF4, HOLES[3])) addSlab(r, this.roof4, -slabT / 2 - 0.003, slabMat);
    for (const r of subtract(ROOF5, HOLES[4])) addSlab(r, this.roof5, -slabT / 2 - 0.003, slabMat);
    // the cinema is two storeys tall: its roof sits level with floor 3's slab above the walls. It
    // belongs to floor 3's view (from floor 2 the camera looks down into the cinema).
    addSlab({ ...CINEMA, x0: CINEMA.x0 + UP_DX, x1: CINEMA.x1 + UP_DX }, this.top, WALL_H + slabT / 2, mat('#4a4152', { rough: 0.9 }));
    // Invisible planes used for click-to-move ray casts.
    for (const f of [0, 1, 2, 3, 4] as const) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(OFFICE_W, OFFICE_D), new THREE.MeshBasicMaterial({ visible: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(OFFICE_W / 2 + f * UP_DX, 0, OFFICE_D / 2);
      plane.userData.floor = f;
      (f ? this.levels[f] : this.group).add(plane);
      this.floors.push(plane);
    }

    // ---------------- walls, stairs, lifts
    for (const w of WALLS) this.buildWall(w, layer(w.x0).root, layer(w.x0).stat);
    rbox(staticOut, OFFICE_W + 0.6, 0.12, OFFICE_D + 0.6, '#d9cfc2', OFFICE_W / 2, -0.07, OFFICE_D / 2, 0.04);
    STAIRWAYS.forEach((st, i) => this.buildStairs(st, i, st.lower === 0 ? staticOut : statics[st.lower]));
    this.buildWells();
    for (const l of LIFTS) this.buildLift(l, layer(l.x0).root, layer(l.x0).stat);
    this.rideCar = liftCar();
    this.rideCar.visible = false;
    this.group.add(this.rideCar);
    this.buildCeiling();
    for (const f of FURNITURE) {
      if (f.kind !== 'riser') continue;
      const step = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), new THREE.MeshBasicMaterial({ visible: false }));
      step.rotation.x = -Math.PI / 2;
      step.position.set(f.x, f.h ?? 0, f.z);
      step.userData.floor = floorOf(f.x);
      layer(f.x).root.add(step);
      this.steps.push(step);
    }
    this.buildSigns();

    // ---------------- furniture
    for (const f of FURNITURE) {
      const dyn: Dynamic = {};
      const obj = buildFurniture(f, dyn);
      const L = layer(f.x);
      L.stat.add(obj);
      if (dyn.monitor) {
        this.monitors.set(f.id, dyn.monitor);
        obj.remove(dyn.monitor);
        this.attachDynamic(obj, dyn.monitor, L.root);
        if (f.kind !== 'pcDesk') this.pickables.push({ object: dyn.monitor, monitor: f.id, floor: floorOf(f.x) });
      }
      if (dyn.screen) {
        obj.remove(dyn.screen);
        this.attachDynamic(obj, dyn.screen, L.root);
        if (f.kind === 'tv' && f.zone) this.setupTv(f.zone, dyn.screen);
        if (f.kind === 'kanbanBoard') this.kanban = { mesh: dyn.screen, tex: null };
        if (f.kind === 'whiteboard') this.whiteboard = { mesh: dyn.screen, tex: null };
        if (f.kind === 'arcade') this.setupArcade(dyn.screen, floorOf(f.x));
        if (f.kind === 'cinemaScreen') this.setupCinema(dyn.screen);
        if (f.kind === 'gameScreen') this.setupNetScreen(dyn.screen);
        if (f.kind === 'karaScreen') this.setupKaraScreen(dyn.screen);
        if (f.kind === 'wolfBoard') this.wolfBoardMesh = dyn.screen;
        if (f.kind === 'moleBoard') this.moleBoardMesh = dyn.screen;
      }
    }
    SEATS.forEach((s, i) => {
      const L = layer(s.x);
      const chair = seatModel(s, i);
      if (chair) {
        chair.position.set(s.x, s.y ?? 0, s.z);
        chair.rotation.y = s.ry;
        L.stat.add(chair);
      }
      // pick proxy
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.62), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.set(s.x, (s.y ?? 0) + 0.5, s.z);
      proxy.userData.seat = s.id;
      L.root.add(proxy);
      this.pickables.push({ object: proxy, seat: s, floor: floorOf(s.x) });
    });
    for (const it of INTERACTABLES) {
      if (it.kind === 'cinema') continue; // reached by walking up (E) or from the cinema panel
      if (it.id.startsWith('mole-door:') || it.id.startsWith('mole-vent:')) continue; // E only (a click there means "walk through")
      const L = layer(it.x);
      if (it.kind === 'elevator') {
        const l = LIFTS.find((q) => Math.abs(q.cx - it.x) < 0.1)!;
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(l.x1 - l.x0, 2.6, l.z1 - l.z0), new THREE.MeshBasicMaterial({ visible: false }));
        proxy.position.set(l.cx, 1.3, (l.z0 + l.z1) / 2);
        L.root.add(proxy);
        this.pickables.push({ object: proxy, interact: it.id, floor: l.floor });
        continue;
      }
      const f = FURNITURE.find(
        (x) =>
          (it.kind === 'kanban' && x.kind === 'kanbanBoard') ||
          (it.kind === 'coffee' && x.kind === 'coffeeMachine') ||
          (it.kind === 'arcade' && x.kind === 'arcade') ||
          (it.kind === 'whiteboard' && x.kind === 'whiteboard') ||
          (it.kind === 'water' && x.kind === 'waterCooler' && floorOf(x.x) === floorOf(it.x)) ||
          (it.kind === 'popcorn' && x.kind === 'popcorn') ||
          (it.kind === 'bar' && x.kind === 'barCounter') ||
          (it.kind === 'dj' && x.kind === 'djBooth') ||
          (it.kind === 'wheel' && x.kind === 'wheel') ||
          (it.kind === 'karaoke' && x.kind === 'songConsole') ||
          (it.kind === 'wolf' && x.kind === 'wolfBoard') ||
          (it.kind === 'mole' && x.id === it.id) ||
          (it.id === 'mole-board' && x.kind === 'moleBoard') ||
          (it.id === 'mole-fuse' && x.kind === 'fuseBox') ||
          (it.id === 'mole-bell' && x.kind === 'moleTable') ||
          (it.id.startsWith('mole-crit') && x.id === it.id.replace('mole-', '')),
      );
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(f ? Math.max(f.w, 0.6) : 1, 2.2, f ? Math.max(f.d, 0.6) : 1), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.set(f?.x ?? it.x, it.kind === 'wheel' ? 1.75 : 1.1, f?.z ?? it.z);
      proxy.rotation.y = f?.ry ?? 0;
      proxy.userData.interact = it.id;
      L.root.add(proxy);
      this.pickables.push({ object: proxy, interact: it.id, floor: floorOf(it.x) });
    }

    // ---------------- landscaping
    const trees: [number, number, number][] = [
      [-4, -3, 1.1], [6, -5, 0.9], [15, -6, 1.2], [26, -5.5, 1], [36, -4.5, 1.15], [45, -2, 1],
      [-5, 8, 1], [-6, 18, 1.2], [-4, 27, 0.95], [53, 9, 1.1], [54, 19, 0.9], [46.5, 31, 1.2],
      [6, 33, 1.1], [3, 40, 0.9], [36, 33.5, 1], [34, 40, 1.2], [-3, 34, 1], [14, 47, 1.1], [27, 46, 1], [40.5, 44, 0.9],
    ];
    trees.forEach(([x, z, s], i) => {
      const t = tree(`tree-${i}`, s);
      t.position.set(x, 0, z);
      staticOut.add(t);
    });

    for (const d of DOORS) this.buildDoor(d, layer(d.x0).root, layer(d.x0).stat);
    statics.forEach((st, f) => this.levels[f].add(mergeStatic(st)));
    this.group.add(mergeStatic(staticOut));
    this.bar = new BarFx(this.upstairs);
    this.karaFx = new KaraokeFx(this.roof4);
    this.wolfFx = new WolfFx(this.roof4);
    if (this.wolfBoardMesh) this.wolfFx.setupBoard(this.wolfBoardMesh);
    this.f5 = new Floor5Fx(this.roof5);
    if (this.moleBoardMesh) this.f5.setupBoard(this.moleBoardMesh);
    this.setMonitorsFrom(new Set());
  }

  /** Which floors are drawn; only the floor you are on casts shadows (upper ones would darken it). */
  setFloorView(visible: boolean[], shadowFloor: number) {
    this.levels.forEach((g, f) => (g.visible = visible[f]));
    // a stairwell's lining only matters while the floor it leads down to isn't drawn
    for (const w of this.wells) w.g.visible = !!visible[w.lower + 1] && !visible[w.lower];
    if (shadowFloor === this.shadowFloor) return;
    this.shadowFloor = shadowFloor;
    this.levels.forEach((g, f) => {
      if (!f) return;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.userData.cast === undefined) m.userData.cast = m.castShadow;
        m.castShadow = f === shadowFloor && !!m.userData.cast && !m.userData.noShadow;
      });
    });
  }

  /** Sliding doors with a lintel above (the wall gap itself goes all the way up). */
  private buildDoor(d: Door, root: THREE.Group, stat: THREE.Group) {
    const w = d.x1 - d.x0;
    const cx = (d.x0 + d.x1) / 2;
    const lintelH = d.wallH - DOOR_H;
    this.addFadeWall(new THREE.BoxGeometry(w, lintelH, WALL_T), d.kind === 'cinema' ? '#2f2838' : d.kind === 'net' ? '#262a3b' : d.kind === 'kara' ? '#231a33' : d.kind === 'wolf' ? '#3a2c22' : '#3b2f3f', cx, DOOR_H + lintelH / 2, d.z, root);
    // frame
    const frame = d.kind === 'cinema' ? '#b08d57' : d.kind === 'net' || d.kind === 'kara' ? '#ff3ea5' : d.kind === 'wolf' ? '#6b4a2e' : '#2de2e6';
    rbox(stat, 0.08, DOOR_H, WALL_T + 0.06, frame, d.x0 + 0.04, DOOR_H / 2, d.z, 0.01);
    rbox(stat, 0.08, DOOR_H, WALL_T + 0.06, frame, d.x1 - 0.04, DOOR_H / 2, d.z, 0.01);
    rbox(stat, w, 0.08, WALL_T + 0.06, frame, cx, DOOR_H - 0.04, d.z, 0.01);
    // two leaves that slide into the wall
    const leafMat = d.kind === 'cinema' ? mat('#5a1f2c', { rough: 0.85 }) : d.kind === 'wolf' ? mat('#5a3d27', { rough: 0.9 }) : mat('#1c1724', { rough: 0.4 });
    const make = () => {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 0.06, DOOR_H - 0.1, 0.06), leafMat);
      leaf.castShadow = true;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, DOOR_H - 0.5, 0.07), new THREE.MeshBasicMaterial({ color: d.kind === 'cinema' || d.kind === 'wolf' ? '#ffcf6b' : '#ff3ea5', toneMapped: false }));
      leaf.add(strip);
      root.add(leaf);
      return { leaf, strip };
    };
    const l = make();
    const r = make();
    l.strip.position.x = w / 4 - 0.08;
    r.strip.position.x = -(w / 4 - 0.08);
    this.doors.push({ door: d, left: l.leaf, right: r.leaf, open: 0 });
    this.updateDoors(0, []);
  }

  /** Doors open while anyone (logical upper-floor positions) is within reach. */
  updateDoors(dt: number, people: { x: number; z: number }[]) {
    for (const D of this.doors) {
      const d = D.door;
      const cx = (d.x0 + d.x1) / 2;
      const near = people.some((p) => Math.abs(p.x - cx) < (d.x1 - d.x0) / 2 + 0.9 && Math.abs(p.z - d.z) < 1.9);
      const target = near ? 1 : 0;
      D.open = dt ? D.open + (target - D.open) * (1 - Math.exp(-(near ? 9 : 4) * dt)) : target;
      const w = d.x1 - d.x0;
      const slide = (w / 2 - 0.12) * D.open;
      D.left.position.set(d.x0 + w / 4 - slide, (DOOR_H - 0.1) / 2, d.z);
      D.right.position.set(d.x1 - w / 4 + slide, (DOOR_H - 0.1) / 2, d.z);
    }
  }

  /** The moving lift car: at drawn x / height y while riding, or null when parked. */
  setRideCar(vx: number | null, y = 0, z = 0) {
    for (const c of this.cars) c.visible = vx == null;
    this.rideCar.visible = vx != null;
    if (vx != null) this.rideCar.position.set(vx, y, z);
  }

  /** One flight: solid steps, a sloped glass balustrade on the open (north) side, click targets. */
  /**
   * Looking down a stairwell from upstairs, the floor below isn't drawn — you'd see straight through
   * to the lawn under the building. Each opening gets a lining (side walls, the wall under the
   * landing, a floor, and the steps themselves) that is shown only while that lower floor is hidden.
   */
  private wells: { lower: number; g: THREE.Group }[] = [];
  /** Warm-up: the stairwell linings too (normally shown only while the floor below is hidden — so
   *  their shader used to compile on the spot, a freeze the moment you reached the next floor). */
  showWells() {
    for (const w of this.wells) w.g.visible = true;
  }
  private buildWells() {
    const wallMat = new THREE.MeshStandardMaterial({ color: '#ddd5c9', roughness: 0.95, side: THREE.DoubleSide });
    const floorMat = new THREE.MeshStandardMaterial({ color: '#dcd4c8', roughness: 1 });
    const tread = mat('#c9a27a', { rough: 0.7 });
    const body = mat('#e8e1d6', { rough: 0.9 });
    for (const st of STAIRWAYS) {
      const g = new THREE.Group();
      g.position.y = st.lower * FLOOR_H; // drawn coords of the storey below
      g.visible = false;
      const h = FLOOR_H - 0.01; // all the way up through the cut slab (else a thin strip of lawn shows)
      const depth = st.z1 - st.z0;
      const cz = (st.z0 + st.z1) / 2;
      const len = st.x1 - st.x0;
      const cx = (st.x0 + st.x1) / 2;
      const high = st.dir > 0 ? st.x1 : st.x0;
      // the floor of the storey below, around the flight and out past its foot
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(OFFICE_W, 14), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(OFFICE_W / 2, 0.004, OFFICE_D - 7);
      g.add(floor);
      const wall = (w: number, d: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        m.position.set(x, h / 2, z);
        g.add(m);
      };
      wall(len, 0.06, cx, st.z0 - 0.03); // inner side (toward the hall)
      wall(0.06, depth + 0.1, high, cz); // under the landing at the top
      // past the open foot of the flight you can see under the slab: close that part of the
      // storey below too (its outer walls are not drawn either), or the lawn shows again
      wall(OFFICE_W, 0.06, OFFICE_W / 2, OFFICE_D - 0.08); // south (outer)
      wall(OFFICE_W, 0.06, OFFICE_W / 2, OFFICE_D - 14); // north edge of the floor patch
      wall(0.06, 14, 0.08, OFFICE_D - 7); // west (outer)
      wall(0.06, 14, OFFICE_W - 0.08, OFFICE_D - 7); // east (outer)
      // the steps (the real ones belong to the lower floor, hidden from up here — except floor 1's)
      if (st.lower > 0) {
        const n = STAIR_STEPS;
        const run = len / n;
        const rise = FLOOR_H / n;
        for (let i = 0; i < n; i++) {
          const sh = (i + 1) * rise;
          const x = st.dir < 0 ? st.x1 - (i + 0.5) * run : st.x0 + (i + 0.5) * run;
          rbox(g, run + 0.002, sh - 0.04, depth, body, x, (sh - 0.04) / 2, cz, 0.005);
          rbox(g, run + 0.02, 0.04, depth, tread, x, sh - 0.02, cz, 0.008);
        }
      }
      this.group.add(g);
      this.wells.push({ lower: st.lower, g });
    }
  }

  private buildStairs(st: Stairway, index: number, stat: THREE.Group) {
    const n = STAIR_STEPS;
    const dx = st.lower * UP_DX; // logical x offset of the floor it starts on
    const root = st.lower === 0 ? this.group : this.levels[st.lower];
    const run = (st.x1 - st.x0) / n;
    const rise = FLOOR_H / n;
    const depth = st.z1 - st.z0;
    const cz = (st.z0 + st.z1) / 2;
    const tread = mat('#c9a27a', { rough: 0.7 });
    const body = mat('#e8e1d6', { rough: 0.9 });
    for (let i = 0; i < n; i++) {
      const h = (i + 1) * rise;
      const x = (st.dir < 0 ? st.x1 - (i + 0.5) * run : st.x0 + (i + 0.5) * run) + dx;
      rbox(stat, run + 0.002, h - 0.04, depth, body, x, (h - 0.04) / 2, cz, 0.005);
      rbox(stat, run + 0.02, 0.04, depth, tread, x, h - 0.02, cz, 0.008);
    }
    const len = Math.hypot(st.x1 - st.x0, FLOOR_H);
    const ang = Math.atan2(FLOOR_H, st.x1 - st.x0) * -st.dir; // tilt toward the high end
    const mid = { x: (st.x0 + st.x1) / 2 + dx, y: FLOOR_H / 2 };
    const glass = new THREE.Mesh(new THREE.BoxGeometry(len, 0.85, 0.03), mat(C.glass, { opacity: 0.28, rough: 0.1 }));
    glass.position.set(mid.x, mid.y + 0.5, st.z0 + 0.04);
    glass.rotation.z = -ang;
    glass.renderOrder = 2;
    root.add(glass);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 10), mat(C.metal, { metal: 0.6, rough: 0.35 }));
    rail.position.set(mid.x, mid.y + 0.97, st.z0 + 0.04);
    rail.rotation.z = Math.PI / 2 - ang;
    rail.castShadow = true;
    root.add(rail);
    for (let i = 0; i <= 5; i++) {
      const vx = st.x0 + 0.2 + (i / 5) * (st.x1 - st.x0 - 0.4);
      const k = st.dir < 0 ? (st.x1 - vx) / (st.x1 - st.x0) : (vx - st.x0) / (st.x1 - st.x0);
      rbox(stat, 0.04, 1.0, 0.04, C.metal, vx + dx, FLOOR_H * k + 0.5, st.z0 + 0.04, 0.01);
    }
    // click targets: the slope (lower floor) and the stairwell (upper floor) — they take you across
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, depth), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(mid.x, mid.y + 0.05, cz);
    proxy.rotation.z = -ang;
    root.add(proxy);
    this.pickables.push({ object: proxy, floor: st.lower, stairs: index });
    const hole = new THREE.Mesh(new THREE.BoxGeometry(st.x1 - st.x0, 0.05, depth), new THREE.MeshBasicMaterial({ visible: false }));
    hole.position.set(mid.x + UP_DX, -0.1, cz);
    this.levels[st.lower + 1].add(hole);
    this.pickables.push({ object: hole, floor: st.lower + 1, stairs: index });
  }

  private buildLift(l: Lift, root: THREE.Group, stat: THREE.Group) {
    const car = liftCar();
    car.position.set(l.cx, 0, l.cz);
    root.add(car);
    this.cars.push(car);
    const h = WALL_H;
    // header over the door + floor indicator
    rbox(stat, l.x1 - l.x0 + 0.1, 0.32, WALL_T + 0.04, C.metal, l.cx, h - 0.16, l.z0, 0.02);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.24),
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        map: canvasTexture(360, 96, (g, w, hh) => {
          g.fillStyle = '#14161c';
          g.fillRect(0, 0, w, hh);
          g.fillStyle = '#7ef0ff';
          g.font = '700 58px "Be Vietnam Pro", sans-serif';
          g.textAlign = 'center';
          g.fillText(`🛗  Tầng ${l.floor + 1}`, w / 2, 68);
        }),
      }),
    );
    sign.position.set(l.cx, h - 0.16, l.z0 - WALL_T / 2 - 0.03);
    sign.rotation.y = Math.PI;
    root.add(sign);
  }

  private buildWall(w: Wall, root: THREE.Group, stat: THREE.Group) {
    const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
    const cx = (w.x0 + w.x1) / 2;
    const cz = (w.z0 + w.z1) / 2;
    const alongX = Math.abs(w.z1 - w.z0) < 1e-6;
    const sx = alongX ? len + WALL_T : WALL_T;
    const sz = alongX ? WALL_T : len + WALL_T;

    if (w.kind === 'hidden') return;
    if (w.kind === 'glass' || w.kind === 'shaft') {
      const H = w.kind === 'shaft' ? WALL_H : 2.7;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.04, H - 0.12, alongX ? 0.04 : len), mat(C.glass, { opacity: w.kind === 'shaft' ? 0.3 : 0.22, rough: 0.1 }));
      glass.position.set(cx, H / 2, cz);
      glass.renderOrder = 2;
      root.add(glass);
      rbox(stat, sx, 0.08, sz, C.frame, cx, H, cz, 0.02);
      rbox(stat, sx, 0.08, sz, C.frame, cx, 0.04, cz, 0.02);
      const posts = Math.max(1, Math.round(len / 2));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        rbox(stat, 0.06, H, 0.06, w.kind === 'shaft' ? C.metal : C.frame, w.x0 + (w.x1 - w.x0) * t, H / 2, w.z0 + (w.z1 - w.z0) * t, 0.02);
      }
      return;
    }
    if (w.kind === 'rail') {
      const H = 1.05;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.03, H - 0.1, alongX ? 0.03 : len), mat(C.glass, { opacity: 0.28, rough: 0.1 }));
      glass.position.set(cx, H / 2, cz);
      glass.renderOrder = 2;
      root.add(glass);
      rbox(stat, alongX ? len + 0.06 : 0.07, 0.06, alongX ? 0.07 : len + 0.06, C.metal, cx, H, cz, 0.02);
      const posts = Math.max(1, Math.round(len / 1.6));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        rbox(stat, 0.05, H, 0.05, C.metal, w.x0 + (w.x1 - w.x0) * t, H / 2, w.z0 + (w.z1 - w.z0) * t, 0.015);
      }
      return;
    }
    if (w.kind === 'cinema') {
      this.addFadeWall(new THREE.BoxGeometry(sx, CINEMA_WALL_H, sz), '#2f2838', cx, CINEMA_WALL_H / 2, cz, root);
      rbox(stat, alongX ? len : WALL_T + 0.04, 0.12, alongX ? WALL_T + 0.04 : len, '#1d1824', cx, 0.06, cz, 0.01);
      return;
    }
    if (w.kind === 'up') {
      // the bar and the game room are dark; the halls are light
      const fl = floorOf(w.x0);
      const vx = cx - fl * UP_DX;
      const lx = cx; // logical
      const color =
        fl === 1 && vx > BAR.x0 - UP_DX - 0.01 && cz < BAR.z1 + 0.01
          ? '#2a2230'
          : fl === 2 && vx > NET.x0 - 2 * UP_DX - 0.01 && cz < NET.z1 + 0.01
            ? '#262a3b'
            : fl === 3 && cz < KARA.z1 + 0.01 && lx < KARA.x1 - 0.01
              ? '#231a33'
              : fl === 3 && cz < WOLF.z1 + 0.01 && lx > WOLF.x0 + 0.01
                ? '#3a2c22'
                : fl === 3 && Math.abs(lx - KARA.x1) < 0.01 && cz < KARA.z1
                  ? '#2c2230'
                  : fl === 4
                    ? '#5a6479'
                    : C.wall;
      this.addFadeWall(new THREE.BoxGeometry(sx, UP_WALL_H, sz), color, cx, UP_WALL_H / 2, cz, root);
      rbox(stat, alongX ? len : WALL_T + 0.04, 0.12, alongX ? WALL_T + 0.04 : len, C.wallTrim, cx, 0.06, cz, 0.01);
      return;
    }
    const isNorth = w.kind === 'outer' && alongX && w.z0 === 0;
    // the outer shell stays drawn from upstairs too (seen from outside, under the upper floor)
    const r1 = w.kind === 'outer' ? this.group : root;
    const color = w.kind === 'inner' ? '#efe7f3' : C.wall;
    if (isNorth) {
      // Big windows: low wall, header, pillars and glass panes.
      this.addFadeWall(new THREE.BoxGeometry(sx, 0.9, sz), color, cx, 0.45, cz, r1);
      this.addFadeWall(new THREE.BoxGeometry(sx, 0.45, sz), color, cx, WALL_H - 0.225, cz, r1);
      for (let x = 0; x <= OFFICE_W; x += 4) this.addFadeWall(new THREE.BoxGeometry(0.4, WALL_H, WALL_T + 0.02), color, x, WALL_H / 2, 0, r1);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(OFFICE_W, WALL_H - 1.35, 0.03), mat('#d7ecfa', { opacity: 0.25, rough: 0.05 }));
      pane.position.set(OFFICE_W / 2, 0.9 + (WALL_H - 1.35) / 2, 0);
      r1.add(pane);
      return;
    }
    this.addFadeWall(new THREE.BoxGeometry(sx, WALL_H, sz), color, cx, WALL_H / 2, cz, r1);
    rbox(stat, alongX ? len : WALL_T + 0.04, 0.12, alongX ? WALL_T + 0.04 : len, C.wallTrim, cx, 0.06, cz, 0.01);
  }

  private buildCeiling() {
    const panelMat = new THREE.MeshBasicMaterial({ color: '#fffaf0', toneMapped: false });
    const warmMat = new THREE.MeshBasicMaterial({ color: '#ffe2b0', toneMapped: false });
    const ceilMat = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 1, emissive: '#cfc9bf', emissiveIntensity: 0.55 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#221c29', roughness: 1 });
    const panelGeo = new THREE.PlaneGeometry(1.2, 0.3);
    const f5Mat = this.f5PanelMat;
    const moleCeil = new THREE.MeshStandardMaterial({ color: '#4a5263', roughness: 1 });
    for (const z of ZONES) {
      const zf = floorOf(z.x0);
      const above = holesAbove(zf).map((h) => ({ ...h, x0: h.x0 + zf * UP_DX, x1: h.x1 + zf * UP_DX }));
      const inHole = (x: number, zz: number) => above.some((h) => x > h.x0 - 0.7 && x < h.x1 + 0.7 && zz > h.z0 - 0.3 && zz < h.z1 + 0.3);
      const parent = this.ceilings[zf];
      const h = z.kind === 'cinema' ? CINEMA_WALL_H : WALL_H;
      const dark = z.kind === 'cinema' || z.kind === 'bar' || z.kind === 'game' || z.kind === 'karaoke' || z.kind === 'wolf' || z.kind === 'mole';
      for (const r of subtract(z, above)) {
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), z.kind === 'mole' ? moleCeil : dark ? darkMat : ceilMat);
        ceil.rotation.x = Math.PI / 2; // faces down: visible from inside, culled from the camera above
        ceil.position.set((r.x0 + r.x1) / 2, h, (r.z0 + r.z1) / 2);
        parent.add(ceil);
      }
      if (z.kind === 'bar' || z.kind === 'karaoke' || z.kind === 'wolf') continue;
      const step = z.kind === 'cinema' ? 4 : 3.2;
      for (let x = z.x0 + step / 2; x < z.x1; x += step) {
        for (let zz = z.z0 + step / 2; zz < z.z1; zz += step) {
          if (inHole(x, zz)) continue;
          const p = new THREE.Mesh(panelGeo, z.kind === 'mole' ? f5Mat : z.kind === 'focus' || z.kind === 'lounge' || z.kind === 'cinema' || z.kind === 'game' ? warmMat : panelMat);
          p.rotation.x = Math.PI / 2;
          p.position.set(x, h - 0.02, zz);
          if (z.kind === 'cinema' || z.kind === 'game') p.scale.set(0.3, 1, 1);
          parent.add(p);
        }
      }
    }
    this.ceilings.forEach((c, f) => {
      c.visible = false;
      this.levels[f].add(c);
    });
  }

  /** Floor 5's ceiling lamps: soft, and off in a blackout. */
  private f5PanelMat = new THREE.MeshBasicMaterial({ color: '#aab6c8', toneMapped: false });
  setF5Lamps(on: boolean) {
    this.f5PanelMat.color.set(on ? '#aab6c8' : '#1a1e26');
  }

  setCeiling(on: boolean) {
    for (const c of this.ceilings) c.visible = on;
  }

  /** "BSS CINEMA · BAR" signs: one in the lobby by the stairs, one over the cinema doors upstairs. */
  private buildSigns() {
    // BSS Net neon: over the pantry door (outside) and on the south wall inside
    const netTex = canvasTexture(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.font = 'italic 800 140px "Be Vietnam Pro", sans-serif';
      g.shadowColor = '#2de2e6';
      g.shadowBlur = 34;
      g.lineWidth = 9;
      g.strokeStyle = '#7ef6ff';
      g.strokeText('🎮 BSS NET', w / 2, 175);
      g.shadowColor = '#ff3ea5';
      g.shadowBlur = 18;
      g.fillStyle = '#f0fdff';
      g.fillText('🎮 BSS NET', w / 2, 175);
    });
    const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, depthWrite: false, toneMapped: false });
    // over the game room door (hall 3 side), inside on the south wall, and in hall 2 by the stairs up
    const out = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), netMat);
    out.position.set(151.2, 2.72, NET.z1 + 0.13);
    this.top.add(out);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), netMat);
    inside.position.set(156.0, 2.45, NET.z1 - 0.13);
    inside.rotation.y = Math.PI;
    this.top.add(inside);
    const upTex = canvasTexture(1024, 192, (g, w, h) => {
      g.fillStyle = '#1d1824';
      g.fillRect(0, 0, w, h);
      g.textAlign = 'center';
      g.font = '800 72px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#7ef6ff';
      g.fillText('⬆ TẦNG 3 · 🎮 BSS NET', w / 2, 122);
    });
    const upSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), new THREE.MeshBasicMaterial({ map: upTex, toneMapped: false }));
    upSign.position.set(STAIRWAYS[1].x0 + UP_DX + 2.2, 2.55, OFFICE_D - 0.13);
    upSign.rotation.y = Math.PI;
    this.upstairs.add(upSign);
    // hall 3 → floor 4 sign, over the third flight
    const up4Tex = canvasTexture(1024, 192, (g, w) => {
      g.fillStyle = '#1d1824';
      g.fillRect(0, 0, w, 192);
      g.textAlign = 'center';
      g.font = '800 66px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#ff9ad5';
      g.fillText('⬆ TẦNG 4 · 🎤 KARAOKE · 🐺 MA SÓI', w / 2, 120);
    });
    const up4 = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), new THREE.MeshBasicMaterial({ map: up4Tex, toneMapped: false }));
    up4.position.set(STAIRWAYS[2].x0 + 2 * UP_DX + 4.0, 2.5, OFFICE_D - 0.13);
    up4.rotation.y = Math.PI;
    this.top.add(up4);
    // neon over the two doors on floor 4 (hall side)
    const neon = (text: string, glow: string, fill: string) =>
      new THREE.MeshBasicMaterial({
        map: canvasTexture(1024, 256, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.textAlign = 'center';
          g.font = 'italic 800 130px "Be Vietnam Pro", sans-serif';
          g.shadowColor = glow;
          g.shadowBlur = 34;
          g.lineWidth = 8;
          g.strokeStyle = glow;
          g.strokeText(text, w / 2, 170);
          g.shadowBlur = 14;
          g.fillStyle = fill;
          g.fillText(text, w / 2, 170);
        }),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
    const kSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), neon('🎤 KARAOKE', '#ff3ea5', '#fff0fa'));
    kSign.position.set(190.2, 2.75, KARA.z1 + 0.13);
    this.roof4.add(kSign);
    const wSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), neon('🐺 MA SÓI', '#ff8a3c', '#fff3e0'));
    wSign.position.set(210.2, 2.75, WOLF.z1 + 0.13);
    this.roof4.add(wSign);
    void HALL4;
    const up5Tex = canvasTexture(1024, 192, (g, w) => {
      g.fillStyle = '#151a26';
      g.fillRect(0, 0, w, 192);
      g.textAlign = 'center';
      g.font = '800 70px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#9fe8ff';
      g.fillText('⬆ TẦNG 5 · 🕵️ NỘI GIÁN', w / 2, 120);
    });
    const up5 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64), new THREE.MeshBasicMaterial({ map: up5Tex, toneMapped: false }));
    up5.position.set(STAIRWAYS[3].x0 + 3 * UP_DX + 4.0, 2.5, OFFICE_D - 0.13);
    up5.rotation.y = Math.PI;
    this.roof4.add(up5);

    const lobby = new THREE.MeshBasicMaterial({ map: this.marqueeTexture(null, true), toneMapped: false, transparent: true, opacity: 1 });
    const m1 = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), lobby);
    m1.position.set(20.3, 2.15, OFFICE_D - 0.13);
    m1.rotation.y = Math.PI;
    this.downstairs.add(m1);
    this.fadeWalls.push({ mesh: m1, material: lobby, target: 1 });
    const hall = new THREE.MeshBasicMaterial({ map: this.marqueeTexture(null, false), toneMapped: false, transparent: true, opacity: 1 });
    const m2 = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), hall);
    m2.position.set(CINEMA_SCREEN.x, 2.7, CINEMA.z1 + 0.13);
    this.upstairs.add(m2);
    this.fadeWalls.push({ mesh: m2, material: hall, target: 1 });
    this.marquees = [lobby, hall];
  }

  private marqueeTexture(title: string | null, lobby: boolean): THREE.CanvasTexture {
    return canvasTexture(1024, 256, (g, w, h) => {
      g.fillStyle = '#1d1824';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffcf6b';
      for (let x = 14; x < w; x += 28) {
        g.beginPath();
        g.arc(x, 12, 6, 0, Math.PI * 2);
        g.arc(x, h - 12, 6, 0, Math.PI * 2);
        g.fill();
      }
      g.textAlign = 'center';
      g.font = '800 70px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#ff6b7f';
      g.fillText(lobby ? '⬆ 🎬 CINEMA · 🍸 BAR · 🎮 GAME · 🎤' : '🎬 BSS CINEMA', w / 2, 108);
      g.font = '500 34px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#ffffff';
      const line = title ? `Đang chiếu: ${title}` : lobby ? 'T2: rạp phim, bar · T3: phòng game · T4: karaoke, ma sói — cầu thang bên trái, thang máy bên phải' : 'Mời vào — chọn một ghế đỏ để xem cùng mọi người';
      g.fillText(ellipsis(g, line, w - 80), w / 2, 186);
    });
  }

  setMarqueeTitle(title: string | null) {
    this.marquees.forEach((m, i) => {
      m.map?.dispose();
      m.map = this.marqueeTexture(title, i === 0);
      m.needsUpdate = true;
    });
  }

  /** Move a dynamic child out of a furniture group, keeping its world transform. */
  private attachDynamic(parent: THREE.Object3D, child: THREE.Object3D, root: THREE.Group) {
    parent.updateMatrixWorld(true);
    child.applyMatrix4(parent.matrixWorld);
    root.add(child);
  }

  private setupCinema(mesh: THREE.Mesh) {
    const s = CINEMA_SCREEN;
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.set(0, s.ry, 0);
    mesh.scale.set(s.w, s.h, 1);
    const idle = canvasTexture(1280, 720, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.7);
      grad.addColorStop(0, '#3a2f5c');
      grad.addColorStop(1, '#120f1c');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.textAlign = 'center';
      g.fillStyle = '#ffcf6b';
      g.font = '800 96px "Be Vietnam Pro", sans-serif';
      g.fillText('BSS CINEMA', w / 2, h / 2 - 40);
      g.fillStyle = '#e8e4f5';
      g.font = '500 40px "Be Vietnam Pro", sans-serif';
      g.fillText('Ngồi xuống một ghế rồi dán link YouTube để cùng xem', w / 2, h / 2 + 40);
      g.font = '400 30px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#a99fc4';
      g.fillText('Mọi người trong rạp sẽ xem cùng lúc 🍿', w / 2, h / 2 + 100);
    });
    this.cinemaIdle = new THREE.MeshBasicMaterial({ map: idle, toneMapped: false });
    mesh.material = this.cinemaIdle;
    this.cinemaScreen = mesh;
  }

  private netScreen: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } | null = null;

  /** The live arena on BSS Net's north wall. */
  private setupNetScreen(mesh: THREE.Mesh) {
    const s = NET_SCREEN;
    mesh.position.set(s.x, s.y, s.z);
    mesh.scale.set(s.w, s.h, 1);
    const tex = canvasTexture(800, 520, () => {});
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.netScreen = { tex, g: (tex.image as HTMLCanvasElement).getContext('2d')! };
    this.updateNetScreen(null, Date.now());
  }

  updateNetScreen(f: SnakeFrame | null, now: number) {
    if (!this.netScreen) return;
    drawSnake(this.netScreen.g, f, now, { big: true });
    this.netScreen.tex.needsUpdate = true;
  }

  /** true: punch a transparent hole so the YouTube iframe (CSS3D, behind the canvas) shows through. */
  setCinemaVideo(on: boolean) {
    if (this.cinemaScreen && this.cinemaIdle) this.cinemaScreen.material = on ? this.cinemaHole : this.cinemaIdle;
  }

  // ------------------------------------------------------------------ karaoke screen
  private karaScreen: THREE.Mesh | null = null;
  private karaIdle: THREE.MeshBasicMaterial | null = null;
  private karaVideo = false;

  private setupKaraScreen(mesh: THREE.Mesh) {
    const s = KARA_SCREEN;
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.set(0, s.ry, 0);
    mesh.scale.set(s.w, s.h, 1);
    this.karaIdle = new THREE.MeshBasicMaterial({ toneMapped: false });
    mesh.material = this.karaIdle;
    this.karaScreen = mesh;
    this.drawKaraIdle({ next: [], last: null, count: null });
  }

  /** What the LED wall shows between songs: up next, the last score, or a count-in. */
  drawKaraIdle(info: { next: { title: string; who: string }[]; last: { title: string; singers: string; score: number; comment: string } | null; count: { title: string; who: string; n: number } | null }) {
    if (!this.karaIdle) return;
    const tex = canvasTexture(1280, 720, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#24103d');
      gr.addColorStop(0.55, '#140a26');
      gr.addColorStop(1, '#06283a');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(255,${120 + ((i * 37) % 120)},${200 + ((i * 13) % 55)},${0.05 + ((i * 7) % 10) / 100})`;
        g.beginPath();
        g.arc((i * 97) % w, (i * 61) % h, 20 + ((i * 29) % 60), 0, Math.PI * 2);
        g.fill();
      }
      g.textAlign = 'center';
      if (info.count) {
        g.fillStyle = '#ff7ac4';
        g.font = '800 64px "Be Vietnam Pro", sans-serif';
        g.fillText('🎤 Chuẩn bị hát', w / 2, 200);
        g.fillStyle = '#ffffff';
        g.font = '800 54px "Be Vietnam Pro", sans-serif';
        g.fillText(ellipsis(g, info.count.title, w - 120), w / 2, 320);
        g.fillStyle = '#9fe8ff';
        g.font = '600 40px "Be Vietnam Pro", sans-serif';
        g.fillText(`Ca sĩ: ${info.count.who}`, w / 2, 400);
        g.fillStyle = '#ffd23f';
        g.font = '800 160px "Be Vietnam Pro", sans-serif';
        g.fillText(String(info.count.n), w / 2, 610);
        return;
      }
      if (info.last) {
        g.fillStyle = '#ffd23f';
        g.font = '800 200px "Be Vietnam Pro", sans-serif';
        g.fillText(String(info.last.score), w / 2, 300);
        g.font = '700 40px "Be Vietnam Pro", sans-serif';
        g.fillStyle = '#ffffff';
        g.fillText(`${'★'.repeat(Math.max(1, Math.round(info.last.score / 20)))}  ${info.last.comment}`, w / 2, 390);
        g.fillStyle = '#d8c8ff';
        g.font = '500 34px "Be Vietnam Pro", sans-serif';
        g.fillText(ellipsis(g, `${info.last.singers} · ${info.last.title}`, w - 120), w / 2, 450);
      } else {
        g.fillStyle = '#ff7ac4';
        g.font = 'italic 800 110px "Be Vietnam Pro", sans-serif';
        g.shadowColor = '#ff3ea5';
        g.shadowBlur = 30;
        g.fillText('BSS KARAOKE', w / 2, 260);
        g.shadowBlur = 0;
        g.fillStyle = '#e8e4f5';
        g.font = '500 38px "Be Vietnam Pro", sans-serif';
        g.fillText('Chọn bài ở bảng 🎤 bên trái màn hình — cả phòng cùng nghe', w / 2, 350);
      }
      if (info.next.length) {
        g.fillStyle = '#9fe8ff';
        g.font = '700 32px "Be Vietnam Pro", sans-serif';
        g.fillText('Bài tiếp theo', w / 2, 535);
        g.fillStyle = '#ffffff';
        g.font = '500 30px "Be Vietnam Pro", sans-serif';
        info.next.slice(0, 3).forEach((n, i) => g.fillText(ellipsis(g, `${i + 1}. ${n.title || 'Đang tải tên bài…'} — ${n.who}`, w - 160), w / 2, 585 + i * 44));
      }
    });
    this.karaIdle.map?.dispose();
    this.karaIdle.map = tex;
    this.karaIdle.needsUpdate = true;
  }

  /** true: show the YouTube iframe through the LED wall. */
  setKaraVideo(on: boolean) {
    this.karaVideo = on;
    if (this.karaScreen && this.karaIdle) this.karaScreen.material = on ? this.cinemaHole : this.karaIdle;
  }

  get karaShowingVideo() {
    return this.karaVideo;
  }

  updateWolfBoard(v: import('../../shared/werewolf').WolfView | null, now: number) {
    this.wolfFx.drawBoard(v, now);
  }

  private addFadeWall(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, root: THREE.Group = this.downstairs) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, transparent: true, opacity: 1 });
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    this.fadeWalls.push({ mesh: m, material, target: 1 });
  }

  // ------------------------------------------------------------------ dynamic bits
  /** Custom screen (e.g. the Claude Code feed) for a desk; shown while someone sits there. */
  setMonitorMaterial(deskId: string, material: THREE.Material | null) {
    if (material) this.monitorOverride.set(deskId, material);
    else this.monitorOverride.delete(deskId);
    const m = this.monitors.get(deskId);
    if (m && this.occupied.has(deskId)) m.material = material ?? this.monitorOn.get(deskId) ?? this.monitorOff;
  }

  monitorWorldPosition(deskId: string): THREE.Vector3 | null {
    const m = this.monitors.get(deskId);
    return m ? m.getWorldPosition(new THREE.Vector3()) : null;
  }

  setMonitorsFrom(occupiedSeats: Set<string>) {
    this.occupied = occupiedSeats;
    for (const [id, m] of this.monitors) {
      const on = occupiedSeats.has(id);
      const override = on ? this.monitorOverride.get(id) : undefined;
      if (override) {
        m.material = override;
        continue;
      }
      if (on) {
        let mm = this.monitorOn.get(id);
        if (!mm) {
          mm = new THREE.MeshBasicMaterial({ map: id.startsWith('pc-') ? gameScreenTexture(this.monitorOn.size) : codeScreenTexture(this.monitorOn.size + 1), toneMapped: false });
          this.monitorOn.set(id, mm);
        }
        m.material = mm;
      } else {
        m.material = this.monitorOff;
      }
    }
  }

  private setupTv(zoneId: string, mesh: THREE.Mesh) {
    const label = ZONE_BY_ID.get(zoneId)?.name ?? 'Phòng họp';
    const idle = this.tvIdleTexture(label);
    (mesh.material as THREE.MeshBasicMaterial).map = idle;
    this.tvs.set(zoneId, { mesh, idle, video: null, label });
    this.pickables.push({ object: mesh, tv: zoneId, floor: 0 });
  }

  private tvIdleTexture(label: string): THREE.CanvasTexture {
    return canvasTexture(768, 432, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#6b8cff');
      grad.addColorStop(1, '#b56fd0');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.arc(w * (0.1 + i * 0.17), h * (0.2 + (i % 3) * 0.3), 40 + i * 12, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '700 54px "Be Vietnam Pro", sans-serif';
      g.fillText(label, w / 2, h / 2 - 10);
      g.font = '500 28px "Be Vietnam Pro", sans-serif';
      g.globalAlpha = 0.9;
      g.fillText('Bấm "Chia sẻ màn hình" để trình chiếu lên đây', w / 2, h / 2 + 44);
      g.font = '600 34px "Be Vietnam Pro", sans-serif';
      g.fillText(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), w / 2, h - 40);
    });
  }

  /** Show (or clear) a shared screen on the TV of a meeting room. */
  setTvVideo(zoneId: string, video: HTMLVideoElement | null) {
    const tv = this.tvs.get(zoneId);
    if (!tv) return;
    const m = tv.mesh.material as THREE.MeshBasicMaterial;
    tv.video?.dispose();
    tv.video = null;
    if (video) {
      tv.video = new THREE.VideoTexture(video);
      tv.video.colorSpace = THREE.SRGBColorSpace;
      m.map = tv.video;
    } else {
      m.map = tv.idle;
    }
    m.needsUpdate = true;
  }

  private tvImages = new Map<string, { img: HTMLImageElement; tex: THREE.Texture; url: string }>();

  /** Show a relayed screen-share frame (object URL) on a meeting-room TV; null restores the idle screen. */
  setTvImage(zoneId: string, url: string | null) {
    const tv = this.tvs.get(zoneId);
    if (!tv) return;
    const m = tv.mesh.material as THREE.MeshBasicMaterial;
    let entry = this.tvImages.get(zoneId);
    if (!url) {
      if (entry && m.map === entry.tex) {
        m.map = tv.idle;
        m.needsUpdate = true;
      }
      return;
    }
    if (!entry) {
      const img = new Image();
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      img.onload = () => {
        tex.needsUpdate = true;
        if (m.map !== tex) {
          m.map = tex;
          m.needsUpdate = true;
        }
      };
      entry = { img, tex, url: '' };
      this.tvImages.set(zoneId, entry);
    }
    if (entry.url !== url) {
      entry.url = url;
      entry.img.src = url;
    }
  }

  tvZones(): string[] {
    return [...this.tvs.keys()];
  }

  updateKanban(tasks: Task[]) {
    if (!this.kanban) return;
    const byCol = new Map(COLUMNS.map((c) => [c.id, [] as Task[]]));
    for (const t of tasks) byCol.get(t.col)?.push(t);
    for (const list of byCol.values()) list.sort((a, b) => a.ord - b.ord);
    const tex = canvasTexture(1024, 470, (g, w, h) => {
      g.fillStyle = '#fbfaf7';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2d3142';
      g.font = '800 34px "Be Vietnam Pro", sans-serif';
      g.fillText('📋 Bảng công việc của team', 24, 46);
      g.font = '500 20px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#7a8090';
      g.fillText('Lại gần và nhấn E để mở', w - 270, 44);
      const colW = (w - 48 - 3 * 16) / 4;
      const colors = ['#9aa3ad', '#6b8cff', '#f0a35e', '#3fb27f'];
      COLUMNS.forEach((col, i) => {
        const x = 24 + i * (colW + 16);
        const list = byCol.get(col.id)!;
        g.fillStyle = '#f0ede6';
        roundRect(g, x, 66, colW, h - 84, 14);
        g.fill();
        g.fillStyle = colors[i];
        g.font = '700 22px "Be Vietnam Pro", sans-serif';
        g.fillText(`${col.label}  ·  ${list.length}`, x + 14, 98);
        list.slice(0, 5).forEach((t, k) => {
          const y = 114 + k * 62;
          g.fillStyle = '#ffffff';
          roundRect(g, x + 10, y, colW - 20, 52, 10);
          g.fill();
          g.fillStyle = PRIORITY_META[t.priority].color;
          roundRect(g, x + 10, y, 6, 52, 3);
          g.fill();
          g.fillStyle = '#2d3142';
          g.font = '500 18px "Be Vietnam Pro", sans-serif';
          g.fillText(ellipsis(g, t.title, colW - 44), x + 26, y + 32);
        });
        if (list.length > 5) {
          g.fillStyle = '#9aa3ad';
          g.font = '500 17px "Be Vietnam Pro", sans-serif';
          g.fillText(`+${list.length - 5} việc nữa`, x + 16, 114 + 5 * 62 + 18);
        }
      });
    });
    this.kanban.tex?.dispose();
    this.kanban.tex = tex;
    const m = this.kanban.mesh.material as THREE.MeshStandardMaterial;
    // per-board material (the cached one is shared)
    if (!this.kanban.mesh.userData.ownMat) {
      this.kanban.mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.kanban.mesh.userData.ownMat = true;
    } else {
      (this.kanban.mesh.material as THREE.MeshBasicMaterial).map = tex;
      (this.kanban.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    void m;
  }

  updateWhiteboard(info: { online: number; doneToday: number; officeName: string }) {
    if (!this.whiteboard) return;
    const now = new Date();
    const tex = canvasTexture(900, 375, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2d3142';
      g.font = '800 44px "Be Vietnam Pro", sans-serif';
      const hour = now.getHours();
      const greet = hour < 11 ? 'Chào buổi sáng ☀️' : hour < 14 ? 'Ăn trưa ngon miệng 🍜' : hour < 18 ? 'Chiều làm việc hiệu quả 💪' : 'Về sớm nghỉ ngơi nhé 🌙';
      g.fillText(greet, 36, 72);
      g.font = '500 28px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#5b6270';
      g.fillText(now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }), 36, 122);
      g.fillStyle = '#6b8cff';
      g.font = '700 34px "Be Vietnam Pro", sans-serif';
      g.fillText(`👥 ${info.online} người đang trong ${info.officeName}`, 36, 196);
      g.fillStyle = '#3fb27f';
      g.fillText(`✅ ${info.doneToday} việc đã xong hôm nay`, 36, 252);
      g.fillStyle = '#e5566b';
      g.font = 'italic 500 24px "Be Vietnam Pro", sans-serif';
      g.fillText('“Làm ít thôi nhưng làm cho tới.”', 36, 326);
    });
    this.whiteboard.tex?.dispose();
    this.whiteboard.tex = tex;
    if (!this.whiteboard.mesh.userData.ownMat) {
      this.whiteboard.mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.whiteboard.mesh.userData.ownMat = true;
    } else {
      (this.whiteboard.mesh.material as THREE.MeshBasicMaterial).map = tex;
      (this.whiteboard.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
  }

  private setupArcade(mesh: THREE.Mesh, floor: number) {
    const tex = canvasTexture(128, 104, () => {});
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.arcades.push({ mesh, tex, t: Math.random() * 10, floor });
  }


  /** `floor`: the floor you are on (only its animated screens are redrawn). */
  tick(dt: number, beat: number, floor: number) {
    this.bar.tick(dt, beat, floor === 1);
    if (floor === 3) {
      this.karaFx.tick(dt);
      this.wolfFx.tick(dt);
    }
    if (floor === 4) this.f5.tick(dt);
    // attract-mode screens: ~20 redraws a second is smooth for pixel art (each one re-uploads a texture)
    this.arcAcc += dt;
    const arcDt = this.arcAcc;
    if (arcDt >= 0.05) this.arcAcc = 0;
    for (const arc of this.arcades) {
      if (arc.floor !== floor || arcDt < 0.05) continue;
      arc.t += arcDt;
      const canvas = arc.tex.image as HTMLCanvasElement;
      const g = canvas.getContext('2d')!;
      const t = arc.t;
      g.fillStyle = '#120f2e';
      g.fillRect(0, 0, 128, 104);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = ['#ff5d8f', '#ffd166', '#06d6a0', '#4cc9f0'][i % 4];
        const x = (i * 37 + t * 40 * (1 + (i % 3))) % 140 - 6;
        const y = 10 + ((i * 23) % 80) + Math.sin(t * 3 + i) * 4;
        g.fillRect(x, y, 6, 6);
      }
      g.fillStyle = '#fff';
      g.fillRect(56 + Math.sin(t * 2) * 30, 90, 16, 5);
      arc.tex.needsUpdate = true;
    }
    this.clockAcc += dt;
    if (this.clockAcc > 30) {
      this.clockAcc = 0;
      for (const tv of this.tvs.values()) {
        const fresh = this.tvIdleTexture(tv.label);
        const m = tv.mesh.material as THREE.MeshBasicMaterial;
        if (m.map === tv.idle) {
          m.map = fresh;
          m.needsUpdate = true;
        }
        tv.idle.dispose();
        tv.idle = fresh;
      }
    }
  }
}

// ------------------------------------------------------------------ helpers
/** Glass lift car, origin on its floor plate centre, door facing north (-z). */
function liftCar(): THREE.Group {
  const g = new THREE.Group();
  const metal = mat('#9aa3ae', { metal: 0.55, rough: 0.35 });
  rbox(g, 2.1, 0.03, 1.95, metal, 0, 0.015, 0, 0.01);
  rbox(g, 2.1, 2.4, 0.05, '#cfd5dd', 0, 1.23, 0.95, 0.02);
  for (const sx of [-1, 1]) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.3, 1.85), mat(C.glass, { opacity: 0.3, rough: 0.1 }));
    glass.position.set(sx * 1.04, 1.2, 0);
    glass.renderOrder = 2;
    g.add(glass);
    rbox(g, 0.06, 2.45, 0.06, metal, sx * 1.04, 1.23, -0.95, 0.02);
    rbox(g, 0.05, 0.05, 1.7, metal, sx * 0.98, 0.95, 0, 0.02);
  }
  rbox(g, 2.2, 0.07, 2.02, metal, 0, 2.47, 0, 0.02);
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: '#fff4dc', toneMapped: false }));
  lamp.rotation.x = Math.PI / 2;
  lamp.position.y = 2.43;
  g.add(lamp);
  return g;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function ellipsis(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

/** Merge all static meshes by material → a handful of draw calls instead of ~1500. */
function mergeStatic(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const material = m.material as THREE.Material;
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g.applyMatrix4(m.matrixWorld);
    let list = buckets.get(material);
    if (!list) buckets.set(material, (list = []));
    list.push(g);
  });
  const out = new THREE.Group();
  out.name = 'office-static';
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = !(material as THREE.MeshStandardMaterial).transparent;
    m.receiveShadow = true;
    out.add(m);
    geos.forEach((g) => g.dispose());
  }
  return out;
}
