// "Tiệc cưới" — floor 7: a wedding banquet hall. A grand ballroom (stage with a flower arch and an
// LED wall, a petal aisle, round banquet tables under chandeliers, the cake and a champagne tower),
// a reception hall (gift table, welcome sign, photo wall) and the bride's dressing room.
// Two people take the groom / bride roles (an MC is optional), then run the programme: the walk
// down the aisle, vows, rings, the kiss, cutting the cake, pouring the champagne tower, the toast,
// the feast, the bouquet toss, the first dance and the party. Guests give (pretend) gift envelopes
// with a wish, cheer, fire party poppers and throw petals, chant for the kiss ("Hôn đi!"), clink
// glasses round their table ("Một, hai, ba — dô!"), reach for the bouquet, and a band plays real
// songs (YouTube, on the shared clock) that follow the programme — or whatever someone requests.
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
/** The couple's album: framed photos on the hall side of the ballroom's south wall (centre, wall face). */
export const WED_ALBUM = { x: X(8.2), z: 19.1 };
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
  /** The kiss: a step closer. */
  kiss: [spot(19.7, 2.3, PI / 2), spot(20.3, 2.3, -PI / 2)],
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
  /** The kiss with nobody watching (otherwise the guests chant until the meter is full). */
  kiss: 1600,
  /** …but not for longer than this. */
  kissMax: 13000,
  /** From a full meter to the kiss. */
  kissLead: 700,
  cakeCut: 5200,
  pour: 5000,
  pourDur: 7000,
  /** Toast countdown: "một" … "dô!" one second apart starting here. */
  toastCount: 1200,
  /** Bouquet: countdown 3-2-1 from here, the throw three seconds later. */
  bouquetCount: 4000,
  bouquetThrow: 7000,
  /** Up from the bride's hands to high above the dance floor, where it tumbles… */
  bouquetRise: 900,
  /** …the ring around the "grab" button closes here: the best moment to reach for it… */
  bouquetPerfect: 9300,
  /** …the server picks who got it… */
  bouquetResolve: 9800,
  /** …and it drops into their hands. */
  bouquetFly: 700,
};
/** Grabs for the bouquet count from here (a little after it leaves her hands). */
export const BOUQUET_OPEN = WED_T.bouquetThrow + 300;
/** Where the bouquet hangs in the air while everyone reaches for it. */
export const BOUQUET_APEX = { x: X(20), y: 3.9, z: 5.8 };
/** Who may reach for it: the crowd in front of the stage, not the couple, not anyone on the stage. */
export function inCatchZone(x: number, z: number): boolean {
  return !onWedStage(x, z) && z > WED_DANCE.z0 - 1 && z < WED_DANCE.z1 + 5 && x > WED_DANCE.x0 - 3 && x < WED_DANCE.x1 + 3;
}

/** Banquet table someone is sitting at / standing beside (index into WED_TABLES), or -1. */
export function tableNear(x: number, z: number): number {
  let best = -1;
  let bd = 2.1;
  WED_TABLES.forEach((t, i) => {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
/** "Một, hai, ba — dô!": from the first glass raised to the clink. */
export const DZO_MS = 3200;

// ------------------------------------------------------------------ the band
/**
 * What plays is a "set" picked by the step (several steps share one, so a song carries on through
 * the vows, the rings and the kiss); each set has a few songs. All are embeddable YouTube uploads,
 * checked to play in the iframe player. `dur` (seconds) keeps a long-running loop's position sane.
 */
export type WedSet = 'lounge' | 'march' | 'vows' | 'toast' | 'feast' | 'bouquet' | 'waltz' | 'party';
export const STEP_SET: Record<WedStep, WedSet> = {
  idle: 'lounge',
  march: 'march',
  vows: 'vows',
  rings: 'vows',
  kiss: 'vows',
  cake: 'vows',
  champagne: 'vows',
  toast: 'toast',
  feast: 'feast',
  bouquet: 'bouquet',
  dance: 'waltz',
  party: 'party',
};
export const SET_NAME: Record<WedSet, string> = {
  lounge: 'Đón khách',
  march: 'Tiến vào lễ đường',
  vows: 'Lễ thành hôn',
  toast: 'Nâng ly',
  feast: 'Khai tiệc',
  bouquet: 'Tung hoa',
  waltz: 'Điệu nhảy đầu tiên',
  party: 'Quẩy',
};
export interface WedSong {
  id: string;
  title: string;
  dur: number;
}
export const WED_SONGS: Record<WedSet, WedSong[]> = {
  lounge: [
    { id: '9z6r9uK8a_M', title: 'Saxophone nhạc cưới — hoà tấu lãng mạn', dur: 3519 },
    { id: 'gLUIsyjQmio', title: 'Canon in D — piano & cello (3 tiếng)', dur: 10947 },
  ],
  march: [
    { id: 'O2GRiATBa_g', title: 'Canon in D (Wedding Version) — Jacob’s Piano', dur: 202 },
    { id: 'Ptk_1Dc2iPY', title: 'Canon in D — Brooklyn Duo', dur: 302 },
  ],
  vows: [
    { id: 'DG6h__b_-iQ', title: 'Cưới Nhau Đi (Yes I Do) — Hiền Hồ x Bùi Anh Tuấn', dur: 239 },
    { id: 'sBiSqt8k3U4', title: 'Beautiful In White — piano & strings', dur: 250 },
    { id: '7rc2y2P5BgQ', title: 'Beautiful In White — piano', dur: 311 },
  ],
  toast: [{ id: '1mQwr_O81a4', title: 'Đám Cưới Nha? — Hồng Thanh x Mie', dur: 175 }],
  feast: [
    { id: '50diFJZFyMI', title: 'Liên khúc nhạc đám cưới nhẹ nhàng', dur: 4794 },
    { id: '9z6r9uK8a_M', title: 'Saxophone nhạc cưới — hoà tấu lãng mạn', dur: 3519 },
  ],
  bouquet: [
    { id: 'hW4z1dYE7No', title: 'Cưới Thôi — Masiu x Masew', dur: 202 },
    { id: '_8ldAdQd9WU', title: 'Cưới Thôi — Masew x Masiu x B Ray x TAP', dur: 182 },
  ],
  waltz: [
    { id: '7KZ460xFFPs', title: 'Can’t Help Falling In Love — Brooklyn Duo', dur: 225 },
    { id: 'MqazV4hbu8E', title: 'Can’t Help Falling In Love — Elvis Presley', dur: 183 },
    { id: 'jFQzRKyTn3c', title: 'Can’t Help Falling In Love — cello & piano', dur: 253 },
  ],
  party: [
    { id: '6L9LDweNOZY', title: 'Đám Cưới Nha Remix — liên khúc EDM', dur: 4957 },
    { id: 'Gm0c_qiQO5k', title: 'Liên khúc nhạc sống đám cưới — cực sung', dur: 5496 },
    { id: 'BBRCKcGPmhI', title: 'Mình Cưới Nhau Đi — Pjnboys x Huỳnh James', dur: 243 },
    { id: '6s0wDHcUD9I', title: 'Đám Cưới Nha? (Remix) — Hồng Thanh x DJ Mie', dur: 180 },
  ],
};
/** The song playing now: one of a set's (`pick`), or a request (`by`). `at` = server ms at 0:00. */
export interface WedMusic {
  id: string;
  title: string;
  set: WedSet;
  pick: number;
  at: number;
  /** Seconds (0 = unknown). */
  dur: number;
  by: string | null;
}
export function autoMusic(set: WedSet, pick: number, at: number): WedMusic {
  const list = WED_SONGS[set];
  const song = list[((pick % list.length) + list.length) % list.length];
  return { id: song.id, title: song.title, set, pick, at, dur: song.dur, by: null };
}
/** "3:45" / "1:02:05" → seconds. */
export function parseLen(len: string | undefined): number {
  if (!len) return 0;
  const parts = len.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

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
  /** How far (ms) the winner's grab was from the perfect moment (null = nobody reached, luck). */
  off: number | null;
  /** How many reached for it. */
  tries: number;
}

/** The kiss: the guests chant until the meter is full (`at` = when the kiss happens). */
export interface WedKiss {
  n: number;
  goal: number;
  at: number | null;
}

/** A photo of the couple (the bytes live in D1, served at /api/wed/photo/<id>). */
export interface WedPhoto {
  id: string;
  w: number;
  h: number;
  /** Who uploaded it. */
  by: string;
  at: number;
}
export const WED_MAX_PHOTOS = 12;
/** Upload limit (bytes) — the client shrinks pictures to ~1600 px JPEG first, far below this. */
export const WED_PHOTO_BYTES = 1_500_000;
export const WED_PHOTO_ID = /^[a-z0-9]{12,24}$/;
export const wedPhotoUrl = (id: string) => `/api/wed/photo/${id}`;
/** Who the album belongs to: a new couple starts with an empty one. */
export const coupleKey = (s: Pick<WedState, 'groom' | 'bride'>) => (s.groom && s.bride ? `${s.groom.id}|${s.bride.id}` : null);
/** The couple and the MC look after the album. */
export const canEditPhotos = (s: WedState, id: string) => !!s.groom && !!s.bride && (s.groom.id === id || s.bride.id === id || s.mc?.id === id);

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
  /** What the band is playing. */
  music: WedMusic;
  /** The "Hôn đi!" meter during the kiss step. */
  kiss: WedKiss | null;
  /** The couple's photos (slideshow on the LED wall, the welcome sign, the album wall in the hall). */
  photos: WedPhoto[];
  /** The one on the welcome sign (null = the first). */
  cover: string | null;
  /** coupleKey() of the couple the album belongs to. */
  photosOf: string | null;
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
  music: autoMusic('lounge', 0, 0),
  kiss: null,
  photos: [],
  cover: null,
  photosOf: null,
});

/** The photo on the welcome sign. */
export function coverPhoto(s: WedState): WedPhoto | null {
  return s.photos.find((p) => p.id === s.cover) ?? s.photos[0] ?? null;
}

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
export const WED_REACTS = ['👏', '❤️', '🌹', '🎉', '🥂', '😭', '📱'] as const;
/** The little reaction row (📱 = a phone torch held up, swaying, for the first dance). */
export const WED_REACT_ROW = ['👏', '❤️', '🌹', '🎉', '🥂', '😭'] as const;
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
  | { a: 'lights'; lights: WedLights }
  /** Request a song (YouTube id) — or `skip` to the set's next one. */
  | { a: 'song'; id: string; title?: string; dur?: number }
  | { a: 'skip' }
  /** "Hôn đi!" — one shout towards the kiss meter. */
  | { a: 'chant' }
  /** Raise a glass at my table ("Một, hai, ba — dô!"); joins the table's toast if one is counting. */
  | { a: 'dzo' }
  /** Reach for the bouquet (`el` = ms after the step began, on the sender's synced clock — fair whatever the latency). */
  | { a: 'catch'; el?: number }
  /** The album (uploads go over HTTP: POST /api/wed/photo): put one on the sign, move it, or take it down. */
  | { a: 'photo'; id: string; op: 'cover' | 'del' | 'left' | 'right' };

export type WedFx =
  | { k: 'gift'; id: string; name: string; amount: number; wish: string }
  | { k: 'react'; id: string; e: string }
  | { k: 'popper'; id: string }
  | { k: 'petals'; id: string }
  | { k: 'lights'; id: string; name: string; lights: WedLights }
  | { k: 'chant'; id: string; n: number; goal: number }
  /** A table's toast is counting (`at` = the clink), `ids` = who raised a glass so far. */
  | { k: 'dzo'; t: number; at: number; ids: string[] }
  | { k: 'dzoGo'; t: number; ids: string[] }
  | { k: 'song'; id: string; name: string; title: string; skip: boolean }
  | { k: 'photo'; id: string; name: string; n: number };

/** Next step in the programme (party is the last one). */
export function nextStep(s: WedStep): WedStep {
  const i = WED_PROGRAM.indexOf(s);
  return i < 0 ? 'march' : WED_PROGRAM[Math.min(WED_PROGRAM.length - 1, i + 1)];
}
