// Canvas drawing for BSS Net: the snake arena (game window + the big screen on the wall) and the
// "something is running" pictures on occupied PC monitors.
import * as THREE from 'three';
import { SNAKE_H, SNAKE_W, type SnakeFrame } from '../../shared/arcade';
import { canvasTexture } from '../world/materials';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Arena + header. `now` is server time (ms). */
export function drawSnake(g: CanvasRenderingContext2D, f: SnakeFrame | null, now: number, o: { big?: boolean; me?: string } = {}) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const head = Math.round(H * 0.085);
  g.fillStyle = '#0b0d16';
  g.fillRect(0, 0, W, H);
  // header
  g.fillStyle = '#141829';
  g.fillRect(0, 0, W, head);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#7ef6ff';
  g.font = `800 ${Math.round(head * 0.5)}px "Be Vietnam Pro", sans-serif`;
  g.fillText('🐍 RẮN SĂN MỒI ĐẠI CHIẾN', head * 0.35, head / 2);
  g.textAlign = 'right';
  g.fillStyle = '#ffd23f';
  const phase = f?.phase ?? 'idle';
  const status = phase === 'play' ? `⏱ ${fmt(f!.until - now)}` : phase === 'countdown' ? `Bắt đầu sau ${fmt(f!.until - now)}` : phase === 'over' ? 'Hết ván!' : 'Đang chờ người chơi';
  g.fillText(status, W - head * 0.35, head / 2);

  // arena
  const cell = Math.floor(Math.min(W / SNAKE_W, (H - head) / SNAKE_H));
  const ox = Math.floor((W - cell * SNAKE_W) / 2);
  const oy = head + Math.floor((H - head - cell * SNAKE_H) / 2);
  g.fillStyle = '#10142280';
  g.fillRect(ox, oy, cell * SNAKE_W, cell * SNAKE_H);
  g.strokeStyle = 'rgba(126,246,255,0.06)';
  g.lineWidth = 1;
  for (let x = 0; x <= SNAKE_W; x++) {
    g.beginPath();
    g.moveTo(ox + x * cell + 0.5, oy);
    g.lineTo(ox + x * cell + 0.5, oy + cell * SNAKE_H);
    g.stroke();
  }
  for (let y = 0; y <= SNAKE_H; y++) {
    g.beginPath();
    g.moveTo(ox, oy + y * cell + 0.5);
    g.lineTo(ox + cell * SNAKE_W, oy + y * cell + 0.5);
    g.stroke();
  }
  g.strokeStyle = '#2de2e6';
  g.lineWidth = 2;
  g.strokeRect(ox + 1, oy + 1, cell * SNAKE_W - 2, cell * SNAKE_H - 2);

  if (f) {
    // food
    const pulse = 0.75 + 0.25 * Math.sin(now / 160);
    for (let i = 0; i < f.food.length; i += 2) {
      const cx = ox + (f.food[i] + 0.5) * cell;
      const cy = oy + (f.food[i + 1] + 0.5) * cell;
      g.fillStyle = (i / 2) % 3 === 0 ? '#ff3ea5' : '#ffd23f';
      g.shadowColor = g.fillStyle;
      g.shadowBlur = cell * 0.8;
      g.beginPath();
      g.arc(cx, cy, cell * 0.3 * pulse, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
    // snakes
    for (const p of f.players) {
      if (!p.alive || p.body.length < 2) continue;
      for (let i = p.body.length - 2; i >= 0; i -= 2) {
        const x = ox + p.body[i] * cell;
        const y = oy + p.body[i + 1] * cell;
        const isHead = i === 0;
        g.fillStyle = p.color;
        g.globalAlpha = isHead ? 1 : 0.65 + 0.35 * (1 - i / p.body.length);
        rr(g, x + 1, y + 1, cell - 2, cell - 2, cell * (isHead ? 0.38 : 0.28));
        g.fill();
      }
      g.globalAlpha = 1;
      // eyes + name over the head
      const hx = ox + (p.body[0] + 0.5) * cell;
      const hy = oy + (p.body[1] + 0.5) * cell;
      g.fillStyle = '#0b0d16';
      g.beginPath();
      g.arc(hx - cell * 0.15, hy - cell * 0.1, cell * 0.09, 0, Math.PI * 2);
      g.arc(hx + cell * 0.15, hy - cell * 0.1, cell * 0.09, 0, Math.PI * 2);
      g.fill();
      g.textAlign = 'center';
      g.font = `700 ${Math.max(10, Math.round(cell * (o.big ? 0.75 : 0.65)))}px "Be Vietnam Pro", sans-serif`;
      g.fillStyle = p.id === o.me ? '#ffffff' : p.color;
      g.fillText(p.id === o.me ? `${p.name} (bạn)` : p.name, hx, hy - cell * 0.95);
    }
    // scoreboard
    const list = [...f.players].sort((a, b) => b.score - a.score).slice(0, 8);
    if (list.length) {
      const lh = Math.round(cell * 0.95);
      const bw = cell * 9;
      g.fillStyle = 'rgba(11,13,22,0.72)';
      rr(g, ox + cell * SNAKE_W - bw - 8, oy + 8, bw, lh * (list.length + 0.6), 8);
      g.fill();
      g.font = `600 ${Math.round(lh * 0.7)}px "Be Vietnam Pro", sans-serif`;
      list.forEach((p, i) => {
        const y = oy + 8 + lh * (i + 0.8);
        g.textAlign = 'left';
        g.fillStyle = p.alive ? p.color : '#5b6070';
        g.fillText(`${p.alive ? '●' : '✕'} ${p.name}`, ox + cell * SNAKE_W - bw, y);
        g.textAlign = 'right';
        g.fillText(String(p.score), ox + cell * SNAKE_W - 16, y);
      });
    }
  }

  // centre messages
  const msg = (big: string, small?: string) => {
    g.fillStyle = 'rgba(11,13,22,0.6)';
    g.fillRect(ox, oy + cell * SNAKE_H * 0.36, cell * SNAKE_W, cell * SNAKE_H * 0.28);
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = `800 ${Math.round(cell * 2.1)}px "Be Vietnam Pro", sans-serif`;
    g.fillText(big, ox + (cell * SNAKE_W) / 2, oy + cell * SNAKE_H * 0.46);
    if (small) {
      g.fillStyle = '#b9c2e6';
      g.font = `500 ${Math.round(cell * 0.95)}px "Be Vietnam Pro", sans-serif`;
      g.fillText(small, ox + (cell * SNAKE_W) / 2, oy + cell * SNAKE_H * 0.56);
    }
  };
  if (phase === 'idle') msg('BSS NET ARENA', 'Ngồi vào một máy → 🐍 Rắn săn mồi → Tham gia');
  else if (phase === 'countdown') msg(`${Math.max(1, Math.ceil((f!.until - now) / 1000))}`, `${f!.queue.map((q) => q.name).join(' · ')}`);
  else if (phase === 'over') msg(f!.winner ? `🏆 ${f!.winner.name} thắng!` : 'Hoà!', 'Ván mới bắt đầu ngay sau đây');
  g.textBaseline = 'alphabetic';
}

/** What an occupied PC shows (one of a few "games"). */
export function gameScreenTexture(seed: number): THREE.CanvasTexture {
  const kind = seed % 3;
  return canvasTexture(384, 208, (g, w, h) => {
    if (kind === 0) {
      g.fillStyle = '#0b0d16';
      g.fillRect(0, 0, w, h);
      const cols = ['#ff3ea5', '#2de2e6', '#ffd23f'];
      for (let k = 0; k < 3; k++) {
        g.fillStyle = cols[k];
        let x = 30 + k * 110;
        let y = 40 + k * 50;
        for (let i = 0; i < 9; i++) {
          g.fillRect(x, y, 11, 11);
          if (i % 4 < 2) x += 12;
          else y += 12;
        }
      }
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(300, 60, 5, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 1) {
      g.fillStyle = '#f3e3c3';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#b89a6a';
      for (let i = 0; i < 16; i++) {
        g.beginPath();
        g.moveTo(80 + i * 15, 4);
        g.lineTo(80 + i * 15, 204);
        g.stroke();
        g.beginPath();
        g.moveTo(80, 4 + i * 13);
        g.lineTo(305, 4 + i * 13);
        g.stroke();
      }
      g.font = '700 12px sans-serif';
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? '#2b6be5' : '#e5364b';
        g.fillText(i % 2 ? 'O' : 'X', 125 + ((i * 37) % 120), 60 + ((i * 23) % 100));
      }
    } else {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#1a1240');
      gr.addColorStop(1, '#0b2a3a');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.textAlign = 'center';
      g.font = 'italic 800 40px sans-serif';
      g.fillStyle = '#7ef6ff';
      g.fillText('BSS NET', w / 2, h / 2);
      g.font = '500 15px sans-serif';
      g.fillStyle = '#ff7ac4';
      g.fillText('Chọn trò để bắt đầu ▶', w / 2, h / 2 + 30);
    }
  });
}
