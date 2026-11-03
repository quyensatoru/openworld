// Animated bits of floor 4. Like the bar, the "lights" are emissive / additive meshes, no real lights.
//  - KaraokeFx: stage LED edge, two follow spots on the mic spots, a slow mirror ball with sweeping
//    beams, wall washes, floating reactions (👏 🌹 ❤️ …) rising from whoever sent them.
//  - WolfFx: the camp fire (flickering flames, embers, a warm pool of light) that turns cold and
//    blue at night, and the game board on the wall.
import * as THREE from 'three';
import { KARA, KARA_STAGE, MIC_SPOTS, WALL_H, WOLF, WOLF_FIRE } from '../../shared/map';
import { PHASE_LABEL, ROLE_META, TEAM_LABEL, type WolfView } from '../../shared/werewolf';
import { canvasTexture } from './materials';

let radial: THREE.CanvasTexture | null = null;
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

const add = (color: string | THREE.Color, opacity = 1, map: THREE.Texture | null = null) =>
  new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });

const HUES = ['#ff3ea5', '#9b5cff', '#2de2e6', '#ff7ac4', '#5d9bff', '#ffd23f'].map((c) => new THREE.Color(c));

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

export class KaraokeFx {
  private edge: THREE.Mesh;
  private edgeMat: THREE.MeshBasicMaterial;
  private spots: { cone: THREE.Mesh; pool: THREE.Mesh; on: number }[] = [];
  private ball: THREE.Mesh;
  private beams: THREE.Mesh[] = [];
  private washes: THREE.Mesh[] = [];
  private floats: { s: THREE.Sprite; t: number; vx: number; vz: number }[] = [];
  private t = 0;
  /** Which mics are held (index → true), set by the game. */
  mics: boolean[] = [false, false];
  /** A song is playing: livelier lights. */
  playing = false;

  constructor(private root: THREE.Group) {
    // LED strip along the stage front + step
    this.edgeMat = new THREE.MeshBasicMaterial({ color: '#ff3ea5', toneMapped: false });
    this.edge = new THREE.Mesh(new THREE.BoxGeometry(KARA_STAGE.x1 - KARA_STAGE.x0, 0.03, 0.03), this.edgeMat);
    this.edge.position.set((KARA_STAGE.x0 + KARA_STAGE.x1) / 2, KARA_STAGE.h - 0.02, KARA_STAGE.z1 + 0.005);
    root.add(this.edge);
    // follow spots on the two mic spots
    for (const m of MIC_SPOTS) {
      const h = WALL_H - 0.1;
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.75, h - KARA_STAGE.h, 24, 1, true), add('#fff2d6', 0.0));
      cone.position.set(m.x, KARA_STAGE.h + (h - KARA_STAGE.h) / 2, m.z);
      root.add(cone);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), add('#fff2d6', 0, radialTex()));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(m.x, KARA_STAGE.h + 0.01, m.z);
      root.add(pool);
      this.spots.push({ cone, pool, on: 0 });
    }
    // mirror ball over the sofas
    const cx = (KARA.x0 + KARA.x1) / 2;
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), new THREE.MeshStandardMaterial({ color: '#dfe6ef', metalness: 0.95, roughness: 0.15, flatShading: true, emissive: '#3a3a55', emissiveIntensity: 0.6 }));
    this.ball.position.set(cx, WALL_H - 0.55, 9.0);
    root.add(this.ball);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), new THREE.MeshBasicMaterial({ color: '#888' }));
    string.position.set(cx, WALL_H - 0.27, 9.0);
    root.add(string);
    // sweeping beams from the ceiling corners
    for (let i = 0; i < 4; i++) {
      const len = 6.5;
      const geo = new THREE.CylinderGeometry(0.03, 0.55, len, 16, 1, true);
      geo.translate(0, -len / 2, 0);
      const beam = new THREE.Mesh(geo, add(HUES[i], 0.12));
      beam.position.set(i < 2 ? KARA.x0 + 1.2 : KARA.x1 - 1.2, WALL_H - 0.15, i % 2 ? 16.5 : 5.5);
      root.add(beam);
      this.beams.push(beam);
    }
    // soft colour washes on the side walls
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), add(HUES[i + 1], 0.22, radialTex()));
      const west = i < 2;
      w.position.set(west ? KARA.x0 + 0.13 : KARA.x1 - 0.13, 1.7, i % 2 ? 14 : 7);
      w.rotation.y = west ? Math.PI / 2 : -Math.PI / 2;
      root.add(w);
      this.washes.push(w);
    }
  }

  /** A reaction floating up from (logical x, z). */
  react(e: string, x: number, z: number, y = 1.9) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoji(e), transparent: true, depthWrite: false, toneMapped: false }));
    s.position.set(x, y, z);
    s.scale.setScalar(0.45);
    this.root.add(s);
    this.floats.push({ s, t: 0, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4 });
  }

  tick(dt: number) {
    this.t += dt;
    const t = this.t;
    const live = this.playing ? 1 : 0.45;
    const hue = HUES[Math.floor(t / 2.2) % HUES.length];
    this.edgeMat.color.copy(hue).lerp(HUES[(Math.floor(t / 2.2) + 1) % HUES.length], (t / 2.2) % 1);
    this.spots.forEach((s, i) => {
      s.on += ((this.mics[i] ? 1 : 0) - s.on) * (1 - Math.exp(-4 * dt));
      (s.cone.material as THREE.MeshBasicMaterial).opacity = 0.075 * s.on;
      (s.pool.material as THREE.MeshBasicMaterial).opacity = 0.55 * s.on;
      s.cone.visible = s.pool.visible = s.on > 0.01;
    });
    this.ball.rotation.y += dt * 0.6;
    this.beams.forEach((b, i) => {
      const a = t * (0.35 + i * 0.07) + i * 1.7;
      b.rotation.set(0.75 + Math.sin(a) * 0.35, a * 0.6 + (i < 2 ? -0.8 : 0.8), Math.cos(a * 0.8) * 0.3);
      (b.material as THREE.MeshBasicMaterial).opacity = 0.07 + 0.07 * live;
      (b.material as THREE.MeshBasicMaterial).color.copy(HUES[(i + Math.floor(t / 3)) % HUES.length]);
    });
    this.washes.forEach((w, i) => {
      (w.material as THREE.MeshBasicMaterial).opacity = (0.12 + 0.1 * live) * (0.7 + 0.3 * Math.sin(t * 0.9 + i * 1.3));
      w.position.y = 1.6 + Math.sin(t * 0.5 + i) * 0.25;
    });
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      f.s.position.y += dt * 0.75;
      f.s.position.x += f.vx * dt;
      f.s.position.z += f.vz * dt;
      f.s.scale.setScalar(0.45 + Math.min(0.2, f.t * 0.4));
      f.s.material.opacity = Math.min(1, 3 - f.t * 1.3);
      if (f.t > 2.3) {
        this.root.remove(f.s);
        f.s.material.dispose();
        this.floats.splice(i, 1);
      }
    }
  }
}

export class WolfFx {
  private flames: { m: THREE.Mesh; base: number; ph: number }[] = [];
  private pool: THREE.Mesh;
  private embers: THREE.Points;
  private emberV: Float32Array;
  private t = 0;
  /** 1 = deep night (blue, low fire), 0 = day / lobby. */
  night = 0;
  private nightTarget = 0;
  private board: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } | null = null;
  private warm = [new THREE.Color('#ff7a1a'), new THREE.Color('#ffc14d'), new THREE.Color('#fff1a8')];
  private cold = [new THREE.Color('#2a5cff'), new THREE.Color('#5fa8ff'), new THREE.Color('#c8e6ff')];

  constructor(root: THREE.Group) {
    const { x, z } = WOLF_FIRE;
    for (let i = 0; i < 5; i++) {
      const h = 0.75 - i * 0.1;
      const geo = new THREE.ConeGeometry(0.32 - i * 0.04, h, 10, 1, true);
      geo.translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, add(this.warm[i % 3], 0.55));
      const a = (i / 5) * Math.PI * 2;
      m.position.set(x + (i ? Math.sin(a) * 0.14 : 0), 0.14, z + (i ? Math.cos(a) * 0.14 : 0));
      root.add(m);
      this.flames.push({ m, base: h, ph: Math.random() * 10 });
    }
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5), add('#ff9a3c', 0.32, radialTex()));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(x, 0.02, z);
    root.add(this.pool);
    const n = 40;
    const pos = new Float32Array(n * 3);
    this.emberV = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x + (Math.random() - 0.5) * 0.5;
      pos[i * 3 + 1] = 0.2 + Math.random() * 2.2;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
      this.emberV[i] = 0.5 + Math.random() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffb35c', size: 0.05, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    root.add(this.embers);
  }

  setNight(n: number) {
    this.nightTarget = n;
  }

  tick(dt: number) {
    this.t += dt;
    this.night += (this.nightTarget - this.night) * (1 - Math.exp(-1.5 * dt));
    const n = this.night;
    this.flames.forEach((f, i) => {
      const k = 0.75 + 0.25 * Math.sin(this.t * (7 + i) + f.ph) * Math.sin(this.t * 3.1 + f.ph * 2);
      f.m.scale.set(1 + 0.08 * Math.sin(this.t * 5 + i), k * (1 - 0.45 * n), 1 + 0.08 * Math.cos(this.t * 6 + i));
      const mat = f.m.material as THREE.MeshBasicMaterial;
      mat.color.copy(this.warm[i % 3]).lerp(this.cold[i % 3], n);
      mat.opacity = 0.5 - 0.15 * n;
    });
    const pm = this.pool.material as THREE.MeshBasicMaterial;
    pm.color.set('#ff9a3c').lerp(new THREE.Color('#3a6cff'), n);
    pm.opacity = (0.34 + 0.05 * Math.sin(this.t * 9) * Math.sin(this.t * 4.3)) * (1 - 0.35 * n);
    const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + this.emberV[i] * dt;
      let x = pos.getX(i) + Math.sin(this.t * 2 + i) * 0.15 * dt;
      let zz = pos.getZ(i) + Math.cos(this.t * 1.7 + i) * 0.15 * dt;
      if (y > 2.6) {
        y = 0.25;
        x = WOLF_FIRE.x + (Math.random() - 0.5) * 0.5;
        zz = WOLF_FIRE.z + (Math.random() - 0.5) * 0.5;
      }
      pos.setXYZ(i, x, y, zz);
    }
    pos.needsUpdate = true;
    (this.embers.material as THREE.PointsMaterial).color.set('#ffb35c').lerp(new THREE.Color('#9fd0ff'), n);
  }

  // ------------------------------------------------------------------ the board on the wall
  setupBoard(mesh: THREE.Mesh) {
    const tex = canvasTexture(720, 420, () => {});
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.board = { tex, g: (tex.image as HTMLCanvasElement).getContext('2d')! };
    this.drawBoard(null, Date.now());
  }

  drawBoard(v: WolfView | null, now: number) {
    if (!this.board) return;
    const g = this.board.g;
    const W = 720;
    const H = 420;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2b2018');
    gr.addColorStop(1, '#1a130e');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#8a6a44';
    g.lineWidth = 6;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.textAlign = 'center';
    g.fillStyle = '#ffcf6b';
    g.font = '800 46px "Be Vietnam Pro", sans-serif';
    g.fillText('🐺 LÀNG MA SÓI', W / 2, 70);
    if (!v || v.phase === 'lobby') {
      const n = v?.seated.length ?? 0;
      g.fillStyle = '#f3e7d3';
      g.font = '600 30px "Be Vietnam Pro", sans-serif';
      g.fillText(`🔥 ${n} người quanh đống lửa`, W / 2, 150);
      g.font = '500 24px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#d8c3a0';
      g.fillText('Ngồi lên một gốc cây để tham gia', W / 2, 210);
      g.fillText('Đủ 5 người là bắt đầu được (tối đa 12)', W / 2, 250);
      g.fillText('Bật mic để nói chuyện cả làng 🎙️', W / 2, 290);
    } else {
      const left = v.until ? Math.max(0, Math.ceil((v.until - now) / 1000)) : 0;
      g.fillStyle = v.phase === 'night' || v.phase === 'witch' ? '#9fc4ff' : '#ffe0a3';
      g.font = '800 38px "Be Vietnam Pro", sans-serif';
      const icon = v.phase === 'night' || v.phase === 'witch' ? '🌙' : v.phase === 'end' ? '🏁' : '☀️';
      g.fillText(`${icon} ${PHASE_LABEL[v.phase]}${v.day ? ` · ngày ${v.day}` : ''}${left ? ` · ${left}s` : ''}`, W / 2, 140);
      const alive = v.players.filter((p) => p.alive).length;
      g.fillStyle = '#f3e7d3';
      g.font = '600 26px "Be Vietnam Pro", sans-serif';
      g.fillText(`Còn sống ${alive}/${v.players.length}`, W / 2, 188);
      g.font = '500 21px "Be Vietnam Pro", sans-serif';
      const rows = v.players.slice(0, 12);
      rows.forEach((p, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 130 + col * 230;
        const y = 236 + row * 40;
        g.fillStyle = p.alive ? '#f3e7d3' : '#8a7a68';
        const r = p.role ? ROLE_META[p.role].emoji : '';
        const nm = p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name;
        g.fillText(`${p.alive ? '🔥' : '💀'} ${nm} ${!p.alive ? r : ''}`, x, y);
      });
      if (v.winner) {
        g.fillStyle = v.winner === 'village' ? '#8fe3b0' : '#ff7d8e';
        g.font = '800 34px "Be Vietnam Pro", sans-serif';
        g.fillText(TEAM_LABEL[v.winner], W / 2, H - 30);
      }
    }
    this.board.tex.needsUpdate = true;
  }
}

/** Is a logical position inside the werewolf village? */
export const inVillage = (x: number, z: number) => x > WOLF.x0 && x < WOLF.x1 && z > WOLF.z0 && z < WOLF.z1;
