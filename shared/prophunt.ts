// "Trốn tìm biến hình" (prop hunt) — floor 6, a furniture showroom. Hiders turn into a piece of
// furniture they are looking at and blend in; seekers, locked in the waiting room while they hide,
// then hunt them with foam-ball guns — but every shot at real furniture costs the seeker health.
// Hiders win if anyone is still standing when the clock runs out. Teams swap every round.
// Server: worker/prophunt.ts. Types, rules and the floor plan are shared here.
import type { FurnitureKind, Wall } from './map';

export const F6 = 300; // logical x of floor 6's west wall
export const PH_FLOOR = 5;
/** Logical x → is it on floor 6. */
export const onPropFloor = (x: number) => x >= F6 - 10 && x < F6 + 50;

// ------------------------------------------------------------------ floor plan (local x 0..40, z 0..28)
export type PhRoom = 'living' | 'bedroom' | 'kitchen' | 'office' | 'storage' | 'kids' | 'hall' | 'cage';
export const PH_ROOMS: Record<PhRoom, { name: string; x0: number; z0: number; x1: number; z1: number; floor: 'wood' | 'carpet' | 'tile' | 'stone' | 'rug'; tint: string }> = {
  living: { name: 'Phòng khách mẫu', x0: 0, z0: 0, x1: 14, z1: 9, floor: 'wood', tint: '#e9dccb' },
  bedroom: { name: 'Phòng ngủ mẫu', x0: 14, z0: 0, x1: 27, z1: 9, floor: 'carpet', tint: '#d9d2e6' },
  kitchen: { name: 'Bếp mẫu', x0: 27, z0: 0, x1: 40, z1: 9, floor: 'tile', tint: '#e4ecef' },
  office: { name: 'Văn phòng mẫu', x0: 0, z0: 9, x1: 12, z1: 19, floor: 'carpet', tint: '#d6dee6' },
  storage: { name: 'Kho hàng', x0: 12, z0: 9, x1: 28, z1: 19, floor: 'stone', tint: '#cfc9bd' },
  kids: { name: 'Khu đồ chơi & thu ngân', x0: 28, z0: 9, x1: 40, z1: 19, floor: 'rug', tint: '#f3dfe2' },
  hall: { name: 'Sảnh tầng 6', x0: 0, z0: 19, x1: 28, z1: 28, floor: 'stone', tint: '#e6e1d8' },
  cage: { name: 'Phòng chờ người tìm', x0: 28, z0: 19, x1: 40, z1: 28, floor: 'stone', tint: '#c9ccd2' },
};
export const PH_ROOM_IDS = Object.keys(PH_ROOMS) as PhRoom[];
export const phZone = (r: PhRoom) => `f6-${r}`;
export function phRoomAt(x: number, z: number): PhRoom | null {
  const lx = x - F6;
  for (const k of PH_ROOM_IDS) {
    const r = PH_ROOMS[k];
    if (lx >= r.x0 && lx < r.x1 && z >= r.z0 && z < r.z1) return k;
  }
  return null;
}

/** Walls (local x), doorways already cut out. */
const seg = (x0: number, z0: number, x1: number, z1: number): Wall => ({ x0: F6 + x0, z0, x1: F6 + x1, z1, kind: 'up' });
export const PH_WALLS: Wall[] = [
  // the building's shell
  seg(0, 0, 40, 0),
  seg(0, 28, 40, 28),
  seg(0, 0, 0, 28),
  seg(40, 0, 40, 28),
  // between the front row and the middle row (z = 9): living↔office, bedroom↔storage, kitchen↔kids
  seg(0, 9, 5.5, 9),
  seg(8.5, 9, 17, 9),
  seg(20, 9, 32, 9),
  seg(35, 9, 40, 9),
  // front row: living | bedroom | kitchen
  seg(14, 0, 14, 3),
  seg(14, 6, 14, 9),
  seg(27, 0, 27, 3),
  seg(27, 6, 27, 9),
  // middle row: office | storage | kids
  seg(12, 9, 12, 12.5),
  seg(12, 15.5, 12, 19),
  seg(28, 9, 28, 12.5),
  seg(28, 15.5, 28, 19),
  // the hall (z = 19): into the office, into the storage; the waiting room's shutter
  seg(0, 19, 3, 19),
  seg(6.5, 19, 16, 19),
  seg(20, 19, 32, 19),
  seg(35.5, 19, 40, 19),
  // hall | waiting room
  seg(28, 19, 28, 28),
];
/** The waiting room's roller shutter (local x, on z = 19): shut while the hiders hide. */
export const PH_GATE = { x0: 32, x1: 35.5, z: 19 };
/** Join board (local), on the hall's south wall right by the stairs. */
export const PH_BOARD = { x: 6.2, z: 27.75 };

/** Where seekers wait (inside the waiting room) and where hiders start (the hall). */
export const PH_CAGE_SPOTS = [
  [31, 22], [34, 22], [37, 22], [31, 25], [34, 25], [37, 25], [32.5, 23.5], [35.5, 23.5],
].map(([x, z]) => ({ x: F6 + x, z }));
export const PH_START_SPOTS = [
  [2.5, 20.8], [5, 21.5], [7.5, 20.8], [10, 21.8], [12.5, 20.8], [15, 21.8], [17.5, 20.8], [20, 21.8],
  [22.5, 20.8], [25, 21.8], [3.5, 23.6], [8, 23.8], [13, 23.2], [18, 23.2], [25.5, 23.6], [6, 25.2],
].map(([x, z]) => ({ x: F6 + x, z }));

// ------------------------------------------------------------------ props
/** What a hider can become. Health follows the size (small things go down in two shots). */
export type PhSize = 'S' | 'M' | 'L';
export const PH_HP: Record<PhSize, number> = { S: 50, M: 100, L: 150 };
export const PH_PROPS: Partial<Record<FurnitureKind, { name: string; size: PhSize }>> = {
  sofa: { name: 'ghế sofa', size: 'L' },
  armchair: { name: 'ghế bành', size: 'M' },
  coffeeTable: { name: 'bàn trà', size: 'M' },
  tvStand: { name: 'kệ tivi', size: 'M' },
  lamp: { name: 'đèn cây', size: 'S' },
  plant: { name: 'chậu cây', size: 'S' },
  bigPlant: { name: 'cây cảnh lớn', size: 'M' },
  beanbag: { name: 'ghế lười', size: 'M' },
  bookshelf: { name: 'tủ sách', size: 'L' },
  carton: { name: 'thùng carton', size: 'S' },
  teddy: { name: 'gấu bông', size: 'S' },
  toyBall: { name: 'quả bóng', size: 'S' },
  bedDouble: { name: 'giường đôi', size: 'L' },
  nightstand: { name: 'tủ đầu giường', size: 'S' },
  wardrobe: { name: 'tủ quần áo', size: 'L' },
  counter: { name: 'tủ bếp', size: 'L' },
  fridge: { name: 'tủ lạnh', size: 'L' },
  roundTable: { name: 'bàn tròn', size: 'M' },
  stool2: { name: 'ghế đẩu', size: 'S' },
  waterCooler: { name: 'cây nước', size: 'S' },
  trashBin: { name: 'thùng rác', size: 'S' },
  washer: { name: 'máy giặt', size: 'M' },
  desk: { name: 'bàn làm việc', size: 'L' },
  chairProp: { name: 'ghế xoay', size: 'S' },
  printer: { name: 'máy in', size: 'S' },
  filing: { name: 'tủ hồ sơ', size: 'M' },
  shelfRack: { name: 'kệ hàng', size: 'L' },
  crates: { name: 'chồng thùng gỗ', size: 'M' },
  pallet: { name: 'pallet hàng', size: 'M' },
  trolley: { name: 'xe đẩy', size: 'M' },
  cone: { name: 'cọc giao thông', size: 'S' },
  fireExt: { name: 'bình chữa cháy', size: 'S' },
  vending: { name: 'máy bán nước', size: 'L' },
  kidsHouse: { name: 'nhà đồ chơi', size: 'L' },
};
export const isPhProp = (k: FurnitureKind) => !!PH_PROPS[k];

// ------------------------------------------------------------------ rules
export const PH_MIN = 3;
export const PH_MAX = 16;
export const PH_SEEKER_HP = 100;
/** A foam ball that hits a hider. */
export const PH_HIT = 25;
/** What a seeker loses for shooting a real piece of furniture. */
export const PH_MISS = 5;
/** Seconds between two shots. */
export const PH_FIRE_S = 0.4;
export const PH_SHOT_RANGE = 30;
/** How close (m) a hider must be to the piece they turn into. */
export const PH_GRAB_RANGE = 3.2;
/** Turning into something else once the hunt is on (s). */
export const PH_SWAP_CD = 12;
export const PH_TAUNT_CD = 8;
export const PH_TAUNTS = 6;

export type PhPhase = 'lobby' | 'starting' | 'roles' | 'hide' | 'seek' | 'roundEnd' | 'end';
export type PhTeam = 'hider' | 'seeker';

export interface PhSettings {
  /** 0 = about a third of the players */
  seekers: number;
  hideS: number;
  roundMin: number;
  rounds: number;
  /** found hiders join the seekers */
  infect: boolean;
  /** every hider makes a sound this often (s, 0 = never) */
  tauntS: number;
}
export const PH_DEFAULTS: PhSettings = { seekers: 0, hideS: 30, roundMin: 4, rounds: 2, infect: false, tauntS: 60 };
export const PH_CHOICES = {
  seekers: [0, 1, 2, 3, 4],
  hideS: [20, 30, 45, 60],
  roundMin: [3, 4, 5, 7],
  rounds: [1, 2, 3, 4],
  tauntS: [0, 30, 60, 90],
} as const;

export function seekersFor(n: number, s: PhSettings): number {
  if (s.seekers > 0) return Math.max(1, Math.min(s.seekers, n - 1));
  return Math.max(1, Math.min(n - 1, Math.round(n / 3)));
}

export interface PhPlayer {
  id: string;
  name: string;
  team: PhTeam;
  alive: boolean;
  /** seekers: everyone sees it; hiders: only hiders */
  hp: number | null;
  maxHp: number;
  score: number;
  /** out: found (and what they were), or a seeker who shot too much furniture */
  out?: { how: 'found' | 'spent' | 'left'; by?: string; prop?: string };
}

export interface PhView {
  phase: PhPhase;
  until: number;
  round: number;
  host: string | null;
  joined: { id: string; name: string }[];
  settings: PhSettings;
  players: PhPlayer[];
  /** who is what right now (everyone draws them) — fid: the piece copied, ry: locked angle */
  props: Record<string, { fid: string; ry: number | null }>;
  hidersLeft: number;
  /** end of a round / the game */
  winner: PhTeam | null;
  why: string;
  feed: { t: number; text: string }[];
  me: {
    inGame: boolean;
    team: PhTeam | null;
    alive: boolean;
    hp: number;
    maxHp: number;
    /** server time you may turn into something else / taunt again */
    swapAt: number;
    tauntAt: number;
    /** where to stand at the start of this round (`key` changes every round) */
    spawn: { x: number; z: number; ry: number; key: string } | null;
  };
}

export type PhFx =
  | { kind: 'taunt'; id: string; x: number; z: number; n: number; auto: boolean }
  | { kind: 'shot'; by: string; x: number; z: number; tx: number; ty: number; tz: number }
  | { kind: 'hit'; id: string; by: string; hp: number }
  | { kind: 'found'; id: string; by: string; prop: string; x: number; z: number }
  | { kind: 'miss'; hp: number }
  | { kind: 'poof'; id: string; x: number; z: number };

export type PhMsg =
  | { a: 'join' }
  | { a: 'leave' }
  | { a: 'settings'; s: Partial<PhSettings> }
  | { a: 'start' }
  | { a: 'abort' }
  /** turn into furniture piece `fid` (null: back to yourself — hide phase only) */
  | { a: 'prop'; fid: string | null }
  /** lock the prop's angle (null: turn with you again) */
  | { a: 'lock'; ry: number | null }
  | { a: 'taunt' }
  /** a foam ball: `hit` = the hider it struck, `fid` = the piece of furniture it struck, or neither (wall / floor) */
  | { a: 'shoot'; hit: string | null; fid: string | null; tx: number; ty: number; tz: number };
