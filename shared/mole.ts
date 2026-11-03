// "Nội Gián" (the mole) — a social-deduction task game on floor 5. Employees run between rooms
// doing small office jobs to ship the project before the deadline; one or more hidden moles quietly
// "lay off" colleagues, cut the power and lock doors. A found colleague or the bell calls a meeting,
// everybody talks (voice) and votes someone out. Server: worker/mole.ts. Types + layout shared here.

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

export type MoleRoom = 'server' | 'design' | 'archive' | 'print' | 'meet' | 'canteen' | 'med' | 'hall5';
export const ROOM_META: Record<MoleRoom, { name: string; x0: number; z0: number; x1: number; z1: number }> = {
  server: { name: 'Phòng Server', x0: F5 + 0, z0: 0, x1: F5 + 12, z1: 9 },
  design: { name: 'Phòng Thiết Kế', x0: F5 + 12, z0: 0, x1: F5 + 28, z1: 9 },
  archive: { name: 'Kho Hồ Sơ', x0: F5 + 28, z0: 0, x1: F5 + 40, z1: 9 },
  print: { name: 'Phòng In Ấn', x0: F5 + 0, z0: 9, x1: F5 + 12, z1: 19 },
  meet: { name: 'Phòng Họp Khẩn', x0: F5 + 12, z0: 9, x1: F5 + 28, z1: 19 },
  canteen: { name: 'Căng Tin', x0: F5 + 28, z0: 9, x1: F5 + 40, z1: 19 },
  med: { name: 'Phòng Y Tế', x0: F5 + 0, z0: 19, x1: F5 + 12, z1: 28 },
  hall5: { name: 'Sảnh tầng 5', x0: F5 + 12, z0: 19, x1: F5 + 40, z1: 28 },
};

export interface Station {
  id: string;
  kind: MoleTaskKind;
  room: MoleRoom;
  x: number;
  z: number;
  /** direction the station faces (furniture front) */
  ry: number;
}

const PI = Math.PI;
export const STATIONS: Station[] = [
  { id: 'st-reboot', kind: 'reboot', room: 'server', x: F5 + 3.2, z: 0.7, ry: 0 },
  { id: 'st-bugs-s', kind: 'bugs', room: 'server', x: F5 + 9.5, z: 7.6, ry: PI },
  { id: 'st-bugs-d', kind: 'bugs', room: 'design', x: F5 + 15.5, z: 0.7, ry: 0 },
  { id: 'st-code-d', kind: 'code', room: 'design', x: F5 + 24.5, z: 0.7, ry: 0 },
  { id: 'st-files', kind: 'files', room: 'archive', x: F5 + 36.5, z: 0.7, ry: 0 },
  { id: 'st-code-a', kind: 'code', room: 'archive', x: F5 + 39.3, z: 6.5, ry: -PI / 2 },
  { id: 'st-paper', kind: 'paper', room: 'print', x: F5 + 0.7, z: 14.0, ry: PI / 2 },
  { id: 'st-plant-p', kind: 'plant', room: 'print', x: F5 + 9.6, z: 17.8, ry: PI },
  { id: 'st-coffee', kind: 'coffee', room: 'canteen', x: F5 + 39.3, z: 12.5, ry: -PI / 2 },
  { id: 'st-plant-c', kind: 'plant', room: 'canteen', x: F5 + 30.5, z: 17.8, ry: PI },
  { id: 'st-files-p', kind: 'files', room: 'print', x: F5 + 2.4, z: 9.7, ry: 0 },
  { id: 'st-scan', kind: 'scan', room: 'med', x: F5 + 3.0, z: 27.4, ry: PI },
  { id: 'st-coffee-h', kind: 'coffee', room: 'hall5', x: F5 + 39.3, z: 21.0, ry: -PI / 2 },
];
export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

/** Fuse box (lights out is fixed here) and the emergency bell (on the meeting table). */
export const FUSE = { x: F5 + 0.6, z: 4.6, ry: PI / 2 };
export const BELL = { x: F5 + 20, z: 14 };
export const TABLE = { x: F5 + 20, z: 14, r: 2.2 };
/** Critical sabotage ("server overload"): two consoles far apart must be held at the same time. */
export const CRIT = [
  { id: 'mole-crit-a', x: F5 + 11.3, z: 1.6, ry: -PI / 2, room: 'server' as MoleRoom },
  { id: 'mole-crit-b', x: F5 + 28.7, z: 7.4, ry: PI / 2, room: 'archive' as MoleRoom },
];
export const MOLE_CRIT_MS = 45_000;

/** Doorways between rooms (gaps in the walls). `axis`: the wall runs along x (door at fixed z) or along z. */
export interface MoleDoor {
  id: string;
  axis: 'x' | 'z';
  /** fixed coordinate of the wall */
  at: number;
  from: number;
  to: number;
  rooms: [MoleRoom, MoleRoom];
}
export const MOLE_DOORS: MoleDoor[] = [
  { id: 'd-sv-ds', axis: 'z', at: F5 + 12, from: 3.5, to: 5.5, rooms: ['server', 'design'] },
  { id: 'd-pr-mt', axis: 'z', at: F5 + 12, from: 13, to: 15, rooms: ['print', 'meet'] },
  { id: 'd-ds-ar', axis: 'z', at: F5 + 28, from: 3.5, to: 5.5, rooms: ['design', 'archive'] },
  { id: 'd-mt-ct', axis: 'z', at: F5 + 28, from: 13, to: 15, rooms: ['meet', 'canteen'] },
  { id: 'd-sv-pr', axis: 'x', at: 9, from: F5 + 5, to: F5 + 7, rooms: ['server', 'print'] },
  { id: 'd-ds-mt', axis: 'x', at: 9, from: F5 + 19, to: F5 + 21, rooms: ['design', 'meet'] },
  { id: 'd-ar-ct', axis: 'x', at: 9, from: F5 + 33, to: F5 + 35, rooms: ['archive', 'canteen'] },
  { id: 'd-pr-md', axis: 'x', at: 19, from: F5 + 5, to: F5 + 7, rooms: ['print', 'med'] },
  { id: 'd-md-hl', axis: 'z', at: F5 + 12, from: 22, to: 24, rooms: ['med', 'hall5'] },
  { id: 'd-mt-hl', axis: 'x', at: 19, from: F5 + 19, to: F5 + 21, rooms: ['meet', 'hall5'] },
  { id: 'd-ct-hl', axis: 'x', at: 19, from: F5 + 33, to: F5 + 35, rooms: ['canteen', 'hall5'] },
];

/** The rectangle a locked door blocks (for collision). */
export function doorRect(d: MoleDoor) {
  const t = 0.18;
  return d.axis === 'z' ? { x0: d.at - t, z0: d.from, x1: d.at + t, z1: d.to } : { x0: d.from, z0: d.at - t, x1: d.to, z1: d.at + t };
}

/** Where people stand round the meeting table (meeting call / game start). */
export function meetingSpot(i: number, n: number) {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  const r = TABLE.r + 0.9;
  const x = TABLE.x + Math.sin(a) * r;
  const z = TABLE.z + Math.cos(a) * r;
  return { x, z, ry: Math.atan2(TABLE.x - x, TABLE.z - z) };
}

export function roomAt(x: number, z: number): MoleRoom | null {
  for (const [k, r] of Object.entries(ROOM_META)) if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return k as MoleRoom;
  return null;
}

export type MolePhase = 'lobby' | 'starting' | 'roles' | 'play' | 'meeting' | 'vote' | 'result' | 'end';
export type MoleRole = 'crew' | 'mole';

export interface MoleSettings {
  /** 0 = auto by player count */
  moles: number;
  /** play time before the deadline, minutes (0 = no deadline) */
  minutes: number;
  /** seconds between two lay-offs */
  killCd: number;
  /** tasks per employee */
  tasks: number;
  /** say whether the voted-out person was a mole */
  reveal: boolean;
}
export const MOLE_DEFAULTS: MoleSettings = { moles: 0, minutes: 0, killCd: 30, tasks: 5, reveal: true };
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
export const VISION = { crew: 6.5, mole: 9, dark: 2.4 };

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
  meeting: { by: string; byName: string; reason: 'report' | 'bell'; body: string | null } | null;
  /** vote phase: who has voted (ids); result: voter → target */
  voted: string[];
  votes: Record<string, string> | null;
  result: { out: string | null; name: string; wasMole: boolean | null; why: 'votes' | 'tie' | 'skip' } | null;
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
  };
}

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
  | { a: 'vote'; target: string };
