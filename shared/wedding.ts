// "Tiệc cưới" — floor 7: a wedding banquet hall. A grand ballroom (stage with a flower arch and an
// LED wall, a petal aisle, round banquet tables under chandeliers, the cake and a champagne tower),
// a reception hall (gift table, welcome sign, photo wall) and the bride's dressing room.
// Two people take the groom / bride roles (an MC is optional), then run the programme: the walk
// down the aisle, vows, rings, the kiss, cutting the cake, pouring the champagne tower, the toast,
// the feast, the bouquet toss, the first dance and the party. Guests give (pretend) gift envelopes
// with a wish, cheer, fire party poppers and throw petals.
// Server: worker/wedding.ts. Layout, types and rules are shared here.
import type { Wall } from './map';

export const F7 = 360; // logical x of floor 7's west wall
export const WED_FLOOR = 6;
/** Logical x → is it on floor 7 (the top floor). */
export const onWedFloor = (x: number) => x >= F7 - 10;
const X = (lx: number) => F7 + lx;

// ------------------------------------------------------------------ floor plan (local x 0..40, z 0..28)
export type WedRoom = 'ballroom' | 'hall' | 'bridal';
export const WED_ROOMS: Record<WedRoom, { id: string; name: string; x0: number; z0: number; x1: number; z1: number; floor: 'wood' | 'carpet' | 'tile' | 'stone' | 'rug'; tint: string }> = {
  ballroom: { id: 'wedding', name: 'Sảnh tiệc cưới (tầng 7)', x0: 0, z0: 0, x1: 40, z1: 19, floor: 'stone', tint: '#f1e6d8' },
  hall: { id: 'hall7', name: 'Sảnh đón khách tầng 7', x0: 0, z0: 19, x1: 30, z1: 28, floor: 'stone', tint: '#e9e1d6' },
  bridal: { id: 'bridal', name: 'Phòng cô dâu', x0: 30, z0: 19, x1: 40, z1: 28, floor: 'carpet', tint: '#f3dfe2' },
};
export const WED_ZONES = new Set(Object.values(WED_ROOMS).map((r) => r.id));
export const inWedZone = (zone: string | undefined) => !!zone && WED_ZONES.has(zone);

/** Walls (local x), doorways already cut out. The stairwell rails are added in map.ts. */
const seg = (x0: number, z0: number, x1: number, z1: number): Wall => ({ x0: X(x0), z0, x1: X(x1), z1, kind: 'up' });
export const WED_WALLS: Wall[] = [
  // the building's shell
  seg(0, 0, 40, 0),
  seg(0, 28, 40, 28),
  seg(0, 0, 0, 28),
  seg(40, 0, 40, 28),
  // ballroom | hall + bridal room: the grand entrance at x 18.5..21.5
  seg(0, 19, 18.5, 19),
  seg(21.5, 19, 40, 19),
  // hall | bridal room (doorway z 21.6..23.6)
  seg(30, 19, 30, 21.6),
  seg(30, 23.6, 30, 28),
];
/** The ballroom's open entrance (no doors: you see the aisle from the hall). */
export const WED_ENTRANCE = { x0: X(18.5), x1: X(21.5), z: 19 };

// ------------------------------------------------------------------ the ballroom
/** Raised stage along the north wall (height above the floor). */
export const WED_STAGE = { x0: X(12.5), z0: 0, x1: X(27.5), z1: 3.6, h: 0.28 };
export function onWedStage(x: number, z: number): boolean {
  return x > WED_STAGE.x0 && x < WED_STAGE.x1 && z > WED_STAGE.z0 && z < WED_STAGE.z1;
}
/** LED wall behind the stage (floor-local height). */
export const WED_SCREEN = { x: X(20), y: 1.86, z: 0.22, w: 5.6, h: 2.5 };
/** The flower arch the couple stands under. */
export const WED_ARCH = { x: X(20), z: 2.3 };
/** Dance floor (light-up tiles) between the stage and the aisle. */
export const WED_DANCE = { x0: X(16.5), z0: 4.0, x1: X(23.5), z1: 8.0 };
/** Petal carpet down the middle. */
export const WED_AISLE = { x0: X(18.9), z0: 8.0, x1: X(21.1), z1: 19 };
export const WED_CAKE = { x: X(14.0), z: 6.4 };
export const WED_TOWER = { x: X(26.0), z: 6.4 };
export const WED_RINGS = { x: X(20), z: 1.15 };
export const WED_PODIUM = { x: X(24.7), z: 2.5 };
/** Banquet tables: 2 rows × 3 per side, 8 chairs each. */
export const WED_TABLES: { x: number; z: number }[] = [3.6, 8.7, 13.8, 26.2, 31.3, 36.4].flatMap((x) => [9.9, 15.2].map((z) => ({ x: X(x), z })));
export const WED_TABLE_R = 0.9;
export const WED_CHAIR_R = 1.28;
export const WED_CHAIRS = 8;
/** Crystal chandeliers (over the walkways between tables and over the aisle). */
export const WED_CHANDELIERS: { x: number; z: number }[] = [
  { x: X(6.15), z: 9.9 },
  { x: X(6.15), z: 15.2 },
  { x: X(33.85), z: 9.9 },
  { x: X(33.85), z: 15.2 },
  { x: X(20), z: 10.6 },
  { x: X(20), z: 15.4 },
];

// ------------------------------------------------------------------ the hall + the bride's room
export const WED_GIFT = { x: X(15.8), z: 19.5 };
export const WED_SIGN = { x: X(23.6), z: 19.75 };
export const WED_PHOTO = { x: X(0.25), z: 23.0 };
export const WED_VANITY = { x: X(39.65), z: 22.0 };
export const WED_DRESSES = { x: X(34.9), z: 19.55 };

// ------------------------------------------------------------------ where the couple goes for each step
export interface Spot {
  x: number;
  z: number;
  ry: number;
}
const PI = Math.PI;
const spot = (lx: number, z: number, ry: number): Spot => ({ x: X(lx), z, ry });
/** [bride, groom] — from the guests' side the bride is on the left. */
export const WED_SPOTS = {
  /** Just outside the entrance, facing the aisle. */
  march: [spot(19.45, 20.5, PI), spot(20.55, 20.5, PI)],
  /** Under the arch, facing each other. */
  arch: [spot(19.35, 2.3, PI / 2), spot(20.65, 2.3, -PI / 2)],
  /** Behind the cake / the tower, facing the guests. */
  cake: [spot(13.45, 5.15, 0), spot(14.55, 5.15, 0)],
  tower: [spot(25.45, 5.15, 0), spot(26.55, 5.15, 0)],
  /** Middle of the dance floor, facing each other. */
  dance: [spot(19.55, 6.0, PI / 2), spot(20.45, 6.0, -PI / 2)],
  /** Bride at the front of the stage with her back to the guests; the groom steps aside. */
  bouquet: [spot(20.0, 3.0, PI), spot(22.6, 2.4, -0.4)],
};

// ------------------------------------------------------------------ programme
export type WedRole = 'groom' | 'bride' | 'mc';
export type WedStep = 'idle' | 'march' | 'vows' | 'rings' | 'kiss' | 'cake' | 'champagne' | 'toast' | 'feast' | 'bouquet' | 'dance' | 'party';
export const WED_PROGRAM: WedStep[] = ['march', 'vows', 'rings', 'kiss', 'cake', 'champagne', 'toast', 'feast', 'bouquet', 'dance', 'party'];
export type WedTrack = 'lounge' | 'march' | 'vows' | 'waltz' | 'party';

export const STEP_META: Record<WedStep, { name: string; emoji: string; mc: string; track: WedTrack; spots: keyof typeof WED_SPOTS | null }> = {
  idle: { name: 'Đón khách', emoji: '💐', mc: 'Mời quý khách vào sảnh, ghi lưu bút và chụp ảnh cùng cô dâu chú rể', track: 'lounge', spots: null },
  march: { name: 'Tiến vào lễ đường', emoji: '👰', mc: 'Xin mời cô dâu và chú rể tiến vào lễ đường!', track: 'march', spots: 'march' },
  vows: { name: 'Lời thề nguyện', emoji: '💞', mc: 'Cô dâu chú rể trao nhau lời thề nguyện trăm năm', track: 'vows', spots: 'arch' },
  rings: { name: 'Trao nhẫn cưới', emoji: '💍', mc: 'Đôi nhẫn cưới — lời hứa gắn bó trọn đời', track: 'vows', spots: 'arch' },
  kiss: { name: 'Nụ hôn hạnh phúc', emoji: '💋', mc: 'Và bây giờ… chú rể có thể hôn cô dâu!', track: 'vows', spots: 'arch' },
  cake: { name: 'Cắt bánh cưới', emoji: '🎂', mc: 'Cô dâu chú rể cùng cắt chiếc bánh ngọt ngào', track: 'vows', spots: 'cake' },
  champagne: { name: 'Rót tháp ly', emoji: '🍾', mc: 'Dòng rượu sâm panh tràn đầy như hạnh phúc lứa đôi', track: 'vows', spots: 'tower' },
  toast: { name: 'Nâng ly chúc mừng', emoji: '🥂', mc: 'Mời toàn thể quý khách cùng nâng ly — một, hai, ba, dô!', track: 'party', spots: 'tower' },
  feast: { name: 'Khai tiệc', emoji: '🍽️', mc: 'Xin mời quý khách nhập tiệc — chúc ngon miệng!', track: 'lounge', spots: null },
  bouquet: { name: 'Tung hoa cưới', emoji: '💐', mc: 'Các bạn độc thân lên sàn nhảy nào — cô dâu sắp tung hoa!', track: 'party', spots: 'bouquet' },
  dance: { name: 'Điệu nhảy đầu tiên', emoji: '💃', mc: 'Điệu valse đầu tiên của vợ chồng mới cưới', track: 'waltz', spots: 'dance' },
  party: { name: 'Quẩy thôi!', emoji: '🎉', mc: 'Sàn nhảy mở cửa — mời tất cả cùng quẩy!', track: 'party', spots: null },
};

/** Timing inside a step (ms after `stepAt`). */
export const WED_T = {
  /** The couple waits at the entrance this long (the march intro), then walks down the aisle. */
  marchGo: 3200,
  ringsRise: 900,
  ringsLand: 3600,
  kiss: 1600,
  cakeCut: 5200,
  pour: 5000,
  pourDur: 7000,
  /** Toast countdown: "một" … "dô!" one second apart starting here. */
  toastCount: 1200,
  /** Bouquet: countdown 3-2-1 from here, the throw three seconds later. */
  bouquetCount: 4000,
  bouquetThrow: 7000,
  bouquetFly: 1500,
};

/** The ballroom's house lights: automatic (dim and glowing, darker for the dance), up, or off (candles only). */
export type WedLights = 'auto' | 'on' | 'off';
export const LIGHTS_META: Record<WedLights, { name: string; emoji: string; said: string }> = {
  auto: { name: 'Tự động', emoji: '✨', said: 'để đèn sảnh tự động' },
  on: { name: 'Bật đèn', emoji: '💡', said: 'bật đèn sảnh' },
  off: { name: 'Tắt đèn', emoji: '🌙', said: 'tắt đèn sảnh — chỉ còn nến lung linh' },
};
export const LIGHTS_ORDER: WedLights[] = ['auto', 'on', 'off'];
/** The light switch on the ballroom's south wall, east of the entrance. */
export const WED_SWITCH = { x: X(23.0), z: 18.88 };

export type WedAttire = 'bride' | 'groom' | 'bridesmaid' | 'groomsman';
export const ATTIRE_META: Record<WedAttire, { name: string; emoji: string; hint: string }> = {
  bride: { name: 'Váy cưới & khăn voan', emoji: '👰', hint: 'Khăn voan, vương miện hoa và bó hoa cầm tay' },
  groom: { name: 'Vest chú rể', emoji: '🤵', hint: 'Nơ cổ và hoa cài ngực' },
  bridesmaid: { name: 'Phù dâu', emoji: '🌸', hint: 'Vòng hoa cài tóc' },
  groomsman: { name: 'Phù rể', emoji: '🎀', hint: 'Nơ cổ và hoa cài ngực nhỏ' },
};

export interface WedPerson {
  id: string;
  name: string;
}

export interface WedGift {
  id: string;
  name: string;
  amount: number;
  wish: string;
  at: number;
}

export interface WedBouquet {
  /** Server ms when it lands. */
  at: number;
  x: number;
  z: number;
  /** Who caught it (null = it fell on the floor). */
  id: string | null;
  name: string | null;
}

export interface WedState {
  groom: WedPerson | null;
  bride: WedPerson | null;
  mc: WedPerson | null;
  step: WedStep;
  /** Server ms when the current step began. */
  stepAt: number;
  startedAt: number | null;
  /** Newest last. */
  gifts: WedGift[];
  total: number;
  givers: number;
  /** Outfits picked in the bride's room (the couple wear theirs automatically). */
  attire: Record<string, WedAttire>;
  bouquet: WedBouquet | null;
  /** Weddings held here so far. */
  count: number;
  /** House lights in the ballroom. */
  lights: WedLights;
}

export const emptyWed = (): WedState => ({
  groom: null,
  bride: null,
  mc: null,
  step: 'idle',
  stepAt: 0,
  startedAt: null,
  gifts: [],
  total: 0,
  givers: 0,
  attire: {},
  bouquet: null,
  count: 0,
  lights: 'auto',
});

/** What someone wears: the couple always dress for it. */
export function attireOf(s: WedState, id: string): WedAttire | null {
  if (s.bride?.id === id) return 'bride';
  if (s.groom?.id === id) return 'groom';
  return s.attire[id] ?? null;
}

/** Pretend money, just for fun — nothing is real. */
export const GIFT_AMOUNTS = [0, 200_000, 300_000, 500_000, 1_000_000, 2_000_000] as const;
export function money(n: number): string {
  if (!n) return 'Tấm lòng 💝';
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000} triệu`;
  return `${n.toLocaleString('vi-VN')}đ`;
}
export const WED_REACTS = ['👏', '❤️', '🌹', '🎉', '🥂', '😭'] as const;
export const WED_MAX_GIFTS = 30;
export const WED_WISH_MAX = 120;

export type WedMsg =
  | { a: 'role'; role: WedRole; on: boolean }
  | { a: 'step'; step: WedStep }
  | { a: 'next' }
  | { a: 'end' }
  | { a: 'gift'; amount: number; wish?: string }
  | { a: 'react'; e: string }
  | { a: 'popper' }
  | { a: 'petals' }
  | { a: 'attire'; attire: WedAttire | null }
  | { a: 'lights'; lights: WedLights };

export type WedFx =
  | { k: 'gift'; id: string; name: string; amount: number; wish: string }
  | { k: 'react'; id: string; e: string }
  | { k: 'popper'; id: string }
  | { k: 'petals'; id: string }
  | { k: 'lights'; id: string; name: string; lights: WedLights };

/** Next step in the programme (party is the last one). */
export function nextStep(s: WedStep): WedStep {
  const i = WED_PROGRAM.indexOf(s);
  return i < 0 ? 'march' : WED_PROGRAM[Math.min(WED_PROGRAM.length - 1, i + 1)];
}
