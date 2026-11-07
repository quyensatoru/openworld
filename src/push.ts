// Asking for, and keeping, permission to notify someone when the office gets busy.
//
// Deliberately never asked for on first load: a permission prompt before you have seen the place
// is the fastest way to get "Block" and lose the channel for good. The player opts in from
// Settings, once they already care.

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'denied' | 'on';

const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64url = (b: ArrayBuffer | null): string => {
  if (!b) return '';
  const u = new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** iOS only delivers Web Push to a PWA that was added to the home screen (16.4+). */
function iosNeedsInstall(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return !standalone;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[push] service worker failed', err);
    return null;
  }
}

/** What to show in Settings, without asking the player for anything. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return iosNeedsInstall() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (iosNeedsInstall()) return 'needs-install';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Turn notifications on. Returns the state afterwards, so the UI can say what happened. */
export async function enablePush(cid: string): Promise<PushState> {
  if (!pushSupported()) return iosNeedsInstall() ? 'needs-install' : 'unsupported';
  if (iosNeedsInstall()) return 'needs-install';
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';

  const res = await fetch('/api/push/key', { credentials: 'same-origin' });
  const { key } = (await res.json()) as { key: string | null };
  if (!key) {
    console.warn('[push] server has no VAPID key configured');
    return 'off';
  }
  const reg = await registration();
  if (!reg) return 'off';
  await navigator.serviceWorker.ready;

  // an existing subscription made with a different key is useless — drop it and start again
  let sub = await reg.pushManager.getSubscription();
  if (sub && bytesToB64url(sub.options.applicationServerKey ?? null) !== key) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) as BufferSource });

  const ok = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cid,
      endpoint: sub.endpoint,
      p256dh: bytesToB64url(sub.getKey('p256dh')),
      auth: bytesToB64url(sub.getKey('auth')),
    }),
  }).then((r) => r.ok, () => false);
  return ok ? 'on' : 'off';
}

export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* nothing subscribed */
  }
  return 'off';
}

/** Send one to this device right now, so the player finds out it works while they still care. */
export async function testPush(cid: string): Promise<boolean> {
  try {
    const r = await fetch('/api/push/test', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid }),
    });
    const j = (await r.json()) as { ok?: boolean };
    return !!j.ok;
  } catch {
    return false;
  }
}
