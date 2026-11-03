// Soft pastel material palette + procedural canvas textures (no image assets needed).
import * as THREE from 'three';

export const C = {
  wall: '#f2ebe1',
  wallTrim: '#ddd0bf',
  wood: '#e3c8a0',
  woodDark: '#b88a5a',
  deskTop: '#f1e8db',
  metal: '#59616d',
  dark: '#2b2f36',
  glass: '#cfe8f3',
  frame: '#a7b2bd',
  grass: '#bcd6a6',
  leaf1: '#6aa874',
  leaf2: '#86bf7f',
  leaf3: '#4f8d62',
  pot: '#d98c5f',
  potWhite: '#efebe4',
  accents: ['#5fa8a0', '#ec8b6f', '#e8b84a', '#9c8ad6', '#6fa8dc', '#8fb996'],
  sofa: ['#9cb89c', '#d9a5a0', '#e2b45a', '#8fa9cf'],
  books: ['#e5566b', '#f2c14e', '#5fa8a0', '#6b8cff', '#b56fd0', '#f08a5d', '#3d8a6a', '#efe6d6'],
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  map?: THREE.Texture;
}

/** Shared (cached) standard material. Do not mutate the returned instance. */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 1}|${o.opacity ?? 1}|${o.map?.uuid ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.8,
      metalness: o.metal ?? 0,
      emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0),
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.transparent ?? (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      map: o.map ?? null,
    });
    if (m.transparent) m.depthWrite = false;
    cache.set(key, m);
  }
  return m;
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

export type FloorKind = 'wood' | 'carpet' | 'tile' | 'stone' | 'rug';

/** Texture covering a 2m x 2m patch, meant to be repeated. */
export function floorTexture(kind: FloorKind, tint: string): THREE.CanvasTexture {
  const r = rng(kind.length * 97 + tint.length);
  const tex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    if (kind === 'wood') {
      const plank = w / 10; // 20cm planks
      for (let i = 0; i < 10; i++) {
        const offset = r() * h;
        for (let k = -1; k < 2; k++) {
          const y0 = offset + k * h * 0.75;
          g.fillStyle = shade(tint, (r() - 0.5) * 0.06);
          g.fillRect(i * plank + 1, y0, plank - 2, h * 0.75 - 2);
          g.strokeStyle = shade(tint, -0.09);
          g.lineWidth = 2;
          g.strokeRect(i * plank + 1, y0, plank - 2, h * 0.75 - 2);
          g.globalAlpha = 0.18;
          for (let s = 0; s < 4; s++) {
            g.strokeStyle = shade(tint, -0.12);
            g.beginPath();
            const gx = i * plank + 6 + r() * (plank - 12);
            g.moveTo(gx, y0 + 4);
            g.bezierCurveTo(gx + 4, y0 + h * 0.25, gx - 4, y0 + h * 0.5, gx + 2, y0 + h * 0.74);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
      }
    } else if (kind === 'tile') {
      const n = 4; // 50cm tiles
      const s = w / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = shade(tint, (r() - 0.5) * 0.03);
          g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
        }
      g.strokeStyle = shade(tint, -0.12);
      g.lineWidth = 4;
      for (let i = 0; i <= n; i++) {
        g.beginPath();
        g.moveTo(i * s, 0);
        g.lineTo(i * s, h);
        g.moveTo(0, i * s);
        g.lineTo(w, i * s);
        g.stroke();
      }
    } else if (kind === 'stone') {
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = shade(tint, (r() - 0.6) * 0.25);
        g.globalAlpha = 0.5;
        const d = 1 + r() * 3;
        g.beginPath();
        g.arc(r() * w, r() * h, d, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.strokeStyle = shade(tint, -0.07);
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
    } else {
      // carpet / rug: soft fibre noise
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (r() - 0.5) * (kind === 'rug' ? 16 : 22);
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Fake code editor shown on monitors of occupied desks. */
export function codeScreenTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed * 7919 + 13);
  return canvasTexture(256, 160, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1f2840');
    grad.addColorStop(1, '#283656');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a4a70';
    g.fillRect(0, 0, w, 14);
    g.fillRect(0, 14, 40, h);
    const cols = ['#9fd3ff', '#ffd27a', '#a6e3a1', '#f5a3c7', '#cdd6f4'];
    for (let y = 22; y < h - 6; y += 9) {
      let x = 48 + Math.floor(r() * 4) * 10;
      const parts = 1 + Math.floor(r() * 4);
      for (let p = 0; p < parts && x < w - 10; p++) {
        const len = 10 + r() * 50;
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.globalAlpha = 0.85;
        g.fillRect(x, y, Math.min(len, w - 8 - x), 4);
        x += len + 6;
      }
    }
    g.globalAlpha = 1;
  });
}
