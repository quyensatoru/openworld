// Web Push, done by hand on top of Web Crypto — no SDK, no Firebase, no account anywhere.
//
// Two standards stacked on top of each other:
//   RFC 8292 (VAPID)  — a JWT signed with our own P-256 key, proving this server may push.
//   RFC 8291 (aes128gcm) — the payload is encrypted to the subscriber's key, so the push service
//                          (Google / Mozilla / Apple) relays bytes it cannot read.
// Everything below is the minimum needed to speak both.

const enc = new TextEncoder();

export interface PushSub {
  endpoint: string;
  /** Subscriber's public key, base64url (65-byte uncompressed P-256 point). */
  p256dh: string;
  /** Subscriber's auth secret, base64url (16 bytes). */
  auth: string;
}

export interface VapidKeys {
  /** base64url of the 65-byte uncompressed public point. */
  publicKey: string;
  /** base64url of the 32-byte private scalar. */
  privateKey: string;
  /** Contact for the push service, e.g. "mailto:you@example.com". */
  subject: string;
}

// ------------------------------------------------------------------ base64url
export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// ------------------------------------------------------------------ VAPID
/** The private scalar plus the public point make the JWK that ECDSA signing wants. */
async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlToBytes(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be a 65-byte uncompressed point');
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** `Authorization: vapid t=<jwt>, k=<public key>` for one push origin. */
async function vapidHeader(keys: VapidKeys, endpoint: string, nowS: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  // an hour is the most push services accept
  const body = bytesToB64url(enc.encode(JSON.stringify({ aud, exp: nowS + 3600, sub: keys.subject })));
  const signed = `${head}.${body}`;
  const key = await vapidSigningKey(keys);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signed));
  return `vapid t=${signed}.${bytesToB64url(sig)}, k=${keys.publicKey}`;
}

// ------------------------------------------------------------------ payload encryption
const hmac = async (keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const k = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
};

/** HKDF as RFC 8291 uses it: one expand step, output always ≤ 32 bytes. */
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> =>
  (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, len);

/**
 * Encrypt one message for one subscriber (RFC 8291 + the aes128gcm content coding of RFC 8188).
 * The body is a single record: a header carrying our ephemeral public key, then the ciphertext.
 */
async function encryptPayload(sub: PushSub, text: string): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  // a fresh key pair per message — that is what makes each one unreadable to the relay
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Workers' types spell the peer key `$public`; the runtime takes either, so cast past it
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0];
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, pair.privateKey, 256));

  // the subscriber's auth secret binds the shared secret to this subscription
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record
  const plain = concat(enc.encode(text), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, plain as BufferSource));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ------------------------------------------------------------------ sending
export type PushResult = 'sent' | 'gone' | 'failed';

/**
 * Deliver one notification. `gone` means the subscription is dead (the browser was reinstalled,
 * the user revoked it) and the row should be dropped — otherwise it burns a subrequest forever.
 */
export async function sendPush(keys: VapidKeys, sub: PushSub, payload: unknown, ttl = 3600): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, JSON.stringify(payload));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(keys, sub.endpoint, Math.floor(Date.now() / 1000)),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: 'normal',
      },
      body: body as BodyInit,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.error('push rejected', res.status, (await res.text()).slice(0, 200));
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error('push failed', err);
    return 'failed';
  }
}

/** Read the VAPID keys out of the environment; null when push has not been set up. */
export function vapidFrom(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || 'mailto:office@example.com' };
}
