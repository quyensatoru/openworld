// Local identity: a random clientId plus the chosen name/avatar, kept in localStorage.
import { sanitizeAvatar, type AvatarConfig } from '../shared/avatar';
import { isInstalled, isIos } from './ui/fullscreen';

const KEY = 'bss-office-profile-v1';
const CID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export interface Profile {
  cid: string;
  name: string;
  avatar: AvatarConfig | null;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

function read(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function loadProfile(): Profile {
  const raw = read();
  const cid = typeof raw.cid === 'string' && CID_RE.test(raw.cid) ? raw.cid : randomId();
  const name = typeof raw.name === 'string' ? raw.name : '';
  const avatar = raw.avatar ? sanitizeAvatar(raw.avatar) : null;
  const p = { cid, name, avatar };
  if (raw.cid !== cid) saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: identity just won't persist */
  }
  refreshHandoff();
}

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`bss-office-${key}`);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`bss-office-${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  if (HANDOFF_PREFS.includes(key)) refreshHandoffSoon();
}

// ------------------------------------------------------------ iPhone home-screen app
// The office added to an iPhone's home screen opens with its own empty storage: no profile, so it
// would be a stranger. While it runs in Safari the page address therefore carries the profile
// (#me=…): "Add to Home Screen" saves that address (the manifest has no start_url on purpose) and
// the app adopts it on its first launch. Never adopted in a normal tab — a copied link must not
// hand someone else your identity. The settings travel too: without them the app fell back to the
// phone defaults ("⚡ Nhẹ": a third of the screen's resolution) and the people looked jagged.
const ME_RE = /^#me=([A-Za-z0-9_-]+)$/;
const HANDOFF_PREFS = ['quality', 'fpsCap', 'fpLook', 'ambience', 'wolfSpeech', 'helpSeen', 'minimapOpen', 'jukeboxVolume', 'karaVolume', 'karaMonitorVol', 'karaFx', 'karaPhones'];

function b64url(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function setHash(hash: string) {
  try {
    history.replaceState(history.state, '', location.pathname + location.search + hash);
  } catch {
    /* ignore */
  }
}

/** iPhone Safari: keep the address carrying the current profile. */
function refreshHandoff() {
  if (!isIos() || isInstalled()) return;
  const raw = read();
  if (typeof raw.cid !== 'string' || !raw.name) return;
  const prefs: Record<string, string> = {};
  try {
    for (const k of HANDOFF_PREFS) {
      const v = localStorage.getItem(`bss-office-${k}`);
      if (v != null && v.length < 500) prefs[k] = v;
    }
    const touch = localStorage.getItem('bss-touch-ui');
    if (touch === '0' || touch === '1') prefs.touchUi = touch;
  } catch {
    /* private mode */
  }
  setHash('#me=' + b64url(JSON.stringify({ cid: raw.cid, name: raw.name, avatar: raw.avatar ?? null, prefs })));
}

let soon = 0;
/** (a slider saves on every step — Safari refuses rapid address changes) */
function refreshHandoffSoon() {
  clearTimeout(soon);
  soon = window.setTimeout(refreshHandoff, 600);
}

function profileHandoff(): void {
  const m = location.hash.match(ME_RE);
  if (m) {
    setHash('');
    try {
      const p = JSON.parse(unb64url(m[1])) as Record<string, unknown>;
      if (isInstalled() && !read().cid && typeof p.cid === 'string' && CID_RE.test(p.cid)) {
        saveProfile({ cid: p.cid, name: typeof p.name === 'string' ? p.name : '', avatar: p.avatar ? sanitizeAvatar(p.avatar) : null });
        const prefs = (p.prefs ?? {}) as Record<string, unknown>;
        for (const k of HANDOFF_PREFS) {
          const v = prefs[k];
          if (typeof v === 'string' && v.length < 500) localStorage.setItem(`bss-office-${k}`, v);
        }
        if (prefs.touchUi === '0' || prefs.touchUi === '1') localStorage.setItem('bss-touch-ui', prefs.touchUi);
      }
    } catch {
      /* not ours */
    }
  }
  refreshHandoff();
}

// At load, before anything reads the profile or the settings (the store reads them as it is created
// and imports this module first).
profileHandoff();
