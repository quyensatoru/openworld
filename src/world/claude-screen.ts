// Desk monitors that mirror someone's Claude Code session (fed by their Claude Code hooks).
// Drawn on a canvas in Claude Code's dark terminal style, redrawn when events arrive and
// (for live sessions near you) a few times per second for the spinner.
import * as THREE from 'three';
import type { ActivityEvent } from '../../shared/protocol';

const W = 640;
const H = 380;
const SPIN = ['✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳'];
export const LIVE_MS = 2.5 * 60_000;

interface Screen {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
  frame: number;
}

export function isLive(events: ActivityEvent[] | undefined, now: number): boolean {
  const last = events?.[events.length - 1];
  return !!last && now - last.ts < LIVE_MS && last.kind !== 'stop';
}

export class ClaudeScreens {
  private screens = new Map<string, Screen>();

  /** Material showing `name`'s feed, or null when there is nothing to show. */
  material(id: string, name: string, events: ActivityEvent[] | undefined, now: number): THREE.Material | null {
    if (!events?.length) return null;
    let s = this.screens.get(id);
    if (!s) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      s = { canvas, tex, material: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), frame: 0 };
      this.screens.set(id, s);
    }
    this.draw(s, name, events, now);
    return s.material;
  }

  /** Advance the spinner of a live screen (call a few times per second for nearby desks). */
  animate(id: string, name: string, events: ActivityEvent[] | undefined, now: number) {
    const s = this.screens.get(id);
    if (!s || !events?.length || !isLive(events, now)) return;
    s.frame++;
    this.draw(s, name, events, now);
  }

  private draw(s: Screen, name: string, events: ActivityEvent[], now: number) {
    const g = s.canvas.getContext('2d')!;
    g.fillStyle = '#1f1e1c';
    g.fillRect(0, 0, W, H);
    // title bar
    g.fillStyle = '#2a2826';
    g.fillRect(0, 0, W, 46);
    for (const [i, c] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(22 + i * 22, 23, 7, 0, Math.PI * 2);
      g.fill();
    }
    const last = events[events.length - 1];
    const project = [...events].reverse().find((e) => e.project)?.project;
    g.font = '700 22px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    g.fillStyle = '#d97757';
    g.fillText('✻ Claude Code', 92, 31);
    g.font = '500 18px ui-monospace, Menlo, Consolas, monospace';
    g.fillStyle = '#a8a29e';
    g.textAlign = 'right';
    g.fillText(`${name}${project ? ` · ${project}` : ''}`.slice(0, 34), W - 16, 30);
    g.textAlign = 'left';

    // the last lines, newest at the bottom like a terminal
    const lines = events.slice(-8);
    const top = 70;
    const lh = 33;
    lines.forEach((e, i) => {
      const y = top + i * lh;
      const newest = i === lines.length - 1;
      g.globalAlpha = newest ? 1 : 0.55 + (0.45 * i) / lines.length;
      g.font = '500 15px ui-monospace, Menlo, Consolas, monospace';
      g.fillStyle = '#78716c';
      g.fillText(new Date(e.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), 16, y);
      g.font = e.kind === 'say' ? '500 19px "Be Vietnam Pro", system-ui, sans-serif' : `${e.kind === 'prompt' ? 700 : 500} 19px ui-monospace, Menlo, Consolas, monospace`;
      g.fillStyle =
        e.kind === 'prompt' || e.kind === 'say' ? '#fafaf9' : e.kind === 'stop' ? '#86efac' : e.kind === 'notify' ? '#fcd34d' : e.kind === 'result' ? (e.icon === '❌' ? '#fca5a5' : '#86efac') : '#d6d3d1';
      const text = `${e.kind === 'prompt' ? '> ' : ''}${e.icon} ${e.text}`;
      g.fillText(fit(g, text, W - 100), 84, y);
    });
    g.globalAlpha = 1;

    // status line
    g.fillStyle = '#2a2826';
    g.fillRect(0, H - 44, W, 44);
    g.font = '600 19px ui-monospace, Menlo, Consolas, monospace';
    if (isLive(events, now)) {
      const secs = Math.max(0, Math.round((now - (lastPromptTs(events) ?? last.ts)) / 1000));
      g.fillStyle = '#d97757';
      g.fillText(`${SPIN[s.frame % SPIN.length]} Đang làm việc… (${secs < 600 ? `${secs}s` : `${Math.round(secs / 60)} phút`})`, 16, H - 16);
    } else {
      g.fillStyle = '#78716c';
      g.fillText(`● Chờ lệnh · lần cuối ${new Date(last.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`, 16, H - 16);
    }
    s.tex.needsUpdate = true;
  }

  dispose() {
    for (const s of this.screens.values()) {
      s.tex.dispose();
      s.material.dispose();
    }
    this.screens.clear();
  }
}

function lastPromptTs(events: ActivityEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'stop') return undefined;
    if (events[i].kind === 'prompt') return events[i].ts;
  }
  return undefined;
}

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 2 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
