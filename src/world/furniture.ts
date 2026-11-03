// Procedural, soft-edged furniture. Every builder returns a Group whose origin sits on the floor
// at the furniture centre, with its "front" facing local +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CINEMA_SCREEN, CINEMA_WALL_H, KARA_SCREEN, type Furniture, type Seat } from '../../shared/map';
import { C, canvasTexture, mat } from './materials';

const geoCache = new Map<string, THREE.BufferGeometry>();

/**
 * Soft box. Tessellation follows the corner radius: tiny radii are invisible from the camera, so
 * they get a plain box (12 triangles) instead of a 588-triangle rounded one — this alone took the
 * scene from ~3M to a few hundred thousand triangles.
 */
function rboxGeo(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const key = `rb|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${rr.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = rr < 0.018 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, rr < 0.12 ? 1 : 2, rr);
    geoCache.set(key, g);
  }
  return g;
}

function cylGeo(rt: number, rb: number, h: number, seg = 20): THREE.BufferGeometry {
  if (Math.max(rt, rb) < 0.05) seg = Math.min(seg, 10); // thin legs, poles, bottles
  const key = `cy|${rt}|${rb}|${h}|${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }
  return g;
}

function sphGeo(r: number, detail = r > 0.5 ? 2 : 1): THREE.BufferGeometry {
  const key = `sp|${r}|${detail}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.IcosahedronGeometry(r, detail);
    geoCache.set(key, g);
  }
  return g;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const rbox = (g: THREE.Object3D, w: number, h: number, d: number, color: string | THREE.Material, x: number, y: number, z: number, r = 0.03) =>
  g.add(mesh(rboxGeo(w, h, d, r), typeof color === 'string' ? mat(color) : color, x, y, z));
export const cyl = (g: THREE.Object3D, rt: number, rb: number, h: number, color: string, x: number, y: number, z: number, seg = 20) =>
  g.add(mesh(cylGeo(rt, rb, h, seg), mat(color), x, y, z));
const sph = (g: THREE.Object3D, r: number, color: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
  const m = mesh(sphGeo(r), mat(color, { rough: 0.9 }), x, y, z);
  m.scale.set(sx, sy, sz);
  g.add(m);
  return m;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rngFrom(seed: string) {
  let s = hash(seed);
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Dynamic parts that the office keeps references to (screens etc.). */
export interface Dynamic {
  monitor?: THREE.Mesh;
  screen?: THREE.Mesh;
}

// ------------------------------------------------------------------ pieces
function plant(g: THREE.Group, big: boolean, seed: string) {
  const r = rngFrom(seed);
  if (big) {
    cyl(g, 0.26, 0.2, 0.5, C.potWhite, 0, 0.25, 0);
    cyl(g, 0.24, 0.24, 0.02, '#7a5a3c', 0, 0.5, 0);
    cyl(g, 0.025, 0.035, 0.9, '#7b5a3a', 0, 0.9, 0, 8);
    const greens = [C.leaf1, C.leaf2, C.leaf3];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r();
      const y = 0.95 + r() * 0.75;
      const rad = 0.12 + r() * 0.2;
      const leaf = sph(g, 0.17, greens[i % 3], Math.cos(a) * rad, y, Math.sin(a) * rad, 1, 0.55, 1.4);
      leaf.rotation.set(r() * 0.8 - 0.4, a, r() * 0.6);
    }
  } else {
    cyl(g, 0.17, 0.13, 0.32, r() > 0.5 ? C.pot : C.potWhite, 0, 0.16, 0);
    cyl(g, 0.16, 0.16, 0.02, '#7a5a3c', 0, 0.32, 0);
    const greens = [C.leaf1, C.leaf2, C.leaf3];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      sph(g, 0.13 + r() * 0.05, greens[i % 3], Math.cos(a) * 0.09, 0.45 + r() * 0.2, Math.sin(a) * 0.09);
    }
    sph(g, 0.15, C.leaf2, 0, 0.66, 0);
  }
}

export function officeChair(color: string): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(rboxGeo(0.3, 0.035, 0.05, 0.015), mat(C.metal), Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14);
    leg.rotation.y = -a;
    g.add(leg);
    sph(g, 0.03, C.dark, Math.cos(a) * 0.28, 0.03, Math.sin(a) * 0.28);
  }
  cyl(g, 0.025, 0.025, 0.32, C.metal, 0, 0.25, 0, 10);
  rbox(g, 0.5, 0.09, 0.48, color, 0, 0.46, 0, 0.04);
  rbox(g, 0.04, 0.32, 0.04, C.metal, 0, 0.62, -0.23, 0.015);
  rbox(g, 0.48, 0.48, 0.08, color, 0, 0.82, -0.27, 0.04);
  return g;
}

function meetingChair(color: string): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) cyl(g, 0.018, 0.015, 0.44, C.metal, x, 0.22, z, 8);
  rbox(g, 0.48, 0.07, 0.46, color, 0, 0.47, 0, 0.03);
  rbox(g, 0.46, 0.42, 0.06, color, 0, 0.75, -0.22, 0.03);
  return g;
}

function cinemaChair(): THREE.Group {
  const g = new THREE.Group();
  const velvet = '#9e2b3a';
  rbox(g, 0.56, 0.16, 0.5, velvet, 0, 0.42, 0.02, 0.06);
  rbox(g, 0.58, 0.72, 0.14, velvet, 0, 0.72, -0.24, 0.07);
  rbox(g, 0.58, 0.32, 0.1, '#2b2433', 0, 0.2, -0.22, 0.03);
  for (const sx of [-1, 1]) {
    rbox(g, 0.08, 0.5, 0.52, '#2b2433', sx * 0.33, 0.33, -0.02, 0.03);
    rbox(g, 0.1, 0.05, 0.56, '#3a3142', sx * 0.33, 0.6, -0.02, 0.02);
  }
  cyl(g, 0.04, 0.035, 0.08, '#cfd6e6', 0.33, 0.67, 0.18, 12); // cup holder
  return g;
}

function gamingChair(i: number): THREE.Group {
  const g = new THREE.Group();
  const accent = ['#e5566b', '#2de2e6', '#39ff88', '#9b5cff'][i % 4];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const leg = mesh(rboxGeo(0.3, 0.035, 0.05, 0.015), mat(C.dark), Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14);
    leg.rotation.y = -a;
    g.add(leg);
  }
  cyl(g, 0.025, 0.025, 0.32, C.dark, 0, 0.25, 0, 10);
  rbox(g, 0.52, 0.1, 0.5, '#15151b', 0, 0.46, 0, 0.04);
  rbox(g, 0.5, 0.78, 0.09, '#15151b', 0, 0.9, -0.27, 0.05);
  rbox(g, 0.12, 0.7, 0.1, accent, -0.16, 0.92, -0.25, 0.03);
  rbox(g, 0.12, 0.7, 0.1, accent, 0.16, 0.92, -0.25, 0.03);
  rbox(g, 0.3, 0.12, 0.1, '#15151b', 0, 1.36, -0.26, 0.04);
  for (const sx of [-1, 1]) rbox(g, 0.06, 0.05, 0.36, accent, sx * 0.29, 0.66, 0.0, 0.02);
  return g;
}

function barStool(): THREE.Group {
  const g = new THREE.Group();
  cyl(g, 0.21, 0.19, 0.08, '#7a1f2e', 0, 0.46, 0);
  cyl(g, 0.03, 0.03, 0.42, '#c9ced6', 0, 0.22, 0, 8);
  cyl(g, 0.18, 0.2, 0.025, '#c9ced6', 0, 0.013, 0);
  return g;
}

function stool(color: string): THREE.Group {
  const g = new THREE.Group();
  cyl(g, 0.2, 0.2, 0.06, color, 0, 0.46, 0);
  cyl(g, 0.03, 0.03, 0.42, C.metal, 0, 0.22, 0, 8);
  cyl(g, 0.17, 0.19, 0.025, C.metal, 0, 0.013, 0);
  return g;
}

export function seatModel(seat: Seat, index: number): THREE.Group | null {
  switch (seat.kind) {
    case 'desk':
      return officeChair(C.accents[Math.floor(index / 4) % C.accents.length]);
    case 'focus':
      return officeChair('#9c8ad6');
    case 'meeting':
      return meetingChair(seat.zone === 'meetA' ? '#7fa7c9' : '#d9a5a0');
    case 'stool':
      return seat.zone === 'bar' ? barStool() : stool(C.accents[index % C.accents.length]);
    case 'pc':
      return gamingChair(index);
    case 'cinema':
      return cinemaChair();
    case 'wolf':
      return stump(index);
    default:
      return null;
  }
}

// ------------------------------------------------------------------ furniture
export function buildFurniture(f: Furniture, dyn: Dynamic): THREE.Group {
  const g = new THREE.Group();
  const r = rngFrom(f.id);
  switch (f.kind) {
    case 'desk': {
      rbox(g, 1.38, 0.04, 0.68, C.deskTop, 0, 0.73, 0, 0.015);
      rbox(g, 0.04, 0.71, 0.6, '#d9d2c7', -0.65, 0.355, 0, 0.015);
      rbox(g, 0.04, 0.71, 0.6, '#d9d2c7', 0.65, 0.355, 0, 0.015);
      rbox(g, 1.26, 0.32, 0.02, '#d9d2c7', 0, 0.52, 0.31, 0.008);
      rbox(g, 0.22, 0.015, 0.16, C.dark, 0, 0.757, 0.17, 0.006);
      rbox(g, 0.04, 0.24, 0.03, C.dark, 0, 0.88, 0.2, 0.01);
      rbox(g, 0.64, 0.4, 0.035, C.dark, 0, 1.07, 0.2, 0.015);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.355), mat('#151922', { rough: 0.4 }));
      screen.position.set(0, 1.07, 0.18);
      screen.rotation.y = Math.PI;
      g.add(screen);
      dyn.monitor = screen;
      rbox(g, 0.44, 0.018, 0.14, '#e9e9ee', 0, 0.759, -0.1, 0.006);
      rbox(g, 0.06, 0.02, 0.09, '#e9e9ee', 0.34, 0.76, -0.1, 0.01);
      if (r() > 0.35) cyl(g, 0.04, 0.035, 0.1, C.accents[Math.floor(r() * 6)], -0.5, 0.8, 0.05, 12);
      if (r() > 0.6) {
        const p = new THREE.Group();
        plant(p, false, f.id);
        p.scale.setScalar(0.45);
        p.position.set(0.52, 0.75, 0.15);
        g.add(p);
      } else if (r() > 0.4) {
        rbox(g, 0.2, 0.03, 0.27, C.books[Math.floor(r() * 8)], 0.45, 0.765, 0.05, 0.005);
      }
      break;
    }
    case 'focusDesk': {
      rbox(g, 1.18, 0.04, 0.6, C.wood, 0, 0.73, 0, 0.015);
      rbox(g, 0.04, 0.71, 0.55, C.woodDark, -0.56, 0.355, 0, 0.015);
      rbox(g, 0.04, 0.71, 0.55, C.woodDark, 0.56, 0.355, 0, 0.015);
      rbox(g, 0.04, 0.55, 0.6, '#cfc6e8', -0.6, 1.02, 0, 0.015);
      rbox(g, 0.04, 0.55, 0.6, '#cfc6e8', 0.6, 1.02, 0, 0.015);
      rbox(g, 1.2, 0.55, 0.04, '#cfc6e8', 0, 1.02, 0.29, 0.015);
      // laptop
      rbox(g, 0.34, 0.015, 0.23, '#c9ced6', 0, 0.76, -0.02, 0.006);
      const lid = mesh(rboxGeo(0.34, 0.23, 0.012, 0.005), mat('#c9ced6'), 0, 0.87, 0.1);
      lid.rotation.x = -0.25;
      g.add(lid);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), mat('#151922'));
      screen.position.set(0, 0.87, 0.092);
      screen.rotation.set(-0.25, Math.PI, 0);
      g.add(screen);
      dyn.monitor = screen;
      // desk lamp
      cyl(g, 0.06, 0.07, 0.02, C.dark, 0.42, 0.76, 0.12);
      cyl(g, 0.01, 0.01, 0.32, C.dark, 0.42, 0.92, 0.12, 6);
      cyl(g, 0.04, 0.09, 0.1, '#ffe2a8', 0.42, 1.08, 0.08);
      break;
    }
    case 'meetingTable': {
      rbox(g, f.w, 0.05, f.d, '#efe6da', 0, 0.74, 0, 0.025);
      rbox(g, 0.32, 0.7, 0.7, '#b9ac9c', -f.w / 2 + 0.6, 0.36, 0, 0.04);
      rbox(g, 0.32, 0.7, 0.7, '#b9ac9c', f.w / 2 - 0.6, 0.36, 0, 0.04);
      cyl(g, 0.11, 0.13, 0.03, C.dark, 0, 0.78, 0);
      for (const x of [-1.2, 0, 1.2]) {
        if (r() > 0.45) rbox(g, 0.3, 0.012, 0.21, '#c9ced6', x, 0.772, -0.42, 0.005);
        if (r() > 0.5) cyl(g, 0.035, 0.035, 0.2, '#bfe3f2', x + 0.25, 0.86, 0.45, 10);
      }
      break;
    }
    case 'tv': {
      rbox(g, f.w, 1.38, 0.06, C.dark, 0, 1.55, 0, 0.02);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(f.w - 0.1, 1.28), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, 1.55, 0.034);
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'sofa': {
      const col = f.zone === 'bar' ? '#6b2d4f' : f.zone === 'karaoke' ? '#5b2a78' : C.sofa[hash(f.id) % C.sofa.length];
      const w = f.w;
      const d = f.d;
      rbox(g, w, 0.24, d, col, 0, 0.2, 0, 0.06);
      rbox(g, w - 0.34, 0.14, d - 0.25, col, 0, 0.38, 0.09, 0.06);
      rbox(g, w, 0.52, 0.22, col, 0, 0.5, -d / 2 + 0.11, 0.09);
      rbox(g, 0.18, 0.42, d, col, -w / 2 + 0.09, 0.37, 0, 0.08);
      rbox(g, 0.18, 0.42, d, col, w / 2 - 0.09, 0.37, 0, 0.08);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.025, 0.02, 0.1, C.woodDark, sx * (w / 2 - 0.1), 0.05, sz * (d / 2 - 0.1), 8);
      if (w > 1.5) {
        const pillow = mesh(rboxGeo(0.36, 0.3, 0.12, 0.06), mat(C.accents[hash(f.id) % 6]), -w / 2 + 0.42, 0.56, -d / 2 + 0.28);
        pillow.rotation.set(-0.2, 0.2, 0.08);
        g.add(pillow);
      }
      break;
    }
    case 'beanbag': {
      sph(g, 0.45, C.accents[hash(f.id) % 6], 0, 0.26, 0, 1, 0.58, 1);
      sph(g, 0.3, C.accents[hash(f.id) % 6], 0, 0.42, -0.2, 1, 0.8, 0.7);
      break;
    }
    case 'coffeeTable': {
      rbox(g, f.w, 0.05, f.d, C.wood, 0, 0.42, 0, 0.02);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.025, 0.02, 0.4, C.woodDark, sx * (f.w / 2 - 0.1), 0.2, sz * (f.d / 2 - 0.1), 8);
      rbox(g, 0.28, 0.02, 0.2, '#f08a5d', -0.35, 0.455, 0.05, 0.005);
      cyl(g, 0.06, 0.05, 0.07, '#efe6d6', 0.3, 0.48, -0.05, 12);
      break;
    }
    case 'bookshelf': {
      const H = 2.0;
      rbox(g, f.w, H, 0.04, C.woodDark, 0, H / 2, -f.d / 2 + 0.02, 0.01);
      rbox(g, 0.05, H, f.d, C.woodDark, -f.w / 2 + 0.025, H / 2, 0, 0.01);
      rbox(g, 0.05, H, f.d, C.woodDark, f.w / 2 - 0.025, H / 2, 0, 0.01);
      const shelves = 5;
      for (let i = 0; i <= shelves; i++) rbox(g, f.w, 0.04, f.d, C.woodDark, 0, 0.02 + (i * (H - 0.04)) / shelves, 0, 0.01);
      for (let i = 0; i < shelves; i++) {
        let x = -f.w / 2 + 0.08;
        const y0 = 0.04 + (i * (H - 0.04)) / shelves;
        while (x < f.w / 2 - 0.12) {
          const bw = 0.03 + r() * 0.04;
          const bh = 0.18 + r() * 0.12;
          if (r() > 0.12) {
            const book = mesh(rboxGeo(bw, bh, 0.24, 0.004), mat(C.books[Math.floor(r() * C.books.length)]), x + bw / 2, y0 + bh / 2, 0.02);
            if (r() > 0.9) book.rotation.z = 0.25;
            g.add(book);
          }
          x += bw + 0.004;
        }
      }
      break;
    }
    case 'plant':
      plant(g, false, f.id);
      break;
    case 'bigPlant':
      plant(g, true, f.id);
      break;
    case 'counter': {
      rbox(g, f.w, 0.88, f.d, '#f3ede4', 0, 0.44, 0, 0.02);
      rbox(g, f.w + 0.04, 0.05, f.d + 0.02, C.wood, 0, 0.905, 0, 0.015);
      for (let z = -f.d / 2 + 0.6; z < f.d / 2; z += 0.9) rbox(g, 0.02, 0.5, 0.025, '#c9bfb2', -f.w / 2 - 0.005, 0.6, z, 0.01);
      sph(g, 0.14, '#efe6d6', 0, 1.0, 1.4, 1, 0.5, 1);
      sph(g, 0.06, '#f2c14e', 0.03, 1.06, 1.37);
      sph(g, 0.06, '#e5566b', -0.05, 1.06, 1.45);
      cyl(g, 0.08, 0.09, 0.22, '#c9ced6', 0, 1.04, -1.2);
      break;
    }
    case 'coffeeMachine': {
      rbox(g, 0.44, 0.5, 0.4, '#3a3f47', 0, 1.18, 0, 0.04);
      rbox(g, 0.36, 0.12, 0.05, '#9aa3ad', 0, 1.3, 0.2, 0.02);
      cyl(g, 0.04, 0.035, 0.08, '#ffffff', 0, 0.97, 0.12, 12);
      rbox(g, 0.1, 0.03, 0.03, '#7fe0a8', 0.12, 1.36, 0.215, 0.01);
      break;
    }
    case 'fridge': {
      rbox(g, f.w, 1.85, f.d, '#dfe5ea', 0, 0.925, 0, 0.05);
      rbox(g, 0.03, 0.5, 0.04, '#9aa3ad', -f.w / 2 + 0.12, 1.2, f.d / 2 + 0.01, 0.012);
      rbox(g, f.w - 0.04, 0.012, 0.01, '#c9d1d8', 0, 1.25, f.d / 2 + 0.002, 0.004);
      break;
    }
    case 'waterCooler': {
      rbox(g, 0.34, 0.95, 0.34, '#eef1f4', 0, 0.475, 0, 0.04);
      cyl(g, 0.14, 0.14, 0.42, '#9fd3ff', 0, 1.16, 0);
      break;
    }
    case 'roundTable': {
      cyl(g, f.w / 2, f.w / 2, 0.04, '#f3ede4', 0, 0.74, 0, 32);
      cyl(g, 0.04, 0.04, 0.72, C.metal, 0, 0.37, 0, 10);
      cyl(g, 0.24, 0.27, 0.03, C.metal, 0, 0.015, 0, 24);
      cyl(g, 0.045, 0.04, 0.09, C.accents[hash(f.id) % 6], 0.15, 0.805, 0.1, 12);
      break;
    }
    case 'reception': {
      rbox(g, f.w, 1.05, f.d, '#f3ede4', 0, 0.525, 0, 0.05);
      rbox(g, f.w + 0.06, 0.05, f.d + 0.06, C.wood, 0, 1.075, 0, 0.02);
      rbox(g, f.w - 0.2, 0.08, 0.02, '#6b8cff', 0, 0.75, f.d / 2 + 0.005, 0.01);
      rbox(g, 0.34, 0.015, 0.24, '#c9ced6', -0.5, 1.11, -0.1, 0.005);
      const bell = new THREE.Group();
      plant(bell, false, 'reception-plant');
      bell.scale.setScalar(0.5);
      bell.position.set(0.9, 1.1, -0.1);
      g.add(bell);
      break;
    }
    case 'kanbanBoard': {
      for (const x of [-f.w / 2 + 0.15, f.w / 2 - 0.15]) {
        rbox(g, 0.06, 2.5, 0.06, C.metal, x, 1.25, 0, 0.02);
        rbox(g, 0.5, 0.04, 0.3, C.metal, x, 0.02, 0, 0.015);
      }
      rbox(g, f.w, 2.0, 0.08, '#ffffff', 0, 1.55, 0, 0.03);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(f.w - 0.12, 1.9), mat('#ffffff', { rough: 0.6 }));
      screen.position.set(0, 1.55, 0.042);
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'whiteboard': {
      rbox(g, f.w, 1.35, 0.05, '#ffffff', 0, 1.55, 0, 0.02);
      rbox(g, f.w * 0.9, 0.04, 0.08, C.frame, 0, 0.86, 0.04, 0.015);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(f.w - 0.12, 1.25), mat('#ffffff', { rough: 0.5 }));
      screen.position.set(0, 1.55, 0.027);
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'rug': {
      rbox(g, f.w, 0.012, f.d, f.zone === 'library' ? '#d9cfe8' : '#f0d9c4', 0, 0.006, 0, 0.005);
      rbox(g, f.w - 0.4, 0.014, f.d - 0.4, f.zone === 'library' ? '#cbbfe0' : '#e8c7aa', 0, 0.007, 0, 0.005);
      break;
    }
    case 'lamp': {
      cyl(g, 0.16, 0.18, 0.03, C.dark, 0, 0.015, 0);
      cyl(g, 0.015, 0.015, 1.5, C.dark, 0, 0.77, 0, 8);
      const shade = mesh(cylGeo(0.13, 0.22, 0.28, 24), mat('#ffe9c2', { emissive: '#ffd58f', emissiveIntensity: 0.6 }), 0, 1.58, 0);
      g.add(shade);
      break;
    }
    case 'cinemaScreen': {
      // black masking frame around the projection surface (the surface itself is dynamic)
      rbox(g, f.w + 0.4, f.h ?? 7.2, 0.12, '#141218', 0, CINEMA_SCREEN.y, -0.04, 0.04);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, 0, 0.04); // placed by OfficeScene from CINEMA_SCREEN
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'curtain': {
      for (let i = 0; i < 5; i++) {
        const fold = mesh(cylGeo(0.13, 0.13, CINEMA_WALL_H - 0.15, 12), mat('#7e1f2c', { rough: 0.95 }), -0.48 + i * 0.24, (CINEMA_WALL_H - 0.15) / 2, Math.sin(i * 1.7) * 0.06);
        g.add(fold);
      }
      break;
    }
    case 'popcorn': {
      rbox(g, 0.9, 0.85, 0.65, '#d63a3a', 0, 0.43, 0, 0.05);
      rbox(g, 0.92, 0.06, 0.67, '#f2c14e', 0, 0.88, 0, 0.02);
      const glass = mesh(rboxGeo(0.7, 0.6, 0.5, 0.04), mat('#fff6d6', { opacity: 0.35, rough: 0.1 }), 0, 1.22, 0);
      g.add(glass);
      for (let i = 0; i < 14; i++) sph(g, 0.05, i % 3 ? '#fff3c4' : '#ffe08a', -0.25 + (i % 5) * 0.12, 0.98 + Math.floor(i / 5) * 0.06, -0.1 + (i % 3) * 0.1);
      rbox(g, 0.8, 0.12, 0.6, '#d63a3a', 0, 1.6, 0, 0.05);
      for (const [x, z] of [[-0.3, 0.42], [0.3, 0.42]]) cyl(g, 0.07, 0.05, 0.16, '#e5566b', x, 0.96, z, 10);
      break;
    }
    case 'barCounter': {
      const wood = '#4a2f25';
      rbox(g, f.w, 0.76, f.d - 0.1, wood, 0, 0.38, -0.05, 0.03);
      rbox(g, f.w + 0.12, 0.05, f.d + 0.12, mat('#241a17', { rough: 0.22 }), 0, 0.785, 0, 0.02);
      for (let x = -f.w / 2 + 0.45; x < f.w / 2; x += 0.6) rbox(g, 0.02, 0.6, 0.02, '#6b4636', x, 0.38, f.d / 2 - 0.09, 0.008);
      const led = mesh(rboxGeo(f.w, 0.025, 0.025, 0.01), new THREE.MeshBasicMaterial({ color: '#ff3ea5', toneMapped: false }), 0, 0.74, f.d / 2 + 0.03);
      led.castShadow = false;
      g.add(led);
      // glasses, shaker and beer taps
      for (let i = 0; i < 7; i++) {
        const x = -f.w / 2 + 0.7 + i * 1.25 + (r() - 0.5) * 0.3;
        cyl(g, 0.035, 0.028, 0.11, i % 2 ? '#d8eef5' : '#f5d58a', x, 0.865, 0.1 + (r() - 0.5) * 0.2, 12);
      }
      cyl(g, 0.045, 0.04, 0.2, '#c9ced6', -f.w / 2 + 0.3, 0.91, -0.15, 12);
      for (const dx of [0, 0.16, 0.32]) {
        cyl(g, 0.02, 0.02, 0.32, '#d9dde3', f.w / 2 - 0.55 + dx, 0.97, -0.2, 8);
        cyl(g, 0.03, 0.03, 0.07, ['#e2b13c', '#3f7d4e', '#a8323e'][Math.round(dx / 0.16)], f.w / 2 - 0.55 + dx, 1.16, -0.2, 8);
      }
      break;
    }
    case 'barShelf': {
      rbox(g, f.w, 2.5, 0.05, '#20161a', 0, 1.25, -f.d / 2 + 0.025, 0.01);
      rbox(g, f.w, 0.9, f.d, '#3a271f', 0, 0.45, 0, 0.02);
      const glow = new THREE.MeshBasicMaterial({ color: '#ffb35c', toneMapped: false });
      const cols = ['#c77d2e', '#3f7d4e', '#d8e8ef', '#3b6fb6', '#a8323e', '#d9a441', '#6a3d7a', '#e8e0c8'];
      for (const [i, y] of [0.98, 1.46, 1.94].entries()) {
        rbox(g, f.w, 0.03, f.d, mat('#b9c4cc', { metal: 0.5, rough: 0.3 }), 0, y, 0, 0.008);
        const strip = mesh(rboxGeo(f.w - 0.2, 0.02, 0.02, 0.008), glow, 0, y + 0.42, -f.d / 2 + 0.06);
        strip.castShadow = false;
        g.add(strip);
        let x = -f.w / 2 + 0.2;
        while (x < f.w / 2 - 0.2) {
          const h = 0.2 + Math.round(r() * 4) * 0.025;
          const rad = r() > 0.5 ? 0.04 : 0.033;
          const c = cols[Math.floor(r() * cols.length)];
          const bm = mat(c, { rough: 0.15, emissive: c, emissiveIntensity: 0.22 + i * 0.04 });
          g.add(mesh(cylGeo(rad, rad, h, 10), bm, x, y + 0.015 + h / 2, 0.02));
          g.add(mesh(cylGeo(0.012, rad * 0.6, 0.09, 8), bm, x, y + 0.015 + h + 0.045, 0.02));
          x += rad * 2 + 0.05 + r() * 0.08;
        }
      }
      break;
    }
    case 'djBooth': {
      rbox(g, f.w, 1.0, f.d, '#17171d', 0, 0.5, 0, 0.04);
      rbox(g, f.w + 0.06, 0.05, f.d + 0.06, '#2c2c36', 0, 1.025, 0, 0.02);
      for (const x of [-0.85, 0.85]) {
        rbox(g, 0.62, 0.05, 0.5, '#24242c', x, 1.075, -0.05, 0.02);
        cyl(g, 0.012, 0.012, 0.04, '#c9ced6', x, 1.12, -0.05, 6);
      }
      rbox(g, 0.5, 0.07, 0.42, '#30303a', 0, 1.085, -0.05, 0.02);
      for (let i = 0; i < 6; i++) cyl(g, 0.018, 0.018, 0.03, ['#ff3ea5', '#2de2e6', '#ffd23f'][i % 3], -0.16 + (i % 3) * 0.16, 1.13, -0.17 + Math.floor(i / 3) * 0.12, 8);
      // laptop
      rbox(g, 0.34, 0.015, 0.24, '#c9ced6', 0, 1.13, 0.2, 0.006);
      const lid = mesh(rboxGeo(0.34, 0.23, 0.012, 0.005), mat('#c9ced6'), 0, 1.24, 0.31);
      lid.rotation.x = 0.3;
      g.add(lid);
      break;
    }
    case 'speaker': {
      rbox(g, f.w, 1.5, f.d, '#16161b', 0, 0.75, 0, 0.04);
      for (const [y, rad] of [[0.48, 0.26], [1.12, 0.12]] as const) {
        const cone = mesh(cylGeo(rad, rad * 0.75, 0.06, 24), mat('#2b2b33', { rough: 0.6 }), 0, y, f.d / 2 - 0.01);
        cone.rotation.x = Math.PI / 2;
        g.add(cone);
        const cap = mesh(sphGeo(rad * 0.32, 1), mat('#3a3a44', { rough: 0.4 }), 0, y, f.d / 2 + 0.01);
        g.add(cap);
      }
      break;
    }
    case 'barTable': {
      cyl(g, f.w / 2, f.w / 2, 0.04, '#241a17', 0, 0.74, 0, 28);
      cyl(g, 0.035, 0.035, 0.72, '#c9ced6', 0, 0.37, 0, 10);
      cyl(g, 0.22, 0.25, 0.03, '#c9ced6', 0, 0.015, 0, 20);
      g.add(mesh(cylGeo(0.04, 0.04, 0.07, 12), mat('#fff1c9', { emissive: '#ffb35c', emissiveIntensity: 0.9 }), 0.08, 0.795, -0.06));
      cyl(g, 0.035, 0.028, 0.12, '#d8eef5', -0.12, 0.82, 0.08, 12);
      break;
    }
    case 'poster': {
      const n = hash(f.id) % 3;
      const tex = canvasTexture(330, 480, (c, w, h) => {
        const grads = [['#ff6b6b', '#3a1c71'], ['#2de2e6', '#14213d'], ['#ffd23f', '#7b2ff7']][n];
        const gr = c.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, grads[0]);
        gr.addColorStop(1, grads[1]);
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.beginPath();
        c.arc(w * 0.5, h * 0.4, 110, 0, Math.PI * 2);
        c.fill();
        c.font = '120px serif';
        c.textAlign = 'center';
        c.fillText(['🚀', '🐞', '⏰'][n], w / 2, h * 0.47);
        c.fillStyle = '#fff';
        c.font = '800 40px "Be Vietnam Pro", sans-serif';
        c.fillText(['SPRINT CUỐI', 'BUG HUNTER', 'DEADLINE 2'][n], w / 2, h * 0.76);
        c.font = '500 20px "Be Vietnam Pro", sans-serif';
        c.fillText(['Sắp chiếu', 'Đang hot', 'Suất chiếu 18:00'][n], w / 2, h * 0.84);
        c.fillText('BSS PICTURES', w / 2, h * 0.94);
      });
      rbox(g, 1.2, 1.7, 0.04, '#1d1824', 0, 1.6, 0, 0.01);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      p.position.set(0, 1.6, 0.025);
      g.add(p);
      break;
    }
    case 'wheel': {
      // stand + back plate; the disc, rim lights and pointer are animated by BarFx
      rbox(g, 2.0, 2.0, 0.05, '#1a1220', 0, 1.75, -0.02, 0.02);
      rbox(g, 0.12, 0.8, 0.08, '#b08d57', 0, 0.4, 0, 0.02);
      break;
    }
    case 'pcDesk': {
      const rgb = ['#2de2e6', '#ff3ea5', '#39ff88', '#9b5cff'][hash(f.id) % 4];
      rbox(g, f.w, 0.04, f.d, '#16171e', 0, 0.74, 0, 0.01);
      for (const sx of [-1, 1]) rbox(g, 0.05, 0.72, f.d - 0.06, '#0e0f14', sx * (f.w / 2 - 0.04), 0.36, 0, 0.01);
      const strip = mesh(rboxGeo(f.w - 0.1, 0.012, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: rgb, toneMapped: false }), 0, 0.715, -f.d / 2 + 0.01);
      strip.castShadow = false;
      g.add(strip);
      // wide monitor (the screen itself is dynamic)
      rbox(g, 0.05, 0.22, 0.05, '#0e0f14', 0, 0.86, 0.2, 0.01);
      rbox(g, 0.26, 0.015, 0.18, '#0e0f14', 0, 0.75, 0.2, 0.006);
      rbox(g, 0.78, 0.44, 0.035, '#0b0c10', 0, 1.13, 0.2, 0.012);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.4), mat('#151922', { rough: 0.4 }));
      screen.position.set(0, 1.13, 0.18);
      screen.rotation.y = Math.PI;
      g.add(screen);
      dyn.monitor = screen;
      // RGB keyboard, mouse, headset
      rbox(g, 0.46, 0.02, 0.15, '#101116', 0, 0.76, -0.1, 0.006);
      const keys = mesh(rboxGeo(0.42, 0.006, 0.11, 0.002), new THREE.MeshBasicMaterial({ color: rgb, toneMapped: false, transparent: true, opacity: 0.55 }), 0, 0.773, -0.1);
      keys.castShadow = false;
      g.add(keys);
      rbox(g, 0.06, 0.025, 0.1, '#101116', 0.34, 0.765, -0.1, 0.012);
      cyl(g, 0.08, 0.08, 0.04, '#1b1c24', -0.42, 0.78, 0.12, 14);
      // tower with a glowing side
      rbox(g, 0.2, 0.44, 0.42, '#0e0f14', f.w / 2 - 0.16, 0.22, 0.05, 0.02);
      const glow = mesh(rboxGeo(0.01, 0.34, 0.32, 0.004), new THREE.MeshBasicMaterial({ color: rgb, toneMapped: false, transparent: true, opacity: 0.7 }), f.w / 2 - 0.27, 0.24, 0.05);
      glow.castShadow = false;
      g.add(glow);
      break;
    }
    case 'snackBar': {
      rbox(g, f.w, 0.95, f.d, '#1d2030', 0, 0.475, 0, 0.03);
      rbox(g, f.w + 0.08, 0.05, f.d + 0.08, '#2b2f45', 0, 0.975, 0, 0.015);
      const led = mesh(rboxGeo(f.w, 0.03, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: '#2de2e6', toneMapped: false }), 0, 0.9, f.d / 2 + 0.02);
      led.castShadow = false;
      g.add(led);
      // cup noodles + cans
      for (let i = 0; i < 6; i++) {
        const x = -f.w / 2 + 0.3 + i * 0.4;
        cyl(g, 0.055, 0.045, 0.11, i % 2 ? '#f2c14e' : '#e5566b', x, 1.055, 0.1, 14);
        cyl(g, 0.057, 0.057, 0.012, '#f4f1ea', x, 1.115, 0.1, 14);
        cyl(g, 0.03, 0.03, 0.12, ['#3b6fb6', '#e5566b', '#3f7d4e'][i % 3], x + 0.16, 1.06, -0.15, 10);
      }
      break;
    }
    case 'gameScreen': {
      rbox(g, f.w, 3.1, 0.12, '#0b0c10', 0, 1.85, -0.04, 0.03);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'karaScreen': {
      // LED wall: black bezel with neon edges; the picture itself is dynamic (placed by OfficeScene)
      rbox(g, f.w, f.h ?? 2.9, 0.12, '#07070b', 0, KARA_SCREEN.y, -0.04, 0.03);
      const neon = (c: string) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
      const hw = (f.w + 0.04) / 2;
      const hh = (f.h ?? 2.9) / 2;
      g.add(mesh(rboxGeo(f.w + 0.08, 0.035, 0.05, 0.01), neon('#ff3ea5'), 0, KARA_SCREEN.y + hh, 0.03));
      g.add(mesh(rboxGeo(f.w + 0.08, 0.035, 0.05, 0.01), neon('#2de2e6'), 0, KARA_SCREEN.y - hh, 0.03));
      for (const sx of [-1, 1]) g.add(mesh(rboxGeo(0.035, hh * 2, 0.05, 0.01), neon(sx < 0 ? '#ff3ea5' : '#2de2e6'), sx * hw, KARA_SCREEN.y, 0.03));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'stage': {
      const h = f.h ?? 0.26;
      rbox(g, f.w, h - 0.02, f.d, '#1b1424', 0, (h - 0.02) / 2, 0, 0.02);
      rbox(g, f.w - 0.04, 0.02, f.d - 0.04, mat('#120d19', { rough: 0.25, metal: 0.2 }), 0, h - 0.01, 0, 0.005);
      // step in front
      rbox(g, 3.2, h / 2, 0.36, '#1b1424', 0, h / 4, f.d / 2 + 0.18, 0.01);
      break;
    }
    case 'micStand': {
      cyl(g, 0.13, 0.15, 0.025, '#1a1a20', 0, 0.0125, 0, 20);
      cyl(g, 0.012, 0.012, 1.42, '#2a2a33', 0, 0.72, 0, 8);
      const boom = mesh(cylGeo(0.01, 0.01, 0.3, 8), mat('#2a2a33'), 0, 1.45, 0.12);
      boom.rotation.x = Math.PI / 2.6;
      g.add(boom);
      const handle = mesh(cylGeo(0.016, 0.012, 0.16, 12), mat('#16161a', { rough: 0.4 }), 0, 1.5, 0.26);
      handle.rotation.x = -0.9;
      g.add(handle);
      g.add(mesh(sphGeo(0.03, 1), mat('#c9ced6', { metal: 0.7, rough: 0.3 }), 0, 1.56, 0.31));
      break;
    }
    case 'wedge': {
      // floor monitor, tilted up toward the singer (front = local +z)
      const box = mesh(rboxGeo(f.w, 0.26, 0.36, 0.03), mat('#16161b'), 0, 0.16, 0);
      box.rotation.x = -0.55;
      g.add(box);
      const grill = mesh(new THREE.PlaneGeometry(f.w - 0.12, 0.18), mat('#33333d', { rough: 0.7 }), 0, 0.256, 0.158);
      grill.rotation.x = -0.55;
      g.add(grill);
      break;
    }
    case 'songConsole': {
      rbox(g, 0.5, 1.0, 0.34, '#1b1424', 0, 0.5, 0, 0.04);
      const tex = canvasTexture(256, 180, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, w, h);
        gr.addColorStop(0, '#3b1a5c');
        gr.addColorStop(1, '#0c2a44');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
        c.textAlign = 'center';
        c.font = '800 46px "Be Vietnam Pro", sans-serif';
        c.fillStyle = '#ff7ac4';
        c.fillText('🎤', w / 2, 74);
        c.font = '800 28px "Be Vietnam Pro", sans-serif';
        c.fillStyle = '#ffffff';
        c.fillText('CHỌN BÀI', w / 2, 128);
        c.font = '500 18px "Be Vietnam Pro", sans-serif';
        c.fillStyle = '#9fe8ff';
        c.fillText('chạm để mở', w / 2, 160);
      });
      const screen = mesh(new THREE.PlaneGeometry(0.46, 0.32), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 1.06, 0.06);
      screen.rotation.x = -0.6;
      g.add(screen);
      rbox(g, 0.5, 0.04, 0.4, '#2a2035', 0, 1.0, 0.02, 0.01);
      break;
    }
    case 'firePit': {
      // ring of stones, ash bed and crossed logs (the flames are animated by WolfFx)
      g.add(mesh(cylGeo(0.62, 0.66, 0.05, 24), mat('#2a2522', { rough: 1 }), 0, 0.025, 0));
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + r() * 0.2;
        sph(g, 0.15 + r() * 0.05, ['#6f6a66', '#807a74', '#5d5955'][i % 3], Math.sin(a) * 0.68, 0.1, Math.cos(a) * 0.68, 1.2, 0.75, 1);
      }
      for (let i = 0; i < 4; i++) {
        const lg = mesh(cylGeo(0.06, 0.07, 0.9, 10), mat('#5a3a22', { rough: 0.95 }), 0, 0.12 + (i % 2) * 0.05, 0);
        lg.rotation.set(Math.PI / 2 - 0.25, (i / 4) * Math.PI, 0);
        g.add(lg);
      }
      break;
    }
    case 'log': {
      const lg = mesh(cylGeo(0.24, 0.24, f.w, 14), mat('#6b4a2e', { rough: 0.95 }), 0, 0.24, 0);
      lg.rotation.z = Math.PI / 2;
      g.add(lg);
      for (const sx of [-1, 1]) {
        const end = mesh(cylGeo(0.2, 0.2, 0.02, 14), mat('#c49a6c', { rough: 0.9 }), sx * (f.w / 2 + 0.005), 0.24, 0);
        end.rotation.z = Math.PI / 2;
        g.add(end);
      }
      break;
    }
    case 'pine': {
      const k = f.h ?? 1;
      cyl(g, 0.08 * k, 0.12 * k, 0.6 * k, '#5a3d27', 0, 0.3 * k, 0, 8);
      const greens = ['#2f5a3c', '#376b45', '#2b5236'];
      for (let i = 0; i < 3; i++) {
        const cone = mesh(new THREE.ConeGeometry((0.85 - i * 0.2) * k, (1.0 - i * 0.12) * k, 9), mat(greens[i], { rough: 0.95 }), 0, (0.85 + i * 0.6) * k, 0);
        cone.rotation.y = r() * 3;
        g.add(cone);
      }
      break;
    }
    case 'lantern': {
      cyl(g, 0.03, 0.04, 1.3, '#3a2a1c', 0, 0.65, 0, 8);
      rbox(g, 0.26, 0.04, 0.26, '#2a1f16', 0, 1.32, 0, 0.01);
      g.add(mesh(rboxGeo(0.2, 0.26, 0.2, 0.02), new THREE.MeshBasicMaterial({ color: '#ffb35c', toneMapped: false }), 0, 1.47, 0));
      rbox(g, 0.28, 0.05, 0.28, '#2a1f16', 0, 1.63, 0, 0.01);
      break;
    }
    case 'moonWindow': {
      const tex = canvasTexture(512, 512, (c, w, h) => {
        const gr = c.createRadialGradient(w * 0.62, h * 0.38, 10, w / 2, h / 2, w * 0.7);
        gr.addColorStop(0, '#2a3f7a');
        gr.addColorStop(1, '#070b1c');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 70; i++) {
          c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
          c.fillRect(r() * w, r() * h, 2, 2);
        }
        c.shadowColor = '#fff6d8';
        c.shadowBlur = 60;
        c.fillStyle = '#fff3c9';
        c.beginPath();
        c.arc(w * 0.6, h * 0.4, 92, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
        c.fillStyle = 'rgba(200,190,160,0.35)';
        for (const [x, y, rr] of [[0.56, 0.36, 18], [0.64, 0.45, 12], [0.6, 0.32, 9]] as const) {
          c.beginPath();
          c.arc(w * x, h * y, rr, 0, Math.PI * 2);
          c.fill();
        }
        // pine silhouettes
        c.fillStyle = '#04060f';
        for (let i = 0; i < 9; i++) {
          const x = i * 64 - 10;
          const th = 120 + ((i * 53) % 90);
          c.beginPath();
          c.moveTo(x, h);
          c.lineTo(x + 32, h - th);
          c.lineTo(x + 64, h);
          c.fill();
        }
      });
      const R = f.w / 2;
      const glass = mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 1.75, 0.11);
      glass.castShadow = false;
      g.add(glass);
      const ring = mesh(new THREE.TorusGeometry(R, 0.08, 8, 40), mat('#4a3322', { rough: 0.8 }), 0, 1.75, 0.11);
      g.add(ring);
      for (const a of [0, Math.PI / 2]) {
        const bar = mesh(rboxGeo(R * 2, 0.04, 0.04, 0.01), mat('#4a3322'), 0, 1.75, 0.12);
        bar.rotation.z = a;
        g.add(bar);
      }
      break;
    }
    case 'wolfBoard': {
      rbox(g, f.w + 0.2, (f.h ?? 2) + 0.2, 0.1, '#4a3322', 0, 1.75, -0.03, 0.03);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h ?? 2), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, 1.75, 0.03);
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'serverRack': {
      rbox(g, f.w, 2.1, f.d, '#1d2230', 0, 1.05, 0, 0.02);
      const leds = new THREE.MeshBasicMaterial({ color: '#39ff88', toneMapped: false });
      const leds2 = new THREE.MeshBasicMaterial({ color: '#2de2e6', toneMapped: false });
      for (let i = 0; i < 9; i++) {
        rbox(g, f.w - 0.08, 0.16, 0.02, '#2b3244', 0, 0.25 + i * 0.2, f.d / 2 + 0.005, 0.005);
        const led = mesh(rboxGeo(0.03, 0.03, 0.01, 0.005), i % 3 ? leds : leds2, -f.w / 2 + 0.12 + r() * 0.1, 0.25 + i * 0.2, f.d / 2 + 0.02);
        led.castShadow = false;
        g.add(led);
      }
      break;
    }
    case 'printer': {
      rbox(g, f.w, 0.7, f.d, '#e9eaee', 0, 0.35, 0, 0.04);
      rbox(g, f.w * 0.8, 0.06, f.d * 0.5, '#cfd3da', 0, 0.73, -0.05, 0.02);
      rbox(g, 0.5, 0.02, 0.3, '#ffffff', 0, 0.77, 0.12, 0.005);
      g.add(mesh(rboxGeo(0.14, 0.05, 0.02, 0.005), new THREE.MeshBasicMaterial({ color: '#39ff88', toneMapped: false }), f.w / 2 - 0.12, 0.62, f.d / 2 + 0.005));
      break;
    }
    case 'filing': {
      rbox(g, f.w, 1.3, f.d, '#8a96a8', 0, 0.65, 0, 0.02);
      for (let i = 0; i < 4; i++) {
        rbox(g, f.w - 0.08, 0.27, 0.02, '#9fabbd', 0, 0.2 + i * 0.3, f.d / 2 + 0.005, 0.01);
        rbox(g, 0.18, 0.03, 0.03, '#d9dde4', 0, 0.26 + i * 0.3, f.d / 2 + 0.02, 0.01);
      }
      break;
    }
    case 'fuseBox': {
      rbox(g, f.w, 1.0, 0.14, '#5d6676', 0, 1.4, -0.05, 0.02);
      rbox(g, f.w - 0.1, 0.9, 0.02, '#7f8899', 0, 1.4, 0.03, 0.01);
      g.add(mesh(rboxGeo(0.24, 0.24, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: '#ffd23f', toneMapped: false }), 0, 1.72, 0.045));
      break;
    }
    case 'terminal': {
      cyl(g, 0.05, 0.08, 1.0, '#3a4152', 0, 0.5, 0, 10);
      const head = mesh(rboxGeo(f.w, 0.55, 0.12, 0.03), mat('#20242f'), 0, 1.15, 0);
      head.rotation.x = -0.35;
      g.add(head);
      const scr = mesh(new THREE.PlaneGeometry(f.w - 0.1, 0.45), new THREE.MeshBasicMaterial({ color: f.id.startsWith('crit') ? '#ff3e5a' : '#2de2e6', toneMapped: false, transparent: true, opacity: 0.85 }), 0, 1.16, 0.065);
      scr.rotation.x = -0.35;
      scr.castShadow = false;
      g.add(scr);
      break;
    }
    case 'moleTable': {
      const R = f.w / 2;
      g.add(mesh(cylGeo(R, R, 0.06, 40), mat('#3b4458', { rough: 0.4 }), 0, 0.76, 0));
      g.add(mesh(cylGeo(0.3, 0.45, 0.72, 20), mat('#2a3040'), 0, 0.36, 0));
      // the emergency bell
      g.add(mesh(cylGeo(0.26, 0.3, 0.08, 24), mat('#1d2230'), 0, 0.83, 0));
      const dome = mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e5364b', emissive: '#7a0f1c', emissiveIntensity: 0.7, roughness: 0.3 }), 0, 0.87, 0);
      g.add(dome);
      break;
    }
    case 'moleBoard': {
      rbox(g, f.w + 0.16, 1.9, 0.08, '#151a26', 0, 1.7, -0.02, 0.02);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(f.w, 1.75), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, 1.7, 0.03);
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'riser': {
      const h = f.h ?? 0.4;
      rbox(g, f.w, h, f.d, '#2e2638', 0, h / 2, 0, 0.02);
      break;
    }
    case 'stripLight': {
      const strip = mesh(rboxGeo(f.w, 0.02, f.d, 0.01), new THREE.MeshBasicMaterial({ color: '#ffb36b', toneMapped: false }), 0, 0.012, 0);
      strip.castShadow = false;
      g.add(strip);
      break;
    }
    case 'arcade': {
      rbox(g, 0.72, 1.75, 0.7, '#5a4fcf', 0, 0.875, 0, 0.05);
      rbox(g, 0.6, 0.06, 0.25, '#2b2f36', 0, 1.05, 0.38, 0.02);
      cyl(g, 0.015, 0.015, 0.09, C.dark, -0.12, 1.12, 0.4, 8);
      sph(g, 0.03, '#e5566b', -0.12, 1.17, 0.4);
      sph(g, 0.025, '#f2c14e', 0.08, 1.09, 0.4);
      sph(g, 0.025, '#5fa8a0', 0.16, 1.09, 0.42);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.42), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, 1.38, 0.355);
      screen.rotation.x = -0.12;
      g.add(screen);
      dyn.screen = screen;
      break;
    }
  }
  g.position.set(f.x, f.y ?? 0, f.z);
  g.rotation.y = f.ry;
  return g;
}

/** Tree-stump seat round the camp fire. */
function stump(i: number): THREE.Group {
  const g = new THREE.Group();
  const bark = ['#6b4a2e', '#5e3f27', '#74512f'][i % 3];
  cyl(g, 0.24, 0.28, 0.4, bark, 0, 0.2, 0, 12);
  cyl(g, 0.235, 0.235, 0.02, '#c9a274', 0, 0.405, 0, 14);
  cyl(g, 0.12, 0.12, 0.022, '#a88158', 0, 0.408, 0, 12);
  return g;
}

export function tree(seed: string, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const r = rngFrom(seed);
  cyl(g, 0.12, 0.18, 1.6, '#9b7653', 0, 0.8, 0, 10);
  const greens = ['#8cc084', '#a7cf8f', '#79b07a'];
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    sph(g, 0.8 + r() * 0.4, greens[i % 3], Math.cos(a) * 0.45, 2.1 + r() * 0.9, Math.sin(a) * 0.45);
  }
  g.scale.setScalar(scale);
  return g;
}
