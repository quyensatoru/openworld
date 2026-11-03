// Floor 5 ("Nội Gián") in 3D: the laid-off colleagues' boxes left behind ("bodies"), red security
// shutters on locked doorways, a marker over each of your unfinished tasks, a red alarm wash during
// the server overload, and the game board in the hall. Lives in the floor-5 group (logical coords).
import * as THREE from 'three';
import { MOLE_DOORS, STATION_BY_ID, TASK_META, type MoleView } from '../../shared/mole';
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

  constructor(private root: THREE.Group) {
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
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.4), new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.9 }));
        box.position.y = 0.16;
        box.rotation.set(0.15, 0.4, 0.25);
        box.castShadow = true;
        g.add(box);
        for (let i = 0; i < 5; i++) {
          const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshStandardMaterial({ color: '#f4f4f0', side: THREE.DoubleSide }));
          paper.rotation.set(-Math.PI / 2, 0, Math.random() * 3);
          paper.position.set((Math.random() - 0.5) * 1.2, 0.01 + i * 0.002, (Math.random() - 0.5) * 1.0);
          g.add(paper);
        }
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 12), new THREE.MeshStandardMaterial({ color: '#e5364b' }));
        mug.rotation.z = Math.PI / 2;
        mug.position.set(0.35, 0.05, 0.2);
        g.add(mug);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(`📦 ${b.name}`, 'rgba(229,54,75,0.92)'), depthTest: false, toneMapped: false }));
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
  }

  tick(dt: number) {
    this.t += dt;
    for (const [, g] of this.markers) g.children[1].position.y = 2.25 + Math.sin(this.t * 3) * 0.08;
    this.alarm.visible = this.alarmOn;
    if (this.alarmOn) (this.alarm.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.1 * Math.max(0, Math.sin(this.t * 6));
    for (const [, g] of this.bodies) g.visible = this.canSee(g.position.x, g.position.z);
  }
}
