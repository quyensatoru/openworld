// After a deploy: does production answer? Checks the main page (and the script it loads), the
// Office API, and — when the passcode is given — that a browser can open its Office connection.
// Never changes anything: no player joins, nothing is written.
//   node scripts/verify-deploy.mjs https://office.xxx.workers.dev
//   OFFICE_PASSCODE=... node scripts/verify-deploy.mjs https://office.xxx.workers.dev
// Exit 0 = every check passed, 1 = something failed (scripts/deploy.mjs prints how to roll back).
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 10_000;

async function get(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

/** Opens the Office connection and closes it at once — the upgrade answering is the check. */
function wsOpens(url, cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: new URL(url.replace(/^ws/, 'http')).origin } });
    const done = (ok, why) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
      resolve({ ok, why });
    };
    const timer = setTimeout(() => done(false, `không mở được sau ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);
    ws.on('open', () => done(true, '101'));
    ws.on('unexpected-response', (_req, res) => done(false, `HTTP ${res.statusCode}`));
    ws.on('error', (e) => done(false, e.message));
  });
}

/** Runs every check once. Returns [{ name, ok, detail }]. */
export async function verify(base, passcode = '') {
  base = base.replace(/\/$/, '');
  const out = [];
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      out.push({ name, ok: true, detail });
    } catch (e) {
      out.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  let html = '';
  await check('Trang chính /', async () => {
    const r = await get(`${base}/`);
    html = await r.text();
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/<script[^>]+src=/i.test(html)) throw new Error('HTTP 200 nhưng không thấy thẻ <script> của app');
    return 'HTTP 200';
  });
  await check('Mã app của trang chính', async () => {
    const src = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)?.[1] ?? html.match(/<script[^>]+src="([^"]+)"/i)?.[1];
    if (!src) throw new Error('trang chính không trỏ tới file script nào');
    const r = await get(new URL(src, `${base}/`).href);
    await r.arrayBuffer();
    if (r.status !== 200) throw new Error(`${src}: HTTP ${r.status}`);
    return `${src}: HTTP 200`;
  });
  await check('Office API /api/session', async () => {
    const r = await get(`${base}/api/session`);
    const body = await r.json().catch(() => null);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!body || typeof body.office !== 'string') throw new Error('HTTP 200 nhưng không phải JSON của Office');
    return `HTTP 200 · ${body.office}`;
  });
  if (passcode) {
    let cookie = '';
    await check('Đăng nhập /api/login', async () => {
      const r = await get(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
      await r.text();
      cookie = (r.headers.get('set-cookie') || '').split(';')[0];
      if (r.status !== 200 || !cookie) throw new Error(`HTTP ${r.status}${cookie ? '' : ', không có cookie'}`);
      return 'HTTP 200';
    });
    if (cookie)
      await check('Kết nối Office /api/ws', async () => {
        const r = await wsOpens(`${base.replace(/^http/, 'ws')}/api/ws`, cookie);
        if (!r.ok) throw new Error(r.why);
        return 'mở được (101)';
      });
  }
  return out;
}

/** A fresh deploy can take a few seconds to be served everywhere: try a few times before failing. */
export async function verifyWithRetry(base, passcode = '', tries = 4, gapMs = 5000) {
  let res = [];
  for (let i = 1; i <= tries; i++) {
    res = await verify(base, passcode);
    if (res.every((r) => r.ok)) break;
    if (i < tries) await new Promise((r) => setTimeout(r, gapMs));
  }
  return res;
}

export function printResults(res) {
  for (const r of res) console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`);
  return res.every((r) => r.ok);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || process.env.PROD_URL || process.env.BASE;
  if (!base) {
    console.error('Cần URL: node scripts/verify-deploy.mjs https://office.xxx.workers.dev');
    process.exit(2);
  }
  const passcode = process.env.OFFICE_PASSCODE || process.env.PASSCODE || '';
  const tries = Number(process.env.VERIFY_TRIES || 1);
  console.log(`▶ Kiểm tra ${base}${passcode ? '' : ' (không có OFFICE_PASSCODE: bỏ qua bước đăng nhập + kết nối)'}`);
  const ok = printResults(await verifyWithRetry(base, passcode, tries, 3000));
  process.exit(ok ? 0 : 1);
}
