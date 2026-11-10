// Floor 7's wedding hall pieces: a champagne / blush / gold palette, built like the rest of the
// procedural furniture (origin on the floor at the piece's centre, front = local +z). Everything
// here is merged per material with the rest of the floor, so the palette is kept small and the
// fine detail (roses on the flower walls, petals on the carpet, the photo backdrop) lives in canvas
// textures rather than in thousands of meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Furniture } from '../../shared/map';
import { WED_SCREEN } from '../../shared/wedding';
import { cylGeo, mesh, rboxGeo, rngFrom, sphGeo, type Dynamic } from './furniture';
import { C, canvasTexture, mat } from './materials';

const PI = Math.PI;

// ------------------------------------------------------------------ palette (shared instances)
const P = {
  get ivory() { return mat('#fbf6ee', { rough: 0.85 }); },
  get white() { return mat('#ffffff', { rough: 0.9 }); },
  get blush() { return mat('#f2c4cc', { rough: 0.85 }); },
  get rose() { return mat('#e79aa8', { rough: 0.8 }); },
  get deep() { return mat('#c75b73', { rough: 0.75 }); },
  get gold() { return mat('#d8b26e', { metal: 0.7, rough: 0.3 }); },
  get green() { return mat('#7fa37a', { rough: 0.85 }); },
  get green2() { return mat('#5f8a63', { rough: 0.85 }); },
  get crystal() { return mat('#eef6ff', { rough: 0.05, metal: 0.2, opacity: 0.5 }); },
  get tulle() { return mat('#ffffff', { rough: 0.9, opacity: 0.45 }); },
  get glossy() { return mat('#fbf7f0', { rough: 0.18 }); },
  get mirror() { return mat('#dfe7ef', { rough: 0.05, metal: 0.95 }); },
  get navy() { return mat('#232d45', { rough: 0.7 }); },
  get dark() { return mat(C.dark); },
  get lacquer() { return mat('#a51d2a', { rough: 0.25 }); },
  get bottle() { return mat('#2c4a33', { rough: 0.2 }); },
};
let bulbMat: THREE.MeshBasicMaterial | null = null;
/** Warm candle / bulb glow (unlit, like the other emissive bits in the building). */
const bulb = () => (bulbMat ??= new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false }));
let edgeMat: THREE.MeshBasicMaterial | null = null;
const warmEdge = () => (edgeMat ??= new THREE.MeshBasicMaterial({ color: '#ffe6b5', toneMapped: false }));
let darkBackMat: THREE.MeshStandardMaterial | null = null;
const screenBack = () => (darkBackMat ??= mat('#0d0b10', { rough: 0.6 }));

// ------------------------------------------------------------------ small helpers
function part(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = mesh(geo, m, x, y, z);
  g.add(o);
  return o;
}
/** Plain box (tiny radius → 12 triangles). */
const bx = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => part(g, rboxGeo(w, h, d, 0.004), m, x, y, z);
const cy = (g: THREE.Object3D, rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 16) => part(g, cylGeo(rt, rb, h, seg), m, x, y, z);
function ball(g: THREE.Object3D, r: number, m: THREE.Material, x: number, y: number, z: number, detail = 1, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const o = part(g, sphGeo(r, detail), m, x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
const openCyl = (rt: number, rb: number, h: number, seg: number) => cached(`oc|${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, true));
const torus = (R: number, r: number, rs: number, ts: number, arc = PI * 2) => cached(`to|${R}|${r}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
function tube(key: string, pts: THREE.Vector3[], r: number, segs: number, radial: number): THREE.BufferGeometry {
  return cached(`tu|${key}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, radial, false));
}
/** A plane whose UVs repeat the texture `ru` × `rv` times (for wrapping textures). */
function plane(w: number, h: number, ru = 1, rv = 1): THREE.BufferGeometry {
  return cached(`pl|${w}|${h}|${ru}|${rv}`, () => {
    const p = new THREE.PlaneGeometry(w, h);
    const uv = p.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
    return p;
  });
}

const BLOOMS = () => [P.white, P.ivory, P.blush, P.blush, P.rose, P.deep];
/** One rose: a slightly flattened bloom, turned at random so the facets don't line up. */
function rose(g: THREE.Object3D, rnd: () => number, r: number, m: THREE.Material, x: number, y: number, z: number, detail = 1) {
  const o = ball(g, r, m, x, y, z, detail, 1, 0.8, 1);
  o.rotation.set(rnd() * PI, rnd() * PI, rnd() * PI);
}
function leaf(g: THREE.Object3D, rnd: () => number, s: number, x: number, y: number, z: number) {
  const o = ball(g, s, rnd() > 0.5 ? P.green : P.green2, x, y, z, 0, 1, 0.28, 0.5);
  o.rotation.set(rnd() * 0.8 - 0.4, rnd() * PI * 2, rnd() * 0.9 - 0.45);
}
/** A loose cluster of roses (+ greenery) inside an ellipsoid. */
function cluster(g: THREE.Object3D, rnd: () => number, cx: number, cy0: number, cz: number, ex: number, ey: number, ez: number, n: number, rMin = 0.055, rMax = 0.1, detail = 1) {
  const cols = BLOOMS();
  for (let i = 0; i < n; i++) {
    const a = rnd() * PI * 2;
    const b = Math.acos(2 * rnd() - 1);
    const k = Math.cbrt(rnd());
    rose(g, rnd, rMin + rnd() * (rMax - rMin), cols[Math.floor(rnd() * cols.length)], cx + Math.sin(b) * Math.cos(a) * ex * k, cy0 + Math.cos(b) * ey * k, cz + Math.abs(Math.sin(b) * Math.sin(a)) * ez * k, detail);
  }
  for (let i = 0; i < Math.ceil(n * 0.45); i++) {
    const a = rnd() * PI * 2;
    leaf(g, rnd, 0.06 + rnd() * 0.04, cx + Math.cos(a) * ex * 1.05, cy0 + (rnd() - 0.5) * ey * 2, cz + Math.abs(Math.sin(a)) * ez * 0.6);
  }
}

function seeded(n: number) {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------ textures (made once, on first use)
let roseTex: THREE.CanvasTexture | null = null;
/** A wall of roses, packed edge to edge. */
function roseWall(): THREE.CanvasTexture {
  return (roseTex ??= canvasTexture(640, 512, (g, w, h) => {
    const rnd = seeded(7);
    g.fillStyle = '#f3dedd';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      g.save();
      g.translate(rnd() * w, rnd() * h);
      g.rotate(rnd() * PI * 2);
      g.fillStyle = rnd() > 0.5 ? '#7fa37a' : '#5f8a63';
      g.beginPath();
      g.ellipse(0, 0, 15, 6, 0, 0, PI * 2);
      g.fill();
      g.restore();
    }
    const cols = [
      ['#ffffff', '#eadbd2'],
      ['#fcefe9', '#e6c3bd'],
      ['#f7cdd4', '#d98c9b'],
      ['#efa9b6', '#c45b72'],
      ['#fde7d8', '#e7b496'],
      ['#fbf6ee', '#e3d2bf'],
    ];
    for (let y = -12, row = 0; y < h + 30; y += 31, row++) {
      for (let x = -12 + (row % 2) * 15; x < w + 30; x += 31) {
        const r = 15 + rnd() * 7;
        const cx = x + (rnd() - 0.5) * 10;
        const cyy = y + (rnd() - 0.5) * 10;
        const [a, b] = cols[Math.floor(rnd() * cols.length)];
        const gr = g.createRadialGradient(cx, cyy, 1, cx, cyy, r);
        gr.addColorStop(0, b);
        gr.addColorStop(0.5, a);
        gr.addColorStop(0.9, a);
        gr.addColorStop(1, b);
        g.fillStyle = gr;
        g.beginPath();
        g.arc(cx, cyy, r, 0, PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(140,60,80,0.25)';
        g.lineWidth = 1.3;
        for (let k = 0; k < 4; k++) {
          const s0 = rnd() * 6;
          g.beginPath();
          g.arc(cx + (rnd() - 0.5) * 2, cyy + (rnd() - 0.5) * 2, r * (0.22 + k * 0.19), s0, s0 + 2.1 + rnd());
          g.stroke();
        }
      }
    }
  }));
}

let carpetTex: THREE.CanvasTexture | null = null;
/** White runner, gold borders, rose petals (tiles along its length). */
function carpet(): THREE.CanvasTexture {
  if (carpetTex) return carpetTex;
  carpetTex = canvasTexture(256, 1024, (g, w, h) => {
    const rnd = seeded(11);
    g.fillStyle = '#fdfaf5';
    g.fillRect(0, 0, w, h);
    // faint damask lattice
    g.strokeStyle = 'rgba(216,178,110,0.13)';
    g.lineWidth = 2;
    for (let y = -64; y < h + 64; y += 64) {
      g.beginPath();
      g.moveTo(30, y);
      g.lineTo(w / 2, y + 32);
      g.lineTo(w - 30, y);
      g.moveTo(30, y + 64);
      g.lineTo(w / 2, y + 32);
      g.lineTo(w - 30, y + 64);
      g.stroke();
    }
    g.fillStyle = '#d8b26e';
    g.fillRect(6, 0, 11, h);
    g.fillRect(w - 17, 0, 11, h);
    g.fillRect(23, 0, 3, h);
    g.fillRect(w - 26, 0, 3, h);
    const petal = (x: number, y: number, rot: number, col: string, s: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      const gr = g.createRadialGradient(-2, -1, 0, 0, 0, 10 * s);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.35, col);
      gr.addColorStop(1, col);
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, 0, 10 * s, 6 * s, 0, 0, PI * 2);
      g.fill();
      g.restore();
    };
    const cols = ['#f2a7b6', '#e57f96', '#f7cdd4', '#c75b73', '#fbe3e6'];
    for (let i = 0; i < 80; i++) {
      // denser toward the middle
      const x = w / 2 + (rnd() + rnd() + rnd() - 1.5) * (w * 0.42);
      const y = rnd() * h;
      const rot = rnd() * PI;
      const col = cols[Math.floor(rnd() * cols.length)];
      const s = 0.8 + rnd() * 0.6;
      for (const dy of [-h, 0, h]) petal(Math.max(32, Math.min(w - 32, x)), y + dy, rot, col, s);
    }
  });
  carpetTex.wrapT = THREE.RepeatWrapping;
  return carpetTex;
}

let skirtTex: THREE.CanvasTexture | null = null;
/** The stage skirt: ivory pleats, blush swags, a gold edge (tiles sideways). */
function skirt(): THREE.CanvasTexture {
  if (skirtTex) return skirtTex;
  skirtTex = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#fbf6ee';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(200,180,160,0.22)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      gr.addColorStop(1, 'rgba(200,180,160,0.22)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 16, h);
    }
    // two blush swags per tile
    for (let i = 0; i < 2; i++) {
      const x0 = i * 256;
      g.fillStyle = 'rgba(242,196,204,0.95)';
      g.beginPath();
      g.moveTo(x0, 8);
      g.quadraticCurveTo(x0 + 128, 92, x0 + 256, 8);
      g.quadraticCurveTo(x0 + 128, 52, x0, 8);
      g.fill();
      g.fillStyle = '#e79aa8';
      g.beginPath();
      g.arc(x0 + 2, 12, 9, 0, PI * 2);
      g.fill();
    }
    g.fillStyle = '#d8b26e';
    g.fillRect(0, 0, w, 7);
    g.fillRect(0, h - 5, w, 5);
  });
  skirtTex.wrapS = THREE.RepeatWrapping;
  return skirtTex;
}

let photoTex: THREE.CanvasTexture | null = null;
function photoBackdrop(): THREE.CanvasTexture {
  return (photoTex ??= canvasTexture(1024, 672, drawBackdrop));
}

/** The script font arrived after the hall was built: draw the canvases that use it again. */
export function redrawWeddingCanvases() {
  if (!photoTex) return;
  const c = photoTex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  drawBackdrop(g, c.width, c.height);
  photoTex.needsUpdate = true;
}

function drawBackdrop(g: CanvasRenderingContext2D, w: number, h: number) {
  {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#fdf6f1');
    bg.addColorStop(1, '#f3d9da');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const vg = g.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h * 0.45, w * 0.62);
    vg.addColorStop(0, 'rgba(255,255,255,0.65)');
    vg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    const gold = g.createLinearGradient(0, 0, w, h);
    gold.addColorStop(0, '#b88a3e');
    gold.addColorStop(0.45, '#f1d48f');
    gold.addColorStop(1, '#b88a3e');
    // big heart outline
    const heart = (cx: number, cyy: number, s: number) => {
      g.beginPath();
      g.moveTo(cx, cyy + s * 0.9);
      g.bezierCurveTo(cx - s * 1.5, cyy - s * 0.1, cx - s * 0.75, cyy - s * 1.15, cx, cyy - s * 0.45);
      g.bezierCurveTo(cx + s * 0.75, cyy - s * 1.15, cx + s * 1.5, cyy - s * 0.1, cx, cyy + s * 0.9);
    };
    g.strokeStyle = gold;
    g.lineWidth = 7;
    heart(w / 2, h * 0.36, 150);
    g.stroke();
    // a few small hearts and sparkles
    const rnd = seeded(5);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      if (Math.abs(x - w / 2) < 330 && y > h * 0.12 && y < h * 0.86) continue;
      g.fillStyle = rnd() > 0.5 ? 'rgba(231,154,168,0.55)' : 'rgba(216,178,110,0.6)';
      heart(x, y, 8 + rnd() * 10);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = gold;
    g.font = 'italic 400 132px "Great Vibes", "Allura", "Segoe Script", "Brush Script MT", "Playfair Display", Georgia, cursive';
    g.fillText('Just Married', w / 2, h * 0.6);
    g.font = '600 44px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#b06e79';
    g.fillText('Hạnh phúc trăm năm', w / 2, h * 0.76);
    g.fillStyle = gold;
    g.fillRect(w / 2 - 170, h * 0.835, 340, 3);
  }
}

let hyTex: THREE.CanvasTexture | null = null;
/** Red lacquer with a gold 囍 (double happiness). */
function songHy(): THREE.CanvasTexture {
  return (hyTex ??= canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#a51d2a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e6c27a';
    g.lineWidth = 6;
    g.strokeRect(12, 12, w - 24, h - 24);
    g.lineWidth = 2;
    g.strokeRect(24, 24, w - 48, h - 48);
    const gold = g.createLinearGradient(0, 40, 0, 220);
    gold.addColorStop(0, '#f6dc9a');
    gold.addColorStop(1, '#c9953f');
    g.fillStyle = gold;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 168px "Noto Serif CJK SC", "Noto Sans CJK SC", "Source Han Serif SC", "PingFang SC", "Microsoft YaHei", "SimSun", serif';
    g.fillText('囍', w / 2, h / 2 + 6);
  }));
}

let plateTex: THREE.CanvasTexture | null = null;
/** The MC lectern's front: a gold monogram. */
function podiumPlate(): THREE.CanvasTexture {
  return (plateTex ??= canvasTexture(256, 340, (g, w, h) => {
    g.fillStyle = '#fbf6ee';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8b26e';
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.lineWidth = 2;
    g.strokeRect(22, 22, w - 44, h - 44);
    g.fillStyle = '#e79aa8';
    g.beginPath();
    const cx = w / 2;
    const cyy = 120;
    const s = 34;
    g.moveTo(cx, cyy + s * 0.9);
    g.bezierCurveTo(cx - s * 1.5, cyy - s * 0.1, cx - s * 0.75, cyy - s * 1.15, cx, cyy - s * 0.45);
    g.bezierCurveTo(cx + s * 0.75, cyy - s * 1.15, cx + s * 1.5, cyy - s * 0.1, cx, cyy + s * 0.9);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#b88a3e';
    g.font = 'italic 400 52px "Great Vibes", "Segoe Script", "Playfair Display", Georgia, cursive';
    g.fillText('Mr & Mrs', cx, 222);
    g.font = '600 20px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#b06e79';
    g.fillText('TRĂM NĂM HẠNH PHÚC', cx, 268);
  }));
}

/** Bake a little assembly into one mesh per material (and keep it out of the shadow pass). */
function mergeLocal(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(m.matrixWorld);
    const material = m.material as THREE.Material;
    let list = buckets.get(material);
    if (!list) buckets.set(material, (list = []));
    list.push(geo);
  });
  const out = new THREE.Group();
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((q) => q.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.noShadow = true;
    out.add(m);
  }
  return out;
}

// ------------------------------------------------------------------ exported data for the FX
/** Coupe glasses on the champagne table (local coords: bowl centre + rim radius), bottom tier first, top glass last. */
export const CHAMPAGNE_GLASSES: { x: number; y: number; z: number; r: number }[] = [];
const COUPE = { r: 0.056, bowl: 0.035, stem: 0.07, foot: 0.006, step: 0.118, base: 0.78 };
for (let k = 0; k < 4; k++) {
  const n = 4 - k;
  const by = COUPE.base + k * (COUPE.foot + COUPE.stem + COUPE.bowl);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      CHAMPAGNE_GLASSES.push({ x: (i - (n - 1) / 2) * COUPE.step, y: by + COUPE.foot + COUPE.stem + COUPE.bowl / 2, z: (j - (n - 1) / 2) * COUPE.step, r: COUPE.r });
    }
  }
}
const CAKE_TIERS = [
  { r: 0.3, h: 0.2 },
  { r: 0.245, h: 0.19 },
  { r: 0.195, h: 0.17 },
  { r: 0.15, h: 0.155 },
  { r: 0.105, h: 0.14 },
];
const CAKE_BASE_Y = 0.825;
/** Height of the top of the wedding cake (above the floor). */
export const CAKE_TOP_Y = CAKE_BASE_Y + CAKE_TIERS.reduce((s, t) => s + t.h, 0);

// ------------------------------------------------------------------ the banquet chair
/** Gold Chiavari chair, ivory cushion, a blush chiffon sash tied in a bow at the back. */
export function banquetChair(): THREE.Group {
  const g = new THREE.Group();
  const gold = P.gold;
  for (const sx of [-1, 1]) {
    cy(g, 0.013, 0.012, 0.44, gold, sx * 0.19, 0.22, 0.17, 6); // front legs
    cy(g, 0.013, 0.012, 0.94, gold, sx * 0.18, 0.47, -0.18, 6); // back legs → back posts
  }
  bx(g, 0.42, 0.03, 0.4, gold, 0, 0.44, 0);
  bx(g, 0.4, 0.05, 0.38, P.ivory, 0, 0.48, 0.005);
  for (const y of [0.62, 0.71, 0.8, 0.92]) bx(g, 0.36, 0.018, 0.018, gold, 0, y, -0.18);
  // sash round the back with a bow
  bx(g, 0.42, 0.13, 0.03, P.blush, 0, 0.76, -0.2);
  for (const sx of [-1, 1]) {
    const loop = ball(g, 0.06, P.blush, sx * 0.065, 0.77, -0.225, 0, 1, 0.55, 0.35);
    loop.rotation.z = sx * 0.35;
    const tail = bx(g, 0.04, 0.28, 0.01, P.blush, sx * 0.04, 0.58, -0.22);
    tail.rotation.z = sx * 0.18;
  }
  ball(g, 0.025, P.rose, 0, 0.77, -0.23, 0);
  return g;
}

// ------------------------------------------------------------------ the pieces
export function buildWeddingPiece(f: Furniture, g: THREE.Group, dyn: Dynamic): void {
  const rnd = rngFrom(f.id);
  switch (f.kind) {
    case 'wedStage': {
      const h = f.h ?? 0.28;
      const body = h - 0.03;
      bx(g, f.w, body, f.d, P.ivory, 0, body / 2, 0);
      bx(g, f.w, 0.03, f.d, P.glossy, 0, h - 0.015, 0);
      bx(g, f.w + 0.02, 0.025, 0.025, P.gold, 0, h - 0.0125, f.d / 2 + 0.005);
      for (const sx of [-1, 1]) bx(g, 0.025, 0.025, f.d, P.gold, sx * (f.w / 2 + 0.005), h - 0.0125, 0);
      const skirtMat = mat('#ffffff', { map: skirt(), rough: 0.9 });
      part(g, plane(f.w, body, f.w / 2), skirtMat, 0, body / 2, f.d / 2 + 0.004);
      for (const sx of [-1, 1]) {
        const side = part(g, plane(f.d, body, f.d / 2), skirtMat, sx * (f.w / 2 + 0.004), body / 2, 0);
        side.rotation.y = (sx * PI) / 2;
      }
      // a wide half-height step at the front centre
      const sw = 3.0;
      const sd = 0.36;
      const sh = h / 2;
      bx(g, sw, sh - 0.02, sd, P.ivory, 0, (sh - 0.02) / 2, f.d / 2 + sd / 2);
      bx(g, sw, 0.02, sd, P.glossy, 0, sh - 0.01, f.d / 2 + sd / 2);
      bx(g, sw + 0.02, 0.02, 0.02, P.gold, 0, sh - 0.01, f.d / 2 + sd + 0.004);
      part(g, plane(sw, sh - 0.02, sw / 2), skirtMat, 0, (sh - 0.02) / 2, f.d / 2 + sd + 0.004);
      break;
    }
    case 'wedScreen': {
      // the LED wall's bezel: dark back, champagne-gold frame, a thin warm edge light
      const sw = WED_SCREEN.w;
      const sh = WED_SCREEN.h;
      const y = WED_SCREEN.y;
      bx(g, sw + 0.16, sh + 0.12, 0.1, screenBack(), 0, y, -0.03);
      for (const sy of [-1, 1]) bx(g, sw + 0.2, 0.055, 0.06, P.gold, 0, y + sy * (sh / 2 + 0.035), 0.02);
      for (const sx of [-1, 1]) bx(g, 0.055, sh + 0.125, 0.06, P.gold, sx * (sw / 2 + 0.07), y, 0.02);
      for (const sy of [-1, 1]) bx(g, sw + 0.06, 0.012, 0.012, warmEdge(), 0, y + sy * (sh / 2 + 0.008), 0.05);
      for (const sx of [-1, 1]) bx(g, 0.012, sh + 0.03, 0.012, warmEdge(), sx * (sw / 2 + 0.03), y, 0.05);
      // roses spilling over two corners of the frame
      cluster(g, rnd, -sw / 2 - 0.05, y + sh / 2 - 0.05, 0.08, 0.32, 0.2, 0.08, 10, 0.05, 0.085);
      cluster(g, rnd, sw / 2 + 0.05, y - sh / 2 + 0.08, 0.08, 0.3, 0.18, 0.08, 9, 0.05, 0.085);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, y, 0.06);
      g.add(screen);
      dyn.screen = screen;
      break;
    }
    case 'flowerWall': {
      const W = f.w;
      const H = 2.6;
      for (const sx of [-1, 1]) cy(g, 0.03, 0.03, H, P.gold, sx * (W / 2 - 0.03), H / 2, 0, 10);
      bx(g, W, 0.05, 0.05, P.gold, 0, H - 0.025, 0);
      bx(g, W, 0.05, 0.05, P.gold, 0, 0.025, 0);
      bx(g, W - 0.08, H - 0.1, 0.06, P.blush, 0, H / 2, -0.06);
      part(g, plane(W - 0.1, H - 0.12), mat('#ffffff', { map: roseWall(), rough: 0.9 }), 0, H / 2, -0.027);
      // 3D blooms over the printed ones, thicker toward the corners
      const cols = BLOOMS();
      for (let i = 0; i < 34; i++) {
        const corner = i < 14;
        const x = corner ? (i % 2 ? 1 : -1) * (W / 2 - 0.2 - rnd() * 0.6) : (rnd() - 0.5) * (W - 0.3);
        const y = corner ? (i % 2 ? 0.2 + rnd() * 0.7 : H - 0.2 - rnd() * 0.7) : 0.2 + rnd() * (H - 0.4);
        rose(g, rnd, 0.055 + rnd() * 0.05, cols[Math.floor(rnd() * cols.length)], x, y, 0.0 + rnd() * 0.07);
      }
      for (let i = 0; i < 14; i++) leaf(g, rnd, 0.07, (rnd() - 0.5) * (W - 0.2), 0.15 + rnd() * (H - 0.3), 0.03);
      break;
    }
    case 'flowerArch': {
      const half = f.w / 2 - 0.1;
      const postH = 1.85;
      const rise = half * 0.45;
      const at = (t: number, z = 0) => new THREE.Vector3(Math.cos(t) * half, postH + Math.sin(t) * rise, z);
      const arcPts = Array.from({ length: 13 }, (_, i) => at((i / 12) * PI));
      const arc = tube(`arch|${f.w}`, arcPts, 0.03, 30, 6);
      for (const zz of [-0.16, 0.16]) {
        part(g, arc, P.gold, 0, 0, zz);
        for (const sx of [-1, 1]) {
          cy(g, 0.032, 0.032, postH, P.gold, sx * half, postH / 2, zz, 10);
          cy(g, 0.07, 0.08, 0.04, P.gold, sx * half, 0.02, zz, 12);
        }
      }
      // cross rods tying the two arches together
      for (const t of [0.15, 0.5, 0.85].map((k) => k * PI)) {
        const p = at(t);
        const rod = cy(g, 0.012, 0.012, 0.32, P.gold, p.x, p.y, 0, 6);
        rod.rotation.x = PI / 2;
      }
      // a chiffon swag across the front and tails down the posts
      const swag = tube(`swag|${f.w}`, [at(0.82 * PI, 0.22), new THREE.Vector3(0, postH + rise * 0.35, 0.24), at(0.18 * PI, 0.22)], 0.05, 20, 6);
      part(g, swag, P.ivory);
      for (const sx of [-1, 1]) {
        const tail = bx(g, 0.16, 1.55, 0.012, P.ivory, sx * (half - 0.04), postH - 0.75, 0.22);
        tail.rotation.z = sx * 0.04;
      }
      // flowers: a lush top-left shoulder spilling down, a cluster at the right foot, one on top
      const tl = at(0.72 * PI);
      cluster(g, rnd, tl.x, tl.y, 0.05, 0.42, 0.3, 0.2, 11, 0.065, 0.115);
      cluster(g, rnd, -half, postH - 0.55, 0.05, 0.14, 0.32, 0.16, 5, 0.05, 0.08);
      cluster(g, rnd, half - 0.05, 0.25, 0.06, 0.3, 0.22, 0.2, 7, 0.065, 0.105);
      const top = at(0.42 * PI);
      cluster(g, rnd, top.x, top.y + 0.02, 0.05, 0.22, 0.12, 0.14, 5, 0.05, 0.08);
      break;
    }
    case 'aisleCarpet': {
      const tex = carpet();
      const rows = f.d / (f.w * 4); // the texture is 1:4
      const m = new THREE.Mesh(plane(f.w, f.d, 1, rows), mat('#ffffff', { map: tex, rough: 0.95 }));
      m.rotation.x = -PI / 2;
      m.position.y = 0.006;
      m.receiveShadow = true;
      g.add(m);
      break;
    }
    case 'flowerStand': {
      cy(g, 0.17, 0.19, 0.04, P.gold, 0, 0.02, 0, 20);
      cy(g, 0.06, 0.08, 0.06, P.gold, 0, 0.07, 0, 14);
      cy(g, 0.055, 0.055, 0.78, P.crystal, 0, 0.49, 0, 12);
      cy(g, 0.018, 0.018, 0.78, P.gold, 0, 0.49, 0, 6);
      for (const y of [0.24, 0.5, 0.76]) cy(g, 0.064, 0.064, 0.018, P.gold, 0, y, 0, 14);
      cy(g, 0.14, 0.05, 0.1, P.gold, 0, 0.93, 0, 16);
      ball(g, 0.16, P.blush, 0, 1.04, 0, 1);
      const cols = BLOOMS();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * PI * 2 + rnd() * 0.4;
        const up = 0.15 + rnd() * 0.85;
        const k = Math.sqrt(1 - up * up);
        rose(g, rnd, 0.065 + rnd() * 0.02, cols[i % cols.length], Math.cos(a) * k * 0.17, 1.04 + up * 0.15, Math.sin(a) * k * 0.17);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * PI * 2;
        leaf(g, rnd, 0.075, Math.cos(a) * 0.17, 0.9 - rnd() * 0.08, Math.sin(a) * 0.17);
      }
      // a little hurricane glass with a candle on the base
      cy(g, 0.04, 0.04, 0.12, P.crystal, 0.12, 0.1, 0.07, 10);
      cy(g, 0.02, 0.02, 0.05, P.white, 0.12, 0.065, 0.07, 8);
      ball(g, 0.012, bulb(), 0.12, 0.105, 0.07, 0, 1, 1.6, 1);
      break;
    }
    case 'banquetTable': {
      const R = f.w / 2;
      cy(g, R + 0.02, R + 0.07, 0.745, P.white, 0, 0.3725, 0, 32);
      const overlay = bx(g, 1.2, 0.006, 1.2, P.blush, 0, 0.748, 0);
      overlay.rotation.y = PI / 4;
      // eight place settings (the chairs sit at angle (c + 0.5)·45°)
      for (let c = 0; c < 8; c++) {
        const a = ((c + 0.5) / 8) * PI * 2;
        const s = Math.sin(a);
        const k = Math.cos(a);
        cy(g, 0.14, 0.13, 0.012, P.gold, s * 0.66, 0.756, k * 0.66, 12);
        const napkin = bx(g, 0.08, 0.026, 0.13, P.blush, s * 0.66, 0.775, k * 0.66);
        napkin.rotation.y = a;
        const ga = a - 0.32;
        cy(g, 0.03, 0.024, 0.11, P.crystal, Math.sin(ga) * 0.62, 0.805, Math.cos(ga) * 0.62, 6);
      }
      // tall gold centrepiece with a ball of roses, candles round its foot
      cy(g, 0.12, 0.14, 0.03, P.gold, 0, 0.765, 0, 16);
      cy(g, 0.016, 0.022, 0.55, P.gold, 0, 1.05, 0, 8);
      cy(g, 0.1, 0.04, 0.06, P.gold, 0, 1.33, 0, 12);
      ball(g, 0.15, P.blush, 0, 1.43, 0, 1);
      const cols = BLOOMS();
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * PI * 2;
        const up = -0.3 + rnd() * 1.2;
        const kk = Math.sqrt(Math.max(0, 1 - Math.min(1, up * up)));
        rose(g, rnd, 0.06 + rnd() * 0.02, cols[(i + c0(f.id)) % cols.length], Math.cos(a) * kk * 0.15, 1.43 + up * 0.13, Math.sin(a) * kk * 0.15, 0);
      }
      for (let i = 0; i < 5; i++) leaf(g, rnd, 0.07, Math.cos(i * 1.3) * 0.15, 1.31, Math.sin(i * 1.3) * 0.15);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2 + 0.5;
        const x = Math.cos(a) * 0.22;
        const z = Math.sin(a) * 0.22;
        cy(g, 0.035, 0.035, 0.08, P.crystal, x, 0.79, z, 6);
        cy(g, 0.018, 0.018, 0.045, P.white, x, 0.775, z, 6);
        ball(g, 0.011, bulb(), x, 0.81, z, 0, 1, 1.5, 1);
      }
      break;
    }
    case 'chandelier': {
      // built apart and baked (one mesh per material) — it hangs in the open over the tables
      const c = new THREE.Group();
      cy(c, 0.12, 0.09, 0.04, P.gold, 0, 3.17, 0, 16);
      cy(c, 0.008, 0.008, 0.22, P.gold, 0, 3.04, 0, 6);
      part(c, torus(0.32, 0.014, 5, 28), P.gold, 0, 2.93, 0).rotation.x = PI / 2;
      part(c, torus(0.55, 0.016, 5, 36), P.gold, 0, 2.7, 0).rotation.x = PI / 2;
      cy(c, 0.045, 0.02, 0.5, P.gold, 0, 2.7, 0, 10);
      // spokes from the centre column to the big ring
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        const spoke = cy(c, 0.008, 0.008, 0.52, P.gold, Math.cos(a) * 0.27, 2.68, Math.sin(a) * 0.27, 5);
        spoke.rotation.set(0, -a, PI / 2);
      }
      // candles round the big ring
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2 + PI / 8;
        const x = Math.cos(a) * 0.55;
        const z = Math.sin(a) * 0.55;
        cy(c, 0.03, 0.018, 0.025, P.gold, x, 2.72, z, 8);
        cy(c, 0.016, 0.016, 0.09, P.white, x, 2.78, z, 6);
        ball(c, 0.022, bulb(), x, 2.845, z, 0, 0.8, 1.3, 0.8);
      }
      // crystal drops: swags under the big ring, a fringe under the small one, a centre pendant
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * PI * 2;
        const drop = ball(c, 0.03, P.crystal, Math.cos(a) * 0.53, 2.6 - (i % 2) * 0.05, Math.sin(a) * 0.53, 0, 0.7, 1.4, 0.7);
        drop.rotation.y = a;
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2 + 0.2;
        ball(c, 0.025, P.crystal, Math.cos(a) * 0.31, 2.85, Math.sin(a) * 0.31, 0, 0.7, 1.4, 0.7);
      }
      for (let i = 0; i < 3; i++) ball(c, 0.07 - i * 0.015, P.crystal, 0, 2.42 - i * 0.1, 0, 1, 1, 1.25, 1);
      ball(c, 0.035, P.gold, 0, 2.38, 0, 1);
      g.add(mergeLocal(c));
      break;
    }
    case 'weddingCake': {
      cy(g, 0.48, 0.51, 0.75, P.white, 0, 0.375, 0, 32);
      cy(g, 0.515, 0.515, 0.035, P.gold, 0, 0.05, 0, 32);
      cy(g, 0.49, 0.49, 0.012, P.blush, 0, 0.756, 0, 32);
      cy(g, 0.08, 0.13, 0.05, P.gold, 0, 0.785, 0, 16);
      cy(g, 0.34, 0.34, 0.02, P.gold, 0, 0.815, 0, 32);
      let y = CAKE_BASE_Y;
      for (const t of CAKE_TIERS) {
        cy(g, t.r, t.r, t.h, P.white, 0, y + t.h / 2, 0, 28);
        cy(g, t.r + 0.004, t.r + 0.004, 0.022, P.gold, 0, y + 0.02, 0, 28);
        y += t.h;
      }
      // a cascade of sugar roses spiralling down the front
      for (let i = 0; i < 16; i++) {
        const t = i / 15;
        const level = Math.min(CAKE_TIERS.length - 1, Math.floor((1 - t) * CAKE_TIERS.length));
        let base = CAKE_BASE_Y;
        for (let k = 0; k < level; k++) base += CAKE_TIERS[k].h;
        const tier = CAKE_TIERS[level];
        const a = 0.9 + t * 2.2;
        const rr = tier.r + 0.012;
        rose(g, rnd, 0.032 + rnd() * 0.018, [P.blush, P.rose, P.ivory, P.deep][i % 4], Math.sin(a) * rr, base + 0.04 + rnd() * (tier.h - 0.06), Math.cos(a) * rr);
        if (i % 3 === 0) leaf(g, rnd, 0.035, Math.sin(a + 0.15) * rr, base + tier.h * 0.4, Math.cos(a + 0.15) * rr);
      }
      // topper: two gold rings and a little posy
      for (const sx of [-1, 1]) {
        const ring = part(g, torus(0.034, 0.006, 6, 20), P.gold, sx * 0.022, CAKE_TOP_Y + 0.05, 0);
        ring.rotation.y = sx * 0.4;
      }
      cluster(g, rnd, 0, CAKE_TOP_Y + 0.02, 0.02, 0.06, 0.02, 0.05, 4, 0.025, 0.035);
      // the knife waiting on the cloth
      const blade = bx(g, 0.2, 0.004, 0.035, P.mirror, 0.16, 0.765, 0.4);
      blade.rotation.y = -0.4;
      const handle = bx(g, 0.1, 0.018, 0.025, P.gold, 0.02, 0.77, 0.46);
      handle.rotation.y = -0.4;
      break;
    }
    case 'champagneTable': {
      cy(g, 0.53, 0.56, 0.75, P.white, 0, 0.375, 0, 32);
      cy(g, 0.565, 0.565, 0.035, P.gold, 0, 0.05, 0, 32);
      cy(g, 0.42, 0.42, 0.02, P.gold, 0, 0.77, 0, 32);
      for (const gl of CHAMPAGNE_GLASSES) {
        const by = gl.y - COUPE.bowl / 2 - COUPE.stem - COUPE.foot;
        cy(g, 0.032, 0.035, COUPE.foot, P.crystal, gl.x, by + COUPE.foot / 2, gl.z, 10);
        cy(g, 0.005, 0.005, COUPE.stem, P.crystal, gl.x, by + COUPE.foot + COUPE.stem / 2, gl.z, 6);
        cy(g, gl.r, gl.r * 0.38, COUPE.bowl, P.crystal, gl.x, gl.y, gl.z, 12);
      }
      // an ice bucket with a second bottle, and flowers on the cloth
      cy(g, 0.075, 0.058, 0.15, P.gold, 0.4, 0.855, -0.28, 14);
      const bottle = cy(g, 0.036, 0.036, 0.2, P.bottle, 0.4, 0.95, -0.28, 10);
      bottle.rotation.z = 0.25;
      const neck = cy(g, 0.013, 0.03, 0.09, P.gold, 0.4 - Math.sin(0.25) * 0.14, 0.95 + Math.cos(0.25) * 0.14, -0.28, 8);
      neck.rotation.z = 0.25;
      cluster(g, rnd, -0.38, 0.82, 0.3, 0.12, 0.05, 0.1, 6, 0.04, 0.06);
      break;
    }
    case 'ringStand': {
      bx(g, 0.3, 0.05, 0.3, P.ivory, 0, 0.025, 0);
      bx(g, 0.31, 0.012, 0.31, P.gold, 0, 0.056, 0);
      cy(g, 0.05, 0.065, 0.8, P.ivory, 0, 0.46, 0, 16);
      cy(g, 0.07, 0.07, 0.02, P.gold, 0, 0.1, 0, 16);
      cy(g, 0.06, 0.06, 0.02, P.gold, 0, 0.82, 0, 16);
      cy(g, 0.14, 0.11, 0.03, P.gold, 0, 0.875, 0, 20);
      // open velvet ring box
      bx(g, 0.12, 0.05, 0.1, P.deep, 0, 0.915, 0.0);
      bx(g, 0.1, 0.012, 0.08, P.ivory, 0, 0.941, 0.0);
      const lid = bx(g, 0.12, 0.012, 0.1, P.deep, 0, 0.99, -0.06);
      lid.rotation.x = -1.35;
      for (const sx of [-1, 1]) part(g, torus(0.02, 0.0045, 6, 18), P.gold, sx * 0.025, 0.96, 0.0);
      ball(g, 0.008, P.crystal, -0.025, 0.983, 0.0, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        rose(g, rnd, 0.03, i % 2 ? P.blush : P.ivory, Math.cos(a) * 0.12, 0.9, Math.sin(a) * 0.12, 0);
      }
      break;
    }
    case 'mcPodium': {
      bx(g, 0.68, 0.06, 0.48, P.gold, 0, 0.03, 0);
      bx(g, 0.6, 0.98, 0.4, P.ivory, 0, 0.55, 0);
      bx(g, 0.64, 0.025, 0.44, P.gold, 0, 1.03, 0);
      part(g, plane(0.44, 0.585), mat('#ffffff', { map: podiumPlate(), rough: 0.8 }), 0, 0.58, 0.202);
      const top = bx(g, 0.68, 0.03, 0.46, P.ivory, 0, 1.07, -0.01);
      top.rotation.x = -0.22;
      // gooseneck mic leaning toward whoever speaks (behind the lectern)
      const neck = cy(g, 0.007, 0.007, 0.28, P.dark, 0.2, 1.2, -0.06, 6);
      neck.rotation.x = -0.5;
      ball(g, 0.022, P.dark, 0.2, 1.303, -0.127, 1, 1, 1.3, 1);
      cluster(g, rnd, -0.22, 1.12, 0.12, 0.12, 0.06, 0.08, 5, 0.04, 0.06);
      break;
    }
    case 'giftTable': {
      bx(g, f.w, 0.76, f.d, P.white, 0, 0.38, 0);
      bx(g, 0.5, 0.006, f.d + 0.02, P.blush, -0.35, 0.763, 0);
      bx(g, 0.5, 0.32, 0.006, P.blush, -0.35, 0.605, f.d / 2 + 0.004);
      bx(g, f.w, 0.03, 0.006, P.gold, 0, 0.05, f.d / 2 + 0.004);
      // the red lacquer gift box with a slot, gold edges and a ribbon bow
      const bxX = -0.35;
      const B = 0.4;
      const y0 = 0.766;
      bx(g, B, B, B, P.lacquer, bxX, y0 + B / 2, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(g, 0.016, B + 0.004, 0.016, P.gold, bxX + sx * B / 2, y0 + B / 2, sz * B / 2);
      bx(g, 0.2, 0.006, 0.035, P.dark, bxX, y0 + B + 0.002, -0.06);
      bx(g, B + 0.01, 0.006, 0.05, P.gold, bxX, y0 + B + 0.003, 0.06);
      for (const sx of [-1, 1]) {
        const loop = ball(g, 0.06, P.gold, bxX + sx * 0.06, y0 + B + 0.035, 0.06, 0, 1, 0.5, 0.45);
        loop.rotation.z = -sx * 0.4;
      }
      part(g, plane(0.3, 0.3), mat('#ffffff', { map: songHy(), rough: 0.3 }), bxX, y0 + B / 2, B / 2 + 0.003);
      // guest book, open, with a gold pen
      bx(g, 0.44, 0.02, 0.3, P.deep, 0.3, 0.772, 0.02);
      for (const sx of [-1, 1]) {
        const page = bx(g, 0.2, 0.014, 0.28, P.ivory, 0.3 + sx * 0.105, 0.789, 0.02);
        page.rotation.z = -sx * 0.06;
      }
      const pen = cy(g, 0.006, 0.006, 0.15, P.gold, 0.42, 0.8, 0.05, 6);
      pen.rotation.set(PI / 2, 0, 0.5);
      // a low vase of roses
      cy(g, 0.07, 0.05, 0.12, P.crystal, 0.72, 0.82, 0, 10);
      cluster(g, rnd, 0.72, 0.93, 0, 0.11, 0.07, 0.1, 7, 0.045, 0.065);
      break;
    }
    case 'wedSign': {
      // gold easel holding a framed board (the board's face is the dynamic `screen`)
      for (const sx of [-1, 1]) {
        const leg = cy(g, 0.015, 0.015, 1.8, P.gold, sx * 0.42, 0.88, 0.05, 6);
        leg.rotation.x = -0.1;
      }
      const back = cy(g, 0.015, 0.015, 1.75, P.gold, 0, 0.84, -0.2, 6);
      back.rotation.x = 0.32;
      bx(g, 1.02, 0.03, 0.09, P.gold, 0, 0.66, 0.1);
      const tilt = -0.1;
      const frame = bx(g, 1.02, 1.42, 0.04, P.gold, 0, 1.37, 0.05);
      frame.rotation.x = tilt;
      const nY = -Math.sin(tilt);
      const nZ = Math.cos(tilt);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      screen.position.set(0, 1.37 + nY * 0.023, 0.05 + nZ * 0.023);
      screen.rotation.x = tilt;
      g.add(screen);
      dyn.screen = screen;
      cluster(g, rnd, -0.45, 2.02, 0.12, 0.22, 0.14, 0.08, 9, 0.045, 0.075);
      cluster(g, rnd, 0.46, 0.76, 0.16, 0.2, 0.12, 0.08, 7, 0.045, 0.07);
      break;
    }
    case 'photoWall': {
      const W = f.w;
      const H = 2.7;
      bx(g, W, H, 0.08, P.ivory, 0, H / 2, -0.1);
      part(g, plane(W - 0.2, H - 0.2), mat('#ffffff', { map: photoBackdrop(), rough: 0.85 }), 0, H / 2, -0.057);
      for (const sy of [-1, 1]) bx(g, W + 0.04, 0.05, 0.05, P.gold, 0, H / 2 + sy * (H / 2 - 0.025), -0.05);
      for (const sx of [-1, 1]) bx(g, 0.05, H, 0.05, P.gold, sx * (W / 2 - 0.025), H / 2, -0.05);
      // flowers cascading from the top-left corner, a bank at the bottom right, a garland on top
      cluster(g, rnd, -W / 2 + 0.25, H - 0.2, 0.02, 0.45, 0.28, 0.14, 13, 0.06, 0.11);
      cluster(g, rnd, -W / 2 + 0.1, H - 0.85, 0.02, 0.12, 0.4, 0.12, 5, 0.05, 0.08);
      cluster(g, rnd, W / 2 - 0.3, 0.25, 0.04, 0.45, 0.26, 0.16, 11, 0.06, 0.11);
      for (let i = 0; i < 9; i++) {
        const x = -W / 2 + 0.7 + i * ((W - 1.0) / 9);
        rose(g, rnd, 0.045, i % 2 ? P.blush : P.ivory, x, H - 0.03 - Math.sin((i / 8) * PI) * 0.12, -0.02, 0);
        if (i % 2 === 0) leaf(g, rnd, 0.05, x + 0.1, H - 0.05 - Math.sin((i / 8) * PI) * 0.12, -0.02);
      }
      break;
    }
    case 'drape': {
      const top = 3.0;
      const tie = 1.05;
      const rod = cy(g, 0.012, 0.012, f.w + 0.1, P.gold, 0, top + 0.06, 0.02, 6);
      rod.rotation.z = PI / 2;
      for (const sx of [-1, 1]) ball(g, 0.025, P.gold, sx * (f.w / 2 + 0.05), top + 0.06, 0.02, 0);
      const swag = tube(`drapeSwag|${f.w}`, [new THREE.Vector3(-f.w / 2 + 0.05, top, 0.05), new THREE.Vector3(0, top - 0.32, 0.08), new THREE.Vector3(f.w / 2 - 0.05, top, 0.05)], 0.06, 14, 6);
      part(g, swag, P.ivory);
      for (const sx of [-1, 1]) {
        const x = sx * (f.w / 2 - 0.28);
        const upper = cy(g, 0.26, 0.07, top - tie, P.ivory, x, (top + tie) / 2, 0.03, 14);
        upper.scale.z = 0.32;
        const lower = cy(g, 0.07, 0.3, tie - 0.01, P.ivory, x, (tie - 0.01) / 2 + 0.01, 0.03, 14);
        lower.scale.z = 0.32;
        const band = cy(g, 0.085, 0.085, 0.07, P.blush, x, tie, 0.03, 12);
        band.scale.z = 0.42;
        rose(g, rnd, 0.04, P.rose, x - sx * 0.06, tie, 0.075, 0);
      }
      break;
    }
    case 'sconce': {
      bx(g, 0.09, 0.2, 0.02, P.gold, 0, 2.0, -0.03);
      const arm = cy(g, 0.008, 0.008, 0.14, P.gold, 0, 1.98, 0.04, 6);
      arm.rotation.x = PI / 2;
      cy(g, 0.03, 0.015, 0.03, P.gold, 0, 1.995, 0.11, 12);
      cy(g, 0.014, 0.014, 0.07, P.white, 0, 2.045, 0.11, 8);
      ball(g, 0.016, bulb(), 0, 2.095, 0.11, 1, 1, 1.6, 1);
      part(g, openCyl(0.045, 0.07, 0.09, 14), P.ivory, 0, 2.165, 0.11);
      break;
    }
    case 'vanity': {
      bx(g, f.w, 0.74, f.d, P.ivory, 0, 0.37, 0);
      bx(g, f.w + 0.04, 0.03, f.d + 0.02, P.glossy, 0, 0.755, 0);
      bx(g, f.w + 0.02, 0.04, f.d + 0.01, P.gold, 0, 0.02, 0);
      for (const x of [-0.46, 0, 0.46]) {
        bx(g, 0.4, 0.004, 0.004, P.gold, x, 0.45, f.d / 2 + 0.002);
        bx(g, 0.09, 0.016, 0.016, P.gold, x, 0.6, f.d / 2 + 0.01);
      }
      // Hollywood mirror
      bx(g, 1.12, 1.0, 0.04, P.ivory, 0, 1.33, -f.d / 2 + 0.06);
      part(g, plane(0.94, 0.84), P.mirror, 0, 1.33, -f.d / 2 + 0.081);
      for (let i = 0; i < 5; i++) ball(g, 0.03, bulb(), -0.44 + i * 0.22, 1.79, -f.d / 2 + 0.1, 1);
      for (const sx of [-1, 1]) for (const y of [0.98, 1.23, 1.48]) ball(g, 0.03, bulb(), sx * 0.52, y, -f.d / 2 + 0.1, 1);
      // bottles, a jewellery box, a few roses
      cy(g, 0.026, 0.03, 0.09, P.crystal, -0.42, 0.815, 0.04, 10);
      cy(g, 0.012, 0.012, 0.025, P.gold, -0.42, 0.872, 0.04, 8);
      cy(g, 0.02, 0.02, 0.12, P.rose, -0.3, 0.83, 0.08, 10);
      cy(g, 0.016, 0.016, 0.07, P.deep, -0.22, 0.805, 0.1, 8);
      bx(g, 0.16, 0.065, 0.11, P.blush, 0.38, 0.803, 0.05);
      bx(g, 0.165, 0.008, 0.115, P.gold, 0.38, 0.84, 0.05);
      cy(g, 0.04, 0.03, 0.1, P.crystal, 0.15, 0.82, -0.1, 10);
      cluster(g, rnd, 0.15, 0.92, -0.1, 0.08, 0.05, 0.07, 5, 0.035, 0.05);
      break;
    }
    case 'mannequinDress': {
      cy(g, 0.2, 0.22, 0.03, P.gold, 0, 0.015, 0, 20);
      // ball gown: satin skirt under a layer of tulle
      cy(g, 0.15, 0.4, 0.98, P.white, 0, 0.6, 0, 28);
      cy(g, 0.165, 0.43, 0.94, P.tulle, 0, 0.58, 0, 28);
      cy(g, 0.405, 0.405, 0.03, P.ivory, 0, 0.125, 0, 28);
      const bodice = cy(g, 0.13, 0.115, 0.32, P.white, 0, 1.26, 0, 18);
      bodice.scale.z = 0.75;
      ball(g, 0.115, P.white, 0, 1.38, 0.01, 1, 1.12, 0.55, 0.78);
      // lace sprigs
      for (let i = 0; i < 10; i++) {
        const a = -1.1 + (i / 9) * 2.2;
        ball(g, 0.012, P.ivory, Math.sin(a) * 0.12, 1.16 + (i % 3) * 0.08, Math.cos(a) * 0.09, 0);
      }
      const sash = cy(g, 0.122, 0.122, 0.045, P.blush, 0, 1.115, 0, 18);
      sash.scale.z = 0.78;
      for (const sx of [-1, 1]) ball(g, 0.05, P.blush, sx * 0.05, 1.12, -0.1, 0, 1, 0.55, 0.4);
      cy(g, 0.04, 0.05, 0.1, P.ivory, 0, 1.5, 0, 12);
      ball(g, 0.055, P.ivory, 0, 1.58, 0, 1);
      // tiara + veil down the back
      const tiara = part(g, torus(0.05, 0.006, 6, 18, PI), P.gold, 0, 1.6, 0.0);
      tiara.rotation.y = PI / 2;
      const veil = part(g, openCyl(0.05, 0.27, 0.72, 16), P.tulle, 0, 1.24, -0.12);
      veil.rotation.x = 0.2;
      // a bouquet tucked at the waist
      cluster(g, rnd, 0.12, 1.08, 0.16, 0.07, 0.05, 0.05, 5, 0.035, 0.05);
      break;
    }
    case 'mannequinSuit': {
      cy(g, 0.18, 0.2, 0.03, P.gold, 0, 0.015, 0, 20);
      for (const sx of [-1, 1]) {
        cy(g, 0.068, 0.062, 0.86, P.navy, sx * 0.085, 0.47, 0, 12);
        bx(g, 0.09, 0.06, 0.2, P.dark, sx * 0.085, 0.06, 0.03);
      }
      const torso = cy(g, 0.2, 0.17, 0.6, P.navy, 0, 1.2, 0, 18);
      torso.scale.z = 0.62;
      const skirtJ = cy(g, 0.17, 0.185, 0.14, P.navy, 0, 0.87, 0, 18);
      skirtJ.scale.z = 0.66;
      ball(g, 0.2, P.navy, 0, 1.47, 0, 1, 1.15, 0.35, 0.62);
      for (const sx of [-1, 1]) {
        const arm = cy(g, 0.055, 0.05, 0.6, P.navy, sx * 0.24, 1.16, 0, 10);
        arm.rotation.z = sx * 0.06;
        const shirt = bx(g, 0.06, 0.26, 0.012, P.white, sx * 0.035, 1.38, 0.113);
        shirt.rotation.z = -sx * 0.25;
        const lapel = bx(g, 0.05, 0.24, 0.012, P.dark, sx * 0.075, 1.36, 0.118);
        lapel.rotation.z = -sx * 0.32;
        ball(g, 0.03, P.dark, sx * 0.03, 1.5, 0.125, 0, 1.3, 0.7, 0.4);
      }
      ball(g, 0.012, P.dark, 0, 1.5, 0.13, 0);
      for (const y of [1.08, 1.18]) ball(g, 0.009, P.gold, 0, y, 0.118, 0);
      bx(g, 0.05, 0.025, 0.01, P.white, -0.11, 1.33, 0.113);
      rose(g, rnd, 0.026, P.white, 0.11, 1.41, 0.12, 1);
      leaf(g, rnd, 0.03, 0.13, 1.38, 0.115);
      cy(g, 0.045, 0.05, 0.08, P.ivory, 0, 1.55, 0, 12);
      ball(g, 0.06, P.ivory, 0, 1.63, 0, 1);
      break;
    }
    case 'lightPanel': {
      // the hall's light switch: an ivory plate with a gold rim and three lit keys, at hand height
      bx(g, f.w + 0.03, 0.27, 0.012, P.gold, 0, 1.3, -0.006);
      bx(g, f.w, 0.24, 0.018, P.ivory, 0, 1.3, 0);
      for (let i = 0; i < 3; i++) {
        bx(g, 0.07, 0.11, 0.014, P.glossy, -0.1 + i * 0.1, 1.3, 0.012);
        ball(g, 0.008, bulb(), -0.1 + i * 0.1, 1.37, 0.018, 0);
      }
      break;
    }
    default:
      break;
  }
}

/** Small per-piece colour offset so neighbouring tables don't look stamped out. */
function c0(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 6;
}
