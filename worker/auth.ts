// Office passcode -> signed session cookie (HMAC-SHA256 via Web Crypto).

const COOKIE = 'bo_sess';
const MAX_AGE_S = 30 * 24 * 3600;
const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(s));
}

function safeEqualStr(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

// Changing the passcode (or the secret) invalidates every existing session.
function signingKey(env: Env): string {
  return `${env.SESSION_SECRET || 'bss-office'}|${env.OFFICE_PASSCODE || ''}`;
}

// Fail closed: without an OFFICE_PASSCODE secret nobody can get in.
export function passcodeRequired(_env: Env): boolean {
  return true;
}

export async function checkPasscode(env: Env, given: string): Promise<boolean> {
  if (!env.OFFICE_PASSCODE) return false;
  const [a, b] = await Promise.all([sha256(given.trim()), sha256(env.OFFICE_PASSCODE.trim())]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function sessionCookie(env: Env, secure: boolean): Promise<string> {
  const exp = String(Date.now() + MAX_AGE_S * 1000);
  const value = `${exp}.${await hmac(signingKey(env), exp)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function isAuthed(env: Env, req: Request): Promise<boolean> {
  if (!env.OFFICE_PASSCODE) return false;
  const header = req.headers.get('Cookie') || '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqualStr(sig, await hmac(signingKey(env), exp));
}

// Best-effort brute-force brake (per isolate): only failed attempts count.
const failures = new Map<string, { n: number; reset: number }>();
export function loginBlocked(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (f.reset < Date.now()) {
    failures.delete(ip);
    return false;
  }
  return f.n >= 10;
}
export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || f.reset < now) failures.set(ip, { n: 1, reset: now + 10 * 60_000 });
  else f.n++;
}
