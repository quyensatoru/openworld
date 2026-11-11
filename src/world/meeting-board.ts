// The meeting-room TV during a meeting: topic, who is in, the last things said.
import { DEPT_BY_ID, type Meeting } from '../../shared/agents';

const W = 1024;
const H = 576;
let cache: { key: string; url: string } | null = null;

export function meetingBoard(m: Meeting): string {
  const key = `${m.id}:${m.lines.length}:${m.members.length}:${m.waiting.length}`;
  if (cache?.key === key) return cache.url;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d2433');
  bg.addColorStop(1, '#131824');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // header
  g.fillStyle = '#6b8cff';
  g.fillRect(0, 0, 10, 96);
  g.font = '700 22px Inter, system-ui, sans-serif';
  g.fillStyle = '#9fb3ff';
  g.fillText('📅 ĐANG HỌP', 34, 38);
  g.font = '800 36px Inter, system-ui, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText(fit(g, m.topic, W - 70), 34, 80);
  // who is in
  let x = 34;
  g.font = '600 20px Inter, system-ui, sans-serif';
  for (const mem of m.members.slice(0, 7)) {
    const d = DEPT_BY_ID.get(mem.dept);
    const label = `${d?.icon ?? ''} ${mem.name.replace('🤖 ', '')}${m.host === mem.id ? ' ★' : ''}`;
    const w = g.measureText(label).width + 26;
    if (x + w > W - 30) break;
    g.fillStyle = (d?.color ?? '#888') + '33';
    round(g, x, 108, w, 36, 18);
    g.fill();
    g.fillStyle = '#e8ecf6';
    g.fillText(label, x + 13, 133);
    x += w + 10;
  }
  if (m.waiting.length) {
    g.fillStyle = '#8a93a6';
    g.fillText(`chờ: ${m.waiting.map((d) => DEPT_BY_ID.get(d)?.short).join(', ')}`, x + 6, 133);
  }
  // the last lines
  const lines = m.lines.filter((l) => l.from !== 'system').slice(-6);
  let y = 192;
  for (const l of lines) {
    g.font = '700 21px Inter, system-ui, sans-serif';
    g.fillStyle = '#9fb3ff';
    const who = `${l.name.replace('🤖 ', '')}:`;
    g.fillText(who, 34, y);
    const wx = 34 + g.measureText(who).width + 10;
    g.font = '400 21px Inter, system-ui, sans-serif';
    g.fillStyle = '#e8ecf6';
    const rows = wrap(g, l.text, W - wx - 30).slice(0, 2);
    rows.forEach((r, i) => g.fillText(r, wx, y + i * 28));
    y += rows.length * 28 + 22;
    if (y > H - 30) break;
  }
  if (!lines.length) {
    g.font = '400 22px Inter, system-ui, sans-serif';
    g.fillStyle = '#8a93a6';
    g.fillText(m.agenda ? fit(g, `Chương trình: ${m.agenda}`, W - 70) : 'Đang chờ mọi người vào phòng…', 34, 200);
  }
  const url = c.toDataURL('image/png');
  cache = { key, url };
  return url;
}

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 2 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  if (out.length > 2) out[1] = fit(g, `${out[1]} ${out.slice(2).join(' ')}`, max);
  return out;
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
