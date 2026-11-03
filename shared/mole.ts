// "Nội Gián" (the mole) — a social-deduction task game on floor 5. Employees run between rooms
// doing small office jobs to ship the project before the deadline; one or more hidden moles quietly
// kill colleagues, cut the power, slam doors shut and crawl through the maintenance ducts. A body
// that is found or the bell calls a meeting, everybody talks (voice) and votes someone out.
// Server: worker/mole.ts. Types + layout shared here (the floor plan is a character grid: walls,
// rooms and zones are all derived from it, so they can never disagree).

export const F5 = 240; // logical x of floor 5's west wall
export const MOLE_FLOOR_X0 = 230;

export type MoleTaskKind = 'coffee' | 'bugs' | 'files' | 'plant' | 'paper' | 'code' | 'reboot' | 'scan';
export const TASK_META: Record<MoleTaskKind, { name: string; emoji: string; how: string }> = {
  coffee: { name: 'Pha cà phê cho sếp', emoji: '☕', how: 'Giữ nút để rót, thả tay khi cà phê nằm trong vạch xanh.' },
  bugs: { name: 'Bắt bug', emoji: '🐛', how: 'Bấm trúng 6 con bug trước khi chúng trốn mất.' },
  files: { name: 'Xếp hồ sơ', emoji: '📑', how: 'Bấm các tập hồ sơ theo thứ tự 1 → 9.' },
  plant: { name: 'Tưới cây', emoji: '🌿', how: 'Tưới từng chậu cho tới khi kim nằm trong vùng xanh — tưới quá là úng!' },
  paper: { name: 'Gỡ kẹt máy in', emoji: '🖨️', how: 'Kéo hết những tờ giấy bị kẹt ra (bấm mỗi tờ vài lần).' },
  code: { name: 'Đổi mật khẩu', emoji: '🔐', how: 'Nhớ mã 5 số hiện trong 2 giây rồi nhập lại.' },
  reboot: { name: 'Khởi động lại server', emoji: '🔄', how: 'Giữ nút cho tới khi thanh tiến trình đầy.' },
  scan: { name: 'Khám sức khoẻ', emoji: '🩺', how: 'Giữ nút và đứng yên 4 giây cho máy đo xong.' },
};

const PI = Math.PI;
type R4 = { x0: number; z0: number; x1: number; z1: number };

// ------------------------------------------------------------------ floor plan
/** 40 × 28 m, one character per square metre (local x = column, z = row). */
const run = (spec: [string, number][]) => spec.map(([c, n]) => c.repeat(n)).join('');
const ROW = {
  a: run([['S', 8], ['D', 10], ['Q', 5], ['A', 7], ['K', 10]]),
  b: run([['S', 8], ['D', 10], ['-', 5], ['A', 7], ['K', 10]]),
  c: run([['S', 8], ['-', 22], ['K', 10]]),
  d: run([['S', 5], ['T', 5], ['-', 2], ['N', 6], ['M', 8], ['-', 2], ['E', 5], ['C', 7]]),
  e: run([['P', 5], ['T', 5], ['-', 2], ['N', 6], ['M', 8], ['-', 2], ['E', 5], ['C', 7]]),
  f: run([['P', 10], ['-', 2], ['N', 6], ['M', 8], ['-', 2], ['E', 5], ['C', 7]]),
  g: run([['P', 10], ['-', 2], ['L', 6], ['M', 8], ['-', 2], ['E', 5], ['C', 7]]),
  h: run([['P', 10], ['-', 2], ['L', 6], ['M', 8], ['-', 5], ['B', 9]]),
  i: run([['Y', 10], ['-', 2], ['L', 6], ['H', 8], ['-', 5], ['B', 9]]),
  j: run([['Y', 10], ['H', 21], ['B', 9]]),
  k: run([['Y', 10], ['H', 30]]),
};
const rows = (r: string, n: number) => Array<string>(n).fill(r);
export const MOLE_GRID: string[] = [
  ...rows(ROW.a, 5),
  ...rows(ROW.b, 2),
  ...rows(ROW.c, 2),
  ...rows(ROW.d, 4),
  ROW.e,
  ROW.f,
  ROW.g,
  ...rows(ROW.h, 4),
  ROW.i,
  ROW.j,
  ...rows(ROW.k, 6),
];
export const GRID_W = 40;
export const GRID_D = 28;

export type MoleRoom =
  | 'server'
  | 'design'
  | 'security'
  | 'archive'
  | 'canteen'
  | 'storage'
  | 'print'
  | 'hr'
  | 'lounge'
  | 'meet'
  | 'elec'
  | 'acct'
  | 'boss'
  | 'med'
  | 'hall'
  | 'corr';

export interface MoleRoomMeta {
  ch: string;
  name: string;
  floor: 'wood' | 'carpet' | 'tile' | 'stone' | 'rug';
  /** floor tint */
  tint: string;
  /** colour of the ceiling light pools */
  light: string;
  /** a real room (doors can be locked from the sabotage menu) — not the hall or the corridors */
  room: boolean;
  /** rectangles (logical coords) covering the room */
  rects: R4[];
}

const META: Record<MoleRoom, Omit<MoleRoomMeta, 'rects'>> = {
  server: { ch: 'S', name: 'Phòng Server', floor: 'tile', tint: '#3d4a63', light: '#8fc8ff', room: true },
  design: { ch: 'D', name: 'Phòng Thiết Kế', floor: 'wood', tint: '#6a5a48', light: '#ffe2b8', room: true },
  security: { ch: 'Q', name: 'Phòng An Ninh', floor: 'tile', tint: '#2f3d4a', light: '#9ff0ff', room: true },
  archive: { ch: 'A', name: 'Kho Hồ Sơ', floor: 'wood', tint: '#5e4f3a', light: '#ffd9a0', room: true },
  canteen: { ch: 'K', name: 'Căng Tin', floor: 'tile', tint: '#6b6250', light: '#ffe6b0', room: true },
  storage: { ch: 'T', name: 'Kho Vật Tư', floor: 'stone', tint: '#4a4640', light: '#d9c8a0', room: true },
  print: { ch: 'P', name: 'Phòng In Ấn', floor: 'tile', tint: '#4c5466', light: '#cfe0ff', room: true },
  hr: { ch: 'N', name: 'Phòng Nhân Sự', floor: 'carpet', tint: '#5a4660', light: '#ffd6e8', room: true },
  lounge: { ch: 'L', name: 'Phòng Nghỉ', floor: 'rug', tint: '#4f5e4a', light: '#ffe2b0', room: true },
  meet: { ch: 'M', name: 'Phòng Họp Khẩn', floor: 'carpet', tint: '#3c4a72', light: '#bcd2ff', room: true },
  elec: { ch: 'E', name: 'Phòng Điện', floor: 'stone', tint: '#4a4a3a', light: '#fff0a0', room: true },
  acct: { ch: 'C', name: 'Phòng Kế Toán', floor: 'wood', tint: '#5a5040', light: '#fff1c8', room: true },
  boss: { ch: 'B', name: 'Phòng Giám Đốc', floor: 'wood', tint: '#6e4a34', light: '#ffd49a', room: true },
  med: { ch: 'Y', name: 'Phòng Y Tế', floor: 'tile', tint: '#4f6e69', light: '#c8fff0', room: true },
  hall: { ch: 'H', name: 'Sảnh tầng 5', floor: 'stone', tint: '#4a4d57', light: '#dfe6ff', room: false },
  corr: { ch: '-', name: 'Hành Lang', floor: 'stone', tint: '#3b3f4a', light: '#c8d4ff', room: false },
};
const BY_CH = new Map(Object.entries(META).map(([k, m]) => [m.ch, k as MoleRoom]));

/** Merge the grid into rectangles per room (row runs stacked while they line up). */
function rectsOf(ch: string): R4[] {
  const out: R4[] = [];
  let open = new Map<string, R4>();
  for (let z = 0; z < GRID_D; z++) {
    const row = MOLE_GRID[z];
    const next = new Map<string, R4>();
    let x = 0;
    while (x < GRID_W) {
      if (row[x] !== ch) {
        x++;
        continue;
      }
      let x1 = x;
      while (x1 < GRID_W && row[x1] === ch) x1++;
      const key = `${x},${x1}`;
      const r = open.get(key);
      if (r) {
        r.z1 = z + 1;
        next.set(key, r);
      } else {
        const nr = { x0: x, z0: z, x1, z1: z + 1 };
        out.push(nr);
        next.set(key, nr);
      }
      x = x1;
    }
    open = next;
  }
  return out.map((r) => ({ x0: r.x0 + F5, z0: r.z0, x1: r.x1 + F5, z1: r.z1 }));
}

export const ROOM_META = Object.fromEntries(Object.entries(META).map(([k, m]) => [k, { ...m, rects: rectsOf(m.ch) }])) as Record<MoleRoom, MoleRoomMeta>;
export const MOLE_ROOMS = Object.keys(ROOM_META) as MoleRoom[];
/** Rooms whose doors a mole can slam shut (everything but the hall and corridors). */
export const LOCKABLE_ROOMS = MOLE_ROOMS.filter((r) => ROOM_META[r].room);

export function roomAt(x: number, z: number): MoleRoom | null {
  const lx = Math.floor(x - F5);
  const lz = Math.floor(z);
  if (lx < 0 || lz < 0 || lx >= GRID_W || lz >= GRID_D) return null;
  return BY_CH.get(MOLE_GRID[lz][lx]) ?? null;
}

// ------------------------------------------------------------------ doors
/** A door in a wall. `axis`: the wall runs along x (door at fixed z) or along z (fixed x). */
export interface MoleDoor {
  id: string;
  axis: 'x' | 'z';
  /** fixed coordinate of the wall (logical) */
  at: number;
  from: number;
  to: number;
  rooms: [MoleRoom, MoleRoom];
}
// [id, axis, local at, local from, local to]
const DOOR_SPEC: [string, 'x' | 'z', number, number, number][] = [
  ['d-sv-hl', 'z', 8, 7, 9],
  ['d-sv-ds', 'z', 8, 2, 4],
  ['d-ds-hl', 'x', 7, 12, 14],
  ['d-an-hl', 'x', 5, 19, 21],
  ['d-ar-hl', 'x', 7, 25, 27],
  ['d-ct-hl', 'z', 30, 7, 9],
  ['d-vt-hl', 'z', 10, 10, 12],
  ['d-in-hl', 'z', 10, 16, 18],
  ['d-in-yt', 'x', 20, 3, 5],
  ['d-sv-in', 'x', 13, 1, 3],
  ['d-ns-hl', 'z', 12, 10, 12],
  ['d-ns-hp', 'z', 18, 11, 13],
  ['d-ng-hl', 'z', 12, 17, 19],
  ['d-ng-sh', 'x', 21, 14, 16],
  ['d-hp-hl', 'x', 9, 21, 23],
  ['d-hp-sh', 'x', 20, 23, 25],
  ['d-hp-he', 'z', 26, 13, 15],
  ['d-di-hl', 'z', 28, 10, 12],
  ['d-di-kt', 'z', 33, 12, 14],
  ['d-kt-ct', 'x', 9, 35, 37],
  ['d-gd-hl', 'z', 31, 17, 19],
  ['d-gd-sh', 'x', 22, 35, 37],
  ['d-yt-sh', 'z', 10, 23, 25],
  ['d-he-sh', 'x', 21, 27, 29],
  ['d-hl-sh', 'x', 21, 10, 12],
];
const cellAt = (lx: number, lz: number) => (lx < 0 || lz < 0 || lx >= GRID_W || lz >= GRID_D ? ' ' : MOLE_GRID[lz][lx]);
export const MOLE_DOORS: MoleDoor[] = DOOR_SPEC.map(([id, axis, at, from, to]) => {
  const m = (from + to) / 2;
  const a = axis === 'x' ? cellAt(Math.floor(m), at - 1) : cellAt(at - 1, Math.floor(m));
  const b = axis === 'x' ? cellAt(Math.floor(m), at) : cellAt(at, Math.floor(m));
  const ra = BY_CH.get(a);
  const rb = BY_CH.get(b);
  if (!ra || !rb || ra === rb) throw new Error(`door ${id} is not between two rooms`);
  return axis === 'x' ? { id, axis, at, from: from + F5, to: to + F5, rooms: [ra, rb] } : { id, axis, at: at + F5, from, to, rooms: [ra, rb] };
});
export const DOOR_BY_ID = new Map(MOLE_DOORS.map((d) => [d.id, d]));

/** The rectangle a closed door blocks (for collision and line of sight). */
export function doorRect(d: MoleDoor) {
  const t = 0.18;
  return d.axis === 'z' ? { x0: d.at - t, z0: d.from, x1: d.at + t, z1: d.to } : { x0: d.from, z0: d.at - t, x1: d.to, z1: d.at + t };
}
export function doorMid(d: MoleDoor) {
  const m = (d.from + d.to) / 2;
  return d.axis === 'x' ? { x: m, z: d.at } : { x: d.at, z: m };
}
export const MOLE_DOOR_RANGE = 2.0;

/** The walls of floor 5 (logical coords): every grid edge between two different areas, minus doors. */
export const MOLE_WALLS: R4[] = (() => {
  const local = DOOR_SPEC.map(([, axis, at, from, to]) => ({ axis, at, from, to }));
  const inDoor = (axis: 'x' | 'z', at: number, a: number) => local.some((d) => d.axis === axis && d.at === at && a >= d.from && a < d.to);
  const out: R4[] = [];
  // walls along x at z = k
  for (let k = 0; k <= GRID_D; k++) {
    let start = -1;
    for (let x = 0; x <= GRID_W; x++) {
      const wall = x < GRID_W && cellAt(x, k - 1) !== cellAt(x, k) && !inDoor('x', k, x);
      if (wall && start < 0) start = x;
      if (!wall && start >= 0) {
        out.push({ x0: start + F5, z0: k, x1: x + F5, z1: k });
        start = -1;
      }
    }
  }
  // walls along z at x = k
  for (let k = 0; k <= GRID_W; k++) {
    let start = -1;
    for (let z = 0; z <= GRID_D; z++) {
      const wall = z < GRID_D && cellAt(k - 1, z) !== cellAt(k, z) && !inDoor('z', k, z);
      if (wall && start < 0) start = z;
      if (!wall && start >= 0) {
        out.push({ x0: k + F5, z0: start, x1: k + F5, z1: z });
        start = -1;
      }
    }
  }
  return out;
})();

// ------------------------------------------------------------------ ducts (moles only)
export interface MoleVent {
  id: string;
  x: number;
  z: number;
  net: 'w' | 'c' | 'e' | 'n';
  room: MoleRoom;
}
const vent = (id: string, lx: number, z: number, net: MoleVent['net']): MoleVent => ({ id, x: lx + F5, z, net, room: roomAt(lx + F5, z)! });
export const MOLE_VENTS: MoleVent[] = [
  vent('v-server', 2.2, 7.6, 'w'),
  vent('v-storage', 6.4, 11.4, 'w'),
  vent('v-med', 8.4, 21.2, 'w'),
  vent('v-design', 16.6, 1.4, 'c'),
  vent('v-hr', 13.0, 14.2, 'c'),
  vent('v-hall', 12.8, 24.2, 'c'),
  vent('v-canteen', 38.6, 8.3, 'e'),
  vent('v-elec', 32.2, 15.3, 'e'),
  vent('v-boss', 39.1, 21.2, 'e'),
  vent('v-security', 21.8, 3.9, 'n'),
  vent('v-archive', 29.3, 6.3, 'n'),
  vent('v-acct', 34.2, 10.0, 'n'),
];
export const VENT_BY_ID = new Map(MOLE_VENTS.map((v) => [v.id, v]));
export const ventLinks = (id: string) => {
  const v = VENT_BY_ID.get(id);
  return v ? MOLE_VENTS.filter((o) => o.net === v.net && o.id !== id) : [];
};
export const MOLE_VENT_RANGE = 1.5;

// ------------------------------------------------------------------ stations
export interface Station {
  id: string;
  kind: MoleTaskKind;
  room: MoleRoom;
  x: number;
  z: number;
  /** direction the station faces (furniture front) */
  ry: number;
}
const st = (id: string, kind: MoleTaskKind, lx: number, z: number, ry: number): Station => ({ id, kind, room: roomAt(lx + F5, z)!, x: lx + F5, z, ry });
export const STATIONS: Station[] = [
  st('st-reboot', 'reboot', 2.6, 0.6, 0),
  st('st-bugs-s', 'bugs', 0.6, 10.6, PI / 2),
  st('st-bugs-d', 'bugs', 10.2, 0.6, 0),
  st('st-code-d', 'code', 15.2, 0.5, 0),
  st('st-code-q', 'code', 19.4, 0.5, 0),
  st('st-files', 'files', 27.4, 0.5, 0),
  st('st-coffee', 'coffee', 39.3, 3.4, -PI / 2),
  st('st-plant-k', 'plant', 31.0, 0.7, 0),
  st('st-files-t', 'files', 7.5, 13.45, PI),
  st('st-paper', 'paper', 0.7, 16.6, PI / 2),
  st('st-plant-l', 'plant', 13.0, 20.3, PI),
  st('st-files-n', 'files', 15.2, 9.4, 0),
  st('st-reboot-e', 'reboot', 31.0, 9.5, 0),
  st('st-code-c', 'code', 39.5, 11.4, -PI / 2),
  st('st-coffee-b', 'coffee', 39.3, 18.6, -PI / 2),
  st('st-scan', 'scan', 3.0, 27.4, PI),
];
export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

/** Fuse box (lights out is fixed here, Phòng Điện) and the emergency bell (on the meeting table). */
export const FUSE = { x: F5 + 28.12, z: 14.7, ry: PI / 2 };
/** Where you stand to use the fuse box. */
export const FUSE_SPOT = { x: FUSE.x + Math.sin(FUSE.ry) * 0.9, z: FUSE.z + Math.cos(FUSE.ry) * 0.9 };
export const BELL = { x: F5 + 22, z: 14.5 };
export const TABLE = { x: BELL.x, z: BELL.z, r: 2.2 };
/** Critical sabotage ("server overload"): two consoles far apart must be held at the same time. */
export const CRIT = [
  { id: 'mole-crit-a', x: F5 + 7.6, z: 5.6, ry: -PI / 2, room: 'server' as MoleRoom },
  { id: 'mole-crit-b', x: F5 + 31.4, z: 20.9, ry: PI / 2, room: 'boss' as MoleRoom },
];
export const MOLE_CRIT_MS = 45_000;
/** The game board in the hall (on the meeting room's south wall). */
export const MOLE_BOARD = { x: F5 + 20, z: 20.12 };

/** Where people stand round the meeting table (meeting call / game start). */
export function meetingSpot(i: number, n: number) {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  const r = TABLE.r + 0.9;
  const x = TABLE.x + Math.sin(a) * r;
  const z = TABLE.z + Math.cos(a) * r;
  return { x, z, ry: Math.atan2(TABLE.x - x, TABLE.z - z) };
}

export type MolePhase = 'lobby' | 'starting' | 'roles' | 'play' | 'meeting' | 'vote' | 'result' | 'end';
export type MoleRole = 'crew' | 'mole';

export interface MoleSettings {
  /** 0 = auto by player count */
  moles: number;
  /** play time before the deadline, minutes (0 = no deadline) */
  minutes: number;
  /** seconds between two kills */
  killCd: number;
  /** tasks per employee */
  tasks: number;
  /** say whether the voted-out person was a mole */
  reveal: boolean;
  /** the shared progress bar: live, or only refreshed at meetings (harder to tell who really works) */
  taskBar: 'live' | 'meetings';
}
export const MOLE_DEFAULTS: MoleSettings = { moles: 0, minutes: 0, killCd: 30, tasks: 5, reveal: true, taskBar: 'live' };
export const MOLE_MIN = 4;
export const MOLE_MAX = 12;
export const MOLE_KILL_RANGE = 2.2;
export const MOLE_REPORT_RANGE = 3.2;
export const MOLE_TASK_RANGE = 2.4;
export const MOLE_BELL_RANGE = 3.0;
export const MOLE_SAB_CD = 40_000;
export const MOLE_LIGHTS_MS = 30_000;
export const MOLE_LOCK_MS = 12_000;
/** Vision radius (m): employees, moles, employees in a blackout. */
export const VISION = { crew: 7, mole: 9.5, dark: 2.4 };

export function molesFor(n: number, s: MoleSettings) {
  if (s.moles > 0) return Math.max(1, Math.min(s.moles, Math.floor((n - 1) / 2)));
  return n <= 6 ? 1 : n <= 10 ? 2 : 3;
}

export interface MolePlayer {
  id: string;
  name: string;
  alive: boolean;
  /** known: yourself, fellow moles, everyone once you're out or the game is over (or reveal on vote-out) */
  role: MoleRole | null;
  out?: 'killed' | 'voted' | 'left';
}

export interface MoleView {
  phase: MolePhase;
  until: number;
  /** play time left (ms) — counts down only during 'play' */
  deadlineLeft: number;
  /** server time when deadlineLeft was measured */
  deadlineAt: number;
  host: string | null;
  joined: { id: string; name: string }[];
  settings: MoleSettings;
  players: MolePlayer[];
  /** finished tasks / all tasks (crew only) */
  progress: number;
  bodies: { id: string; name: string; x: number; z: number }[];
  /** server time the blackout ends (0 = lights on) */
  lights: number;
  /** critical sabotage: server time it blows up (0 = none) + which consoles are being held */
  crit: number;
  critHeld: string[];
  locks: { door: string; until: number }[];
  /** doors that are shut right now (by hand or locked) */
  doors: string[];
  /** people hiding in a duct right now (not drawn) */
  hidden: string[];
  meeting: { by: string; byName: string; reason: 'report' | 'bell'; body: string | null } | null;
  /** vote phase: who has voted (ids); result: voter → target */
  voted: string[];
  votes: Record<string, string> | null;
  result: { out: string | null; name: string; wasMole: boolean | null; why: 'votes' | 'tie' | 'skip'; molesLeft: number | null } | null;
  winner: MoleRole | null;
  why: string;
  log: { t: number; text: string }[];
  me: {
    inGame: boolean;
    role: MoleRole | null;
    alive: boolean;
    tasks: { st: string; kind: MoleTaskKind; done: boolean }[];
    mates: string[];
    killReady: number;
    sabReady: number;
    bell: number;
    vote: string | null;
    /** the duct you're in (moles) */
    vent: string | null;
  };
}

/** One-off moments sent to some people: your own death (with who did it), the killer's flash,
 *  a medical scan everyone nearby can see (moles can't fake it), a door / duct hatch moving. */
export type MoleFx =
  | { kind: 'killed'; by: string }
  | { kind: 'kill'; victim: string }
  | { kind: 'scan'; id: string; x: number; z: number }
  | { kind: 'door'; door: string; shut: boolean; locked?: boolean }
  | { kind: 'vent'; vent: string };

export type MoleMsg =
  | { a: 'join' }
  | { a: 'leave' }
  | { a: 'settings'; s: Partial<MoleSettings> }
  | { a: 'start' }
  | { a: 'abort' }
  | { a: 'task'; st: string }
  | { a: 'kill'; target: string }
  | { a: 'report'; body: string }
  | { a: 'bell' }
  | { a: 'sabotage'; kind: 'lights' | 'door' | 'crit'; room?: MoleRoom }
  | { a: 'fix' }
  | { a: 'hold'; console: string }
  | { a: 'vote'; target: string }
  | { a: 'door'; door: string }
  /** enter the duct here (`vent`), move to a linked one, or climb out (`vent: null`) */
  | { a: 'vent'; vent: string | null };
