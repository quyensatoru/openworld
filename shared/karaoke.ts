// Karaoke room (floor 4): a shared song queue played on the room's LED screen, up to two mics with
// echo / reverb that every listener applies to the singer's voice. Types + pure helpers shared by
// the worker (worker/karaoke.ts) and the client.

export interface MicFx {
  /** Mic level, 0..1.5. */
  vol: number;
  /** Echo amount (wet level + feedback), 0..1. */
  echo: number;
  /** Echo delay in seconds, 0.06..0.45. */
  delay: number;
  /** Reverb amount, 0..1. */
  reverb: number;
  /** Reverb size: 0 small room, 1 karaoke room, 2 hall. */
  room: number;
  /** Shelving EQ in dB, -12..12. */
  bass: number;
  treble: number;
}

export const FX_PRESETS: { id: string; label: string; fx: MicFx }[] = [
  { id: 'karaoke', label: '🎤 Karaoke', fx: { vol: 1, echo: 0.42, delay: 0.2, reverb: 0.32, room: 1, bass: 2, treble: 3 } },
  { id: 'studio', label: '🎧 Phòng thu', fx: { vol: 1, echo: 0.08, delay: 0.11, reverb: 0.2, room: 0, bass: 1, treble: 2 } },
  { id: 'hall', label: '🏛️ Hội trường', fx: { vol: 1, echo: 0.15, delay: 0.28, reverb: 0.62, room: 2, bass: 0, treble: 1 } },
  { id: 'ballad', label: '🌙 Ballad', fx: { vol: 1, echo: 0.3, delay: 0.34, reverb: 0.5, room: 2, bass: 3, treble: 0 } },
  { id: 'dry', label: '🗣️ Giọng mộc', fx: { vol: 1, echo: 0, delay: 0.15, reverb: 0, room: 0, bass: 0, treble: 0 } },
];
export const DEFAULT_FX: MicFx = FX_PRESETS[0].fx;

const num = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export function sanitizeFx(v: unknown): MicFx {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_FX;
  return {
    vol: num(o.vol, 0, 1.5, d.vol),
    echo: num(o.echo, 0, 1, d.echo),
    delay: num(o.delay, 0.06, 0.45, d.delay),
    reverb: num(o.reverb, 0, 1, d.reverb),
    room: Math.round(num(o.room, 0, 2, d.room)),
    bass: num(o.bass, -12, 12, d.bass),
    treble: num(o.treble, -12, 12, d.treble),
  };
}

export interface KaraSong {
  sid: string;
  videoId: string;
  title: string;
  by: string;
  byName: string;
  /** Seconds; 0 until a player has loaded the video. */
  dur: number;
}

export interface KaraMic {
  id: string;
  name: string;
  fx: MicFx;
}

export interface KaraNow {
  song: KaraSong;
  /** Server ms at which the video is at 0 s (a short count-in before it starts). */
  startAt: number;
  pausedAt: number | null;
}

export interface KaraResult {
  sid: string;
  title: string;
  singers: string;
  score: number;
  comment: string;
  at: number;
}

export interface KaraState {
  queue: KaraSong[];
  now: KaraNow | null;
  mics: KaraMic[];
  last: KaraResult | null;
}

export const KARA_REACTS = ['👏', '🌹', '❤️', '🎉', '🔥', '😂'] as const;
export type KaraReact = (typeof KARA_REACTS)[number];
export const KARA_MAX_QUEUE = 40;
export const KARA_PER_PERSON = 5;
export const KARA_MICS = 2;
/** Count-in before a song starts. */
export const KARA_LEAD_MS = 3000;
/** The score stays on screen this long before the next song. */
export const KARA_SCORE_MS = 7000;

export type KaraMsg =
  | { a: 'add'; videoId: string; title?: string; dur?: number }
  | { a: 'remove'; sid: string }
  | { a: 'skip' }
  | { a: 'pause' }
  | { a: 'resume' }
  | { a: 'restart' }
  | { a: 'mic'; on: boolean }
  | { a: 'fx'; fx: MicFx }
  | { a: 'react'; e: string }
  | { a: 'meta'; sid: string; title?: string; dur?: number }
  | { a: 'voice'; sid: string; sung: number; heard: number }
  | { a: 'broken'; sid: string };

/** A YouTube search hit (from /api/yt-search). */
export interface YtHit {
  id: string;
  title: string;
  channel: string;
  /** "4:21" */
  len: string;
}

export function parseLen(len: string): number {
  const parts = len.split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((s, n) => s * 60 + n, 0);
}

export function scoreComment(score: number): string {
  if (score >= 97) return 'Ca sĩ chuyên nghiệp! Ra album đi thôi 🌟';
  if (score >= 92) return 'Quá đỉnh! Cả phòng nổi da gà 🔥';
  if (score >= 86) return 'Hát hay quá trời! 👏';
  if (score >= 78) return 'Khá lắm, thêm chút cảm xúc nữa là chuẩn 🎶';
  if (score >= 65) return 'Tạm ổn — luyện thêm vài bài nữa nhé 😄';
  return 'Hình như mic chưa bật hay sao ấy? 🤐';
}
