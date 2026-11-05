// Real Hanoi weather, shared by the worker (which reads it) and the client (which draws it).
// The hour of day is not carried on the wire: the client works it out from the office timezone, so
// the sky keeps moving between the ten-minute refreshes.

/** What the sky looks like — everything the renderer needs in one word. */
export type SkyKind = 'clear' | 'fair' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow';

export interface Weather {
  kind: SkyKind;
  /** Cloud cover, 0..1. */
  cloud: number;
  /** Rainfall in mm/h (0 when dry). */
  rain: number;
  tempC: number;
  /** Local hours (Hanoi) the sun comes up and goes down. */
  sunrise: number;
  sunset: number;
  /** When the worker read this (epoch ms) — the client refreshes once it gets old. */
  at: number;
}

/** WMO weather code → what we draw, plus how to say it in Vietnamese. */
const CODES: [codes: number[], kind: SkyKind, label: string, emoji: string][] = [
  [[0], 'clear', 'Trời quang', '☀️'],
  [[1], 'fair', 'Nắng nhẹ', '🌤️'],
  [[2], 'cloudy', 'Mây rải rác', '⛅'],
  [[3], 'overcast', 'Nhiều mây', '☁️'],
  [[45, 48], 'fog', 'Sương mù', '🌫️'],
  [[51, 53, 55, 56, 57], 'drizzle', 'Mưa phùn', '🌦️'],
  [[61, 63, 66, 80, 81], 'rain', 'Mưa', '🌧️'],
  [[65, 67, 82], 'storm', 'Mưa to', '🌧️'],
  [[71, 73, 75, 77, 85, 86], 'snow', 'Tuyết', '🌨️'],
  [[95, 96, 99], 'storm', 'Dông', '⛈️'],
];

export function fromCode(code: number): { kind: SkyKind; label: string; emoji: string } {
  for (const [codes, kind, label, emoji] of CODES) {
    if (codes.includes(code)) return { kind, label, emoji };
  }
  return { kind: 'fair', label: 'Nắng nhẹ', emoji: '🌤️' };
}

/** How the weather reads in the corner of the screen: "🌧️ Mưa · 24°". */
export function weatherText(w: Weather, night: boolean): { emoji: string; label: string } {
  const dry = w.kind === 'clear' || w.kind === 'fair';
  for (const [, kind, label, emoji] of CODES) {
    if (kind !== w.kind) continue;
    // at night a clear sky is moonlight, not sunshine
    if (night && dry) return { emoji: w.kind === 'clear' ? '🌙' : '🌛', label: w.kind === 'clear' ? 'Trời quang' : 'Ít mây' };
    return { emoji, label };
  }
  return { emoji: '🌤️', label: 'Nắng nhẹ' };
}

/** Local hour in the office timezone, 0..24 with minutes as a fraction. */
export function localHour(nowMs: number, tzOffsetMinutes: number): number {
  const d = new Date(nowMs + tzOffsetMinutes * 60_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/**
 * How much daylight there is, 0 (night) .. 1 (full day). It fades over the ~50 minutes either side
 * of sunrise and sunset, which is roughly how long civil twilight lasts in Hanoi.
 */
export const TWILIGHT = 0.85;
export function daylight(hour: number, sunrise: number, sunset: number): number {
  const up = Math.min(1, Math.max(0, (hour - (sunrise - TWILIGHT / 2)) / TWILIGHT));
  const down = Math.min(1, Math.max(0, (hour - (sunset - TWILIGHT / 2)) / TWILIGHT));
  return up * (1 - down);
}

/** Warm low sun: strongest an hour before sunset, and a weaker echo just after sunrise. */
export function goldenHour(hour: number, sunrise: number, sunset: number): number {
  const dusk = Math.max(0, 1 - Math.abs(hour - (sunset - 0.7)) / 1.4);
  const dawn = Math.max(0, 1 - Math.abs(hour - (sunrise + 0.7)) / 1.2) * 0.7;
  return Math.max(dusk, dawn);
}

/** How hard it is raining, 0 (dry) .. 1 (downpour) — drives both the drops and the sound. */
export function rainLevel(w: Weather): number {
  if (w.kind === 'storm') return Math.min(1, Math.max(0.78, w.rain / 6));
  if (w.kind === 'rain') return Math.min(0.95, Math.max(0.5, w.rain / 4));
  if (w.kind === 'drizzle') return Math.min(0.45, Math.max(0.26, w.rain / 2));
  if (w.kind === 'snow') return 0.3;
  return w.rain > 0.08 ? 0.22 : 0;
}

/** Used until the first reading arrives, and whenever the weather service is unreachable. */
export function fallbackWeather(now = Date.now()): Weather {
  return { kind: 'fair', cloud: 0.35, rain: 0, tempC: 26, sunrise: 6, sunset: 18, at: now };
}
