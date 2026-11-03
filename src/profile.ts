// Local identity: a random clientId plus the chosen name/avatar, kept in localStorage.
import { sanitizeAvatar, type AvatarConfig } from '../shared/avatar';

const KEY = 'bss-office-profile-v1';

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
  const cid = typeof raw.cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(raw.cid) ? raw.cid : randomId();
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
}
