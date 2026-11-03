// Office layout shared by the client (3D build, collision, path finding) and the server (zones).
import { BELL, CRIT, FUSE, ROOM_META, STATIONS, TASK_META, type MoleTaskKind } from './mole';
// Units are metres. x grows to the east, z grows to the south, y is up.
// Character yaw `ry`: 0 = facing +z (south), PI/2 = facing +x (east).

export type ZoneKind = 'work' | 'meeting' | 'pantry' | 'focus' | 'lounge' | 'lobby' | 'cinema' | 'bar' | 'game' | 'karaoke' | 'wolf' | 'mole';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Zone extends Rect {
  id: string;
  name: string;
  kind: ZoneKind;
  floor: 'wood' | 'carpet' | 'tile' | 'stone' | 'rug';
}

export type SeatKind = 'desk' | 'meeting' | 'sofa' | 'stool' | 'focus' | 'cinema' | 'pc' | 'wolf';

export interface Seat {
  id: string;
  kind: SeatKind;
  x: number;
  y?: number; // floor height (stadium rows)
  z: number;
  ry: number; // direction the seated person faces
  zone: string;
  label: string;
}

export type FurnitureKind =
  | 'desk'
  | 'meetingTable'
  | 'tv'
  | 'sofa'
  | 'coffeeTable'
  | 'beanbag'
  | 'bookshelf'
  | 'plant'
  | 'bigPlant'
  | 'counter'
  | 'coffeeMachine'
  | 'fridge'
  | 'roundTable'
  | 'reception'
  | 'kanbanBoard'
  | 'waterCooler'
  | 'whiteboard'
  | 'focusDesk'
  | 'rug'
  | 'lamp'
  | 'arcade'
  | 'cinemaScreen'
  | 'curtain'
  | 'popcorn'
  | 'stripLight'
  | 'riser'
  | 'barCounter'
  | 'barShelf'
  | 'djBooth'
  | 'speaker'
  | 'barTable'
  | 'poster'
  | 'wheel'
  | 'pcDesk'
  | 'snackBar'
  | 'gameScreen'
  | 'karaScreen'
  | 'stage'
  | 'micStand'
  | 'wedge'
  | 'firePit'
  | 'stump'
  | 'log'
  | 'pine'
  | 'lantern'
  | 'moonWindow'
  | 'wolfBoard'
  | 'songConsole'
  | 'serverRack'
  | 'printer'
  | 'filing'
  | 'fuseBox'
  | 'moleTable'
  | 'terminal'
  | 'moleBoard';

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  y?: number;
  z: number;
  h?: number; // risers: height
  ry: number; // rotation around Y
  w: number; // footprint width along local x
  d: number; // footprint depth along local z
  solid: boolean;
  zone?: string;
}

export interface Wall {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** up: plain wall on the upper floor · rail: glass balustrade · shaft: glass lift shaft · hidden: collision only */
  kind: 'outer' | 'glass' | 'inner' | 'cinema' | 'up' | 'rail' | 'shaft' | 'hidden' | 'annex';
}

export type InteractKind = 'kanban' | 'coffee' | 'water' | 'arcade' | 'whiteboard' | 'cinema' | 'popcorn' | 'elevator' | 'bar' | 'dj' | 'wheel' | 'snack' | 'karaoke' | 'wolf' | 'mole';
export interface Interactable {
  id: string;
  kind: InteractKind;
  x: number;
  z: number;
  radius: number;
  label: string;
}

export const OFFICE_W = 40;
export const OFFICE_D = 28;
export const MAIN_D = OFFICE_D;
export const GROUND_W = OFFICE_W;

// ---------------------------------------------------------------- floors
// Four floors. To keep collision, path finding, zones and the server simple, every position stays
// 2D: floor f lives at x + f·UP_DX ("logical" coordinates) and is *drawn* shifted back by f·UP_DX
// and raised by f·FLOOR_H, i.e. stacked right above the office.
//   floor 0 (x 0..40)    office
//   floor 1 (x 60..100)  cinema (double height: it also takes floor 2's space) · bar · hall
//   floor 2 (x 120..160) BSS Net game room (above the bar) · hall — an L around the cinema roof
//   floor 3 (x 180..220) karaoke · werewolf village · hall
//   floor 4 (x 240..280) "Nội Gián": six rooms round a meeting room · hall
export type Floor = 0 | 1 | 2 | 3 | 4;
export const FLOORS = 5;
export const FLOOR_H = 3.4;
export const UP_DX = 60;
/** Every room is this tall (the slab between floors is FLOOR_H - WALL_H). */
export const WALL_H = 3.2;
export const UP_WALL_H = WALL_H;
export const CINEMA_WALL_H = FLOOR_H + WALL_H;
export const UP = { x0: 60, z0: 0, x1: 100, z1: 28 };
export const TOP = { x0: 120, z0: 0, x1: 160, z1: 28 };
export const CINEMA = { x0: 60, z0: 0, x1: 84, z1: 20 };
export const BAR = { x0: 84, z0: 0, x1: 100, z1: 20 };
export const HALL = { x0: 60, z0: 20, x1: 100, z1: 28 };
/** BSS Net, the game room on floor 3 (right above the bar). */
export const NET = { x0: 144, z0: 0, x1: 160, z1: 20 };
export const HALL3 = { x0: 120, z0: 20, x1: 160, z1: 28 };
/** Live arena screen on the game room's north wall. */
export const NET_SCREEN = { x: (NET.x0 + NET.x1) / 2, y: 1.85, z: 0.25, w: 4.4, h: 2.86 };
/** Floor 4: karaoke (west), the werewolf village (east), hall along the south. */
export const ROOF4 = { x0: 180, z0: 0, x1: 220, z1: 28 };
export const KARA = { x0: 180, z0: 0, x1: 200, z1: 20 };
export const WOLF = { x0: 200, z0: 0, x1: 220, z1: 20 };
export const HALL4 = { x0: 180, z0: 20, x1: 220, z1: 28 };
/** Karaoke LED screen on the north wall (floor-local height), stage in front of it. */
export const KARA_SCREEN = { x: 190, y: 1.86, z: 0.24, w: 4.6, h: 2.59, ry: 0 };
export const KARA_STAGE = { x0: 183.2, z0: 0.2, x1: 196.8, z1: 4.0, h: 0.26 };
/** Where the (up to two) singers stand: either side of the screen, facing the room. */
export const MIC_SPOTS = [
  { x: 186.3, z: 2.5, ry: 0.22 },
  { x: 193.7, z: 2.5, ry: -0.22 },
];
/** Werewolf village: stumps in a circle round the camp fire. */
export const WOLF_FIRE = { x: 210, z: 9.6 };
export const WOLF_RING = 3.1;
/** Floor 5: the "Nội Gián" game (layout + rules in shared/mole.ts). */
export const ROOF5 = { x0: 240, z0: 0, x1: 280, z1: 28 };
export const HALL5 = { x0: 252, z0: 19, x1: 280, z1: 28 };
export const WORLD_W = ROOF5.x1;
export const WORLD_D = OFFICE_D;
export const WALL_T = 0.2;
export const PLAYER_RADIUS = 0.28;
export const SPAWN = { x: 20, z: 25.5, ry: Math.PI };

export function floorOf(x: number): Floor {
  return x >= 230 ? 4 : x >= 170 ? 3 : x >= 110 ? 2 : x >= 50 ? 1 : 0;
}
/** Where a logical x is drawn. */
export function visualX(x: number): number {
  return x - floorOf(x) * UP_DX;
}
/** Logical x moved onto the floor of `ref` (same drawn position). */
export function sameFloorX(x: number, ref: number): number {
  return visualX(x) + floorOf(ref) * UP_DX;
}

// ---------------------------------------------------------------- stairs
/** A flight of stairs from floor `lower` to the one above, along the south wall (drawn coords). */
export interface Stairway {
  lower: 0 | 1 | 2 | 3;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** -1: rises toward x0 (west), 1: rises toward x1 (east). */
  dir: -1 | 1;
}
export const STAIRWAYS: Stairway[] = [
  { lower: 0, x0: 10.6, x1: 18.6, z0: 26.0, z1: 27.9, dir: -1 }, // lobby → hall 2
  { lower: 1, x0: 26.0, x1: 34.0, z0: 26.0, z1: 27.9, dir: 1 }, // hall 2 → hall 3
  { lower: 2, x0: 10.6, x1: 18.6, z0: 26.0, z1: 27.9, dir: -1 }, // hall 3 → hall 4
  { lower: 3, x0: 26.0, x1: 34.0, z0: 26.0, z1: 27.9, dir: 1 }, // hall 4 → hall 5
];
export const STAIRS = STAIRWAYS[0];
export const STAIR_STEPS = 20;
/** 0 at the foot, 1 at the top. */
export function stairRise(s: Stairway, vx: number): number {
  const k = s.dir < 0 ? (s.x1 - vx) / (s.x1 - s.x0) : (vx - s.x0) / (s.x1 - s.x0);
  return Math.min(1, Math.max(0, k));
}
export function stairY(s: Stairway, vx: number): number {
  return FLOOR_H * (s.lower + stairRise(s, vx));
}
/** Drawn x of useful spots on a stairway (z is the middle of the flight). */
export function stairPoints(s: Stairway) {
  const w = s.dir < 0;
  return {
    z: (s.z0 + s.z1) / 2,
    foot: w ? s.x1 + 0.8 : s.x0 - 0.8, // lower floor, in front of the first step
    climb: w ? s.x0 + 0.9 : s.x1 - 0.9, // walk here to go up (you change floor on the way)
    top: w ? s.x0 - 0.9 : s.x1 + 0.8, // upper floor, past the last step
    descend: w ? s.x1 - 1.0 : s.x0 + 1.0, // walk here (from the top) to go down
    upAt: w ? s.x0 + 2.0 : s.x1 - 2.0, // crossing this while climbing → upper floor coords
    downAt: w ? s.x1 - 2.0 : s.x0 + 2.0, // crossing this while descending → lower floor coords
  };
}
/** The flight under a logical position (its lower part on the lower floor, the rest in the stairwell above). */
export function stairAt(x: number, z: number): Stairway | null {
  const f = floorOf(x);
  const vx = visualX(x);
  for (const s of STAIRWAYS) {
    if (s.lower !== f && s.lower !== f - 1) continue;
    if (vx > s.x0 - 0.05 && vx < s.x1 + 0.05 && z > s.z0 && z < s.z1 + 0.1) return s;
  }
  return null;
}
export function onStairs(x: number, z: number): boolean {
  return !!stairAt(x, z);
}

/** Glass lift: one shaft through all floors at the same drawn spot. */
export interface Lift {
  floor: Floor;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cx: number;
  cz: number;
}
const liftAt = (floor: Floor): Lift => {
  const x0 = 22.0 + floor * UP_DX;
  return { floor, x0, x1: x0 + 2.4, z0: 25.8, z1: 28, cx: x0 + 1.2, cz: 26.95 };
};
export const LIFTS: Lift[] = [liftAt(0), liftAt(1), liftAt(2), liftAt(3), liftAt(4)];
/** Inside a lift car (standing room). */
export function liftAtPos(x: number, z: number): Lift | null {
  for (const l of LIFTS) if (x > l.x0 + 0.2 && x < l.x1 - 0.2 && z > l.z0 + 0.3 && z < l.z1) return l;
  return null;
}
export const FLOOR_NAMES = ['Tầng 1 · Văn phòng', 'Tầng 2 · Rạp phim & Bar', 'Tầng 3 · Phòng game', 'Tầng 4 · Karaoke & Ma sói', 'Tầng 5 · Nội Gián'];
export const DANCE_FLOOR = { x0: 89, z0: 7.5, x1: 95, z1: 13.5 };
/** Lucky wheel on the bar's south wall (centre height above the upper floor). */
export const WHEEL_SPOT = { x: 87.0, y: 1.75, z: 19.82 };
/** LED wall above the DJ booth (upper-floor local coords): the jukebox video plays here. */
export const BAR_SCREEN = { x: 99.86, y: 2.32, z: 10.5, w: 2.84, h: 1.6, ry: -Math.PI / 2 };

/** Automatic sliding doors (gaps in walls along x at `z`). They keep the cinema and the bar dark. */
export interface Door {
  id: string;
  x0: number;
  x1: number;
  z: number;
  wallH: number;
  kind: 'cinema' | 'bar' | 'net' | 'kara' | 'wolf';
}
export const DOORS: Door[] = [
  { id: 'cine-w', x0: 60.5, x1: 62.5, z: 20, wallH: CINEMA_WALL_H, kind: 'cinema' },
  { id: 'cine-e', x0: 81.5, x1: 83.5, z: 20, wallH: CINEMA_WALL_H, kind: 'cinema' },
  { id: 'bar', x0: 90, x1: 92.4, z: 20, wallH: WALL_H, kind: 'bar' },
  { id: 'net', x0: 150, x1: 152.4, z: 20, wallH: WALL_H, kind: 'net' },
  { id: 'kara', x0: 189, x1: 191.4, z: 20, wallH: WALL_H, kind: 'kara' },
  { id: 'wolf', x0: 209, x1: 211.4, z: 20, wallH: WALL_H, kind: 'wolf' },
];
export const DOOR_H = 2.45;
export function onDanceFloor(x: number, z: number): boolean {
  return x > DANCE_FLOOR.x0 && x < DANCE_FLOOR.x1 && z > DANCE_FLOOR.z0 && z < DANCE_FLOOR.z1;
}

export const ZONES: Zone[] = [
  { id: 'library', name: 'Thư viện yên tĩnh', kind: 'focus', floor: 'carpet', x0: 0, z0: 0, x1: 10, z1: 11 },
  { id: 'lounge', name: 'Lounge thư giãn', kind: 'lounge', floor: 'rug', x0: 0, z0: 11, x1: 10, z1: 28 },
  { id: 'workspace', name: 'Khu làm việc', kind: 'work', floor: 'wood', x0: 10, z0: 0, x1: 30, z1: 16 },
  { id: 'meetA', name: 'Phòng họp Hạ Long', kind: 'meeting', floor: 'carpet', x0: 30, z0: 0, x1: 40, z1: 9 },
  { id: 'meetB', name: 'Phòng họp Sa Pa', kind: 'meeting', floor: 'carpet', x0: 30, z0: 9, x1: 40, z1: 18 },
  { id: 'pantry', name: 'Pantry', kind: 'pantry', floor: 'tile', x0: 30, z0: 18, x1: 40, z1: 28 },
  { id: 'lobby', name: 'Sảnh chính', kind: 'lobby', floor: 'stone', x0: 10, z0: 16, x1: 30, z1: 28 },
  { id: 'cinema', name: 'Rạp chiếu phim (tầng 2)', kind: 'cinema', floor: 'carpet', ...CINEMA },
  { id: 'bar', name: 'BSS Bar (tầng 2)', kind: 'bar', floor: 'wood', ...BAR },
  { id: 'hall2', name: 'Sảnh tầng 2', kind: 'lobby', floor: 'stone', ...HALL },
  { id: 'netcafe', name: 'BSS Net — phòng game (tầng 3)', kind: 'game', floor: 'carpet', ...NET },
  { id: 'hall3', name: 'Sảnh tầng 3', kind: 'lobby', floor: 'stone', ...HALL3 },
  { id: 'karaoke', name: 'Phòng Karaoke (tầng 4)', kind: 'karaoke', floor: 'carpet', ...KARA },
  { id: 'wolfroom', name: 'Làng Ma Sói (tầng 4)', kind: 'wolf', floor: 'wood', ...WOLF },
  { id: 'hall4', name: 'Sảnh tầng 4', kind: 'lobby', floor: 'stone', ...HALL4 },
  ...(['server', 'design', 'archive', 'print', 'meet', 'canteen', 'med'] as const).map(
    (k): Zone => ({ id: `f5-${k}`, name: ROOM_META[k].name, kind: 'mole', floor: k === 'meet' ? 'carpet' : k === 'canteen' ? 'tile' : 'wood', x0: ROOM_META[k].x0, z0: ROOM_META[k].z0, x1: ROOM_META[k].x1, z1: ROOM_META[k].z1 }),
  ),
  { id: 'hall5', name: 'Sảnh tầng 5', kind: 'lobby', floor: 'stone', ...HALL5 },
];

const PI = Math.PI;

// ---------------------------------------------------------------- walls
// Partition walls are written as segments with door gaps already cut out.
export const WALLS: Wall[] = [
  // outer shell of the office
  { x0: 0, z0: 0, x1: OFFICE_W, z1: 0, kind: 'outer' },
  { x0: 0, z0: OFFICE_D, x1: OFFICE_W, z1: OFFICE_D, kind: 'outer' },
  { x0: 0, z0: 0, x1: 0, z1: OFFICE_D, kind: 'outer' },
  { x0: OFFICE_W, z0: 0, x1: OFFICE_W, z1: OFFICE_D, kind: 'outer' },
  // staircase (collision only; the stairs draw their own balustrade) + glass lift shaft
  { x0: STAIRS.x0, z0: STAIRS.z0, x1: STAIRS.x1 - 1.0, z1: STAIRS.z0, kind: 'hidden' },
  { x0: STAIRS.x0, z0: STAIRS.z0, x1: STAIRS.x0, z1: OFFICE_D, kind: 'hidden' },
  // second flight (hall 2 → hall 3): its sides on floor 2, its stairwell balustrade on floor 3
  { x0: STAIRWAYS[1].x0 + 1.0 + UP_DX, z0: 26.0, x1: STAIRWAYS[1].x1 + UP_DX, z1: 26.0, kind: 'hidden' },
  { x0: STAIRWAYS[1].x1 + UP_DX, z0: 26.0, x1: STAIRWAYS[1].x1 + UP_DX, z1: OFFICE_D, kind: 'hidden' },
  { x0: STAIRWAYS[1].x0 + 2 * UP_DX, z0: 26.0, x1: STAIRWAYS[1].x1 + 2 * UP_DX, z1: 26.0, kind: 'rail' },
  { x0: STAIRWAYS[1].x0 + 2 * UP_DX, z0: 26.0, x1: STAIRWAYS[1].x0 + 2 * UP_DX, z1: OFFICE_D, kind: 'rail' },
  // ---- floor 3: an L around the cinema roof. Where it meets the (two-storey) cinema walls those
  // walls are the boundary, so floor 3 only adds collision there.
  { x0: NET.x0, z0: 0, x1: NET.x1, z1: 0, kind: 'up' },
  { x0: TOP.x1, z0: 0, x1: TOP.x1, z1: NET.z1, kind: 'up' },
  { x0: TOP.x1, z0: NET.z1, x1: TOP.x1, z1: TOP.z1, kind: 'up' },
  { x0: TOP.x0, z0: TOP.z1, x1: TOP.x1, z1: TOP.z1, kind: 'up' },
  { x0: TOP.x0, z0: HALL3.z0, x1: TOP.x0, z1: TOP.z1, kind: 'up' },
  { x0: NET.x0, z0: NET.z1, x1: 150, z1: NET.z1, kind: 'up' },
  { x0: 152.4, z0: NET.z1, x1: NET.x1, z1: NET.z1, kind: 'up' },
  { x0: NET.x0, z0: 0, x1: NET.x0, z1: NET.z1, kind: 'hidden' },
  { x0: TOP.x0, z0: HALL3.z0, x1: NET.x0, z1: HALL3.z0, kind: 'hidden' },
  // third flight (hall 3 → hall 4): its sides on floor 3, its stairwell balustrade on floor 4
  { x0: STAIRWAYS[2].x0 + 2 * UP_DX, z0: 26.0, x1: STAIRWAYS[2].x1 - 1.0 + 2 * UP_DX, z1: 26.0, kind: 'hidden' },
  { x0: STAIRWAYS[2].x0 + 2 * UP_DX, z0: 26.0, x1: STAIRWAYS[2].x0 + 2 * UP_DX, z1: OFFICE_D, kind: 'hidden' },
  { x0: STAIRWAYS[2].x0 + 3 * UP_DX, z0: 26.0, x1: STAIRWAYS[2].x1 + 3 * UP_DX, z1: 26.0, kind: 'rail' },
  { x0: STAIRWAYS[2].x1 + 3 * UP_DX, z0: 26.0, x1: STAIRWAYS[2].x1 + 3 * UP_DX, z1: OFFICE_D, kind: 'rail' },
  // fourth flight (hall 4 → hall 5): its sides on floor 4, its stairwell balustrade on floor 5
  { x0: STAIRWAYS[3].x0 + 1.0 + 3 * UP_DX, z0: 26.0, x1: STAIRWAYS[3].x1 + 3 * UP_DX, z1: 26.0, kind: 'hidden' },
  { x0: STAIRWAYS[3].x1 + 3 * UP_DX, z0: 26.0, x1: STAIRWAYS[3].x1 + 3 * UP_DX, z1: OFFICE_D, kind: 'hidden' },
  { x0: STAIRWAYS[3].x0 + 4 * UP_DX, z0: 26.0, x1: STAIRWAYS[3].x1 + 4 * UP_DX, z1: 26.0, kind: 'rail' },
  { x0: STAIRWAYS[3].x0 + 4 * UP_DX, z0: 26.0, x1: STAIRWAYS[3].x0 + 4 * UP_DX, z1: OFFICE_D, kind: 'rail' },
  // ---- floor 5 ("Nội Gián"): 3×2 rooms over the hall, doorways cut out (see MOLE_DOORS)
  { x0: ROOF5.x0, z0: 0, x1: ROOF5.x1, z1: 0, kind: 'up' },
  { x0: ROOF5.x1, z0: 0, x1: ROOF5.x1, z1: ROOF5.z1, kind: 'up' },
  { x0: ROOF5.x0, z0: ROOF5.z1, x1: ROOF5.x1, z1: ROOF5.z1, kind: 'up' },
  { x0: ROOF5.x0, z0: 0, x1: ROOF5.x0, z1: ROOF5.z1, kind: 'up' },
  { x0: 252, z0: 19, x1: 252, z1: 22, kind: 'up' },
  { x0: 252, z0: 24, x1: 252, z1: ROOF5.z1, kind: 'up' },
  ...[252, 268].flatMap((x): Wall[] => [
    { x0: x, z0: 0, x1: x, z1: 3.5, kind: 'up' },
    { x0: x, z0: 5.5, x1: x, z1: 13, kind: 'up' },
    { x0: x, z0: 15, x1: x, z1: 19, kind: 'up' },
  ]),
  ...[9, 19].flatMap((z): Wall[] => [
    { x0: 240, z0: z, x1: 245, z1: z, kind: 'up' },
    { x0: 247, z0: z, x1: 259, z1: z, kind: 'up' },
    { x0: 261, z0: z, x1: 273, z1: z, kind: 'up' },
    { x0: 275, z0: z, x1: 280, z1: z, kind: 'up' },
  ]),
  // ---- floor 4: karaoke | werewolf village, hall along the south (doors 189..191.4, 209..211.4)
  { x0: ROOF4.x0, z0: 0, x1: KARA.x1, z1: 0, kind: 'up' },
  { x0: WOLF.x0, z0: 0, x1: ROOF4.x1, z1: 0, kind: 'up' },
  { x0: ROOF4.x1, z0: 0, x1: ROOF4.x1, z1: KARA.z1, kind: 'up' },
  { x0: ROOF4.x1, z0: KARA.z1, x1: ROOF4.x1, z1: ROOF4.z1, kind: 'up' },
  { x0: ROOF4.x0, z0: ROOF4.z1, x1: ROOF4.x1, z1: ROOF4.z1, kind: 'up' },
  { x0: ROOF4.x0, z0: 0, x1: ROOF4.x0, z1: KARA.z1, kind: 'up' },
  { x0: ROOF4.x0, z0: KARA.z1, x1: ROOF4.x0, z1: ROOF4.z1, kind: 'up' },
  { x0: KARA.x1, z0: 0, x1: KARA.x1, z1: KARA.z1, kind: 'up' },
  { x0: KARA.x0, z0: KARA.z1, x1: 189, z1: KARA.z1, kind: 'up' },
  { x0: 191.4, z0: KARA.z1, x1: KARA.x1, z1: KARA.z1, kind: 'up' },
  { x0: WOLF.x0, z0: WOLF.z1, x1: 209, z1: WOLF.z1, kind: 'up' },
  { x0: 211.4, z0: WOLF.z1, x1: WOLF.x1, z1: WOLF.z1, kind: 'up' },
  ...LIFTS.flatMap((l): Wall[] => [
    { x0: l.x0, z0: l.z0, x1: l.x0, z1: l.z1, kind: 'shaft' },
    { x0: l.x1, z0: l.z0, x1: l.x1, z1: l.z1, kind: 'shaft' },
    { x0: l.x0, z0: l.z0, x1: l.x0 + 0.55, z1: l.z0, kind: 'shaft' },
    { x0: l.x1 - 0.55, z0: l.z0, x1: l.x1, z1: l.z0, kind: 'shaft' },
  ]),
  // ---- upper floor: outer shell (where the cinema has its own tall walls, those are the shell)
  { x0: BAR.x0, z0: UP.z0, x1: UP.x1, z1: UP.z0, kind: 'up' },
  { x0: UP.x0, z0: UP.z1, x1: UP.x1, z1: UP.z1, kind: 'up' },
  { x0: UP.x0, z0: CINEMA.z1, x1: UP.x0, z1: UP.z1, kind: 'up' },
  { x0: UP.x1, z0: UP.z0, x1: UP.x1, z1: BAR.z1, kind: 'up' },
  { x0: UP.x1, z0: BAR.z1, x1: UP.x1, z1: UP.z1, kind: 'up' },
  // cinema: tall walls, two doors from the hall at the screen end (x 60.5..62.5 and 81.5..83.5)
  { x0: CINEMA.x0, z0: CINEMA.z0, x1: CINEMA.x1, z1: CINEMA.z0, kind: 'cinema' },
  { x0: CINEMA.x0, z0: CINEMA.z0, x1: CINEMA.x0, z1: CINEMA.z1, kind: 'cinema' },
  { x0: CINEMA.x1, z0: CINEMA.z0, x1: CINEMA.x1, z1: CINEMA.z1, kind: 'cinema' },
  { x0: CINEMA.x0, z0: CINEMA.z1, x1: 60.5, z1: CINEMA.z1, kind: 'cinema' },
  { x0: 62.5, z0: CINEMA.z1, x1: 81.5, z1: CINEMA.z1, kind: 'cinema' },
  { x0: 83.5, z0: CINEMA.z1, x1: CINEMA.x1, z1: CINEMA.z1, kind: 'cinema' },
  // bar: door from the hall at x 90..92.4
  { x0: BAR.x0, z0: BAR.z1, x1: 90, z1: BAR.z1, kind: 'up' },
  { x0: 92.4, z0: BAR.z1, x1: BAR.x1, z1: BAR.z1, kind: 'up' },
  // stairwell balustrade upstairs
  { x0: STAIRS.x0 + UP_DX, z0: STAIRS.z0, x1: STAIRS.x1 + UP_DX, z1: STAIRS.z0, kind: 'rail' },
  { x0: STAIRS.x1 + UP_DX, z0: STAIRS.z0, x1: STAIRS.x1 + UP_DX, z1: OFFICE_D, kind: 'rail' },
  // library: east wall (door z 7.5..9.5) + south wall (door x 4..6)
  { x0: 10, z0: 0, x1: 10, z1: 7.5, kind: 'glass' },
  { x0: 10, z0: 9.5, x1: 10, z1: 11, kind: 'glass' },
  { x0: 0, z0: 11, x1: 4, z1: 11, kind: 'glass' },
  { x0: 6, z0: 11, x1: 10, z1: 11, kind: 'glass' },
  // meeting rooms: west wall with doors (A: z 6.5..8.3, B: z 15..16.8)
  { x0: 30, z0: 0, x1: 30, z1: 6.5, kind: 'glass' },
  { x0: 30, z0: 8.3, x1: 30, z1: 15, kind: 'glass' },
  { x0: 30, z0: 16.8, x1: 30, z1: 18, kind: 'glass' },
  // between A and B, and between B and pantry
  { x0: 30, z0: 9, x1: OFFICE_W, z1: 9, kind: 'inner' },
  { x0: 30, z0: 18, x1: OFFICE_W, z1: 18, kind: 'inner' },
];

// ---------------------------------------------------------------- furniture & seats
export const FURNITURE: Furniture[] = [];
export const SEATS: Seat[] = [];
export const INTERACTABLES: Interactable[] = [];

function addF(kind: FurnitureKind, x: number, z: number, w: number, d: number, ry = 0, solid = true, zone?: string) {
  const id = `${kind}-${FURNITURE.length}`;
  FURNITURE.push({ id, kind, x, z, ry, w, d, solid, zone });
  return id;
}
function addSeat(kind: SeatKind, x: number, z: number, ry: number, zone: string, label: string, id?: string) {
  SEATS.push({ id: id ?? `${kind}-${SEATS.length}`, kind, x, z, ry, zone, label });
}

// Workspace: 6 clusters of 4 desks (2 facing 2). Desk 1.4 x 0.7.
{
  const xs = [14.5, 20, 25.5];
  const zs = [4.6, 11.2];
  let n = 1;
  for (const cz of zs) {
    for (const cx of xs) {
      for (const side of [-1, 1] as const) {
        for (const dx of [-0.7, 0.7]) {
          const dz = side * 0.35; // desk centre offset from cluster centre
          const deskId = `desk-${String(n).padStart(2, '0')}`;
          // side -1 = north row: person sits north of the desk, facing south (+z)
          FURNITURE.push({ id: deskId, kind: 'desk', x: cx + dx, z: cz + dz, ry: side < 0 ? 0 : PI, w: 1.4, d: 0.7, solid: true, zone: 'workspace' });
          addSeat('desk', cx + dx, cz + side * 0.98, side < 0 ? 0 : PI, 'workspace', `Bàn ${n}`, deskId);
          n++;
        }
      }
    }
  }
  // plants between clusters
  for (const [x, z] of [[17.25, 4.6], [22.75, 4.6], [17.25, 11.2], [22.75, 11.2], [11, 0.8], [29, 0.8], [11, 15.2], [29, 15.2]]) {
    addF('plant', x, z, 0.5, 0.5, 0, true, 'workspace');
  }
  addF('whiteboard', 20, 0.35, 3, 0.3, 0, true, 'workspace');
  INTERACTABLES.push({ id: 'whiteboard', kind: 'whiteboard', x: 20, z: 1.2, radius: 1.6, label: 'Xem bảng thông báo' });
}

// Meeting rooms: long table + 6 chairs + TV on the east wall.
for (const [room, cz] of [['meetA', 4.5], ['meetB', 13.5]] as const) {
  const cx = 35;
  addF('meetingTable', cx, cz, 3.6, 1.5, 0, true, room);
  addF('tv', OFFICE_W - 0.15, cz, 2.4, 0.15, -PI / 2, true, room);
  addF('plant', 30.6, cz - 3.6, 0.5, 0.5, 0, true, room);
  let i = 1;
  for (const dx of [-1.2, 0, 1.2]) {
    addSeat('meeting', cx + dx, cz - 1.2, 0, room, `Ghế họp ${i++}`, `${room}-n${dx}`);
    addSeat('meeting', cx + dx, cz + 1.2, PI, room, `Ghế họp ${i++}`, `${room}-s${dx}`);
  }
  addSeat('meeting', cx - 2.45, cz, PI / 2, room, 'Ghế chủ trì', `${room}-head`);
}

// Pantry
{
  addF('counter', 39.55, 23, 0.9, 7, 0, true, 'pantry');
  addF('coffeeMachine', 39.55, 20.4, 0.6, 0.5, -PI / 2, true, 'pantry');
  addF('fridge', 39.5, 27.2, 0.9, 0.8, -PI / 2, true, 'pantry');
  addF('waterCooler', 30.6, 27.4, 0.4, 0.4, 0, true, 'pantry');
  INTERACTABLES.push({ id: 'coffee', kind: 'coffee', x: 38.6, z: 20.4, radius: 1.3, label: 'Pha cà phê' });
  INTERACTABLES.push({ id: 'water', kind: 'water', x: 31.2, z: 27, radius: 1.1, label: 'Uống nước' });
  for (const [x, z] of [[34, 21.5], [34, 25.5]] as const) {
    addF('roundTable', x, z, 1.0, 1.0, 0, true, 'pantry');
    addSeat('stool', x - 0.85, z, PI / 2, 'pantry', 'Ghế pantry');
    addSeat('stool', x + 0.85, z, -PI / 2, 'pantry', 'Ghế pantry');
    addSeat('stool', x, z - 0.85, 0, 'pantry', 'Ghế pantry');
  }
}

// Library: bookshelves + 4 focus desks facing the north wall + armchairs.
{
  addF('bookshelf', 0.35, 5, 8, 0.45, PI / 2, true, 'library');
  addF('bookshelf', 4.2, 0.35, 6, 0.45, 0, true, 'library');
  for (const [i, x] of [1.9, 3.9, 5.9, 7.9].entries()) {
    const id = `focus-${i + 1}`;
    FURNITURE.push({ id, kind: 'focusDesk', x, z: 3.3, ry: PI, w: 1.2, d: 0.6, solid: true, zone: 'library' });
    addSeat('focus', x, 4.25, PI, 'library', `Góc tập trung ${i + 1}`, id);
  }
  addF('rug', 5, 8, 5, 3, 0, false, 'library');
  addF('lamp', 1, 10.3, 0.4, 0.4, 0, true, 'library');
  addF('bigPlant', 9.3, 0.7, 0.7, 0.7, 0, true, 'library');
  addSeat('sofa', 2.6, 8, PI / 2, 'library', 'Ghế đọc sách', 'read-1');
  addF('sofa', 2.5, 8, 0.9, 0.9, PI / 2, true, 'library');
  addSeat('sofa', 7.6, 8, -PI / 2, 'library', 'Ghế đọc sách', 'read-2');
  addF('sofa', 7.7, 8, 0.9, 0.9, -PI / 2, true, 'library');
}

// Lounge: rug, L sofa set around a coffee table, bean bags, arcade machine.
{
  addF('rug', 4.8, 16.5, 6, 4.5, 0, false, 'lounge');
  addF('coffeeTable', 4.8, 16.5, 1.6, 0.8, 0, true, 'lounge');
  addF('sofa', 4.8, 14.6, 2.6, 0.9, 0, true, 'lounge');
  addSeat('sofa', 4.1, 14.7, 0, 'lounge', 'Sofa', 'sofa-1');
  addSeat('sofa', 5.5, 14.7, 0, 'lounge', 'Sofa', 'sofa-2');
  addF('sofa', 1.9, 16.5, 2.4, 0.9, PI / 2, true, 'lounge');
  addSeat('sofa', 2.0, 16.0, PI / 2, 'lounge', 'Sofa', 'sofa-3');
  addSeat('sofa', 2.0, 17.1, PI / 2, 'lounge', 'Sofa', 'sofa-4');
  addF('beanbag', 7.3, 18.2, 0.9, 0.9, 0, true, 'lounge');
  addSeat('sofa', 7.3, 18.2, -PI * 0.75, 'lounge', 'Ghế lười', 'bean-1');
  addF('beanbag', 4.8, 19.2, 0.9, 0.9, 0, true, 'lounge');
  addSeat('sofa', 4.8, 19.2, PI, 'lounge', 'Ghế lười', 'bean-2');
  addF('arcade', 0.6, 24, 0.8, 0.8, PI / 2, true, 'lounge');
  INTERACTABLES.push({ id: 'arcade', kind: 'arcade', x: 1.5, z: 24, radius: 1.2, label: 'Chơi máy game' });
  addF('bigPlant', 0.7, 27.3, 0.7, 0.7, 0, true, 'lounge');
  addF('bigPlant', 9.3, 27.3, 0.7, 0.7, 0, true, 'lounge');
  addF('lamp', 0.6, 13.6, 0.4, 0.4, 0, true, 'lounge');
}

// Lobby: reception desk, kanban board, plants, water cooler.
{
  addF('kanbanBoard', 20, 17.2, 4.2, 0.3, 0, true, 'lobby');
  INTERACTABLES.push({ id: 'kanban', kind: 'kanban', x: 20, z: 18.4, radius: 2.2, label: 'Mở bảng Kanban' });
  addF('reception', 25.5, 22, 2.6, 0.9, 0, true, 'lobby');
  addF('bigPlant', 29.2, 27.2, 0.7, 0.7, 0, true, 'lobby');
  addF('plant', 14.5, 17.4, 0.5, 0.5, 0, true, 'lobby');
  addF('plant', 25.5, 17.4, 0.5, 0.5, 0, true, 'lobby');
  addF('sofa', 14, 24.5, 2.4, 0.9, PI / 2, true, 'lobby');
  addSeat('sofa', 14.1, 24, PI / 2, 'lobby', 'Ghế chờ', 'wait-1');
  addSeat('sofa', 14.1, 25.1, PI / 2, 'lobby', 'Ghế chờ', 'wait-2');
}

// ------------------------------------------------------------------ upper floor: cinema
// Stadium seating: 6 rows rising toward the north wall; the screen is on the south wall, next to
// the two doors from the hall (you come in at the front, at floor level, and climb the side aisles).
export const CINEMA_ROWS_Z = [12.7, 11.2, 9.7, 8.2, 6.7, 5.2]; // front → back
export const ROW_RISE = 0.42;
const BAND = 1.5;
const BAND_FRONT = CINEMA_ROWS_Z[0] + BAND / 2;

/** Height of the floor under a (logical) position, in drawn/world units. */
export function groundAt(x: number, z: number): number {
  const st = stairAt(x, z);
  if (st) return stairY(st, visualX(x));
  const f = floorOf(x);
  if (f === 1 && x > CINEMA.x0 && x < CINEMA.x1 && z > CINEMA.z0 && z < CINEMA.z1) {
    return FLOOR_H + Math.max(0, Math.min(CINEMA_ROWS_Z.length - 1, Math.floor((BAND_FRONT - z) / BAND))) * ROW_RISE;
  }
  if (f === 3 && onStage(x, z)) return 3 * FLOOR_H + KARA_STAGE.h;
  return f * FLOOR_H;
}

export function onStage(x: number, z: number): boolean {
  return x > KARA_STAGE.x0 && x < KARA_STAGE.x1 && z > KARA_STAGE.z0 && z < KARA_STAGE.z1;
}

/** Screen: centre in upper-floor local coords (y above the upper floor). */
export const CINEMA_SCREEN = { x: (CINEMA.x0 + CINEMA.x1) / 2, y: 3.55, z: CINEMA.z1 - 0.34, w: 9.8, h: 5.5, ry: Math.PI };
{
  const cx = CINEMA_SCREEN.x;
  FURNITURE.push({ id: 'cinemaScreen-0', kind: 'cinemaScreen', x: cx, z: CINEMA.z1 - 0.2, ry: Math.PI, w: CINEMA_SCREEN.w + 0.6, d: 0.3, h: CINEMA_SCREEN.h + 0.5, solid: true, zone: 'cinema' });
  addF('curtain', cx - CINEMA_SCREEN.w / 2 - 0.9, CINEMA.z1 - 0.45, 1.4, 0.4, Math.PI, true, 'cinema');
  addF('curtain', cx + CINEMA_SCREEN.w / 2 + 0.9, CINEMA.z1 - 0.45, 1.4, 0.4, Math.PI, true, 'cinema');
  // risers (one per row band; the last one runs to the back wall)
  CINEMA_ROWS_Z.forEach((_, i) => {
    if (!i) return;
    const zFront = BAND_FRONT - i * BAND;
    const zBack = i === CINEMA_ROWS_Z.length - 1 ? CINEMA.z0 : zFront - BAND;
    FURNITURE.push({ id: `riser-${i}`, kind: 'riser', x: cx, z: (zFront + zBack) / 2, ry: 0, w: CINEMA.x1 - CINEMA.x0 - 0.2, d: zFront - zBack, h: i * ROW_RISE, solid: false, zone: 'cinema' });
    addF('stripLight', cx, zFront - 0.02, CINEMA.x1 - CINEMA.x0 - 0.4, 0.05, 0, false, 'cinema');
    FURNITURE[FURNITURE.length - 1].y = i * ROW_RISE;
  });
  // 3 blocks per row (6 + 8 + 6) with two aisles; row A is the front row; everyone faces the screen (+z)
  const xs = [...[0, 1, 2, 3, 4, 5].map((i) => 61.6 + i), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => 68.5 + i), ...[0, 1, 2, 3, 4, 5].map((i) => 77.4 + i)];
  CINEMA_ROWS_Z.forEach((z, r) => {
    const letter = 'ABCDEF'[r];
    xs.forEach((x, i) => {
      SEATS.push({ id: `cine-${letter}${i + 1}`, kind: 'cinema', x, y: r * ROW_RISE, z, ry: 0, zone: 'cinema', label: `Ghế ${letter}${i + 1}` });
    });
  });
  addF('popcorn', CINEMA.x0 + 0.75, 16.6, 0.9, 0.7, Math.PI / 2, true, 'cinema');
  INTERACTABLES.push({ id: 'popcorn', kind: 'popcorn', x: CINEMA.x0 + 1.7, z: 16.6, radius: 1.2, label: 'Lấy bỏng ngô 🍿' });
  INTERACTABLES.push({ id: 'cinema', kind: 'cinema', x: CINEMA.x1 - 1.6, z: 16.6, radius: 1.6, label: 'Bảng điều khiển máy chiếu' });
}

// ------------------------------------------------------------------ upper floor: bar
{
  addF('barShelf', 92, 0.32, 9, 0.42, 0, true, 'bar');
  addF('barCounter', 92, 3.0, 9, 0.9, 0, true, 'bar');
  [88.3, 89.5, 90.7, 91.9, 93.1, 94.3, 95.5].forEach((x, i) => addSeat('stool', x, 4.05, Math.PI, 'bar', `Ghế quầy bar ${i + 1}`, `bar-${i + 1}`));
  INTERACTABLES.push({ id: 'bar', kind: 'bar', x: 97.3, z: 3.1, radius: 1.3, label: 'Gọi đồ uống 🍹' });
  addF('djBooth', 98.45, 10.5, 2.8, 1.0, -Math.PI / 2, true, 'bar'); // the DJ stands behind it, by the wall
  INTERACTABLES.push({ id: 'dj', kind: 'dj', x: 97.2, z: 10.5, radius: 1.15, label: 'Chọn nhạc với DJ 🎧' });
  addF('speaker', 99.25, 7.4, 0.75, 0.6, -Math.PI / 2, true, 'bar');
  addF('speaker', 99.25, 13.6, 0.75, 0.6, -Math.PI / 2, true, 'bar');
  // booths along the cinema wall
  [6.5, 10.5, 14.5].forEach((z, i) => {
    addF('sofa', 84.62, z, 2.4, 0.9, PI / 2, true, 'bar');
    addF('coffeeTable', 86.55, z, 1.2, 0.6, PI / 2, true, 'bar');
    addSeat('sofa', 84.72, z - 0.55, PI / 2, 'bar', 'Ghế bar', `booth-${i}a`);
    addSeat('sofa', 84.72, z + 0.55, PI / 2, 'bar', 'Ghế bar', `booth-${i}b`);
  });
  for (const [x, z] of [[87.4, 17.4], [96.6, 17.4]] as const) {
    addF('barTable', x, z, 0.8, 0.8, 0, true, 'bar');
    addSeat('stool', x - 0.8, z, PI / 2, 'bar', 'Ghế bar');
    addSeat('stool', x + 0.8, z, -PI / 2, 'bar', 'Ghế bar');
    addSeat('stool', x, z - 0.8, 0, 'bar', 'Ghế bar');
  }
  addF('bigPlant', 99.35, 19.35, 0.7, 0.7, 0, true, 'bar');
  addF('bigPlant', 84.75, 19.35, 0.7, 0.7, 0, true, 'bar');
  // lucky wheel on the south wall, left of the door (the spinning disc is built by BarFx)
  addF('wheel', WHEEL_SPOT.x, WHEEL_SPOT.z, 2.0, 0.2, Math.PI, false, 'bar');
  INTERACTABLES.push({ id: 'wheel', kind: 'wheel', x: WHEEL_SPOT.x, z: WHEEL_SPOT.z - 1.15, radius: 1.2, label: 'Quay vòng quay may mắn 🎡' });
}

// ------------------------------------------------------------------ upper floor: hall
{
  addF('sofa', 65.5, 27.45, 2.4, 0.9, PI, true, 'hall2');
  addSeat('sofa', 64.95, 27.35, PI, 'hall2', 'Ghế chờ', 'hall-1');
  addSeat('sofa', 66.05, 27.35, PI, 'hall2', 'Ghế chờ', 'hall-2');
  addF('bigPlant', 60.65, 27.35, 0.7, 0.7, 0, true, 'hall2');
  addF('bigPlant', 80.3, 27.35, 0.7, 0.7, 0, true, 'hall2');
  addF('bigPlant', 99.35, 27.35, 0.7, 0.7, 0, true, 'hall2');
  addF('plant', 86.2, 20.5, 0.5, 0.5, 0, true, 'hall2');
  addF('plant', 96.2, 20.5, 0.5, 0.5, 0, true, 'hall2');
  [65.2, 68.6, 75.4, 78.8].forEach((x) => addF('poster', x, CINEMA.z1 + 0.12, 1.6, 0.06, 0, false, 'hall2'));
  addF('waterCooler', 99.5, 23.4, 0.4, 0.4, -PI / 2, true, 'hall2');
}

// ------------------------------------------------------------------ lifts
for (const l of LIFTS) {
  INTERACTABLES.push({ id: `lift-${l.floor}`, kind: 'elevator', x: l.cx, z: l.cz - 0.6, radius: 1.5, label: 'Thang máy 🛗 · chọn tầng' });
}

// ------------------------------------------------------------------ floor 3: BSS Net (game room) + hall
{
  let n = 1;
  const pc = (x: number, z: number, ry: number) => {
    const id = `pc-${String(n).padStart(2, '0')}`;
    FURNITURE.push({ id, kind: 'pcDesk', x, z, ry, w: 1.2, d: 0.65, solid: true, zone: 'netcafe' });
    // you sit on the -z side of the desk (local), facing it
    SEATS.push({ id, kind: 'pc', x: x - Math.sin(ry) * 0.9, z: z - Math.cos(ry) * 0.9, ry, zone: 'netcafe', label: `Máy ${n}` });
    n++;
  };
  for (let i = 0; i < 7; i++) pc(NET.x1 - 0.45, 8.0 + i * 1.4, PI / 2); // along the east wall
  for (let i = 0; i < 7; i++) pc(NET.x0 + 0.45, 8.0 + i * 1.4, -PI / 2); // along the west wall
  for (let i = 0; i < 4; i++) pc(151.7, 9.4 + i * 1.4, PI / 2); // island, facing east
  for (let i = 0; i < 4; i++) pc(152.35, 9.4 + i * 1.4, -PI / 2); // island, facing west
  // big arena screen + sofas to watch from
  FURNITURE.push({ id: 'gameScreen-0', kind: 'gameScreen', x: NET_SCREEN.x, z: 0.2, ry: 0, w: NET_SCREEN.w + 0.3, d: 0.2, solid: true, zone: 'netcafe' });
  for (const [x, k] of [[148.6, 'a'], [155.4, 'b']] as const) {
    addF('sofa', x, 4.6, 2.4, 0.9, PI, true, 'netcafe');
    addSeat('sofa', x - 0.55, 4.5, PI, 'netcafe', 'Ghế xem', `net-sofa-${k}1`);
    addSeat('sofa', x + 0.55, 4.5, PI, 'netcafe', 'Ghế xem', `net-sofa-${k}2`);
  }
  // snack corner by the door
  addF('snackBar', 147.2, 19.25, 2.6, 0.8, PI, true, 'netcafe');
  addF('fridge', NET.x0 + 0.6, 18.9, 0.9, 0.8, PI / 2, true, 'netcafe');
  INTERACTABLES.push({ id: 'snack', kind: 'snack', x: 147.2, z: 18.0, radius: 1.2, label: 'Mua mì tôm + nước 🍜' });
  addF('bigPlant', NET.x0 + 0.6, 0.6, 0.7, 0.7, 0, true, 'netcafe');
  addF('bigPlant', NET.x1 - 0.5, 0.6, 0.7, 0.7, 0, true, 'netcafe');
  addF('bigPlant', NET.x1 - 0.5, 19.4, 0.7, 0.7, 0, true, 'netcafe');
  // hall 3: a little arcade corner + somewhere to sit
  addF('arcade', TOP.x0 + 0.6, 22.2, 0.8, 0.8, PI / 2, true, 'hall3');
  addF('arcade', TOP.x0 + 0.6, 23.6, 0.8, 0.8, PI / 2, true, 'hall3');
  INTERACTABLES.push({ id: 'arcade-3', kind: 'arcade', x: TOP.x0 + 1.6, z: 22.9, radius: 1.2, label: 'Chơi máy game thùng' });
  addF('sofa', 128.0, 27.45, 2.4, 0.9, PI, true, 'hall3');
  addSeat('sofa', 127.45, 27.35, PI, 'hall3', 'Ghế chờ', 'hall3-1');
  addSeat('sofa', 128.55, 27.35, PI, 'hall3', 'Ghế chờ', 'hall3-2');
  addF('bigPlant', TOP.x0 + 0.65, 27.35, 0.7, 0.7, 0, true, 'hall3');
  addF('bigPlant', 141.1, 27.35, 0.7, 0.7, 0, true, 'hall3');
  addF('bigPlant', TOP.x1 - 0.65, 27.35, 0.7, 0.7, 0, true, 'hall3');
  addF('plant', 146.2, 20.5, 0.5, 0.5, 0, true, 'hall3');
  addF('plant', 156.2, 20.5, 0.5, 0.5, 0, true, 'hall3');
}

// ------------------------------------------------------------------ floor 4: karaoke
{
  const z = 'karaoke';
  FURNITURE.push({ id: 'stage-0', kind: 'stage', x: (KARA_STAGE.x0 + KARA_STAGE.x1) / 2, z: (KARA_STAGE.z0 + KARA_STAGE.z1) / 2, ry: 0, w: KARA_STAGE.x1 - KARA_STAGE.x0, d: KARA_STAGE.z1 - KARA_STAGE.z0, h: KARA_STAGE.h, solid: false, zone: z });
  FURNITURE.push({ id: 'karaScreen-0', kind: 'karaScreen', x: KARA_SCREEN.x, z: 0.16, ry: 0, w: KARA_SCREEN.w + 0.36, d: 0.2, h: KARA_SCREEN.h + 0.3, solid: true, zone: z });
  addF('speaker', 183.9, 0.75, 0.75, 0.6, 0, true, z);
  addF('speaker', 196.1, 0.75, 0.75, 0.6, 0, true, z);
  for (const [i, m] of MIC_SPOTS.entries()) {
    addF('micStand', m.x + (i ? 0.62 : -0.62), m.z + 0.55, 0.3, 0.3, m.ry, false, z);
    addF('wedge', m.x, KARA_STAGE.z1 - 0.32, 0.7, 0.45, PI, false, z);
  }
  // U of sofas round a long low table, facing the screen; a second row behind
  addF('coffeeTable', 190, 8.6, 4.2, 1.1, 0, true, z);
  for (const [x, k] of [[188.75, 'a'], [191.25, 'b']] as const) {
    addF('sofa', x, 10.55, 2.4, 0.9, PI, true, z);
    addSeat('sofa', x - 0.55, 10.45, PI, z, 'Sofa karaoke', `kara-${k}1`);
    addSeat('sofa', x + 0.55, 10.45, PI, z, 'Sofa karaoke', `kara-${k}2`);
  }
  addF('sofa', 186.35, 8.6, 2.4, 0.9, PI / 2, true, z);
  addSeat('sofa', 186.45, 8.05, PI / 2 + 0.5, z, 'Sofa karaoke', 'kara-w1');
  addSeat('sofa', 186.45, 9.15, PI / 2 + 0.35, z, 'Sofa karaoke', 'kara-w2');
  addF('sofa', 193.65, 8.6, 2.4, 0.9, -PI / 2, true, z);
  addSeat('sofa', 193.55, 8.05, -PI / 2 - 0.5, z, 'Sofa karaoke', 'kara-e1');
  addSeat('sofa', 193.55, 9.15, -PI / 2 - 0.35, z, 'Sofa karaoke', 'kara-e2');
  for (const [x, k] of [[187.6, 'c'], [192.4, 'd']] as const) {
    addF('sofa', x, 13.9, 2.4, 0.9, PI, true, z);
    addSeat('sofa', x - 0.55, 13.8, PI, z, 'Sofa karaoke', `kara-${k}1`);
    addSeat('sofa', x + 0.55, 13.8, PI, z, 'Sofa karaoke', `kara-${k}2`);
  }
  addF('songConsole', 198.9, 9.0, 0.7, 0.55, -PI / 2, true, z);
  INTERACTABLES.push({ id: 'kara-console', kind: 'karaoke', x: 197.9, z: 9.0, radius: 1.3, label: 'Chọn bài hát 🎤' });
  addF('fridge', 199.45, 15.6, 0.9, 0.8, -PI / 2, true, z);
  addF('bigPlant', 180.65, 19.35, 0.7, 0.7, 0, true, z);
  addF('bigPlant', 199.35, 19.35, 0.7, 0.7, 0, true, z);
  addF('bigPlant', 180.65, 5.0, 0.7, 0.7, 0, true, z);
  addF('bigPlant', 199.35, 5.0, 0.7, 0.7, 0, true, z);
}

// ------------------------------------------------------------------ floor 4: werewolf village
{
  const z = 'wolfroom';
  addF('firePit', WOLF_FIRE.x, WOLF_FIRE.z, 1.5, 1.5, 0, true, z);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = WOLF_FIRE.x + Math.sin(a) * WOLF_RING;
    const zz = WOLF_FIRE.z + Math.cos(a) * WOLF_RING;
    const id = `wolf-${String(i + 1).padStart(2, '0')}`;
    // the stump is the chair: you sit on it facing the fire
    SEATS.push({ id, kind: 'wolf', x, z: zz, ry: Math.atan2(WOLF_FIRE.x - x, WOLF_FIRE.z - zz), zone: z, label: `Gốc cây ${i + 1}` });
  }
  addF('moonWindow', 214.2, 0.12, 3.2, 0.2, 0, true, z);
  FURNITURE.push({ id: 'wolfBoard-0', kind: 'wolfBoard', x: 205.4, z: 0.16, ry: 0, w: 3.6, d: 0.2, h: 2.1, solid: true, zone: z });
  INTERACTABLES.push({ id: 'wolf-board', kind: 'wolf', x: 205.4, z: 1.3, radius: 1.5, label: 'Bảng luật Ma sói 🐺' });
  for (const [x, zz, s] of [[201.4, 1.4, 1.15], [218.6, 1.6, 1.25], [201.5, 18.4, 1.1], [218.5, 18.3, 1.2], [201.2, 11.0, 0.9], [218.8, 7.0, 0.95], [218.7, 13.2, 0.85]] as const) {
    FURNITURE.push({ id: `pine-${FURNITURE.length}`, kind: 'pine', x, z: zz, ry: (x * 7 + zz) % 6, w: 1.1 * s, d: 1.1 * s, h: s, solid: true, zone: z });
  }
  for (const [x, zz] of [[203.2, 4.0], [216.8, 4.0], [203.2, 15.2], [216.8, 15.2]] as const) addF('lantern', x, zz, 0.3, 0.3, 0, true, z);
  // logs along the side walls for people who come to watch
  for (const [x, zz, k] of [[201.0, 7.0, 'w1'], [201.0, 14.4, 'w2'], [219.0, 10.2, 'e1']] as const) {
    const ry = x < 210 ? PI / 2 : -PI / 2;
    addF('log', x, zz, 2.2, 0.55, ry, true, z);
    addSeat('sofa', x + (x < 210 ? 0.15 : -0.15), zz - 0.55, ry, z, 'Khúc gỗ (xem)', `wolf-log-${k}a`);
    addSeat('sofa', x + (x < 210 ? 0.15 : -0.15), zz + 0.55, ry, z, 'Khúc gỗ (xem)', `wolf-log-${k}b`);
  }
}

// ------------------------------------------------------------------ floor 4: hall
{
  const z = 'hall4';
  addF('sofa', 184.0, 27.45, 2.4, 0.9, PI, true, z);
  addSeat('sofa', 183.45, 27.35, PI, z, 'Ghế chờ', 'hall4-1');
  addSeat('sofa', 184.55, 27.35, PI, z, 'Ghế chờ', 'hall4-2');
  addF('bigPlant', ROOF4.x0 + 0.65, 27.35, 0.7, 0.7, 0, true, z);
  addF('bigPlant', ROOF4.x1 - 0.65, 27.35, 0.7, 0.7, 0, true, z);
  addF('bigPlant', 200.0, 20.55, 0.7, 0.7, 0, true, z);
  addF('plant', 186.2, 20.5, 0.5, 0.5, 0, true, z);
  addF('plant', 206.2, 20.5, 0.5, 0.5, 0, true, z);
  addF('waterCooler', 219.5, 23.4, 0.4, 0.4, -PI / 2, true, z);
}

// ------------------------------------------------------------------ floor 5: "Nội Gián"
{
  // task stations (what you see matches the job)
  const furnitureFor: Record<MoleTaskKind, { kind: FurnitureKind; w: number; d: number }> = {
    coffee: { kind: 'coffeeMachine', w: 0.6, d: 0.5 },
    bugs: { kind: 'desk', w: 1.4, d: 0.7 },
    files: { kind: 'filing', w: 1.0, d: 0.55 },
    plant: { kind: 'bigPlant', w: 0.7, d: 0.7 },
    paper: { kind: 'printer', w: 0.9, d: 0.7 },
    code: { kind: 'terminal', w: 0.8, d: 0.25 },
    reboot: { kind: 'terminal', w: 1.0, d: 0.3 },
    scan: { kind: 'terminal', w: 0.9, d: 0.3 },
  };
  for (const st of STATIONS) {
    const f = furnitureFor[st.kind];
    FURNITURE.push({ id: st.id, kind: f.kind, x: st.x, z: st.z, ry: st.ry, w: f.w, d: f.d, solid: true, zone: st.room === 'hall5' ? 'hall5' : `f5-${st.room}` });
    const m = TASK_META[st.kind];
    INTERACTABLES.push({ id: st.id, kind: 'mole', x: st.x + Math.sin(st.ry) * 0.95, z: st.z + Math.cos(st.ry) * 0.95, radius: 1.5, label: `${m.emoji} ${m.name}` });
  }
  FURNITURE.push({ id: 'fuseBox-0', kind: 'fuseBox', x: FUSE.x, z: FUSE.z, ry: FUSE.ry, w: 0.9, d: 0.25, solid: true, zone: 'f5-server' });
  INTERACTABLES.push({ id: 'mole-fuse', kind: 'mole', x: FUSE.x + 0.9, z: FUSE.z, radius: 1.4, label: '🔌 Hộp cầu dao (sửa khi mất điện)' });
  FURNITURE.push({ id: 'moleTable-0', kind: 'moleTable', x: BELL.x, z: BELL.z, ry: 0, w: 3.4, d: 3.4, solid: true, zone: 'f5-meet' });
  INTERACTABLES.push({ id: 'mole-bell', kind: 'mole', x: BELL.x, z: BELL.z + 2.4, radius: 2.6, label: '🔔 Chuông họp khẩn' });
  // decoration per room
  const R = ROOM_META;
  for (let i = 0; i < 4; i++) addF('serverRack', R.server.x0 + 0.45, 0.9 + i * 0.95, 0.6, 0.9, PI / 2, true, 'f5-server');
  for (let i = 0; i < 3; i++) addF('serverRack', R.server.x0 + 6.0 + i * 0.95, 0.45, 0.9, 0.6, 0, true, 'f5-server');
  for (const [x, z] of [[R.design.x0 + 5, 5.3], [R.design.x0 + 11, 5.3]] as const) {
    addF('desk', x, z, 1.4, 0.7, 0, true, 'f5-design');
    addF('desk', x, z + 0.75, 1.4, 0.7, PI, true, 'f5-design');
  }
  addF('bigPlant', R.design.x1 - 0.6, 8.3, 0.7, 0.7, 0, true, 'f5-design');
  addF('bookshelf', R.archive.x0 + 0.35, 5.0, 6, 0.45, PI / 2, true, 'f5-archive');
  addF('filing', R.archive.x0 + 4.5, 4.4, 1.0, 0.55, 0, true, 'f5-archive');
  addF('filing', R.archive.x0 + 7.0, 4.4, 1.0, 0.55, 0, true, 'f5-archive');
  addF('filing', R.archive.x0 + 4.5, 5.0, 1.0, 0.55, PI, true, 'f5-archive');
  addF('filing', R.archive.x0 + 7.0, 5.0, 1.0, 0.55, PI, true, 'f5-archive');
  addF('printer', R.print.x0 + 0.6, 11.8, 0.9, 0.7, PI / 2, true, 'f5-print');
  addF('printer', R.print.x0 + 0.6, 16.4, 0.9, 0.7, PI / 2, true, 'f5-print');
  addF('counter', R.print.x0 + 6.5, 14.5, 3.0, 0.8, 0, true, 'f5-print');
  addF('counter', R.canteen.x1 - 0.45, 15.6, 0.9, 4.0, 0, true, 'f5-canteen');
  addF('fridge', R.canteen.x1 - 0.5, 10.0, 0.9, 0.8, -PI / 2, true, 'f5-canteen');
  for (const [x, z] of [[R.canteen.x0 + 3.5, 12.5], [R.canteen.x0 + 3.5, 16.0]] as const) {
    addF('roundTable', x, z, 1.0, 1.0, 0, true, 'f5-canteen');
    addSeat('stool', x - 0.85, z, PI / 2, 'f5-canteen', 'Ghế căng tin');
    addSeat('stool', x + 0.85, z, -PI / 2, 'f5-canteen', 'Ghế căng tin');
  }
  for (const [x, z] of [[R.meet.x0 + 0.7, 9.7], [R.meet.x1 - 0.7, 9.7], [R.meet.x0 + 0.7, 18.3], [R.meet.x1 - 0.7, 18.3]] as const) addF('plant', x, z, 0.5, 0.5, 0, true, 'f5-meet');
  // hall 5: the game board + somewhere to wait
  FURNITURE.push({ id: 'moleBoard-0', kind: 'moleBoard', x: 255.0, z: 19.25, ry: 0, w: 4.2, d: 0.2, solid: true, zone: 'hall5' });
  INTERACTABLES.push({ id: 'mole-board', kind: 'mole', x: 255.0, z: 20.6, radius: 1.8, label: '🕵️ Bảng Nội Gián · tham gia' });
  addF('sofa', 257.5, 27.45, 2.4, 0.9, PI, true, 'hall5');
  addSeat('sofa', 256.95, 27.35, PI, 'hall5', 'Ghế chờ', 'hall5-1');
  addSeat('sofa', 258.05, 27.35, PI, 'hall5', 'Ghế chờ', 'hall5-2');
  // medical bay
  addF('sofa', R.med.x0 + 0.6, 22.5, 2.4, 0.9, PI / 2, true, 'f5-med');
  addF('sofa', R.med.x0 + 7.5, 27.4, 2.4, 0.9, PI, true, 'f5-med');
  addF('waterCooler', R.med.x1 - 0.5, 20.0, 0.4, 0.4, -PI / 2, true, 'f5-med');
  addF('bigPlant', R.med.x0 + 0.65, 19.8, 0.7, 0.7, 0, true, 'f5-med');
  // critical-sabotage consoles
  for (const c of CRIT) {
    FURNITURE.push({ id: c.id.replace('mole-', ''), kind: 'terminal', x: c.x, z: c.z, ry: c.ry, w: 1.0, d: 0.3, solid: true, zone: `f5-${c.room}` });
    INTERACTABLES.push({ id: c.id, kind: 'mole', x: c.x + Math.sin(c.ry) * 0.95, z: c.z + Math.cos(c.ry) * 0.95, radius: 1.4, label: '🚨 Bảng điều khiển server (sự cố)' });
  }
  addF('bigPlant', 279.35, 27.35, 0.7, 0.7, 0, true, 'hall5');
  addF('bigPlant', 279.35, 19.8, 0.7, 0.7, 0, true, 'hall5');
}

export const SEAT_BY_ID = new Map(SEATS.map((s) => [s.id, s]));

// ---------------------------------------------------------------- queries
export function zoneAt(x: number, z: number): Zone {
  for (const zn of ZONES) {
    if (x >= zn.x0 && x < zn.x1 && z >= zn.z0 && z < zn.z1) return zn;
  }
  return ZONES.find((zn) => zn.id === 'lobby')!;
}

export const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

/** Axis-aligned obstacle rectangles (walls + solid furniture), used for collision and nav grid. */
export function obstacleRects(): Rect[] {
  const out: Rect[] = [];
  const h = WALL_T / 2;
  for (const w of WALLS) {
    out.push({ x0: Math.min(w.x0, w.x1) - h, z0: Math.min(w.z0, w.z1) - h, x1: Math.max(w.x0, w.x1) + h, z1: Math.max(w.z0, w.z1) + h });
  }
  for (const f of FURNITURE) {
    if (!f.solid) continue;
    const rotated = Math.abs(Math.sin(f.ry)) > 0.5;
    const hw = (rotated ? f.d : f.w) / 2;
    const hd = (rotated ? f.w : f.d) / 2;
    out.push({ x0: f.x - hw, z0: f.z - hd, x1: f.x + hw, z1: f.z + hd });
  }
  return out;
}

/** Push a circle out of all rects. Returns corrected position. */
export function resolveCollision(rects: Rect[], x: number, z: number, r = PLAYER_RADIUS): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of rects) {
      const cx = Math.max(b.x0, Math.min(x, b.x1));
      const cz = Math.max(b.z0, Math.min(z, b.z1));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // centre inside the rect: push out along the shallowest axis
        const pl = x - b.x0, pr = b.x1 - x, pt = z - b.z0, pb = b.z1 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = b.x0 - r;
        else if (m === pr) x = b.x1 + r;
        else if (m === pt) z = b.z0 - r;
        else z = b.z1 + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  x = Math.max(r + WALL_T, Math.min(WORLD_W - r - WALL_T, x));
  z = Math.max(r + WALL_T, Math.min(WORLD_D - r - WALL_T, z));
  return { x, z };
}

/** Rooms where everyone inside hears everyone (and nobody outside). */
export function roomVoice(zone: Zone): boolean {
  return zone.kind === 'meeting' || zone.kind === 'karaoke' || zone.kind === 'wolf';
}

/** Voice rules: who should hear whom. */
export function voiceMode(zone: Zone): 'room' | 'proximity' | 'none' {
  if (roomVoice(zone)) return 'room';
  if (zone.kind === 'focus') return 'none';
  return 'proximity';
}

// ------------------------------------------------------------------ who hears / sees whom
export const VOICE_RADIUS = 4.5;
/** Binary media packets: µ-law voice, camera JPEG, screen JPEG, Opus voice. */
export const MEDIA_KIND = { audio: 1, cam: 2, screen: 3, opus: 4 } as const;
export type MediaKind = keyof typeof MEDIA_KIND;

interface Presence {
  x: number;
  z: number;
  status: string;
}

/**
 * Shared rule (server routes media with it, client uses it for volume/UI):
 * same meeting room / karaoke / werewolf village → everyone; library → nobody; elsewhere → within a radius.
 * People in "focus"/"away" don't take part in hallway voice.
 */
export function inRange(a: Presence, b: Presence, kind: MediaKind, slack = 0): boolean {
  const za = zoneAt(a.x, a.z);
  const zb = zoneAt(b.x, b.z);
  if (roomVoice(za) || roomVoice(zb)) return za.id === zb.id;
  if (voiceMode(za) === 'none' || voiceMode(zb) === 'none') return false;
  if (kind !== 'screen' && (a.status === 'focus' || b.status === 'focus' || a.status === 'away' || b.status === 'away')) return false;
  const r = (kind === 'screen' ? 8 : VOICE_RADIUS) + slack;
  return Math.hypot(a.x - b.x, a.z - b.z) <= r;
}
