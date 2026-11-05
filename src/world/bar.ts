// Animated bits of the Office Bar (upper floor): LED dance floor, disco ball with light dots, sweeping
// beams, chase lights along the ceiling, a strobe, spinning records, an equaliser, neon signs and
// the jukebox LED wall. The room itself is kept dark (see World.setDim): all the "light" here is
// emissive or additive — no real light sources, which would cost every pixel of the whole scene.
import * as THREE from 'three';
import { BAR, BAR_SCREEN, DANCE_FLOOR, FURNITURE, WHEEL_SPOT } from '../../shared/map';
import { WHEEL_PRIZES, WHEEL_SPIN_MS } from '../../shared/protocol';
import { canvasTexture } from './materials';

const PALETTE = ['#ff3ea5', '#2de2e6', '#ffd23f', '#7b2ff7', '#ff7a00', '#39ff88'].map((c) => new THREE.Color(c));
const WHITE = new THREE.Color('#ffffff');

/** Beat-derived party state shared by the bar effects and the room lighting (World). */
export function party(beat: number): { kick: number; bar: number; strobe: boolean; color: THREE.Color } {
  const beatI = Math.floor(beat);
  const frac = beat - beatI;
  const bar = Math.floor(beat / 4);
  // strobe: a flash on every beat of each 4th bar, plus random downbeat hits — never more than
  // ~2 flashes a second (photosensitivity guideline: at most 3 per second)
  const strobe = frac < 0.12 && (bar % 4 === 3 || hash3(beatI, 5, 11) > 0.86);
  return { kick: Math.exp(-frac * 5), bar, strobe, color: PALETTE[(bar + (beatI % 2) * 2) % PALETTE.length] };
}
const BALL = { x: (DANCE_FLOOR.x0 + DANCE_FLOOR.x1) / 2, y: 2.62, z: (DANCE_FLOOR.z0 + DANCE_FLOOR.z1) / 2 };

function hash3(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

let radial: THREE.CanvasTexture | null = null;
/** Soft white disc (light pools, beam hit spots). */
function radialTex(): THREE.CanvasTexture {
  radial ??= canvasTexture(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  return radial;
}

const BEAM_LEN = 9;
const BEAM_R = 1.6;
const tmpDir = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const EAST = new THREE.Vector3(1, 0, 0);
type Face = 'floor' | 'x0' | 'x1' | 'z0' | 'z1';

/** Distance from `o` along `d` to the first surface of the bar room (floor or a wall). */
function hitRoom(o: THREE.Vector3, d: THREE.Vector3): { t: number; face: Face } {
  const lim = { x0: BAR.x0 + 0.12, x1: BAR.x1 - 0.12, z0: BAR.z0 + 0.12, z1: BAR.z1 - 0.12 };
  let t = d.y < -1e-3 ? (o.y - 0.05) / -d.y : Infinity;
  let face: Face = 'floor';
  const wall = (tt: number, f: Face) => {
    if (tt > 0 && tt < t) {
      t = tt;
      face = f;
    }
  };
  if (d.x < -1e-3) wall((lim.x0 - o.x) / d.x, 'x0');
  if (d.x > 1e-3) wall((lim.x1 - o.x) / d.x, 'x1');
  if (d.z < -1e-3) wall((lim.z0 - o.z) / d.z, 'z0');
  if (d.z > 1e-3) wall((lim.z1 - o.z) / d.z, 'z1');
  return { t, face };
}

/** Dark frame behind the LED wall. */
function rbox16(root: THREE.Group, w: number, h: number, d: number, sc: typeof BAR_SCREEN) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), new THREE.MeshStandardMaterial({ color: '#111116', roughness: 0.5 }));
  frame.position.set(sc.x + 0.02, sc.y, sc.z);
  root.add(frame);
}

export class BarFx {
  private tiles: THREE.InstancedMesh;
  private cols: number;
  private rows: number;
  private ball: THREE.Mesh;
  private dots: THREE.Mesh;
  private dotsMat: THREE.MeshBasicMaterial;
  private beams: { pivot: THREE.Object3D; cone: THREE.Mesh; mat: THREE.MeshBasicMaterial; lensMat: THREE.MeshBasicMaterial; spot: THREE.Mesh; spotMat: THREE.MeshBasicMaterial; phase: number }[] = [];
  private wallDots: THREE.MeshBasicMaterial | null = null;
  private platters: THREE.Object3D[] = [];
  private eq: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; acc: number } | null = null;
  private neon: THREE.MeshBasicMaterial[] = [];
  private lasers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private pools: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; r: number; still: boolean }[] = [];
  private bulbs: THREE.InstancedMesh;
  private strobe: THREE.MeshBasicMaterial;
  private screenIdle: THREE.Material;
  private screenHole = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, fog: false, toneMapped: false });
  readonly screen: THREE.Mesh;
  private t = 0;
  private flicker = 0;
  private tmp = new THREE.Color();

  /** everything here (hidden while the camera is in the cinema, behind the wall) */
  readonly root: THREE.Group;

  constructor(up: THREE.Group) {
    const root = (this.root = new THREE.Group());
    root.name = 'bar-fx';
    up.add(root);

    // ---------------- LED dance floor
    this.cols = Math.round(DANCE_FLOOR.x1 - DANCE_FLOOR.x0);
    this.rows = Math.round(DANCE_FLOOR.z1 - DANCE_FLOOR.z0);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(DANCE_FLOOR.x1 - DANCE_FLOOR.x0 + 0.1, 0.03, DANCE_FLOOR.z1 - DANCE_FLOOR.z0 + 0.1),
      new THREE.MeshStandardMaterial({ color: '#0d0b12', roughness: 0.3, metalness: 0.4 }),
    );
    base.position.set(BALL.x, 0.012, BALL.z);
    base.receiveShadow = true;
    root.add(base);
    this.tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.02, 0.9), new THREE.MeshBasicMaterial({ toneMapped: false }), this.cols * this.rows);
    const m = new THREE.Matrix4();
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        m.makeTranslation(DANCE_FLOOR.x0 + 0.5 + i, 0.03, DANCE_FLOOR.z0 + 0.5 + j);
        this.tiles.setMatrixAt(j * this.cols + i, m);
        this.tiles.setColorAt(j * this.cols + i, PALETTE[(i + j) % PALETTE.length]);
      }
    }
    this.tiles.computeBoundingSphere();
    root.add(this.tiles);

    // ---------------- disco ball + rotating light dots
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), new THREE.MeshStandardMaterial({ color: '#eef0f6', metalness: 1, roughness: 0.14, flatShading: true }));
    this.ball.position.set(BALL.x, BALL.y, BALL.z);
    root.add(this.ball);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2 - BALL.y - 0.28, 6), new THREE.MeshStandardMaterial({ color: '#888' }));
    rod.position.set(BALL.x, (3.2 + BALL.y + 0.28) / 2, BALL.z);
    root.add(rod);
    const dotTex = canvasTexture(512, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const a = hash3(i, 1, 7) * Math.PI * 2;
        const r = Math.sqrt(hash3(i, 2, 7)) * (w / 2 - 12);
        const x = w / 2 + Math.cos(a) * r;
        const y = h / 2 + Math.sin(a) * r;
        const s = 3 + hash3(i, 3, 7) * 4;
        const gr = g.createRadialGradient(x, y, 0, x, y, s);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x - s, y - s, s * 2, s * 2);
      }
    });
    this.dotsMat = new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.dots = new THREE.Mesh(new THREE.CircleGeometry(6.4, 48), this.dotsMat);
    this.dots.rotation.x = -Math.PI / 2;
    this.dots.position.set(BALL.x, 0.05, BALL.z);
    this.dots.renderOrder = 3;
    root.add(this.dots);

    // ---------------- disco-ball dots on the walls too (scrolling = the ball turning)
    const wallTex = canvasTexture(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const x = hash3(i, 4, 2) * w;
        const y = 12 + hash3(i, 6, 2) * (h - 24);
        const s = 2.5 + hash3(i, 8, 2) * 3.5;
        const gr = g.createRadialGradient(x, y, 0, x, y, s);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x - s, y - s, s * 2, s * 2);
      }
    });
    wallTex.wrapS = THREE.RepeatWrapping;
    this.wallDots = new THREE.MeshBasicMaterial({ map: wallTex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const WH = 2.9;
    const wall = (x0: number, z0: number, x1: number, z1: number, ry: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.PlaneGeometry(len, WH);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * len) / 8 + x0 * 0.07); // ~8 m per texture repeat
      const m = new THREE.Mesh(g, this.wallDots!);
      m.position.set((x0 + x1) / 2, 0.15 + WH / 2, (z0 + z1) / 2);
      m.rotation.y = ry;
      m.renderOrder = 3;
      root.add(m);
    };
    wall(BAR.x0 + 0.3, BAR.z0 + 0.105, BAR.x1 - 0.3, BAR.z0 + 0.105, 0); // north (behind the bottles)
    wall(BAR.x0 + 0.105, BAR.z0 + 0.3, BAR.x0 + 0.105, BAR.z1 - 0.3, Math.PI / 2); // west
    wall(BAR.x1 - 0.105, BAR.z0 + 0.3, BAR.x1 - 0.105, BAR.z1 - 0.3, -Math.PI / 2); // east
    wall(BAR.x0 + 0.3, BAR.z1 - 0.105, 89.9, BAR.z1 - 0.105, Math.PI); // south, either side of the door
    wall(92.5, BAR.z1 - 0.105, BAR.x1 - 0.3, BAR.z1 - 0.105, Math.PI);

    // ---------------- light beams from the ceiling over the DJ booth
    // long enough to always reach the floor or a wall — whatever sticks out is hidden behind them
    const coneGeo = new THREE.ConeGeometry(BEAM_R, BEAM_LEN, 24, 1, true);
    coneGeo.translate(0, -BEAM_LEN / 2, 0); // apex at the origin, opening downward
    const fade = canvasTexture(4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ffffff'); // apex
      gr.addColorStop(1, '#3a3a3a'); // far end, still visible where it lands
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    [[BAR.x1 - 1.6, 7.2], [BAR.x1 - 1.6, 10.5], [BAR.x1 - 1.6, 13.8], [BAR.x0 + 1.2, 6.0], [BAR.x0 + 1.2, 15.0]].forEach(([x, z], i) => {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 3.1, z);
      if (x < BAR.x0 + 5) pivot.rotation.y = Math.PI;
      const mat = new THREE.MeshBasicMaterial({ color: PALETTE[i % PALETTE.length], alphaMap: fade, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.renderOrder = 4;
      cone.frustumCulled = false;
      pivot.add(cone);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.18, 12), new THREE.MeshStandardMaterial({ color: '#202028', metalness: 0.5, roughness: 0.4 }));
      pivot.add(head);
      const lensMat = new THREE.MeshBasicMaterial({ color: PALETTE[i % PALETTE.length], toneMapped: false });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.095;
      pivot.add(lens);
      root.add(pivot);
      // where the beam lands (floor or wall): a bright spot
      const spotMat = new THREE.MeshBasicMaterial({ map: radialTex(), color: PALETTE[i % PALETTE.length], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spotMat);
      spot.renderOrder = 4;
      root.add(spot);
      this.beams.push({ pivot, cone, mat, lensMat, spot, spotMat, phase: i * 2.1 });
    });

    // ---------------- DJ booth: records + equaliser
    const dj = FURNITURE.find((f) => f.kind === 'djBooth');
    if (dj) {
      const booth = new THREE.Group();
      booth.position.set(dj.x, 0, dj.z);
      booth.rotation.y = dj.ry;
      root.add(booth);
      const vinyl = new THREE.MeshStandardMaterial({ color: '#0b0b0e', roughness: 0.35 });
      for (const [x, label] of [[-0.85, '#ff3ea5'], [0.85, '#2de2e6']] as const) {
        const p = new THREE.Group();
        p.position.set(x, 1.105, -0.05);
        const rec = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 32), vinyl);
        const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.014, 20), new THREE.MeshBasicMaterial({ color: label, toneMapped: false }));
        const mark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.016, 0.06), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        mark.position.set(0, 0, 0.12);
        p.add(rec, lab, mark);
        booth.add(p);
        this.platters.push(p);
      }
      const tex = canvasTexture(256, 64, () => {});
      const eq = new THREE.Mesh(new THREE.PlaneGeometry(dj.w - 0.5, 0.42), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      eq.position.set(0, 0.62, dj.d / 2 + 0.012);
      booth.add(eq);
      this.eq = { tex, g: (tex.image as HTMLCanvasElement).getContext('2d')!, acc: 0 };
    }

    // ---------------- neon signs (over the bottles, and over the door on the hall side)
    const neonTex = canvasTexture(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.font = 'italic 800 150px "Be Vietnam Pro", sans-serif';
      g.shadowColor = '#ff3ea5';
      g.shadowBlur = 38;
      g.strokeStyle = '#ff7ac4';
      g.lineWidth = 10;
      g.strokeText('OFFICE BAR', w / 2, 180);
      g.shadowColor = '#2de2e6';
      g.shadowBlur = 22;
      g.fillStyle = '#fff1fa';
      g.fillText('OFFICE BAR', w / 2, 180);
    });
    for (const [x, y, z, w, ry] of [
      [(BAR.x0 + BAR.x1) / 2, 2.78, 0.2, 3.2, 0],
      [91.2, 2.62, BAR.z1 + 0.14, 2.4, 0],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, depthWrite: false, toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
      sign.position.set(x, y, z);
      sign.rotation.y = ry;
      root.add(sign);
      this.neon.push(mat);
    }

    // ---------------- pools of coloured light on the floor (additive decals)
    const poolTex = canvasTexture(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    const pool = (r: number, color: THREE.Color, x: number, z: number, sx = 1, sz = 1, still = false, phase = 0) => {
      const mat = new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2 * sx, r * 2 * sz), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.045, z);
      mesh.renderOrder = 3;
      root.add(mesh);
      this.pools.push({ mesh, mat, phase, r, still });
    };
    pool(2.4, PALETTE[0], BALL.x, BALL.z, 1, 1, false, 0);
    pool(2.4, PALETTE[1], BALL.x, BALL.z, 1, 1, false, Math.PI);
    pool(2.0, PALETTE[3], BALL.x, BALL.z, 1, 1, false, Math.PI / 2);
    pool(2.6, new THREE.Color('#c8641e'), (BAR.x0 + BAR.x1) / 2, 4.3, 2.2, 0.8, true); // warm glow at the counter
    pool(2.4, new THREE.Color('#9b5cff'), BAR.x0 + 1.8, 10.5, 0.8, 2.6, true); // booths
    pool(1.6, new THREE.Color('#2de2e6'), BAR.x1 - 2.2, 10.5, 1, 1.6, true); // DJ

    // ---------------- chase lights along the ceiling edge
    const pts: [number, number][] = [];
    for (let x = BAR.x0 + 0.3; x < BAR.x1 - 0.2; x += 0.55) pts.push([x, BAR.z0 + 0.16], [x, BAR.z1 - 0.16]);
    for (let z = BAR.z0 + 0.6; z < BAR.z1 - 0.4; z += 0.55) pts.push([BAR.x0 + 0.16, z], [BAR.x1 - 0.16, z]);
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), pts.length * 2);
    pts.forEach(([x, z], i) => {
      for (const [row, y] of [3.04, 2.62].entries()) {
        m.makeTranslation(x, y, z);
        this.bulbs.setMatrixAt(i * 2 + row, m);
        this.bulbs.setColorAt(i * 2 + row, PALETTE[i % PALETTE.length]);
      }
    });
    this.bulbs.computeBoundingSphere();
    root.add(this.bulbs);

    // ---------------- strobe flash over the whole room
    this.strobe = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(BAR.x1 - BAR.x0 - 0.3, BAR.z1 - BAR.z0 - 0.3), this.strobe);
    flash.rotation.x = -Math.PI / 2;
    flash.position.set((BAR.x0 + BAR.x1) / 2, 0.06, (BAR.z0 + BAR.z1) / 2);
    flash.renderOrder = 5;
    root.add(flash);

    // ---------------- lasers from the DJ booth (thin additive lines)
    const laserGeo = new THREE.BoxGeometry(1, 0.014, 0.014);
    laserGeo.translate(0.5, 0, 0); // starts at the origin, shoots along +x; scaled to reach the wall
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: PALETTE[i % 2], transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(laserGeo, mat);
      mesh.position.set(BAR.x1 - 0.9, 2.95, 10.5 + (i - 2.5) * 0.12);
      mesh.renderOrder = 4;
      root.add(mesh);
      this.lasers.push({ mesh, mat });
    }

    // ---------------- jukebox LED wall above the DJ booth
    rbox16(root, BAR_SCREEN.w + 0.16, BAR_SCREEN.h + 0.16, 0.08, BAR_SCREEN);
    this.screenIdle = new THREE.MeshBasicMaterial({
      toneMapped: false,
      map: canvasTexture(768, 432, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h);
        gr.addColorStop(0, '#2a0f3d');
        gr.addColorStop(1, '#0b1a3a');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.textAlign = 'center';
        g.font = 'italic 800 84px "Be Vietnam Pro", sans-serif';
        g.shadowColor = '#ff3ea5';
        g.shadowBlur = 24;
        g.fillStyle = '#ffd6f0';
        g.fillText('OFFICE JUKEBOX', w / 2, h / 2 - 20);
        g.shadowBlur = 0;
        g.font = '500 32px "Be Vietnam Pro", sans-serif';
        g.fillStyle = '#c9d6ff';
        g.fillText('Dán link YouTube ở bảng 🎵 để chọn nhạc', w / 2, h / 2 + 50);
      }),
    });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(BAR_SCREEN.w, BAR_SCREEN.h), this.screenIdle);
    this.screen.position.set(BAR_SCREEN.x - 0.05, BAR_SCREEN.y, BAR_SCREEN.z);
    this.screen.rotation.y = BAR_SCREEN.ry;
    root.add(this.screen);
    this.buildWheel(root);
  }

  // ---------------- lucky wheel
  private wheel!: { disc: THREE.Mesh; bulbs: THREE.InstancedMesh; spin: { from: number; to: number; at: number } | null; angle: number; lastSector: number };
  /** Called for every sector passing the pointer (tick sound). */
  onWheelTick: (() => void) | null = null;

  private buildWheel(root: THREE.Group) {
    const n = WHEEL_PRIZES.length;
    const seg = (Math.PI * 2) / n;
    const cols = ['#ff3ea5', '#ffd23f', '#2de2e6', '#7b2ff7', '#ff7a00', '#39ff88', '#e5566b', '#6b8cff'];
    const short = ['🍹 Cocktail', '🎤 Hát 1 bài', '☕ Cà phê', '🍀 Lần sau', '💃 Nhảy', '🍕 Bao pizza', '🧧 Lì xì 0đ', '👑 Vua bar'];
    const tex = canvasTexture(768, 768, (g, w) => {
      const c = w / 2;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.moveTo(c, c);
        g.arc(c, c, c - 4, -Math.PI / 2 + i * seg, -Math.PI / 2 + (i + 1) * seg);
        g.closePath();
        g.fillStyle = cols[i % cols.length];
        g.fill();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 6;
        g.stroke();
        g.save();
        g.translate(c, c);
        g.rotate(-Math.PI / 2 + (i + 0.5) * seg);
        g.textAlign = 'right';
        g.fillStyle = '#1a1220';
        g.font = '800 40px "Be Vietnam Pro", sans-serif';
        g.fillText(short[i] ?? '', c - 36, 14);
        g.restore();
      }
    });
    const group = new THREE.Group();
    group.position.set(WHEEL_SPOT.x, WHEEL_SPOT.y, WHEEL_SPOT.z - 0.06);
    group.rotation.y = Math.PI; // faces into the room (north)
    root.add(group);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 64), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    group.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.045, 10, 64), new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.8, roughness: 0.25, emissive: '#5a3d10', emissiveIntensity: 0.6 }));
    group.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 20), new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.8, roughness: 0.25 }));
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.03;
    group.add(hub);
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 3), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
    pointer.rotation.z = Math.PI;
    pointer.position.set(0, 0.92, 0.06);
    group.add(pointer);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), 24);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * 0.88, Math.sin(a) * 0.88, 0.05);
      bulbs.setMatrixAt(i, m);
      bulbs.setColorAt(i, new THREE.Color('#ffd23f'));
    }
    bulbs.computeBoundingSphere();
    group.add(bulbs);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.32),
      new THREE.MeshBasicMaterial({
        transparent: true,
        toneMapped: false,
        map: canvasTexture(768, 128, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.textAlign = 'center';
          g.font = '800 52px "Be Vietnam Pro", sans-serif';
          g.shadowColor = '#ffd23f';
          g.shadowBlur = 18;
          g.fillStyle = '#fff6d6';
          g.fillText('🎡 VÒNG QUAY MAY MẮN', w / 2, 88);
        }),
      }),
    );
    sign.position.set(0, 1.12, 0.02);
    group.add(sign);
    this.wheel = { disc, bulbs, spin: null, angle: 0, lastSector: 0 };
  }

  /** Spin to `prize` (index in WHEEL_PRIZES), started at server time `at` (ms). */
  spinWheel(prize: number, at: number) {
    const w = this.wheel;
    const seg = (Math.PI * 2) / WHEEL_PRIZES.length;
    const target = (prize + 0.5) * seg; // this rotation puts that sector under the pointer
    const from = w.angle;
    const delta = ((((from - target) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) + Math.PI * 2 * 5;
    w.spin = { from, to: from - delta, at }; // clockwise, five full turns and then some
  }

  private tickWheel(nowMs: number) {
    const w = this.wheel;
    const sp = w.spin;
    let spinning = false;
    if (sp) {
      const k = Math.min(1, Math.max(0, (nowMs - sp.at) / WHEEL_SPIN_MS));
      const e = 1 - Math.pow(1 - k, 3);
      w.angle = sp.from + (sp.to - sp.from) * e;
      spinning = k < 1;
      if (!spinning) w.spin = null;
    }
    w.disc.rotation.z = w.angle;
    const seg = (Math.PI * 2) / WHEEL_PRIZES.length;
    const sector = Math.floor(-w.angle / seg);
    if (spinning && sector !== w.lastSector) this.onWheelTick?.();
    w.lastSector = sector;
    const c = this.tmp;
    const step = Math.floor(nowMs / (spinning ? 60 : 400));
    for (let i = 0; i < 24; i++) {
      c.set((i + step) % 2 ? '#ffd23f' : '#ff3ea5').multiplyScalar((i + step) % 3 === 0 ? 1.4 : 0.35);
      w.bulbs.setColorAt(i, c);
    }
    if (w.bulbs.instanceColor) w.bulbs.instanceColor.needsUpdate = true;
  }

  /** Put a beam's hit spot where its axis first meets the floor or a wall of the bar. */
  private placeSpot(pivot: THREE.Object3D, cone: THREE.Mesh, spot: THREE.Mesh) {
    pivot.updateMatrix();
    const d = tmpDir.copy(DOWN).applyQuaternion(pivot.quaternion);
    const o = pivot.position;
    const { t, face } = hitRoom(o, d);
    // the cone ends exactly where it lands (even when the wall in front of the camera is faded out)
    cone.scale.setScalar(Math.min(1, (Number.isFinite(t) ? t + 0.25 : BEAM_LEN) / BEAM_LEN));
    if (!Number.isFinite(t) || t > BEAM_LEN) {
      spot.visible = false;
      return;
    }
    spot.visible = true;
    spot.position.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    const r = (t / BEAM_LEN) * BEAM_R * 2.4;
    spot.scale.set(r, r, 1);
    spot.rotation.set(0, 0, 0);
    if (face === 'floor') spot.rotation.x = -Math.PI / 2;
    else if (face === 'x0') spot.rotation.y = Math.PI / 2;
    else if (face === 'x1') spot.rotation.y = -Math.PI / 2;
    else if (face === 'z1') spot.rotation.y = Math.PI;
  }

  /** true: punch a hole so the jukebox's YouTube iframe (CSS3D, behind the canvas) shows through. */
  setVideo(on: boolean) {
    this.screen.material = on ? this.screenHole : this.screenIdle;
  }

  /** `beat`: shared beat clock (float). `active`: you are upstairs (otherwise nothing animates). */
  tick(dt: number, beat: number, active: boolean) {
    if (!active) return;
    this.tickWheel((beat / (124 / 60)) * 1000); // the beat clock is server time × 124 BPM
    this.t += dt;
    const beatI = Math.floor(beat);
    const P = party(beat);
    const kick = P.kick;
    const bar = P.bar;
    const pattern = bar % 4;
    const hue = PALETTE[bar % PALETTE.length];
    const hue2 = PALETTE[(bar + 2) % PALETTE.length];

    // dance floor
    const c = this.tmp;
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        let k = 0.1;
        let col = hue;
        if (pattern === 0) {
          const on = (i + j + beatI) % 2 === 0;
          k = on ? 0.35 + 0.65 * kick : 0.08;
          col = on ? hue : hue2;
        } else if (pattern === 1) {
          const ring = Math.floor(Math.max(Math.abs(i - (this.cols - 1) / 2), Math.abs(j - (this.rows - 1) / 2)));
          const active = beatI % 3;
          k = ring === active ? 0.4 + 0.6 * kick : 0.1;
          col = PALETTE[(ring + bar) % PALETTE.length];
        } else if (pattern === 2) {
          k = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin((i + j) * 0.9 - beat * Math.PI));
          col = (i + beatI) % 2 ? hue : hue2;
        } else {
          const r = hash3(i, j, Math.floor(beat * 2));
          k = r > 0.62 ? 0.5 + 0.5 * kick : 0.06;
          col = PALETTE[Math.floor(r * 97) % PALETTE.length];
        }
        c.copy(col).multiplyScalar(k);
        this.tiles.setColorAt(j * this.cols + i, c);
      }
    }
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;

    // ball, dots, beams, records
    this.ball.rotation.y += dt * 0.7;
    this.dots.rotation.z -= dt * 0.35;
    this.dotsMat.color.copy(hue).lerp(WHITE, 0.55);
    this.dotsMat.opacity = 0.32 + 0.3 * kick;
    for (const b of this.beams) {
      b.pivot.rotation.z = -0.55 + Math.sin(this.t * 0.9 + b.phase) * 0.45;
      b.pivot.rotation.x = Math.sin(this.t * 0.63 + b.phase * 1.7) * 0.5;
      const col = PALETTE[(bar + Math.round(b.phase)) % PALETTE.length];
      b.mat.color.copy(col);
      b.lensMat.color.copy(col);
      b.spotMat.color.copy(col);
      const op = (beatI + Math.round(b.phase)) % 4 === 0 && pattern === 3 ? 0 : 0.09 + 0.16 * kick;
      b.mat.opacity = op;
      b.spotMat.opacity = Math.min(1, op * 3.2);
      this.placeSpot(b.pivot, b.cone, b.spot);
    }
    if (this.wallDots) {
      this.wallDots.map!.offset.x -= dt * 0.035;
      this.wallDots.color.copy(hue).lerp(WHITE, 0.5);
      this.wallDots.opacity = 0.22 + 0.3 * kick;
    }
    for (const p of this.platters) p.rotation.y -= dt * 3.5;

    // equaliser at ~12 fps
    if (this.eq) {
      this.eq.acc += dt;
      if (this.eq.acc > 0.08) {
        this.eq.acc = 0;
        const g = this.eq.g;
        g.fillStyle = '#07060c';
        g.fillRect(0, 0, 256, 64);
        for (let i = 0; i < 24; i++) {
          const lvl = Math.min(1, (0.25 + 0.75 * Math.abs(Math.sin(beat * 1.3 + i * 0.7))) * (i < 6 ? 0.45 + 0.55 * kick : 0.7 + 0.3 * hash3(i, beatI, 3)));
          const h = Math.round(lvl * 56);
          g.fillStyle = `hsl(${(i * 12 + bar * 40) % 360} 90% 60%)`;
          g.fillRect(4 + i * 10.4, 60 - h, 8, h);
        }
        this.eq.tex.needsUpdate = true;
      }
    }

    // neon flicker (rare)
    this.flicker -= dt;
    if (this.flicker < -2 - Math.random() * 3) this.flicker = 0.3;
    const on = this.flicker > 0 ? (Math.random() > 0.5 ? 0.35 : 1) : 1;
    for (const n of this.neon) n.opacity = on;

    // light pools: three circling the dance floor, the rest breathing in place
    for (const p of this.pools) {
      if (p.still) {
        p.mat.opacity = 0.32 + 0.1 * Math.sin(this.t * 1.3 + p.phase) + 0.08 * kick;
        continue;
      }
      const a = this.t * 0.9 + p.phase;
      p.mesh.position.x = BALL.x + Math.cos(a) * 2.4;
      p.mesh.position.z = BALL.z + Math.sin(a * 1.3) * 2.4;
      p.mat.color.copy(PALETTE[(bar + Math.round(p.phase * 2)) % PALETTE.length]);
      p.mat.opacity = 0.25 + 0.55 * kick;
    }
    // chase lights: a running pattern, one step per 8th note
    const step = Math.floor(beat * 4);
    for (let i = 0; i < this.bulbs.count; i++) {
      const on = (i + step) % 4 === 0 || (pattern === 3 && hash3(i, step, 9) > 0.7);
      c.copy(PALETTE[(Math.floor(i / 2) + bar) % PALETTE.length]).multiplyScalar(on ? 1.4 : 0.08);
      this.bulbs.setColorAt(i, c);
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.strobe.opacity = P.strobe ? 0.3 : 0;
    // lasers fan out from the DJ booth, flicking colour every beat
    for (const [i, l] of this.lasers.entries()) {
      l.mesh.rotation.y = -Math.PI / 2 + Math.sin(this.t * (0.7 + i * 0.13) + i) * 0.75;
      l.mesh.rotation.z = -0.08 - 0.06 * Math.sin(this.t * 1.1 + i * 2);
      l.mesh.updateMatrix();
      const hit = hitRoom(l.mesh.position, tmpDir.copy(EAST).applyQuaternion(l.mesh.quaternion));
      l.mesh.scale.x = Number.isFinite(hit.t) ? hit.t : 0.01;
      const on = pattern !== 1 || (beatI + i) % 2 === 0;
      l.mat.opacity = on ? 0.5 + 0.4 * kick : 0;
      l.mat.color.copy(i % 2 ? PALETTE[1] : PALETTE[(bar + 4) % PALETTE.length]);
    }
  }
}
