// Floor 5 ("Nội Gián") in 3D: the laid-off colleagues' boxes left behind ("bodies"), red security
// shutters on locked doorways, a marker over each of your unfinished tasks, a red alarm wash during
// the server overload, and the game board in the hall. Lives in the floor-5 group (logical coords).
import * as THREE from 'three';
import { MOLE_DOORS, ROOM_META, STATION_BY_ID, TASK_META, type MoleView } from '../../shared/mole';
import { canvasTexture } from './materials';

const label = (text: string, bg: string) =>
  canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(8, 16, w - 16, h - 32, 40);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '700 50px "Be Vietnam Pro", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.length > 16 ? text.slice(0, 15) + '…' : text, w / 2, h / 2 + 2);
  });

let blood: THREE.CanvasTexture | null = null;
/** A dark red pool with uneven edges and a few drops. */
function bloodTex() {
  blood ??= canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const blob = (cx: number, cy: number, r: number, a: number) => {
      g.fillStyle = `rgba(110, 4, 14, ${a})`;
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        const rr = r * (0.75 + 0.35 * Math.sin(t * 3 + cx) * Math.cos(t * 5 + cy));
        const x = cx + Math.cos(t) * rr;
        const y = cy + Math.sin(t) * rr;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.fill();
    };
    blob(w / 2, h / 2, 70, 0.92);
    blob(w / 2 + 40, h / 2 + 20, 38, 0.85);
    for (let i = 0; i < 9; i++) blob(w / 2 + Math.cos(i * 2.3) * (90 + i * 4), h / 2 + Math.sin(i * 2.3) * (80 + i * 3), 6 + (i % 3) * 3, 0.9);
    g.fillStyle = 'rgba(255, 90, 90, 0.18)';
    g.beginPath();
    g.ellipse(w / 2 - 18, h / 2 - 20, 22, 10, -0.5, 0, Math.PI * 2);
    g.fill();
  });
  return blood;
}

let chalk: THREE.CanvasTexture | null = null;
/** The outline of a person, in chalk. */
function chalkTex() {
  chalk ??= canvasTexture(256, 448, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(245, 245, 240, 0.9)';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.arc(w / 2, 62, 40, 0, Math.PI * 2); // head
    g.moveTo(w / 2 - 40, 118);
    g.lineTo(w / 2 - 110, 210); // left arm
    g.lineTo(w / 2 - 92, 228);
    g.lineTo(w / 2 - 34, 165);
    g.lineTo(w / 2 - 38, 270);
    g.lineTo(w / 2 - 70, 420); // left leg
    g.lineTo(w / 2 - 40, 426);
    g.lineTo(w / 2, 300);
    g.lineTo(w / 2 + 44, 426); // right leg
    g.lineTo(w / 2 + 74, 418);
    g.lineTo(w / 2 + 38, 270);
    g.lineTo(w / 2 + 36, 165);
    g.lineTo(w / 2 + 104, 140); // right arm, bent up
    g.lineTo(w / 2 + 112, 112);
    g.lineTo(w / 2 + 40, 118);
    g.closePath();
    g.stroke();
  });
  return chalk;
}

export class Floor5Fx {
  private bodies = new Map<string, THREE.Group>();
  private shutters = new Map<string, THREE.Mesh>();
  private markers = new Map<string, THREE.Group>();
  private alarm: THREE.Mesh;
  private alarmOn = false;
  private t = 0;
  private board: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } | null = null;
  /** Can the local player see this logical spot? (fog of war; set by the world) */
  canSee: (x: number, z: number) => boolean = () => true;

  /** Pools of light under the (weak) ceiling lamps; some of them flicker. */
  private pools: { m: THREE.Mesh; base: number; flicker: boolean; seed: number }[] = [];
  /** Red emergency lamps over the doorways. */
  private beacons: THREE.Mesh[] = [];
  private blackout = false;

  constructor(private root: THREE.Group) {
    const glow = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.3)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    let n = 0;
    for (const [k, r] of Object.entries(ROOM_META)) {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const cols = Math.max(1, Math.round(w / 8));
      const rows = Math.max(1, Math.round(d / 8));
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const warm = k === 'canteen' || k === 'med';
          const m = new THREE.Mesh(
            new THREE.PlaneGeometry(5.2, 5.2),
            new THREE.MeshBasicMaterial({ map: glow, color: warm ? '#ffd9a0' : '#9fc4ff', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
          );
          m.rotation.x = -Math.PI / 2;
          m.position.set(r.x0 + ((i + 0.5) * w) / cols, 0.02, r.z0 + ((j + 0.5) * d) / rows);
          root.add(m);
          this.pools.push({ m, base: k === 'meet' ? 0.3 : 0.2, flicker: n % 4 === 1, seed: Math.random() * 100 });
          n++;
        }
    }
    for (const dd of MOLE_DOORS) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(dd.axis === 'x' ? 0.5 : 0.25, 0.12, dd.axis === 'x' ? 0.25 : 0.5), new THREE.MeshBasicMaterial({ color: '#ff2a3d', toneMapped: false, transparent: true, opacity: 0.35 }));
      const mid = (dd.from + dd.to) / 2;
      lamp.position.set(dd.axis === 'x' ? mid : dd.at, 2.95, dd.axis === 'x' ? dd.at : mid);
      root.add(lamp);
      this.beacons.push(lamp);
    }
    this.alarm = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 28),
      new THREE.MeshBasicMaterial({ color: '#ff1f3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.alarm.rotation.x = -Math.PI / 2;
    this.alarm.position.set(260, 0.04, 14);
    this.alarm.visible = false;
    root.add(this.alarm);
  }

  setupBoard(mesh: THREE.Mesh) {
    const tex = canvasTexture(840, 350, () => {});
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.board = { tex, g: (tex.image as HTMLCanvasElement).getContext('2d')! };
    this.drawBoard(null);
  }

  drawBoard(v: MoleView | null) {
    if (!this.board) return;
    const g = this.board.g;
    const W = 840;
    const H = 350;
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#141a2b');
    gr.addColorStop(1, '#0b0f1a');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.fillStyle = '#9fe8ff';
    g.font = 'italic 900 74px "Be Vietnam Pro", sans-serif';
    g.fillText('🕵️ NỘI GIÁN', W / 2, 92);
    g.font = '600 30px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#e8ecff';
    if (!v || v.phase === 'lobby' || v.phase === 'starting') {
      const n = v?.joined.length ?? 0;
      g.fillText(n ? `${n} người đã tham gia — cần ít nhất 4` : 'Lại gần bấm E để tham gia', W / 2, 170);
      g.font = '500 24px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#9aa3c7';
      g.fillText('Làm nhiệm vụ · tìm nội gián · họp và bỏ phiếu', W / 2, 225);
      g.fillText('Cần bật mic để bàn bạc 🎙️', W / 2, 265);
    } else {
      const alive = v.players.filter((p) => p.alive).length;
      g.fillText(v.phase === 'end' ? (v.winner === 'crew' ? '🏆 Nhân viên thắng' : '🕵️ Nội gián thắng') : `Đang chơi · còn ${alive}/${v.players.length} người`, W / 2, 170);
      // progress bar
      g.fillStyle = '#263048';
      g.fillRect(120, 215, W - 240, 34);
      g.fillStyle = '#39ff88';
      g.fillRect(120, 215, (W - 240) * v.progress, 34);
      g.font = '600 22px "Be Vietnam Pro", sans-serif';
      g.fillStyle = '#ffffff';
      g.fillText(`Tiến độ dự án ${Math.round(v.progress * 100)}%`, W / 2, 240);
    }
    this.board.tex.needsUpdate = true;
  }

  /** Sync bodies, locked doors and task markers with the game. */
  update(v: MoleView | null, now: number) {
    const live = v && v.phase !== 'lobby' && v.phase !== 'end';
    // bodies: a toppled box of belongings + a name tag
    const want = new Set(live ? v!.bodies.map((b) => b.id) : []);
    for (const [id, g] of this.bodies)
      if (!want.has(id)) {
        this.root.remove(g);
        this.bodies.delete(id);
      }
    if (live)
      for (const b of v!.bodies) {
        if (this.bodies.has(b.id)) continue;
        // a crime scene: a dark pool, a chalk outline, a dropped mug
        const g = new THREE.Group();
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: bloodTex(), transparent: true, depthWrite: false, toneMapped: false }));
        pool.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
        pool.position.y = 0.012;
        g.add(pool);
        const chalk = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.9), new THREE.MeshBasicMaterial({ map: chalkTex(), transparent: true, depthWrite: false, toneMapped: false }));
        chalk.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
        chalk.position.y = 0.016;
        g.add(chalk);
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 12), new THREE.MeshStandardMaterial({ color: '#d9d9d9' }));
        mug.rotation.z = Math.PI / 2;
        mug.position.set(0.55, 0.05, 0.3);
        g.add(mug);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(`💀 ${b.name}`, 'rgba(150,10,25,0.92)'), depthTest: false, toneMapped: false }));
        tag.scale.set(1.4, 0.35, 1);
        tag.position.y = 0.9;
        tag.renderOrder = 5;
        g.add(tag);
        g.position.set(b.x, 0, b.z);
        this.root.add(g);
        this.bodies.set(b.id, g);
      }
    // shutters on locked doorways
    const locked = new Set(live ? v!.locks.filter((l) => l.until > now).map((l) => l.door) : []);
    for (const d of MOLE_DOORS) {
      let m = this.shutters.get(d.id);
      if (locked.has(d.id) && !m) {
        const len = d.to - d.from;
        m = new THREE.Mesh(
          new THREE.BoxGeometry(d.axis === 'x' ? len : 0.12, 2.6, d.axis === 'x' ? 0.12 : len),
          new THREE.MeshStandardMaterial({ color: '#8a1020', emissive: '#ff1f3d', emissiveIntensity: 0.45, transparent: true, opacity: 0.88, roughness: 0.4 }),
        );
        const mid = (d.from + d.to) / 2;
        m.position.set(d.axis === 'x' ? mid : d.at, 1.3, d.axis === 'x' ? d.at : mid);
        this.root.add(m);
        this.shutters.set(d.id, m);
      } else if (!locked.has(d.id) && m) {
        this.root.remove(m);
        this.shutters.delete(d.id);
      }
    }
    // a bouncing marker over each of my unfinished tasks (employees and ghosts)
    const mine = new Set(live && v!.me.role === 'crew' && v!.phase === 'play' ? v!.me.tasks.filter((t) => !t.done).map((t) => t.st) : []);
    for (const [id, g] of this.markers)
      if (!mine.has(id)) {
        this.root.remove(g);
        this.markers.delete(id);
      }
    for (const id of mine) {
      if (this.markers.has(id)) continue;
      const st = STATION_BY_ID.get(id)!;
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(`${TASK_META[st.kind].emoji} việc của bạn`, 'rgba(240,160,30,0.92)'), depthTest: false, toneMapped: false }));
      tag.scale.set(1.3, 0.33, 1);
      tag.position.y = 2.3;
      tag.renderOrder = 5;
      g.add(tag);
      g.position.set(st.x + Math.sin(st.ry) * 0.95, 0, st.z + Math.cos(st.ry) * 0.95);
      this.root.add(g);
      this.markers.set(id, g);
    }
    this.alarmOn = !!live && v!.crit > now;
    this.blackout = !!live && v!.lights > now;
  }

  private scans: { g: THREE.Group; t: number }[] = [];
  /** A medical scan in progress: a green beam round the person (proof they're an employee). */
  scan(x: number, z: number) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 2.4, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: '#39ff88', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.position.y = 1.2;
    g.add(beam);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.03, 8, 40), new THREE.MeshBasicMaterial({ color: '#b6ffd0', toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.position.set(x, 0, z);
    this.root.add(g);
    this.scans.push({ g, t: 0 });
  }

  tick(dt: number) {
    this.t += dt;
    for (const p of this.pools) {
      let o = this.blackout ? 0 : p.base;
      // a dying tube: mostly on, sometimes stuttering off
      if (p.flicker && !this.blackout) {
        const k = Math.sin(this.t * 1.3 + p.seed) * Math.sin(this.t * 3.7 + p.seed * 2);
        if (k > 0.6) o *= Math.random() < 0.5 ? 0.15 : 1;
      }
      (p.m.material as THREE.MeshBasicMaterial).opacity = o;
    }
    const beat = this.alarmOn ? 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 8)) : this.blackout ? 0.6 : 0.28 + 0.07 * Math.sin(this.t * 1.5);
    for (const b of this.beacons) (b.material as THREE.MeshBasicMaterial).opacity = beat;
    for (let i = this.scans.length - 1; i >= 0; i--) {
      const s = this.scans[i];
      s.t += dt;
      const ring = s.g.children[1];
      ring.position.y = 0.1 + ((s.t * 1.1) % 1) * 2.2;
      s.g.visible = this.canSee(s.g.position.x, s.g.position.z);
      if (s.t > 4) {
        this.root.remove(s.g);
        this.scans.splice(i, 1);
      }
    }
    for (const [, g] of this.markers) g.children[1].position.y = 2.25 + Math.sin(this.t * 3) * 0.08;
    this.alarm.visible = this.alarmOn;
    if (this.alarmOn) (this.alarm.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.1 * Math.max(0, Math.sin(this.t * 6));
    for (const [, g] of this.bodies) g.visible = this.canSee(g.position.x, g.position.z);
  }
}
