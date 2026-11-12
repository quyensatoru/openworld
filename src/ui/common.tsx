// Small shared UI pieces: avatar initials, icons, formatting helpers.
import type { AvatarConfig } from '../../shared/avatar';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][0]).toUpperCase();
}

export function AvatarDot({ name, avatar, size }: { name: string; avatar?: AvatarConfig | null; size?: number }) {
  const bg = avatar?.top ?? '#6b8cff';
  return (
    <span className="avatar-dot" style={{ background: bg, color: readable(bg), ...(size ? { width: size, height: size, fontSize: size * 0.42 } : {}) }}>
      {initials(name)}
    </span>
  );
}

function readable(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 170 ? '#2d3142' : '#ffffff';
}

export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}g ${String(m % 60).padStart(2, '0')}p` : `${m} phút`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** "Hôm nay" / "Hôm qua" / "Thứ ba, 11/11" — chat that runs over days needs to say which one. */
export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  const opts: Intl.DateTimeFormatOptions = diff < 7 ? { weekday: 'long', day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleDateString('vi-VN', opts);
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'vừa xong';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} phút trước`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} giờ trước`;
  return `${Math.floor(d / 86_400_000)} ngày trước`;
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  mic: (on: boolean) => (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {!on && <path d="M4 4l16 16" />}
    </svg>
  ),
  cam: (on: boolean) => (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="3" y="7" width="13" height="10" rx="2.5" />
      <path d="M16 11l5-3v8l-5-3" />
      {!on && <path d="M3 4l17 17" />}
    </svg>
  ),
  screen: (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4M12 13V7M9 10l3-3 3 3" />
    </svg>
  ),
};
