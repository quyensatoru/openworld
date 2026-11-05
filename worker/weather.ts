// Hanoi's real weather, from Open-Meteo (no API key, no sign-up).
// One reading is shared by everybody: it is cached in the isolate for ten minutes and at the edge
// for the same, so a room full of people costs at most a handful of requests an hour.
import { fallbackWeather, fromCode, type Weather } from '../shared/weather';

const HANOI = { lat: 21.0278, lon: 105.8342, tz: 'Asia/Bangkok' };
const TTL = 10 * 60_000;
const URL_ =
  `https://api.open-meteo.com/v1/forecast?latitude=${HANOI.lat}&longitude=${HANOI.lon}` +
  '&current=temperature_2m,weather_code,cloud_cover,precipitation' +
  `&daily=sunrise,sunset&forecast_days=1&timezone=${encodeURIComponent(HANOI.tz)}`;

interface OpenMeteo {
  current?: { temperature_2m?: number; weather_code?: number; cloud_cover?: number; precipitation?: number };
  daily?: { sunrise?: string[]; sunset?: string[] };
}

let cached: Weather | null = null;
let inflight: Promise<Weather> | null = null;

/** "2026-11-05T06:12" → 6.2 (local hours). */
function hourOf(iso: string | undefined, fallback: number): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? Number(m[1]) + Number(m[2]) / 60 : fallback;
}

async function read(): Promise<Weather> {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const d = (await res.json()) as OpenMeteo;
  const cur = d.current ?? {};
  const { kind } = fromCode(Number(cur.weather_code ?? 1));
  return {
    kind,
    cloud: Math.min(1, Math.max(0, Number(cur.cloud_cover ?? 40) / 100)),
    rain: Math.max(0, Number(cur.precipitation ?? 0)),
    tempC: Math.round(Number(cur.temperature_2m ?? 26)),
    sunrise: hourOf(d.daily?.sunrise?.[0], 6),
    sunset: hourOf(d.daily?.sunset?.[0], 18),
    at: Date.now(),
  };
}

/** The current weather over Hanoi. Never throws: a bad reading keeps the last good one. */
export async function hanoiWeather(): Promise<Weather> {
  if (cached && Date.now() - cached.at < TTL) return cached;
  // several people joining at once share one upstream request
  inflight ??= read()
    .then((w) => (cached = w))
    .catch((err) => {
      console.error('weather read failed', err);
      return cached ?? fallbackWeather();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
