// Floor 7, the wedding hall: everything that moves or glows. Like the other floors, "lights" are
// emissive / additive meshes (no real lights). The programme's effects are driven by the shared
// wedding state (`step` + `stepAt` on the server clock), so everyone sees the rings rise, the cake
// sparklers and the champagne pour at the same moment; one-shots fire once per step (and are
// skipped for somebody who walks in long after they happened).
//  - LED wall (names, the step, countdowns, wishes) + the welcome sign in the hall
//  - fairy-light strands across the ceiling, chandelier glow, candle glow on the tables
//  - light-up dance floor, follow spots on the couple, party beams, a glowing stage edge
//  - petals (the walk down the aisle, guests throwing them), confetti (poppers, cannons), hearts,
//    sparkles, cold sparklers by the cake, cold smoke on the floor
//  - the rings flying to the couple, the champagne tower filling, the feast on every table, the
//    bouquet tumbling high over the dance floor until someone grabs it, gift envelopes flying into
//    the gift box
//  - the guests: "Hôn đi!" shouts and the meter on the LED wall, "một, hai, ba — dô!" over a table,
//    phone torches swaying for the first dance; the band's music video through the LED wall
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BOUQUET_APEX,
  DZO_MS,
  STEP_META,
  WED_CAKE,
  WED_CHANDELIERS,
  WED_DANCE,
  WED_GIFT,
  WED_PROGRAM,
  WED_RINGS,
  WED_SPOTS,
  WED_STAGE,
  WED_T,
  WED_TABLES,
  WED_TOWER,
  F7,
  money,
  type WedLights,
  type WedState,
  type WedStep,
} from '../../shared/wedding';
import { FURNITURE, WALL_H, floorOf } from '../../shared/map';
import { canvasTexture } from './materials';
import { CAKE_TOP_Y, CHAMPAGNE_GLASSES } from './wedding-furniture';

export type WedCue =
  | 'march'
  | 'marchGo'
  | 'rings'
  | 'ringsLand'
  | 'kiss'
  | 'drumroll'
  | 'cakeCut'
  | 'pour'
  | 'toastTick'
  | 'toastGo'
  | 'feast'
  | 'bouquetTick'
  | 'bouquetThrow'
  | 'bouquetCatch'
  | 'bouquetMiss'
  | 'dance'
  | 'party';

interface Who {
  x: number;
  z: number;
  /** Feet height above floor 7. */
  y: number;
  ry: number;
}

// ------------------------------------------------------------------ textures (made once)
let glow: THREE.CanvasTexture | null = null;
function glowTex() {
  glow ??= canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  return glow;
}
let petalT: THREE.CanvasTexture | null = null;
function petalTex() {
  petalT ??= canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const gr = g.createRadialGradient(w * 0.45, h * 0.55, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#d9d9d9');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(w / 2, h * 0.95);
    g.bezierCurveTo(w * 0.02, h * 0.62, w * 0.18, h * 0.06, w / 2, h * 0.2);
    g.bezierCurveTo(w * 0.82, h * 0.06, w * 0.98, h * 0.62, w / 2, h * 0.95);
    g.fill();
  });
  return petalT;
}
let heartT: THREE.CanvasTexture | null = null;
function heartTex() {
  heartT ??= canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.shadowColor = 'rgba(255,90,130,0.9)';
    g.shadowBlur = 14;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#ff9ab3');
    gr.addColorStop(1, '#e8325c');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(w / 2, h * 0.84);
    g.bezierCurveTo(w * 0.1, h * 0.56, w * 0.12, h * 0.16, w * 0.33, h * 0.18);
    g.bezierCurveTo(w * 0.44, h * 0.19, w * 0.5, h * 0.3, w / 2, h * 0.34);
    g.bezierCurveTo(w * 0.5, h * 0.3, w * 0.56, h * 0.19, w * 0.67, h * 0.18);
    g.bezierCurveTo(w * 0.88, h * 0.16, w * 0.9, h * 0.56, w / 2, h * 0.84);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(w * 0.34, h * 0.32, 9, 6, -0.6, 0, Math.PI * 2);
    g.fill();
  });
  return heartT;
}
let smokeT: THREE.CanvasTexture | null = null;
function smokeTex() {
  smokeT ??= canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = w / 2 + Math.cos(i * 2.4) * w * 0.16;
      const y = h / 2 + Math.sin(i * 1.7) * h * 0.12;
      const gr = g.createRadialGradient(x, y, 0, x, y, w * 0.32);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
  });
  return smokeT;
}
const emojiTex = new Map<string, THREE.CanvasTexture>();
function emoji(e: string): THREE.CanvasTexture {
  let t = emojiTex.get(e);
  if (!t) {
    t = canvasTexture(128, 128, (g, w, h) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.fillText(e, w / 2, h / 2 + 6);
    });
    emojiTex.set(e, t);
  }
  return t;
}

/** A short shout as a sticker: bold white text with a coloured outline (cached by text + colour). */
const wordTex = new Map<string, THREE.CanvasTexture>();
function word(text: string, color: string): THREE.CanvasTexture {
  const key = `${text}|${color}`;
  let t = wordTex.get(key);
  if (!t) {
    t = canvasTexture(512, 160, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 92px "Be Vietnam Pro", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      g.lineJoin = 'round';
      g.lineWidth = 16;
      g.strokeStyle = color;
      g.strokeText(text, w / 2, h / 2 + 4, w - 20);
      g.fillStyle = '#ffffff';
      g.fillText(text, w / 2, h / 2 + 4, w - 20);
    });
    wordTex.set(key, t);
  }
  return t;
}

/** Uplight: a cone of light rising up a wall from a fixture on the floor (bright at the bottom). */
let upT: THREE.CanvasTexture | null = null;
function uplightTex() {
  upT ??= canvasTexture(64, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const yn = 1 - y / (h - 1); // 0 at the floor, 1 at the ceiling
      const inten = 0.12 * (1 - yn) + 0.88 * Math.pow(1 - yn, 1.6);
      const spread = 0.16 + 0.5 * yn;
      for (let x = 0; x < w; x++) {
        const dx = (x / (w - 1)) * 2 - 1;
        const a = inten * Math.exp(-((dx / spread) ** 2)) * Math.min(1, (1 - yn) * 30);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, a));
      }
    }
    g.putImageData(img, 0, 0);
  });
  return upT;
}
/** Gobo: soft dots and little hearts thrown on the dance floor by a rotating projector. */
let goboT: THREE.CanvasTexture | null = null;
function goboTex() {
  goboT ??= canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cx = w / 2;
    const cy = h / 2;
    for (let i = 0; i < 150; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * w * 0.47;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const fade = 1 - r / (w * 0.5);
      if (i % 9 === 0) drawHeart(g, x, y, 7 + rnd() * 5, `rgba(255,255,255,${0.75 * fade})`);
      else {
        const s = 3 + rnd() * 6;
        const gr = g.createRadialGradient(x, y, 0, x, y, s);
        gr.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x - s, y - s, s * 2, s * 2);
      }
    }
  });
  return goboT;
}

const v2 = new THREE.Vector2();
/** Pixels per metre at 1 m for the camera rendering a point cloud (for real-size glows). */
function pointScale(r: THREE.WebGLRenderer, cam: THREE.Camera): number {
  const h = r.getDrawingBufferSize(v2).y;
  const fov = (cam as THREE.PerspectiveCamera).fov ?? 50;
  return h / (2 * Math.tan(((fov * Math.PI) / 180) / 2));
}

/** One draw call for every little light of the room: each point a soft flickering glow of its own size and colour. */
function glowCloud(pts: { x: number; y: number; z: number; size: number; color: THREE.Color }[]): { obj: THREE.Points; mat: THREE.ShaderMaterial } {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
  geo.setAttribute('gcol', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.color.r, p.color.g, p.color.b]), 3));
  geo.setAttribute('gsize', new THREE.Float32BufferAttribute(pts.map((p) => p.size), 1));
  geo.setAttribute('phase', new THREE.Float32BufferAttribute(pts.map(() => Math.random() * 100), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: 800 }, boost: { value: 1 }, map: { value: glowTex() } },
    vertexShader: `
      attribute vec3 gcol;
      attribute float gsize;
      attribute float phase;
      uniform float time;
      uniform float scale;
      varying vec3 vC;
      void main() {
        // candles flicker, bigger glows (halos, washes) just breathe
        float k = gsize > 1.2 ? 0.06 : 0.2;
        float fl = 1.0 - k + k * sin(time * (3.0 + fract(phase * 7.1) * 6.0) + phase) * sin(time * 1.7 + phase * 3.0);
        vC = gcol * fl;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(gsize * scale / -mv.z, 900.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float boost;
      varying vec3 vC;
      void main() {
        float a = texture2D(map, gl_PointCoord).a;
        gl_FragColor = vec4(vC * a * boost, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const obj = new THREE.Points(geo, mat);
  obj.frustumCulled = false;
  obj.onBeforeRender = (r, _s, cam) => (mat.uniforms.scale.value = pointScale(r, cam));
  return { obj, mat };
}

/** Flat quads (floor pools, wall washes) merged into one mesh, each with its own colour. */
function quadBatch(quads: { c: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; color: THREE.Color }[], map: THREE.Texture, opacity: number): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  quads.forEach((q, i) => {
    for (const [a, b, s, t] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      pos.push(q.c.x + q.u.x * a + q.v.x * b, q.c.y + q.u.y * a + q.v.y * b, q.c.z + q.u.z * a + q.v.z * b);
      uv.push(s, t);
      col.push(q.color.r, q.color.g, q.color.b);
    }
    const k = i * 4;
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false }));
  m.frustumCulled = false;
  return m;
}

const add = (color: string | THREE.Color, opacity = 1, map: THREE.Texture | null = null) =>
  new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });

const PETAL_COLS = ['#ffd3dc', '#ffffff', '#f7a8b8', '#ffe9ee', '#e8738c'].map((c) => new THREE.Color(c));
const CONFETTI_COLS = ['#f6d58a', '#ffffff', '#f7a8b8', '#ffb3c6', '#b8e6d4', '#c9b8f0', '#ffd27a', '#e8738c'].map((c) => new THREE.Color(c));
const PARTY_HUES = ['#ff5fa2', '#ffd27a', '#7fe0ff', '#b48cff', '#7dffb0', '#ff9a5c'].map((c) => new THREE.Color(c));
const GOLD = new THREE.Color('#ffd58a');
const WARM = new THREE.Color('#fff1d6');
const BLUSH = new THREE.Color('#ffc2d1');

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const stepIdx = (s: WedStep) => WED_PROGRAM.indexOf(s);

// ------------------------------------------------------------------ particle pools
/** Instanced quads with simple physics: petals and confetti. */
class Flakes {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array; // x y z
  private v: Float32Array; // vx vy vz
  private r: Float32Array; // rot x y z
  private w: Float32Array; // spin x y z
  private life: Float32Array; // remaining seconds (≤0 = free)
  private col: THREE.Color[];
  private live = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  private pos = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(
    root: THREE.Group,
    private n: number,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    cols: THREE.Color[],
    private drag: number,
    private fall: number,
    private shimmer: boolean,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.r = new Float32Array(n * 3);
    this.w = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.col = Array.from({ length: n }, (_, i) => cols[i % cols.length].clone());
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, this.col[i]);
    root.add(this.mesh);
  }

  get active() {
    return this.live > 0;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    // first free slot (or the oldest one)
    let k = -1;
    let oldest = Infinity;
    let oi = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        k = i;
        break;
      }
      if (this.life[i] < oldest) {
        oldest = this.life[i];
        oi = i;
      }
    }
    if (k < 0) k = oi;
    else this.live++;
    const j = k * 3;
    this.p[j] = x;
    this.p[j + 1] = y;
    this.p[j + 2] = z;
    this.v[j] = vx;
    this.v[j + 1] = vy;
    this.v[j + 2] = vz;
    this.r[j] = Math.random() * 6;
    this.r[j + 1] = Math.random() * 6;
    this.r[j + 2] = Math.random() * 6;
    this.w[j] = (Math.random() - 0.5) * 9;
    this.w[j + 1] = (Math.random() - 0.5) * 9;
    this.w[j + 2] = (Math.random() - 0.5) * 9;
    this.life[k] = life;
  }

  tick(dt: number, t: number) {
    if (!this.live) {
      this.mesh.count = 0;
      return;
    }
    let out = 0;
    let alive = 0;
    const dragK = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      alive++;
      const j = i * 3;
      // flutter: a little sideways wobble as it falls
      const fl = Math.sin(t * 3 + i * 1.7) * 0.5;
      this.v[j] = this.v[j] * dragK + fl * dt;
      this.v[j + 1] = (this.v[j + 1] - this.fall * dt) * dragK;
      this.v[j + 2] = this.v[j + 2] * dragK + Math.cos(t * 2.6 + i) * 0.3 * dt;
      // settle on the floor (and stay a moment)
      let y = this.p[j + 1] + this.v[j + 1] * dt;
      if (y < 0.012) {
        y = 0.012;
        this.v[j] *= 0.5;
        this.v[j + 1] = 0;
        this.v[j + 2] *= 0.5;
        this.w[j] *= 0.85;
        this.w[j + 1] *= 0.85;
        this.w[j + 2] *= 0.85;
      }
      this.p[j] += this.v[j] * dt;
      this.p[j + 1] = y;
      this.p[j + 2] += this.v[j + 2] * dt;
      this.r[j] += this.w[j] * dt;
      this.r[j + 1] += this.w[j + 1] * dt;
      this.r[j + 2] += this.w[j + 2] * dt;
      const fade = Math.min(1, this.life[i] / 0.6);
      this.e.set(this.r[j], this.r[j + 1], this.r[j + 2]);
      this.q.setFromEuler(this.e);
      this.s.setScalar(fade);
      this.pos.set(this.p[j], y, this.p[j + 2]);
      this.m.compose(this.pos, this.q, this.s);
      this.mesh.setMatrixAt(out, this.m);
      if (this.shimmer) {
        // foil catching the light as it turns
        this.c.copy(this.col[i]).multiplyScalar(0.55 + 0.45 * Math.abs(Math.cos(this.r[j] * 1.3)));
        this.mesh.setColorAt(out, this.c);
      } else this.mesh.setColorAt(out, this.col[i]);
      out++;
    }
    this.live = alive;
    this.mesh.count = out;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Additive glowing points with gravity: sparks, glints, bubbles. */
class Sparks {
  readonly pts: THREE.Points;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private colA: Float32Array;
  private v: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private base: Float32Array;
  private g: Float32Array;
  private live = 0;
  private next = 0;

  constructor(
    root: THREE.Group,
    private n: number,
    size: number,
  ) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.colA = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.g = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const m = new THREE.PointsMaterial({ size, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
    this.pts = new THREE.Points(this.geo, m);
    this.pts.frustumCulled = false;
    root.add(this.pts);
  }

  get active() {
    return this.live > 0;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, c: THREE.Color, gravity = 4) {
    const k = this.next;
    this.next = (this.next + 1) % this.n;
    if (this.life[k] <= 0) this.live++;
    const j = k * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.v[j] = vx;
    this.v[j + 1] = vy;
    this.v[j + 2] = vz;
    this.life[k] = this.max[k] = life;
    this.base[j] = c.r;
    this.base[j + 1] = c.g;
    this.base[j + 2] = c.b;
    this.g[k] = gravity;
  }

  /** A round puff of glints. */
  burst(x: number, y: number, z: number, n: number, speed: number, c: THREE.Color, life = 0.9, gravity = 1.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(Math.random() * 2 - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s, life * (0.6 + Math.random() * 0.5), c, gravity);
    }
  }

  tick(dt: number, t: number) {
    if (!this.live) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    let alive = 0;
    let top = 0;
    for (let k = 0; k < this.n; k++) {
      const j = k * 3;
      if (this.life[k] <= 0) {
        this.colA[j] = this.colA[j + 1] = this.colA[j + 2] = 0;
        continue;
      }
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.colA[j] = this.colA[j + 1] = this.colA[j + 2] = 0;
        continue;
      }
      alive++;
      top = k + 1;
      this.v[j + 1] -= this.g[k] * dt;
      this.pos[j] += this.v[j] * dt;
      this.pos[j + 1] += this.v[j + 1] * dt;
      this.pos[j + 2] += this.v[j + 2] * dt;
      const a = this.life[k] / this.max[k];
      const tw = 0.65 + 0.35 * Math.sin(t * 30 + k * 2.1);
      const f = Math.min(1, a * 1.6) * tw;
      this.colA[j] = this.base[j] * f;
      this.colA[j + 1] = this.base[j + 1] * f;
      this.colA[j + 2] = this.base[j + 2] * f;
    }
    this.live = alive;
    this.geo.setDrawRange(0, top);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Floater {
  s: THREE.Sprite;
  t: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  grow: number;
}

// ------------------------------------------------------------------ the floor's effects
export class Floor7Fx {
  /** Where people are (logical x/z, feet height above floor 7, facing); null if not here. */
  people: (id: string) => Who | null = () => null;
  /** Something timed in the programme just happened (sounds, emotes are hooked on this). */
  onCue: (cue: WedCue, s: WedState) => void = () => {};

  private s: WedState | null = null;
  /** The house lights (the switch): glows read softer with the lights up, brighter with them off. */
  private lights: WedLights = 'auto';
  private fired = new Set<string>();
  private t = 0;

  // screen + sign
  private screen: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } | null = null;
  private sign: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } | null = null;
  private screenKey = '';
  private screenAcc = 0;
  private wishLine: { name: string; text: string; amount: number; until: number } | null = null;

  // lights
  private fairy: THREE.Points;
  private fairyMat: THREE.ShaderMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private tiles: THREE.InstancedMesh;
  private tileN: number;
  private tileCols = 14;
  private tileRows = 8;
  private tileAcc = 0;
  private spots: { cone: THREE.Mesh; pool: THREE.Mesh; on: number; x: number; z: number }[] = [];
  private beams: THREE.Mesh[] = [];
  private beamOn = 0;
  private glowMat: THREE.ShaderMaterial;
  private motesMat: THREE.ShaderMaterial;
  private pools: THREE.Mesh;
  private uplights: THREE.Mesh;
  private stageWash: THREE.Mesh;
  private gobo: THREE.Mesh;
  private trussBeams: THREE.Mesh;

  // particles
  private petals: Flakes;
  private confetti: Flakes;
  private sparks: Sparks;
  private floats: Floater[] = [];
  private smoke: { s: THREE.Sprite; ph: number; base: THREE.Vector3 }[] = [];
  private smokeLevel = 0;
  private smokeTarget = 0;
  private smokeAt: 'aisle' | 'dance' | 'stage' = 'stage';

  // props of the programme
  private rings: THREE.Group[] = [];
  private ringGlow: THREE.Sprite[] = [];
  private liquid: THREE.InstancedMesh;
  private liquidFill = -1;
  private bottle: THREE.Group;
  private stream: THREE.Mesh;
  private knife: THREE.Mesh;
  private dishes: THREE.InstancedMesh[] = [];
  private dishOn = 0;
  private dishTarget = 0;
  private bouquet: THREE.Group;
  private envelopes: { g: THREE.Group; t: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];

  // the band's music video through the LED wall (a hole the YouTube iframe shows through)
  private videoOn = false;
  private videoHole: THREE.Mesh | null = null;
  // the guests
  private chant = { n: 0, goal: 0 };
  private chantLast = new Map<string, number>();
  private torches: { id: string; s: THREE.Sprite; core: THREE.Sprite; t: number; life: number; ph: number }[] = [];
  private dzoTags = new Map<number, { s: THREE.Sprite; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; at: number; n: number; key: string }>();

  constructor(private root: THREE.Group) {
    const SH = WED_STAGE.h;
    // ---- fairy-light strands across the ceiling (each bulb twinkles on its own)
    {
      const pos: number[] = [];
      const ph: number[] = [];
      for (const z of [2.2, 5.4, 8.6, 11.8, 15.0, 18.0]) {
        const n = 64;
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1);
          const x = F7 + 0.4 + k * 39.2;
          // two sagging spans per strand
          const sag = Math.sin(((k * 2) % 1) * Math.PI) * 0.42;
          pos.push(x, WALL_H - 0.06 - sag, z + Math.sin(k * 9) * 0.05);
          ph.push(Math.random() * Math.PI * 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('phase', new THREE.Float32BufferAttribute(ph, 1));
      this.fairyMat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, scale: { value: 800 }, map: { value: glowTex() }, color: { value: new THREE.Color('#ffe2b3') }, boost: { value: 1 } },
        vertexShader: `
          attribute float phase;
          uniform float time;
          uniform float scale;
          varying float vA;
          void main() {
            vA = 0.55 + 0.45 * sin(time * (1.3 + fract(phase * 3.7) * 1.9) + phase);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = min(0.1 * scale / -mv.z, 256.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map;
          uniform vec3 color;
          uniform float boost;
          varying float vA;
          void main() {
            vec4 t = texture2D(map, gl_PointCoord);
            gl_FragColor = vec4(color * t.a * vA * boost, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.fairy = new THREE.Points(geo, this.fairyMat);
      this.fairy.frustumCulled = false;
      this.fairy.onBeforeRender = (r, _s, cam) => (this.fairyMat.uniforms.scale.value = pointScale(r, cam));
      root.add(this.fairy);
    }

    // ---- glowing stage edge
    this.edgeMat = new THREE.MeshBasicMaterial({ color: '#ffd58a', toneMapped: false });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(WED_STAGE.x1 - WED_STAGE.x0, 0.025, 0.025), this.edgeMat);
    edge.position.set((WED_STAGE.x0 + WED_STAGE.x1) / 2, SH - 0.015, WED_STAGE.z1 + 0.01);
    root.add(edge);

    // ---- light-up dance floor (additive, so it barely shows until it lights up)
    {
      const cols = this.tileCols;
      const rows = this.tileRows;
      this.tileN = cols * rows;
      const w = (WED_DANCE.x1 - WED_DANCE.x0) / cols;
      const d = (WED_DANCE.z1 - WED_DANCE.z0) / rows;
      const geo = new THREE.PlaneGeometry(w * 0.92, d * 0.92);
      geo.rotateX(-Math.PI / 2);
      this.tiles = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), this.tileN);
      const m = new THREE.Matrix4();
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          m.makeTranslation(WED_DANCE.x0 + (i + 0.5) * w, 0.008, WED_DANCE.z0 + (j + 0.5) * d);
          this.tiles.setMatrixAt(i * rows + j, m);
          this.tiles.setColorAt(i * rows + j, new THREE.Color(0, 0, 0));
        }
      root.add(this.tiles);
    }

    // ---- follow spots for the couple (+ one for the bouquet catcher)
    for (let i = 0; i < 3; i++) {
      const h = WALL_H - 0.1;
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.8, h, 24, 1, true), add('#fff3dc', 0));
      root.add(cone);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), add('#fff3dc', 0, glowTex()));
      pool.rotation.x = -Math.PI / 2;
      root.add(pool);
      cone.visible = pool.visible = false;
      this.spots.push({ cone, pool, on: 0, x: F7 + 20, z: 2 });
    }
    // ---- party beams from the ceiling corners
    for (let i = 0; i < 6; i++) {
      const len = 9;
      const geo = new THREE.CylinderGeometry(0.04, 0.7, len, 16, 1, true);
      geo.translate(0, -len / 2, 0);
      const beam = new THREE.Mesh(geo, add(PARTY_HUES[i], 0));
      beam.position.set(F7 + [2, 38, 2, 38, 12, 28][i], WALL_H - 0.15, [2, 2, 17, 17, 1, 1][i]);
      beam.visible = false;
      root.add(beam);
      this.beams.push(beam);
    }
    // ---- the room's own light (the hall is kept dim, like a real banquet hall: what you see glowing
    // is the candles, the chandeliers, the uplights on the walls and the stage)
    {
      const warm = new THREE.Color('#ffc98a');
      const pts: { x: number; y: number; z: number; size: number; color: THREE.Color }[] = [];
      const P = (x: number, y: number, z: number, size: number, c: string | THREE.Color, k: number) => pts.push({ x, y, z, size, color: new THREE.Color(c).multiplyScalar(k) });
      for (const c of WED_CHANDELIERS) {
        P(c.x, 2.74, c.z, 2.6, '#ffcf96', 0.3); // halo round the whole chandelier
        P(c.x, 2.8, c.z, 0.95, '#fff0d6', 0.75); // its bright heart
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          P(c.x + Math.cos(a) * 0.55, 2.78, c.z + Math.sin(a) * 0.55, 0.32, '#ffe1b0', 0.8); // candle bulbs on the ring
        }
      }
      for (const t of WED_TABLES) {
        P(t.x, 0.98, t.z, 0.9, '#ffb760', 0.7); // the centrepiece candles
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + t.x;
          P(t.x + Math.cos(a) * 0.22, 0.86, t.z + Math.sin(a) * 0.22, 0.24, '#ffd08a', 0.9);
        }
      }
      for (const f of FURNITURE) {
        if (f.kind !== 'sconce' || floorOf(f.x) !== 6) continue;
        P(f.x + Math.sin(f.ry) * 0.11, 2.1, f.z + Math.cos(f.ry) * 0.11, 0.9, '#ffc27a', 0.75);
      }
      // tea lights lining the aisle
      for (let z = 8.6; z < 18.5; z += 0.8) for (const x of [18.72, 21.28]) P(F7 + x, 0.06, z, 0.3, '#ffb050', 0.95);
      // the stage truss: a row of warm lamps over the front of the stage
      for (let i = 0; i < 9; i++) P(F7 + 13.6 + i * 1.6, 3.0, 3.45, 0.5, '#fff1dc', 0.9);
      // footlights along the stage edge, washing its skirt pink and lilac
      for (let i = 0; i < 10; i++) P(F7 + 13.25 + i * 1.5, 0.08, WED_STAGE.z1 + 0.25, 0.7, i % 2 ? '#ff7fb5' : '#b58cff', 0.55);
      // uplights: coloured cones of light rising up the walls
      const UPC = ['#ff6fa8', '#a07cff', '#ffb04f'];
      const quads: { c: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; color: THREE.Color }[] = [];
      let n = 0;
      const up = (x: number, z: number, nx: number, nz: number) => {
        const col = new THREE.Color(UPC[n++ % UPC.length]);
        const h = WALL_H - 0.05;
        quads.push({ c: new THREE.Vector3(x + nx * 0.3, h / 2, z + nz * 0.3), u: new THREE.Vector3(Math.abs(nz) * 0.85, 0, Math.abs(nx) * 0.85), v: new THREE.Vector3(0, h / 2, 0), color: col });
        P(x + nx * 0.34, 0.07, z + nz * 0.34, 0.6, col, 0.8); // the fixture on the floor
      };
      for (const z of [2.6, 6.8, 11.0, 15.2]) {
        up(F7 + 0.1, z, 1, 0);
        up(F7 + 39.9, z, -1, 0);
      }
      for (const x of [3.6, 8.7, 31.3, 36.4]) up(F7 + x, 0.1, 0, 1);
      for (const x of [3.6, 8.7, 13.8, 26.2, 31.3, 36.4]) up(F7 + x, 18.9, 0, -1);
      // the two flower walls on the stage get a soft rose light washed up their faces
      for (const x of [14.6, 25.4]) {
        const h = 2.7;
        quads.push({ c: new THREE.Vector3(F7 + x, WED_STAGE.h + h / 2, 0.52), u: new THREE.Vector3(1.6, 0, 0), v: new THREE.Vector3(0, h / 2, 0), color: new THREE.Color('#ff9cc4') });
        P(F7 + x, WED_STAGE.h + 0.06, 0.62, 0.7, '#ff9cc4', 0.7);
      }
      this.uplights = quadBatch(quads, uplightTex(), 0.62);
      root.add(this.uplights);
      const glowAll = glowCloud(pts);
      this.glowMat = glowAll.mat;
      root.add(glowAll.obj);
      void warm;
      // warm pools: under each chandelier on the floor, on every table top
      const pq: { c: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; color: THREE.Color }[] = [];
      for (const c of WED_CHANDELIERS) pq.push({ c: new THREE.Vector3(c.x, 0.013, c.z), u: new THREE.Vector3(2.9, 0, 0), v: new THREE.Vector3(0, 0, 2.9), color: new THREE.Color('#ffc58a') });
      // the stage floor in a warm glow, and the dance floor in front of it
      pq.push({ c: new THREE.Vector3(F7 + 20, WED_STAGE.h + 0.006, 1.9), u: new THREE.Vector3(8.5, 0, 0), v: new THREE.Vector3(0, 0, 2.6), color: new THREE.Color('#ffd2b0') });
      pq.push({ c: new THREE.Vector3(F7 + 20, 0.02, 6.0), u: new THREE.Vector3(5.2, 0, 0), v: new THREE.Vector3(0, 0, 3.4), color: new THREE.Color('#ffb59a') });
      // and a little light on the walkways between the tables
      for (const x of [11.25, 28.75]) for (const z of [9.9, 15.2]) pq.push({ c: new THREE.Vector3(F7 + x, 0.013, z), u: new THREE.Vector3(1.8, 0, 0), v: new THREE.Vector3(0, 0, 1.8), color: new THREE.Color('#ffbb8a') });
      for (const t of WED_TABLES) pq.push({ c: new THREE.Vector3(t.x, 0.777, t.z), u: new THREE.Vector3(1.05, 0, 0), v: new THREE.Vector3(0, 0, 1.05), color: new THREE.Color('#ffb46a') });
      this.pools = quadBatch(pq, glowTex(), 0.3);
      root.add(this.pools);
      // a soft rose backlight on the wall behind the stage set
      this.stageWash = new THREE.Mesh(new THREE.PlaneGeometry(19, 3.3), add('#ff8fc4', 0.42, glowTex()));
      this.stageWash.position.set(F7 + 20, 1.7, 0.12);
      root.add(this.stageWash);
      // the gobo projector's pattern turning slowly on the dance floor
      this.gobo = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), add('#fff0dc', 0.3, goboTex()));
      this.gobo.rotation.x = -Math.PI / 2;
      this.gobo.position.set(F7 + 20, 0.016, 6.0);
      root.add(this.gobo);
      // the truss itself, and faint beams from its lamps down onto the stage
      const truss = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.07, 0.07), new THREE.MeshStandardMaterial({ color: '#c9a35b', metalness: 0.85, roughness: 0.3 }));
      truss.position.set(F7 + 20, 3.08, 3.45);
      root.add(truss);
      const cones: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const h = 2.75;
        const g = new THREE.CylinderGeometry(0.05, 0.5, h, 18, 1, true);
        g.translate(F7 + 13.6 + i * 1.6, 3.0 - h / 2, 3.2);
        cones.push(g);
      }
      this.trussBeams = new THREE.Mesh(mergeGeometries(cones), add('#fff3e0', 0.035));
      root.add(this.trussBeams);
      // glitter in the air: motes catching the light now and then
      const mp: number[] = [];
      const mph: number[] = [];
      for (let i = 0; i < 300; i++) {
        mp.push(F7 + 1 + Math.random() * 38, 0.9 + Math.random() * 2.2, 1 + Math.random() * 17.5);
        mph.push(Math.random() * 50);
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
      mg.setAttribute('phase', new THREE.Float32BufferAttribute(mph, 1));
      this.motesMat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, scale: { value: 800 }, map: { value: glowTex() }, color: { value: new THREE.Color('#ffe7b8') }, boost: { value: 1 } },
        vertexShader: `
          attribute float phase;
          uniform float time;
          uniform float scale;
          varying float vA;
          void main() {
            vec3 p = position;
            p.x += sin(time * 0.11 + phase * 5.0) * 0.5;
            p.y += sin(time * 0.17 + phase * 3.0) * 0.3;
            p.z += cos(time * 0.09 + phase * 4.0) * 0.5;
            float tw = sin(time * (0.8 + fract(phase * 13.0) * 1.6) + phase * 20.0);
            vA = 0.06 + 0.94 * pow(max(tw, 0.0), 10.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = min(0.045 * scale / -mv.z, 22.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map;
          uniform vec3 color;
          uniform float boost;
          varying float vA;
          void main() {
            float a = texture2D(map, gl_PointCoord).a;
            gl_FragColor = vec4(color * a * vA * boost, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const motes = new THREE.Points(mg, this.motesMat);
      motes.frustumCulled = false;
      motes.onBeforeRender = (r, _s, cam) => (this.motesMat.uniforms.scale.value = pointScale(r, cam));
      root.add(motes);
    }

    // ---- particles
    const petalGeo = new THREE.PlaneGeometry(0.075, 0.06);
    this.petals = new Flakes(root, 320, petalGeo, new THREE.MeshBasicMaterial({ map: petalTex(), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, depthWrite: false }), PETAL_COLS, 1.6, 1.1, false);
    const confGeo = new THREE.PlaneGeometry(0.035, 0.065);
    this.confetti = new Flakes(root, 520, confGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CONFETTI_COLS, 1.2, 2.4, true);
    this.sparks = new Sparks(root, 700, 0.07);
    // cold smoke ("khói lạnh"): soft low clouds
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false;
      root.add(s);
      this.smoke.push({ s, ph: Math.random() * Math.PI * 2, base: new THREE.Vector3() });
    }

    // ---- the rings
    const gold = new THREE.MeshStandardMaterial({ color: '#f3c766', metalness: 1, roughness: 0.18, emissive: '#7a5a1a', emissiveIntensity: 0.6 });
    const diamond = new THREE.MeshBasicMaterial({ color: '#f4fbff', toneMapped: false });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 10, 28), gold);
      g.add(band);
      if (i === 0) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), diamond);
        gem.position.y = 0.07;
        g.add(gem);
      }
      g.visible = false;
      root.add(g);
      this.rings.push(g);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffe6a8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      halo.scale.setScalar(0.5);
      halo.visible = false;
      root.add(halo);
      this.ringGlow.push(halo);
    }

    // ---- champagne: the liquid in every glass of the tower, the bottle and its stream
    {
      const geo = new THREE.CylinderGeometry(0.9, 0.55, 0.5, 14);
      geo.translate(0, 0.25, 0);
      const mat = new THREE.MeshStandardMaterial({ color: '#f5c94a', emissive: '#b8860b', emissiveIntensity: 0.55, roughness: 0.15, transparent: true, opacity: 0.85, depthWrite: false });
      this.liquid = new THREE.InstancedMesh(geo, mat, CHAMPAGNE_GLASSES.length);
      this.liquid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(this.liquid);
      this.setFill(0);
      this.bottle = new THREE.Group();
      const glassM = new THREE.MeshStandardMaterial({ color: '#1f4a2c', roughness: 0.2, metalness: 0.1 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.24, 14), glassM);
      body.position.y = -0.12;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.042, 0.12, 12), glassM);
      neck.position.y = 0.06;
      const foil = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.06, 12), new THREE.MeshStandardMaterial({ color: '#e9c46a', metalness: 0.9, roughness: 0.3 }));
      foil.position.y = 0.12;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.08, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#f6efe0', roughness: 0.6 }));
      label.position.y = -0.12;
      this.bottle.add(body, neck, foil, label);
      this.bottle.visible = false;
      root.add(this.bottle);
      this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 1, 8, 1, true), add('#ffd76a', 0.75));
      this.stream.visible = false;
      root.add(this.stream);
    }
    // ---- the cake knife
    this.knife = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.045), new THREE.MeshStandardMaterial({ color: '#e8edf2', metalness: 1, roughness: 0.15, emissive: '#3a3f46' }));
    this.knife.visible = false;
    root.add(this.knife);

    // ---- the feast: five dishes on every table
    {
      const plate = new THREE.CylinderGeometry(0.15, 0.12, 0.025, 18);
      const dome = new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 0.75, 1);
      const roll = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8);
      roll.rotateZ(Math.PI / 2);
      const bowl = new THREE.CylinderGeometry(0.11, 0.07, 0.07, 16);
      const plates = new THREE.InstancedMesh(plate, new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.35 }), WED_TABLES.length * 5);
      const foods = new THREE.InstancedMesh(dome, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), WED_TABLES.length * 4);
      const rolls = new THREE.InstancedMesh(roll, new THREE.MeshStandardMaterial({ color: '#d8913f', roughness: 0.6 }), WED_TABLES.length * 3);
      const soups = new THREE.InstancedMesh(bowl, new THREE.MeshStandardMaterial({ color: '#c8452f', roughness: 0.4 }), WED_TABLES.length);
      const foodCols = ['#c97b3a', '#7fb069', '#e8b04a', '#e06c75'].map((c) => new THREE.Color(c));
      const m = new THREE.Matrix4();
      WED_TABLES.forEach((t, ti) => {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + ti;
          const x = t.x + Math.sin(a) * 0.42;
          const z = t.z + Math.cos(a) * 0.42;
          m.makeTranslation(x, 0.775, z);
          plates.setMatrixAt(ti * 5 + k, m);
          if (k < 4) {
            m.makeTranslation(x, 0.79, z);
            foods.setMatrixAt(ti * 4 + k, m);
            foods.setColorAt(ti * 4 + k, foodCols[k]);
          } else {
            m.makeTranslation(x, 0.81, z);
            soups.setMatrixAt(ti, m);
          }
        }
        for (let r = 0; r < 3; r++) {
          m.makeTranslation(t.x + (r - 1) * 0.05, 0.8 + (r === 1 ? 0.03 : 0), t.z);
          rolls.setMatrixAt(ti * 3 + r, m);
        }
      });
      for (const d of [plates, foods, rolls, soups]) {
        d.visible = false;
        d.castShadow = false;
        d.receiveShadow = true;
        root.add(d);
        this.dishes.push(d);
      }
    }

    // ---- the bouquet that flies
    {
      this.bouquet = new THREE.Group();
      const cols = ['#ffffff', '#ffd3dc', '#f7a8b8', '#fff4e6', '#e8738c'];
      const geo = new THREE.IcosahedronGeometry(0.045, 1);
      for (let i = 0; i < 13; i++) {
        const a = i * 2.4;
        const r = i ? 0.05 + (i % 3) * 0.022 : 0;
        const f = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.8 }));
        f.position.set(Math.cos(a) * r, 0.05 - r * 0.4, Math.sin(a) * r);
        this.bouquet.add(f);
      }
      const stems = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.018, 0.2, 8), new THREE.MeshStandardMaterial({ color: '#6f9a63', roughness: 0.8 }));
      stems.position.y = -0.1;
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.04, 10), new THREE.MeshStandardMaterial({ color: '#fff7ef', roughness: 0.5 }));
      ribbon.position.y = -0.06;
      this.bouquet.add(stems, ribbon);
      this.bouquet.visible = false;
      root.add(this.bouquet);
    }
  }

  // ------------------------------------------------------------------ screens
  setupScreen(mesh: THREE.Mesh, at: { x: number; y: number; z: number; w: number; h: number }) {
    mesh.position.set(at.x, at.y, at.z);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(at.w, at.h, 1);
    const tex = canvasTexture(1024, Math.round((1024 * at.h) / at.w), () => {});
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.screen = { mesh, tex, g: (tex.image as HTMLCanvasElement).getContext('2d')! };
    this.drawScreen(Date.now(), true);
    // 16:9 in the middle of the wall: where the band's video shows through (feast and party)
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(at.h * (16 / 9), at.h), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, fog: false, toneMapped: false }));
    hole.position.set(at.x, at.y, at.z + 0.004);
    hole.visible = false;
    (mesh.parent ?? this.root).add(hole);
    this.videoHole = hole;
  }

  /** The band's YouTube player exists (CSS3D, behind the canvas): the wall can show it. */
  setVideo(on: boolean) {
    this.videoOn = on;
  }

  /** Is the music video showing on the LED wall right now (feast / party)? */
  private videoShows(step: WedStep) {
    return this.videoOn && (step === 'feast' || step === 'party');
  }

  setupSign(mesh: THREE.Mesh) {
    const tex = canvasTexture(512, 712, () => {});
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.sign = { mesh, tex, g: (tex.image as HTMLCanvasElement).getContext('2d')! };
    this.drawSign();
  }

  private names(): { a: string; b: string } | null {
    const s = this.s;
    if (!s?.groom || !s.bride) return null;
    return { a: s.groom.name, b: s.bride.name };
  }

  private drawSign() {
    if (!this.sign) return;
    const { g, tex } = this.sign;
    const w = 512;
    const h = 712;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#fffaf3');
    gr.addColorStop(1, '#f8e4e6');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8b26e';
    g.lineWidth = 6;
    g.strokeRect(18, 18, w - 36, h - 36);
    g.lineWidth = 2;
    g.strokeRect(30, 30, w - 60, h - 60);
    // flower corners
    const bloom = (x: number, y: number, r: number, c: string) => {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = c;
        g.beginPath();
        g.ellipse(x + Math.cos(i) * r * 0.5, y + Math.sin(i) * r * 0.5, r * 0.6, r * 0.45, i, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f6d58a';
      g.beginPath();
      g.arc(x, y, r * 0.25, 0, Math.PI * 2);
      g.fill();
    };
    for (const [x, y] of [[44, 44], [w - 44, 44], [44, h - 44], [w - 44, h - 44]]) {
      g.fillStyle = '#9dbb92';
      g.beginPath();
      g.ellipse(x + (x < w / 2 ? 30 : -30), y, 26, 9, 0.4, 0, Math.PI * 2);
      g.fill();
      bloom(x, y, 26, '#f4b8c4');
      bloom(x + (x < w / 2 ? 18 : -18), y + (y < h / 2 ? 22 : -22), 16, '#ffffff');
    }
    g.textAlign = 'center';
    g.fillStyle = '#b08a4a';
    g.font = '600 26px "Be Vietnam Pro", sans-serif';
    g.fillText('WELCOME TO OUR WEDDING', w / 2, 128);
    g.font = 'italic 500 26px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#9b6b78';
    g.fillText('Chào mừng đến lễ thành hôn của', w / 2, 168);
    const n = this.names();
    g.fillStyle = '#7a3b4d';
    if (n) {
      g.font = 'italic 700 58px "Be Vietnam Pro", serif';
      fitText(g, n.a, w / 2, 290, w - 90);
      g.fillStyle = '#e06c88';
      g.font = '700 46px "Be Vietnam Pro", sans-serif';
      g.fillText('&', w / 2, 362);
      g.fillStyle = '#7a3b4d';
      g.font = 'italic 700 58px "Be Vietnam Pro", serif';
      fitText(g, n.b, w / 2, 440, w - 90);
    } else {
      g.font = 'italic 700 46px "Be Vietnam Pro", serif';
      g.fillText('Cô dâu & Chú rể', w / 2, 330);
      g.font = '500 24px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#9b6b78';
      g.fillText('Bấm vào bảng này để nhận vai', w / 2, 390);
      g.fillText('cô dâu, chú rể hoặc MC 💍', w / 2, 424);
    }
    g.strokeStyle = '#d8b26e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(140, 500);
    g.lineTo(w - 140, 500);
    g.stroke();
    g.fillStyle = '#b08a4a';
    g.font = '600 26px "Be Vietnam Pro", sans-serif';
    g.fillText(dateLine(), w / 2, 548);
    g.font = '500 22px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#9b6b78';
    g.fillText('Tầng 7 · Sảnh tiệc cưới', w / 2, 590);
    tex.needsUpdate = true;
  }

  /** The LED wall: redrawn when what it says changes, and a few times a second while animating. */
  private drawScreen(now: number, force = false) {
    if (!this.screen) return;
    const s = this.s;
    const step = s?.step ?? 'idle';
    const el = s ? now - s.stepAt : 0;
    const wish = this.wishLine && this.wishLine.until > now ? this.wishLine : null;
    let count = '';
    if (step === 'toast' && el > WED_T.toastCount && el < WED_T.toastCount + 5200) count = ['MỘT', 'HAI', 'BA', 'DÔ! 🥂'][Math.min(3, Math.floor((el - WED_T.toastCount) / 1000))];
    if (step === 'bouquet' && el > WED_T.bouquetCount && el < WED_T.bouquetThrow) count = String(3 - Math.floor((el - WED_T.bouquetCount) / 1000));
    if (step === 'bouquet' && el >= WED_T.bouquetThrow && el < WED_T.bouquetResolve + 4500) count = s?.bouquet?.name ? `💐 ${s.bouquet.name}!` : s?.bouquet ? '💐' : 'CHỘP! 🙌';
    const chanting = step === 'kiss' && !!s?.kiss && s.kiss.at === null && s.kiss.goal > 0;
    const key = `${step}|${s?.stepAt}|${s?.groom?.name}|${s?.bride?.name}|${count}|${wish?.until ?? ''}|${chanting ? this.chant.n : ''}`;
    const animated = step === 'party' || step === 'dance' || !!count || chanting;
    if (!force && key === this.screenKey && !animated) return;
    this.screenKey = key;
    const { g, tex } = this.screen;
    const W = (tex.image as HTMLCanvasElement).width;
    const H = (tex.image as HTMLCanvasElement).height;
    const t = now / 1000;
    // background: blush → ivory with soft bokeh (party: deep night colours)
    const party = step === 'party' || step === 'dance';
    const gr = g.createLinearGradient(0, 0, W, H);
    if (party) {
      gr.addColorStop(0, '#2a1033');
      gr.addColorStop(1, '#3d1530');
    } else {
      gr.addColorStop(0, '#fff6ee');
      gr.addColorStop(1, '#f6d8de');
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const x = (i * 131 + (party ? t * 30 : t * 6) * (1 + (i % 3))) % (W + 80) - 40;
      const y = (i * 67) % H;
      const r = 14 + ((i * 29) % 46);
      const c = party ? PARTY_HUES[i % PARTY_HUES.length] : i % 2 ? GOLD : BLUSH;
      const b = g.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${party ? 0.35 : 0.28})`);
      b.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = b;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = party ? '#ffd58a' : '#d8b26e';
    g.lineWidth = 5;
    g.strokeRect(16, 16, W - 32, H - 32);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const n = this.names();
    const ink = party ? '#fff4f7' : '#7a3b4d';
    const soft = party ? '#ffd58a' : '#b08a4a';
    if (chanting && s?.kiss) {
      // "HÔN ĐI! HÔN ĐI!" — the guests' meter
      const k = clamp01(this.chant.n / Math.max(1, s.kiss.goal));
      const beat = 1 + 0.06 * Math.abs(Math.sin(t * 7));
      g.fillStyle = soft;
      g.font = '700 32px "Be Vietnam Pro", sans-serif';
      g.fillText('CẢ SẢNH CÙNG HÔ NÀO', W / 2, 84);
      g.save();
      g.translate(W / 2, 205);
      g.scale(beat, beat);
      g.fillStyle = '#d81b60';
      g.font = '900 104px "Be Vietnam Pro", sans-serif';
      fitText(g, 'HÔN ĐI! HÔN ĐI!', 0, 0, W - 120);
      g.restore();
      const bx = 120;
      const bw = W - 240;
      const by = 268;
      g.fillStyle = 'rgba(122,59,77,0.18)';
      roundRect(g, bx, by, bw, 34, 17);
      g.fill();
      const gr2 = g.createLinearGradient(bx, 0, bx + bw, 0);
      gr2.addColorStop(0, '#ff8fb1');
      gr2.addColorStop(1, '#e8325c');
      g.fillStyle = gr2;
      roundRect(g, bx, by, Math.max(34, bw * k), 34, 17);
      g.fill();
      drawHeart(g, bx + Math.max(17, bw * k - 17), by + 15, 22 * beat, '#ffffff');
      g.fillStyle = ink;
      g.font = '600 26px "Be Vietnam Pro", sans-serif';
      g.fillText(`${Math.min(this.chant.n, s.kiss.goal)} / ${s.kiss.goal} tiếng hô 💋`, W / 2, 346);
    } else if (count) {
      g.fillStyle = soft;
      g.font = '700 34px "Be Vietnam Pro", sans-serif';
      g.fillText(step === 'toast' ? 'NÂNG LY CHÚC MỪNG' : 'TUNG HOA CƯỚI', W / 2, 90);
      g.fillStyle = party ? '#ffffff' : '#c2185b';
      g.font = `800 ${count.length > 6 ? 92 : 190}px "Be Vietnam Pro", sans-serif`;
      fitText(g, count, W / 2, H / 2 + (count.length > 6 ? 40 : 75), W - 80);
    } else if (wish) {
      g.fillStyle = soft;
      g.font = '700 32px "Be Vietnam Pro", sans-serif';
      g.fillText(`💌 ${wish.name} mừng cưới · ${money(wish.amount)}`, W / 2, 96);
      g.fillStyle = ink;
      g.font = 'italic 600 46px "Be Vietnam Pro", serif';
      wrapText(g, wish.text ? `“${wish.text}”` : 'Chúc hai bạn trăm năm hạnh phúc! 💕', W / 2, 190, W - 120, 58, 4);
    } else if (!n) {
      g.fillStyle = soft;
      g.font = '700 34px "Be Vietnam Pro", sans-serif';
      g.fillText('SẢNH TIỆC CƯỚI', W / 2, 120);
      g.fillStyle = ink;
      g.font = 'italic 700 78px "Be Vietnam Pro", serif';
      g.fillText('Happy Wedding', W / 2, 228);
      g.font = '500 30px "Be Vietnam Pro", sans-serif';
      g.fillStyle = party ? '#ffffff' : '#9b6b78';
      g.fillText('Nhận vai cô dâu · chú rể ở bảng ngoài sảnh 💍', W / 2, 310);
      if (s?.count) g.fillText(`Đã có ${s.count} đám cưới tổ chức ở đây 💕`, W / 2, 360);
    } else {
      const meta = STEP_META[step];
      g.fillStyle = soft;
      g.font = '700 30px "Be Vietnam Pro", sans-serif';
      g.fillText(step === 'idle' ? 'LỄ THÀNH HÔN' : step === 'party' ? 'JUST MARRIED' : `${meta.emoji}  ${meta.name.toUpperCase()}`, W / 2, 82);
      g.fillStyle = ink;
      g.font = 'italic 700 74px "Be Vietnam Pro", serif';
      fitText(g, n.a, W * 0.27, 210, W * 0.42);
      fitText(g, n.b, W * 0.73, 210, W * 0.42);
      // a heart between the names (beats in the party)
      const beat = party ? 1 + 0.12 * Math.abs(Math.sin(t * 3.3)) : 1;
      drawHeart(g, W / 2, 178, 40 * beat, party ? '#ff5f8f' : '#e06c88');
      g.fillStyle = party ? '#ffffff' : '#9b6b78';
      g.font = '500 30px "Be Vietnam Pro", sans-serif';
      fitText(g, step === 'idle' ? dateLine() : meta.mc, W / 2, 300, W - 100);
      if (step === 'idle') {
        g.font = '500 26px "Be Vietnam Pro", sans-serif';
        g.fillText('Mời quý khách ghi lưu bút và mừng cưới ở bàn ngoài sảnh 💌', W / 2, 350);
      }
    }
    tex.needsUpdate = true;
  }

  /** A guest's gift wish shows on the wall for a while. */
  wish(name: string, amount: number, text: string, now: number) {
    this.wishLine = { name, amount, text, until: now + 6500 };
    this.drawScreen(now, true);
  }

  // ------------------------------------------------------------------ state
  setLights(l: WedLights) {
    this.lights = l;
  }

  apply(s: WedState) {
    const prev = this.s;
    this.s = s;
    this.lights = s.lights ?? 'auto';
    if (!prev || prev.stepAt !== s.stepAt || prev.step !== s.step) {
      this.fired.clear();
      this.chant = { n: s.kiss?.n ?? 0, goal: s.kiss?.goal ?? 0 };
    } else if (s.kiss) this.chant = { n: Math.max(this.chant.n, s.kiss.n), goal: s.kiss.goal };
    if (!prev || prev.groom?.name !== s.groom?.name || prev.bride?.name !== s.bride?.name) this.drawSign();
    this.screenKey = '';
  }

  /** Fire `key` once per step, when `el` passes `at` (but not for latecomers, > 2.5 s after). */
  private once(key: string, el: number, at: number, late = 2500): boolean {
    if (el < at || this.fired.has(key)) return false;
    this.fired.add(key);
    return el - at < late;
  }

  // ------------------------------------------------------------------ one-shots for everyone
  react(e: string, x: number, z: number, y: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoji(e), transparent: true, depthWrite: false, toneMapped: false }));
    s.position.set(x, y, z);
    s.scale.setScalar(0.42);
    this.root.add(s);
    this.floats.push({ s, t: 0, life: 2.4, vx: (Math.random() - 0.5) * 0.35, vy: 0.75, vz: (Math.random() - 0.5) * 0.35, grow: 0 });
  }

  /** The kiss meter, as the shouts come in. */
  setChant(n: number, goal: number) {
    this.chant = { n: Math.max(this.chant.n, n), goal };
  }

  /** "Hôn đi!" over someone's head (at most a few a second each). */
  shout(id: string, text: string, color: string) {
    const p = this.people(id);
    if (!p) return;
    const now = performance.now();
    if (now - (this.chantLast.get(id) ?? 0) < 380) return;
    this.chantLast.set(id, now);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: word(text, color), transparent: true, depthWrite: false, toneMapped: false }));
    sp.position.set(p.x + (Math.random() - 0.5) * 0.3, p.y + 2.15, p.z + (Math.random() - 0.5) * 0.3);
    sp.scale.set(0.95, 0.3, 1);
    this.root.add(sp);
    this.floats.push({ s: sp, t: 0, life: 1.3, vx: (Math.random() - 0.5) * 0.3, vy: 0.9, vz: (Math.random() - 0.5) * 0.3, grow: 0 });
  }

  /** A phone torch held up and swaying (the first dance). */
  torch(id: string) {
    if (this.torches.length > 40 || this.torches.some((t) => t.id === id)) return;
    // a soft halo round a small, hard, bright point (the phone's LED)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff1d9', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(0.5);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    core.scale.setScalar(0.09);
    this.root.add(sp, core);
    this.torches.push({ id, s: sp, core, t: 0, life: 10, ph: Math.random() * Math.PI * 2 });
  }

  /** A table's toast is counting ("MỘT · HAI · BA"), `n` glasses raised. */
  dzo(t: number, at: number, n: number) {
    const tb = WED_TABLES[t];
    if (!tb) return;
    let tag = this.dzoTags.get(t);
    if (!tag) {
      const tex = canvasTexture(384, 192, () => {});
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      sp.position.set(tb.x, 2.35, tb.z);
      sp.scale.set(1.2, 0.6, 1);
      this.root.add(sp);
      tag = { s: sp, g: (tex.image as HTMLCanvasElement).getContext('2d')!, tex, at, n, key: '' };
      this.dzoTags.set(t, tag);
    }
    tag.at = at;
    tag.n = n;
  }

  /** "DZÔ!" — the clink over a table. */
  dzoGo(t: number, n: number, couple: boolean) {
    const tb = WED_TABLES[t];
    this.dropTag(t);
    if (!tb) return;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: word('DZÔ! 🍻', '#c2185b'), transparent: true, depthWrite: false, toneMapped: false }));
    sp.position.set(tb.x, 1.9, tb.z);
    sp.scale.set(1.6, 0.5, 1);
    this.root.add(sp);
    this.floats.push({ s: sp, t: 0, life: 1.8, vx: 0, vy: 0.55, vz: 0, grow: 0 });
    // glasses meet over the middle of the table: gold sparks, a puff of foam
    this.sparks.burst(tb.x, 1.35, tb.z, 18 + n * 8, 1.6, GOLD, 0.8, 1.2);
    for (let i = 0; i < 10 + n * 5; i++) this.sparks.emit(tb.x + (Math.random() - 0.5) * 0.5, 1.2, tb.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8, 0.9, WARM, 2.5);
    if (couple) this.hearts(tb.x, 1.8, tb.z, 10, 0.7);
  }

  private dropTag(t: number) {
    const tag = this.dzoTags.get(t);
    if (!tag) return;
    this.root.remove(tag.s);
    tag.s.material.dispose();
    tag.tex.dispose();
    this.dzoTags.delete(t);
  }

  private drawTag(tag: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; at: number; n: number; key: string }, now: number) {
    const left = tag.at - now;
    const say = left > (DZO_MS * 2) / 3 ? 'MỘT' : left > DZO_MS / 3 ? 'HAI' : 'BA';
    const key = `${say}|${tag.n}`;
    if (key === tag.key) return;
    tag.key = key;
    const g = tag.g;
    const w = 384;
    const h = 192;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(122, 22, 58, 0.82)';
    roundRect(g, 14, 18, w - 28, h - 36, 40);
    g.fill();
    g.strokeStyle = '#ffd58a';
    g.lineWidth = 5;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '900 78px "Be Vietnam Pro", sans-serif';
    g.fillText(`${say}…`, w / 2, h / 2 - 12);
    g.fillStyle = '#ffd58a';
    g.font = '700 28px "Be Vietnam Pro", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    g.fillText(`🍻 ${tag.n} ly đang nâng`, w / 2, h / 2 + 46);
    tag.tex.needsUpdate = true;
  }

  /** Party popper: a cone of confetti out of someone's hand. */
  popper(x: number, z: number, y: number, ry: number) {
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    for (let i = 0; i < 70; i++) {
      const sp = 3.2 + Math.random() * 2.6;
      const side = (Math.random() - 0.5) * 1.6;
      this.confetti.emit(x + fx * 0.3, y + 1.35, z + fz * 0.3, fx * sp + fz * side, 3.2 + Math.random() * 2.4, fz * sp - fx * side, 3.2 + Math.random() * 1.5);
    }
    this.sparks.burst(x + fx * 0.35, y + 1.4, z + fz * 0.35, 18, 2.4, GOLD, 0.6);
  }

  /** A handful of petals thrown forward. */
  toss(x: number, z: number, y: number, ry: number) {
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    for (let i = 0; i < 46; i++) {
      const sp = 1.6 + Math.random() * 1.8;
      const side = (Math.random() - 0.5) * 1.4;
      this.petals.emit(x + fx * 0.3, y + 1.4, z + fz * 0.3, fx * sp + fz * side, 1.8 + Math.random() * 1.6, fz * sp - fx * side, 5 + Math.random() * 3);
    }
  }

  /** A red envelope flies from someone into the gift box. */
  envelope(x: number, z: number, y: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.012), new THREE.MeshStandardMaterial({ color: '#d1242f', roughness: 0.5, emissive: '#3a0508' }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.014), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.8, roughness: 0.3 }));
    g.add(body, band);
    this.root.add(g);
    this.envelopes.push({ g, t: 0, from: new THREE.Vector3(x, y + 1.25, z), to: new THREE.Vector3(WED_GIFT.x, 1.02, WED_GIFT.z) });
  }

  private hearts(x: number, y: number, z: number, n: number, spread = 1) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex(), transparent: true, depthWrite: false, toneMapped: false }));
      s.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
      s.scale.setScalar(0.12);
      this.root.add(s);
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.9) * spread;
      this.floats.push({ s, t: 0, life: 2.2 + Math.random() * 1.4, vx: Math.cos(a) * sp, vy: 0.7 + Math.random() * 0.9, vz: Math.sin(a) * sp, grow: 0.18 + Math.random() * 0.22 });
    }
  }

  /** Confetti cannons either side of the stage. */
  private cannons() {
    for (const sx of [-1, 1]) {
      const x = (WED_STAGE.x0 + WED_STAGE.x1) / 2 + sx * 6.2;
      for (let i = 0; i < 150; i++) {
        this.confetti.emit(x, WED_STAGE.h + 0.6, WED_STAGE.z1 - 0.2, -sx * (0.4 + Math.random() * 2.2), 6 + Math.random() * 3.2, 1.2 + Math.random() * 3.6, 4.5 + Math.random() * 2);
      }
      this.sparks.burst(x, WED_STAGE.h + 0.8, WED_STAGE.z1, 30, 3.5, GOLD, 0.8);
    }
  }

  // ------------------------------------------------------------------ per frame
  /** Positions of the couple's feet (or their spots if they aren't drawn). */
  private couple(step: WedStep): [Who | null, Who | null] {
    const s = this.s;
    const sp = STEP_META[step].spots ? WED_SPOTS[STEP_META[step].spots!] : null;
    const pick = (id: string | undefined, k: 0 | 1): Who | null => {
      const p = id ? this.people(id) : null;
      if (p) return p;
      return sp ? { x: sp[k].x, z: sp[k].z, y: 0, ry: sp[k].ry } : null;
    };
    return [pick(s?.bride?.id, 0), pick(s?.groom?.id, 1)];
  }

  private setFill(p: number) {
    if (Math.abs(p - this.liquidFill) < 0.002) return;
    this.liquidFill = p;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    // tiers from the top glass down (the array lists the top glass last)
    const ys = [...new Set(CHAMPAGNE_GLASSES.map((g) => g.y))].sort((a, b) => b - a);
    CHAMPAGNE_GLASSES.forEach((g, i) => {
      const tier = ys.indexOf(g.y);
      const f = clamp01(p * ys.length - tier);
      v.set(WED_TOWER.x + g.x, g.y - g.r * 0.45, WED_TOWER.z + g.z);
      sc.set(g.r, Math.max(0.001, f) * g.r * 1.5, g.r);
      m.compose(v, q, sc);
      this.liquid.setMatrixAt(i, m);
    });
    this.liquid.instanceMatrix.needsUpdate = true;
    this.liquid.visible = p > 0.001;
  }

  tick(dt: number, now: number) {
    this.t += dt;
    const t = this.t;
    const s = this.s;
    const step: WedStep = s?.step ?? 'idle';
    const el = s ? now - s.stepAt : 0;
    const idx = stepIdx(step);
    const party = step === 'party';
    const romance = step === 'dance';
    const cue = (c: WedCue) => s && this.onCue(c, s);

    // ---------- timed moments of the programme
    if (s && step !== 'idle') {
      if (this.once('start', el, 0, 4000)) {
        if (step === 'march') cue('march');
        if (step === 'feast') cue('feast');
        if (step === 'dance') cue('dance');
        if (step === 'party') {
          cue('party');
          this.cannons();
        }
        if (step === 'cake') cue('drumroll');
      }
      if (step === 'march' && this.once('go', el, WED_T.marchGo, 6000)) cue('marchGo');
      if (step === 'rings' && this.once('rise', el, WED_T.ringsRise)) {
        cue('rings');
        this.sparks.burst(WED_RINGS.x, WED_STAGE.h + 1.0, WED_RINGS.z, 40, 1.4, GOLD, 1.2, 0.4);
      }
      if (step === 'rings' && this.once('land', el, WED_T.ringsLand)) {
        cue('ringsLand');
        const [b, g] = this.couple(step);
        for (const p of [b, g]) if (p) this.sparks.burst(p.x, p.y + 1.15, p.z, 36, 1.6, GOLD, 1.0, 0.6);
      }
      const kissAt = s.kiss?.at ?? (s.kiss ? null : s.stepAt + WED_T.kiss);
      if (step === 'kiss' && kissAt !== null && this.once('kiss', el, kissAt - s.stepAt)) {
        cue('kiss');
        const [b, g] = this.couple(step);
        const mx = b && g ? (b.x + g.x) / 2 : WED_RINGS.x;
        const mz = b && g ? (b.z + g.z) / 2 : 2.3;
        this.hearts(mx, WED_STAGE.h + 1.7, mz, 26, 1.1);
        this.cannons();
        for (let i = 0; i < 90; i++) this.petals.emit(mx + (Math.random() - 0.5) * 3.4, WALL_H - 0.2, mz + (Math.random() - 0.5) * 2.2, 0, -0.2, 0, 6 + Math.random() * 3);
      }
      if (step === 'cake' && this.once('cut', el, WED_T.cakeCut)) {
        cue('cakeCut');
        this.sparks.burst(WED_CAKE.x, CAKE_TOP_Y + 0.1, WED_CAKE.z, 50, 1.8, GOLD, 1.2, 0.8);
        this.hearts(WED_CAKE.x, CAKE_TOP_Y + 0.2, WED_CAKE.z, 8, 0.6);
      }
      if (step === 'champagne' && this.once('pour', el, WED_T.pour)) cue('pour');
      if (step === 'toast') {
        for (let i = 0; i < 3; i++) if (this.once(`tick${i}`, el, WED_T.toastCount + i * 1000, 900)) cue('toastTick');
        if (this.once('dô', el, WED_T.toastCount + 3000)) {
          cue('toastGo');
          for (const tb of WED_TABLES) this.sparks.burst(tb.x, 1.6, tb.z, 10, 1.2, GOLD, 0.9, 0.5);
        }
      }
      if (step === 'bouquet') {
        for (let i = 0; i < 3; i++) if (this.once(`btick${i}`, el, WED_T.bouquetCount + i * 1000, 900)) cue('bouquetTick');
        if (this.once('throw', el, WED_T.bouquetThrow, 3000)) cue('bouquetThrow');
        // the best moment to grab: the bouquet flashes
        if (!s.bouquet && this.once('perfect', el, WED_T.bouquetPerfect, 600)) this.sparks.burst(BOUQUET_APEX.x, BOUQUET_APEX.y, BOUQUET_APEX.z, 34, 1.8, GOLD, 0.7, 0.3);
        if (s.bouquet && now >= s.bouquet.at && this.once('land', el, s.bouquet.at - s.stepAt, 3000)) {
          if (s.bouquet.id) {
            cue('bouquetCatch');
            const p = this.people(s.bouquet.id) ?? { x: s.bouquet.x, z: s.bouquet.z, y: 0, ry: 0 };
            this.hearts(p.x, p.y + 1.9, p.z, 14, 0.7);
            for (let i = 0; i < 80; i++) this.confetti.emit(p.x, p.y + 2.6, p.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 3 + Math.random() * 1.5);
          } else cue('bouquetMiss');
        }
      }
    }

    // ---------- the aisle: petals rain over the couple as they walk in
    if (step === 'march' && el > WED_T.marchGo - 500 && el < WED_T.marchGo + 22000) {
      const [b, g] = this.couple(step);
      const cx = b && g ? (b.x + g.x) / 2 : F7 + 20;
      const cz = b && g ? Math.min(b.z, g.z) : 12;
      const rate = 70 * dt;
      for (let i = 0; i < rate; i++) this.petals.emit(cx + (Math.random() - 0.5) * 3.2, WALL_H - 0.15, cz - 0.5 - Math.random() * 3, (Math.random() - 0.5) * 0.3, -0.1, 0, 7 + Math.random() * 3);
    }

    // ---------- rings
    {
      const show = step === 'rings' && el > WED_T.ringsRise - 200 && el < WED_T.ringsLand + 1600;
      const [b, g] = this.couple('rings');
      this.rings.forEach((r, i) => {
        r.visible = this.ringGlow[i].visible = show;
        if (!show) return;
        const k = clamp01((el - WED_T.ringsRise) / (WED_T.ringsLand - WED_T.ringsRise));
        const start = new THREE.Vector3(WED_RINGS.x + (i ? 0.04 : -0.04), WED_STAGE.h + 1.0, WED_RINGS.z);
        const who = i ? g : b;
        const end = who ? new THREE.Vector3(who.x, who.y + 1.12, who.z) : start;
        const mid = start.clone().lerp(end, 0.5);
        mid.y = WED_STAGE.h + 2.3;
        // up, hover, then down to the hands (quadratic curve)
        const u = ease(k);
        const p = start.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(mid, 2 * u * (1 - u)).addScaledVector(end, u * u);
        r.position.copy(p);
        r.rotation.set(t * 1.6 + i, t * 2.4, 0.3);
        const fade = el > WED_T.ringsLand + 900 ? 1 - clamp01((el - WED_T.ringsLand - 900) / 700) : 1;
        r.scale.setScalar(Math.max(0.01, fade));
        this.ringGlow[i].position.copy(p);
        (this.ringGlow[i].material as THREE.SpriteMaterial).opacity = 0.7 * fade * (0.8 + 0.2 * Math.sin(t * 8 + i));
        if (Math.random() < dt * 14) this.sparks.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.3, -0.2, (Math.random() - 0.5) * 0.3, 0.7, GOLD, 0.3);
      });
    }

    // ---------- cake: knife glint and the cold sparkler fountains either side
    {
      const cutting = step === 'cake' && el > WED_T.cakeCut - 2200 && el < WED_T.cakeCut + 1500;
      this.knife.visible = cutting;
      if (cutting) {
        const k = clamp01((el - (WED_T.cakeCut - 2200)) / 2200);
        this.knife.position.set(WED_CAKE.x + 0.18, CAKE_TOP_Y * 0.42 + (1 - ease(k)) * 0.25, WED_CAKE.z - 0.1);
        this.knife.rotation.set(0, 0.5, -0.5 + k * 0.35);
      }
      const fount = step === 'cake' && el > WED_T.cakeCut - 300 && el < WED_T.cakeCut + 7000;
      if (fount) {
        for (const sx of [-1, 1]) {
          const n = Math.ceil(120 * dt);
          for (let i = 0; i < n; i++)
            this.sparks.emit(WED_CAKE.x + sx * 0.75, 0.1, WED_CAKE.z + 0.1, (Math.random() - 0.5) * 0.5, 4.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 0.4, Math.random() < 0.3 ? WARM : GOLD, 5.5);
        }
      }
    }

    // ---------- champagne tower
    {
      let fill = 0;
      if (idx > stepIdx('champagne')) fill = 1;
      else if (step === 'champagne') fill = clamp01((el - WED_T.pour) / WED_T.pourDur);
      this.setFill(fill);
      const pouring = step === 'champagne' && el > WED_T.pour - 1400 && el < WED_T.pour + WED_T.pourDur + 800;
      this.bottle.visible = pouring;
      const topG = CHAMPAGNE_GLASSES[CHAMPAGNE_GLASSES.length - 1];
      const topY = topG ? topG.y : 1.2;
      if (pouring) {
        const tilt = ease(clamp01((el - (WED_T.pour - 1400)) / 1200)) * (1 - ease(clamp01((el - WED_T.pour - WED_T.pourDur) / 800)));
        this.bottle.position.set(WED_TOWER.x - 0.16, topY + 0.42, WED_TOWER.z);
        this.bottle.rotation.set(0, 0, -0.4 - tilt * 1.6);
      }
      const flowing = step === 'champagne' && el > WED_T.pour && el < WED_T.pour + WED_T.pourDur;
      this.stream.visible = flowing;
      if (flowing) {
        const top = topY + 0.36;
        this.stream.position.set(WED_TOWER.x - 0.02, (top + topY) / 2, WED_TOWER.z);
        this.stream.scale.set(1, top - topY, 1);
        (this.stream.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.2 * Math.sin(t * 25);
        // bubbles in the filling glasses
        const n = Math.ceil(90 * dt);
        for (let i = 0; i < n; i++) {
          const g = CHAMPAGNE_GLASSES[(Math.random() * CHAMPAGNE_GLASSES.length) | 0];
          this.sparks.emit(WED_TOWER.x + g.x + (Math.random() - 0.5) * g.r, g.y, WED_TOWER.z + g.z + (Math.random() - 0.5) * g.r, 0, 0.35 + Math.random() * 0.3, 0, 0.6, WARM, -0.2);
        }
      }
    }

    // ---------- the feast on every table
    this.dishTarget = idx >= stepIdx('feast') ? 1 : 0;
    if (this.dishOn !== this.dishTarget) {
      this.dishOn = this.dishTarget ? Math.min(1, this.dishOn + dt * 1.6) : Math.max(0, this.dishOn - dt * 2);
      const k = ease(this.dishOn);
      for (const d of this.dishes) {
        d.visible = k > 0.01;
        d.scale.setScalar(Math.max(0.01, k));
        d.position.y = (1 - k) * 0.4;
      }
    }

    // ---------- the bouquet: over her shoulder, high over the dance floor (tumbling while everyone
    // reaches for it), then down into the hands of whoever grabbed best
    {
      const b = s?.bouquet;
      const inAir = !!s && step === 'bouquet' && el >= WED_T.bouquetThrow && (b ? now < b.at + 200 : el < WED_T.bouquetResolve + 5000);
      this.bouquet.visible = inAir;
      if (inAir && s) {
        const hang = (ms: number) => {
          const u = ms / 1000;
          return new THREE.Vector3(BOUQUET_APEX.x + Math.sin(u * 1.7) * 0.35, BOUQUET_APEX.y + Math.sin(u * 2.9) * 0.12, BOUQUET_APEX.z + Math.cos(u * 1.3) * 0.25);
        };
        let p: THREE.Vector3;
        const dropAt = b ? b.at - WED_T.bouquetFly : Infinity;
        if (now >= dropAt && b) {
          const k = clamp01((now - dropAt) / WED_T.bouquetFly);
          const catcher = b.id ? this.people(b.id) : null;
          const to = new THREE.Vector3(catcher?.x ?? b.x, catcher ? catcher.y + 1.5 : 0.08, catcher?.z ?? b.z);
          p = hang(dropAt - s.stepAt).lerp(to, k * k);
          p.y += Math.sin(k * Math.PI) * 0.4;
        } else {
          const k = clamp01((el - WED_T.bouquetThrow) / WED_T.bouquetRise);
          if (k < 1) {
            const bride = s.bride ? this.people(s.bride.id) : null;
            const from = new THREE.Vector3(bride?.x ?? WED_SPOTS.bouquet[0].x, (bride?.y ?? WED_STAGE.h) + 1.4, bride?.z ?? WED_SPOTS.bouquet[0].z);
            p = from.lerp(hang(el), ease(k));
            p.y += Math.sin(k * Math.PI) * 1.1;
          } else p = hang(el);
        }
        this.bouquet.position.copy(p);
        this.bouquet.rotation.set(t * 5.5, t * 2.2, t * 3.4);
        if (Math.random() < dt * 30) this.petals.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4, 3);
        if (!b && Math.random() < dt * 10) this.sparks.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, -0.3, (Math.random() - 0.5) * 0.6, 0.7, GOLD, 0.5);
      }
    }

    // ---------- the guests: phone torches, toast countdowns
    for (let i = this.torches.length - 1; i >= 0; i--) {
      const tc = this.torches[i];
      tc.t += dt;
      const p = this.people(tc.id);
      if (!p || tc.t >= tc.life) {
        this.root.remove(tc.s, tc.core);
        tc.s.material.dispose();
        tc.core.material.dispose();
        this.torches.splice(i, 1);
        continue;
      }
      const sway = Math.sin(tc.t * 1.6 + tc.ph);
      tc.s.position.set(p.x + Math.cos(p.ry) * 0.42 * sway + Math.sin(p.ry) * 0.18, p.y + 2.05 + Math.abs(sway) * 0.05, p.z - Math.sin(p.ry) * 0.42 * sway + Math.cos(p.ry) * 0.18);
      tc.core.position.copy(tc.s.position);
      const k = Math.min(1, tc.t * 3, (tc.life - tc.t) * 1.5);
      tc.s.material.opacity = k * (0.75 + 0.15 * Math.sin(tc.t * 13 + tc.ph));
      tc.core.material.opacity = k;
    }
    for (const [ti, tag] of this.dzoTags) {
      if (now > tag.at + 1500) this.dropTag(ti);
      else {
        this.drawTag(tag, now);
        tag.s.position.y = 2.35 + Math.sin(t * 6) * 0.03;
      }
    }

    // ---------- envelopes
    for (let i = this.envelopes.length - 1; i >= 0; i--) {
      const e = this.envelopes[i];
      e.t += dt / 0.95;
      const k = Math.min(1, e.t);
      const p = e.from.clone().lerp(e.to, ease(k));
      p.y += Math.sin(k * Math.PI) * 0.9;
      e.g.position.copy(p);
      e.g.rotation.set(0, k * 8, Math.sin(k * 10) * 0.3);
      if (k >= 1) {
        this.sparks.burst(e.to.x, e.to.y + 0.1, e.to.z, 14, 1.1, GOLD, 0.7, 0.6);
        this.root.remove(e.g);
        e.g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        this.envelopes.splice(i, 1);
      }
    }

    // ---------- lights
    this.fairyMat.uniforms.time.value = t;
    // with the house lights up the decorative glows step back; with them off they carry the room
    const lk = this.lights === 'on' ? 0.55 : this.lights === 'off' ? 1.2 : 1;
    this.fairyMat.uniforms.boost.value = (party ? 1.25 : 1) * lk;
    this.glowMat.uniforms.boost.value = this.lights === 'on' ? 0.75 : this.lights === 'off' ? 1.15 : 1;
    if (party) this.edgeMat.color.copy(PARTY_HUES[Math.floor(t / 1.2) % PARTY_HUES.length]).lerp(PARTY_HUES[(Math.floor(t / 1.2) + 1) % PARTY_HUES.length], (t / 1.2) % 1);
    else this.edgeMat.color.copy(GOLD).multiplyScalar(0.75 + 0.25 * Math.sin(t * 1.4));
    this.glowMat.uniforms.time.value = t;
    this.motesMat.uniforms.time.value = t;
    this.motesMat.uniforms.boost.value = (party ? 1.4 : 1) * (this.lights === 'on' ? 0.35 : lk);
    (this.pools.material as THREE.MeshBasicMaterial).opacity = (party ? 0.16 : 0.34) * (this.lights === 'on' ? 0.45 : lk) * (0.94 + 0.06 * Math.sin(t * 2.1));
    // uplights breathe; in the party they chase through the colours
    const upM = this.uplights.material as THREE.MeshBasicMaterial;
    upM.opacity = (0.55 + 0.1 * Math.sin(t * 0.7)) * (this.lights === 'on' ? 0.6 : lk);
    if (party) upM.color.copy(PARTY_HUES[Math.floor(t / 1.6) % PARTY_HUES.length]).lerp(WARM, 0.35);
    else upM.color.set('#ffffff');
    (this.stageWash.material as THREE.MeshBasicMaterial).opacity = (romance ? 0.55 : 0.42) * (0.85 + 0.15 * Math.sin(t * 0.5));
    // the gobo turns slowly (spins and changes colour in the party)
    this.gobo.rotation.z += dt * (party ? 0.35 : 0.06);
    const gm = this.gobo.material as THREE.MeshBasicMaterial;
    if (party) gm.color.copy(PARTY_HUES[Math.floor(t / 0.8) % PARTY_HUES.length]);
    else gm.color.copy(romance ? BLUSH : WARM);
    gm.opacity = party ? 0.45 : romance ? 0.4 : 0.26;
    (this.trussBeams.material as THREE.MeshBasicMaterial).opacity = step !== 'idle' && step !== 'feast' && !party ? 0.085 : 0.05;

    // dance floor (20 Hz is plenty)
    this.tileAcc += dt;
    if (this.tileAcc > 0.05) {
      this.tileAcc = 0;
      const c = new THREE.Color();
      for (let i = 0; i < this.tileCols; i++)
        for (let j = 0; j < this.tileRows; j++) {
          const k = i * this.tileRows + j;
          // (additive on top of an already bright marble floor, after the sRGB encode: a little
          // linear colour goes a long way — idle tiles only give the floor a faint sheen)
          if (party) {
            const h = PARTY_HUES[(i + j + Math.floor(t * 2.5)) % PARTY_HUES.length];
            const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(t * 6.3 - i * 0.6 + j * 0.4));
            c.copy(h).multiplyScalar(pulse * 0.32);
          } else if (romance || step === 'bouquet') {
            const w = 0.5 + 0.5 * Math.sin(t * 1.4 - Math.hypot(i - 6.5, j - 3.5) * 0.7);
            c.copy(BLUSH).lerp(GOLD, w).multiplyScalar(0.015 + 0.05 * w);
          } else {
            const w = 0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.5 + j * 0.9);
            c.copy(WARM).multiplyScalar(0.004 + 0.005 * w);
          }
          this.tiles.setColorAt(k, c);
        }
      if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    }

    // follow spots: on the couple during the ceremony, the catcher after the toss
    {
      const lit = step !== 'idle' && step !== 'feast' && step !== 'party';
      const [b, g] = this.couple(step);
      const targets: (Who | null)[] = [lit ? b : null, lit ? g : null, null];
      const bq = s?.bouquet;
      if (step === 'bouquet' && bq?.id && now >= bq.at) targets[2] = this.people(bq.id);
      this.spots.forEach((sp, i) => {
        const tg = targets[i];
        sp.on += ((tg ? 1 : 0) - sp.on) * (1 - Math.exp(-3 * dt));
        sp.cone.visible = sp.pool.visible = sp.on > 0.01;
        if (!sp.cone.visible) return;
        if (tg) {
          sp.x += (tg.x - sp.x) * (1 - Math.exp(-6 * dt));
          sp.z += (tg.z - sp.z) * (1 - Math.exp(-6 * dt));
        }
        const fy = tg?.y ?? 0;
        const h = WALL_H - 0.1 - fy;
        sp.cone.position.set(sp.x, fy + h / 2, sp.z);
        sp.cone.scale.set(1, h / (WALL_H - 0.1), 1);
        sp.pool.position.set(sp.x, fy + 0.015, sp.z);
        (sp.cone.material as THREE.MeshBasicMaterial).opacity = 0.07 * sp.on;
        (sp.pool.material as THREE.MeshBasicMaterial).opacity = 0.5 * sp.on;
      });
    }
    // party beams
    this.beamOn += ((party ? 1 : 0) - this.beamOn) * (1 - Math.exp(-2 * dt));
    this.beams.forEach((bm, i) => {
      bm.visible = this.beamOn > 0.01;
      if (!bm.visible) return;
      const a = t * (0.4 + i * 0.06) + i * 1.3;
      bm.rotation.set(0.6 + Math.sin(a) * 0.4, a * 0.5 + (i % 2 ? 0.8 : -0.8), Math.cos(a * 0.8) * 0.35);
      (bm.material as THREE.MeshBasicMaterial).opacity = 0.11 * this.beamOn;
      (bm.material as THREE.MeshBasicMaterial).color.copy(PARTY_HUES[(i + Math.floor(t / 2.5)) % PARTY_HUES.length]);
    });

    // cold smoke: on the aisle for the march, on the stage for the kiss, on the dance floor
    this.smokeTarget = 0;
    if (step === 'march' && el < WED_T.marchGo + 24000) {
      this.smokeTarget = 1;
      this.smokeAt = 'aisle';
    } else if (step === 'kiss' && el < 14000) {
      this.smokeTarget = 0.9;
      this.smokeAt = 'stage';
    } else if (step === 'dance') {
      this.smokeTarget = 1;
      this.smokeAt = 'dance';
    }
    this.smokeLevel += (this.smokeTarget - this.smokeLevel) * (1 - Math.exp(-(this.smokeTarget > this.smokeLevel ? 0.9 : 0.5) * dt));
    const smokeOn = this.smokeLevel > 0.01;
    this.smoke.forEach((m, i) => {
      if (!smokeOn) {
        m.s.visible = false;
        return;
      }
      if (!m.s.visible || m.base.x === 0) {
        // (re)place the cloud over the area it belongs to
        const area =
          this.smokeAt === 'aisle'
            ? { x0: F7 + 18.4, x1: F7 + 21.6, z0: 4.5, z1: 18.5 }
            : this.smokeAt === 'stage'
              ? { x0: F7 + 15, x1: F7 + 25, z0: 1.0, z1: 4.6 }
              : { x0: WED_DANCE.x0, x1: WED_DANCE.x1, z0: WED_DANCE.z0, z1: WED_DANCE.z1 };
        const floorY = this.smokeAt === 'stage' && i % 3 ? WED_STAGE.h : 0;
        m.base.set(area.x0 + Math.random() * (area.x1 - area.x0), floorY + 0.18 + Math.random() * 0.2, area.z0 + Math.random() * (area.z1 - area.z0));
        m.s.visible = true;
      }
      const drift = Math.sin(t * 0.25 + m.ph) * 0.4;
      m.s.position.set(m.base.x + drift, m.base.y + Math.sin(t * 0.4 + m.ph) * 0.06, m.base.z + Math.cos(t * 0.21 + m.ph) * 0.3);
      m.s.scale.setScalar(1.6 + 0.5 * Math.sin(t * 0.3 + m.ph));
      (m.s.material as THREE.SpriteMaterial).opacity = 0.38 * this.smokeLevel * (0.7 + 0.3 * Math.sin(t * 0.5 + m.ph));
    });
    if (!smokeOn) for (const m of this.smoke) m.base.x = 0;

    // ---------- particles and floaters
    this.petals.tick(dt, t);
    this.confetti.tick(dt, t);
    this.sparks.tick(dt, t);
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      f.s.position.x += f.vx * dt;
      f.s.position.y += f.vy * dt;
      f.s.position.z += f.vz * dt;
      f.vx *= Math.exp(-1.2 * dt);
      f.vz *= Math.exp(-1.2 * dt);
      if (f.grow) f.s.scale.setScalar(Math.min(f.grow, 0.12 + f.t * 0.6));
      (f.s.material as THREE.SpriteMaterial).opacity = Math.min(1, (f.life - f.t) / 0.6);
      if (f.t >= f.life) {
        this.root.remove(f.s);
        f.s.material.dispose();
        this.floats.splice(i, 1);
      }
    }

    // ---------- the LED wall (the music video shows through its middle during the feast and the party)
    if (this.videoHole) this.videoHole.visible = this.videoShows(step);
    this.screenAcc += dt;
    if (this.screenAcc > 0.15) {
      this.screenAcc = 0;
      this.drawScreen(now);
    }
  }
}

// ------------------------------------------------------------------ canvas helpers
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number) {
  const w = g.measureText(text).width;
  if (w <= max) return g.fillText(text, x, y);
  g.save();
  g.translate(x, y);
  g.scale(max / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      g.fillText(line, x, y + n * lh);
      line = w;
      if (++n >= lines - 1) break;
    } else line = test;
  }
  if (line && n < lines) fitText(g, line, x, y + n * lh, max);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function drawHeart(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: string) {
  g.save();
  g.translate(x, y);
  g.fillStyle = c;
  g.shadowColor = c;
  g.shadowBlur = 18;
  g.beginPath();
  g.moveTo(0, s * 0.85);
  g.bezierCurveTo(-s * 1.2, s * 0.1, -s * 0.6, -s * 0.9, 0, -s * 0.35);
  g.bezierCurveTo(s * 0.6, -s * 0.9, s * 1.2, s * 0.1, 0, s * 0.85);
  g.fill();
  g.restore();
}

function dateLine(): string {
  const d = new Date();
  const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  return `${days[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
