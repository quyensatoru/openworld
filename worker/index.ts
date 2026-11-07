// Worker entry: tiny JSON API + WebSocket hand-off to the OfficeRoom Durable Object.
// Static files (the game client) are served by Workers Static Assets before this runs.

import { summarizeHook } from './activity';
import { deletePushSub, dropPushSubs as dropSubs, savePushSub, subsForUser as mySubs, userForToken } from './db';
import { checkPasscode, clearCookie, isAuthed, loginBlocked, passcodeRequired, recordLoginFailure, sessionCookie } from './auth';
import { sendPush, vapidFrom } from './push';
import { hanoiWeather } from './weather';

export { OfficeRoom } from './office-room';

interface OptionalSecrets {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...init.headers },
  });

const tokenCache = new Map<string, { uid: string | null; until: number }>();
async function tokenUser(env: Env, token: string): Promise<string | null> {
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.uid;
  const uid = await userForToken(env.DB, token).catch(() => null);
  tokenCache.set(token, { uid, until: Date.now() + (uid ? 5 * 60_000 : 30_000) });
  return uid;
}

const DEFAULT_ICE: RTCIceServerLike[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

async function iceServers(env: Env & OptionalSecrets): Promise<RTCIceServerLike[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return DEFAULT_ICE;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 12 * 3600 }),
    });
    if (!res.ok) throw new Error(`TURN ${res.status}`);
    const body = (await res.json()) as { iceServers?: RTCIceServerLike | RTCIceServerLike[] };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    return list.length ? [...DEFAULT_ICE, ...list] : DEFAULT_ICE;
  } catch (err) {
    console.error('TURN credentials failed', err);
    return DEFAULT_ICE;
  }
}

interface YtHit {
  id: string;
  title: string;
  channel: string;
  len: string;
}

const ytCache = new Map<string, { at: number; hits: YtHit[] }>();

async function ytSearch(q: string): Promise<YtHit[]> {
  const key = q.toLowerCase();
  const hit = ytCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.hits;
  const res = await fetch(`https://www.youtube.com/results?hl=vi&gl=VN&search_query=${encodeURIComponent(q)}`, {
    headers: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.6',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Cookie: 'CONSENT=YES+1; SOCS=CAI',
    },
  });
  if (!res.ok) throw new Error(`youtube ${res.status}`);
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s) ?? html.match(/ytInitialData"?\]?\s*=\s*(\{.*?\});\s*(?:var|window|<\/script>)/s);
  if (!m) throw new Error('no ytInitialData');
  const data = JSON.parse(m[1]) as unknown;
  const hits: YtHit[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || hits.length >= 20 || depth > 40) return;
    const v = (o as { videoRenderer?: Record<string, any> }).videoRenderer;
    if (v?.videoId) {
      const len = v.lengthText?.simpleText as string | undefined;
      if (len) {
        hits.push({
          id: String(v.videoId),
          title: (v.title?.runs ?? []).map((r: { text: string }) => r.text).join('').slice(0, 140),
          channel: String(v.ownerText?.runs?.[0]?.text ?? '').slice(0, 60),
          len,
        });
      }
      return;
    }
    for (const k in o as Record<string, unknown>) walk((o as Record<string, unknown>)[k], depth + 1);
  };
  walk(data, 0);
  ytCache.set(key, { at: Date.now(), hits });
  if (ytCache.size > 300) ytCache.delete(ytCache.keys().next().value!);
  return hits;
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const secure = url.protocol === 'https:';

    switch (url.pathname) {
      case '/api/session':
        return json({
          authed: await isAuthed(env, req),
          needPasscode: passcodeRequired(env),
          office: env.OFFICE_NAME || 'Văn phòng',
        });

      case '/api/login': {
        if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
        const ip = req.headers.get('CF-Connecting-IP') || 'local';
        if (loginBlocked(ip)) return json({ ok: false, error: 'Thử sai quá nhiều lần, đợi 10 phút nhé.' }, { status: 429 });
        const body = (await req.json().catch(() => ({}))) as { passcode?: unknown };
        const ok = await checkPasscode(env, String(body.passcode ?? ''));
        if (!ok) {
          recordLoginFailure(ip);
          await new Promise((r) => setTimeout(r, 400));
          return json({ ok: false, error: 'Mã văn phòng không đúng.' }, { status: 401 });
        }
        return json({ ok: true }, { headers: { 'Set-Cookie': await sessionCookie(env, secure) } });
      }

      case '/api/logout':
        return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(secure) } });

      case '/api/ice': {
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        return json({ iceServers: await iceServers(env as Env & OptionalSecrets) });
      }

      // Claude Code hooks POST their JSON here (see Settings → "Màn hình Claude Code").
      case '/api/activity': {
        if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
        const auth = req.headers.get('Authorization') ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : url.searchParams.get('k') ?? '';
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return json({ error: 'unauthorized' }, { status: 401 });
        const uid = await tokenUser(env, token);
        if (!uid) return json({ error: 'unauthorized' }, { status: 401 });
        const raw = await req.text();
        if (raw.length > 256_000) return json({ ok: true, skipped: 'too large' });
        let hook: Record<string, unknown>;
        try {
          hook = JSON.parse(raw);
        } catch {
          return json({ error: 'bad json' }, { status: 400 });
        }
        const ev = summarizeHook(hook, url.searchParams.get('p') === '1', Date.now());
        if (!ev) return json({ ok: true, skipped: true });
        const stub = env.OFFICE.get(env.OFFICE.idFromName('main'));
        await stub.fetch('https://office/activity', { method: 'POST', body: JSON.stringify({ uid, ev }) });
        return json({ ok: true });
      }

      // Karaoke song search (YouTube's own results page; no API key needed).
      case '/api/yt-search': {
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
        if (!q) return json({ hits: [] });
        try {
          return json({ hits: await ytSearch(q) }, { headers: { 'Cache-Control': 'private, max-age=600' } });
        } catch (err) {
          console.error('yt search failed', err);
          return json({ hits: [], error: 'search failed' }, { status: 502 });
        }
      }

      // Hanoi's weather, for the sky and the rain outside the windows.
      case '/api/weather': {
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        return json(await hanoiWeather(), { headers: { 'Cache-Control': 'public, max-age=300' } });
      }

      // ---- Web Push. The public key is not a secret: the browser needs it to subscribe.
      case '/api/push/key': {
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        const v = vapidFrom(env as Env & OptionalSecrets);
        return json({ key: v?.publicKey ?? null });
      }

      case '/api/push/subscribe': {
        if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const cid = String(b.cid ?? '');
        const endpoint = String(b.endpoint ?? '');
        const p256dh = String(b.p256dh ?? '');
        const auth = String(b.auth ?? '');
        // Endpoints are URLs at the browser vendor's push service, so always https — except on a
        // dev server, where the tests stand up their own push service over plain http.
        const localDev = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        const endpointOk = /^https:\/\//.test(endpoint) || (localDev && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(endpoint));
        if (
          !/^[a-zA-Z0-9_-]{8,64}$/.test(cid) ||
          !endpointOk ||
          endpoint.length > 1024 ||
          !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || // 65 bytes base64url
          !/^[A-Za-z0-9_-]{16,32}$/.test(auth) // 16 bytes base64url
        ) {
          return json({ error: 'bad subscription' }, { status: 400 });
        }
        await savePushSub(env.DB, cid, endpoint, p256dh, auth, Date.now());
        return json({ ok: true });
      }

      case '/api/push/unsubscribe': {
        if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        const b = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
        const endpoint = String(b.endpoint ?? '');
        if (endpoint) await deletePushSub(env.DB, endpoint);
        return json({ ok: true });
      }

      // "Send me one now" — the button right after you switch notifications on, so you find out
      // it works while you still remember enabling it.
      case '/api/push/test': {
        if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
        if (!(await isAuthed(env, req))) return json({ error: 'unauthorized' }, { status: 401 });
        const v = vapidFrom(env as Env & OptionalSecrets);
        if (!v) return json({ ok: false, error: 'server chưa cấu hình VAPID' }, { status: 503 });
        const b = (await req.json().catch(() => ({}))) as { cid?: unknown };
        const cid = String(b.cid ?? '');
        if (!/^[a-zA-Z0-9_-]{8,64}$/.test(cid)) return json({ error: 'bad cid' }, { status: 400 });
        const subs = await mySubs(env.DB, cid);
        if (!subs.length) return json({ ok: false, error: 'chưa có thiết bị nào đăng ký' }, { status: 404 });
        const results = await Promise.all(
          subs.map((sb) => sendPush(v, sb, { title: 'Office', body: 'Thông báo đang hoạt động 👍', tag: 'office-test', url: '/' })),
        );
        const gone = subs.filter((_, i) => results[i] === 'gone').map((sb) => sb.endpoint);
        if (gone.length) await dropSubs(env.DB, gone);
        return json({ ok: results.includes('sent'), results });
      }

      // Local only: explains why the room did or did not send a nudge.
      case '/api/push/why': {
        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return json({ error: 'not found' }, { status: 404 });
        const stub = env.OFFICE.get(env.OFFICE.idFromName('main'));
        return stub.fetch('https://office/nudge-status');
      }

      case '/api/ws': {
        if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        const origin = req.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host) return new Response('Bad origin', { status: 403 });
        if (!(await isAuthed(env, req))) return new Response('Unauthorized', { status: 401 });
        const stub = env.OFFICE.get(env.OFFICE.idFromName('main'));
        return stub.fetch(req);
      }
    }
    return json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
