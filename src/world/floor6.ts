// Floor 6, the prop-hunt showroom: the waiting room's roller shutter, the join board, the outline
// round the piece a hider is about to become, and the little moments (puffs, taunt notes, foam
// balls, hit sparks). Also hands out the models hiders wear: an exact copy of the piece they chose.
// Positions here are floor-local: logical x (300..340), y above floor 6's floor, z.
import * as THREE from 'three';
import { FURNITURE, type Furniture } from '../../shared/map';
import { F6, PH_BOARD, PH_GATE, PH_PROPS, type PhView } from '../../shared/prophunt';
import { buildFurniture } from './furniture';
import { canvasTexture } from './materials';

const FURN = new Map(FURNITURE.map((f) => [f.id, f]));

interface Fx {
  obj: THREE.Object3D;
  t: number;
  life: number;
  step(k: number, dt: number): void;
}

export class Floor6Fx {
  private root: THREE.Group;
  private gate: THREE.Mesh;
  private gateOpen = 0;
  private gateWant = 1;
  private board: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; key: string };
  private outline: THREE.LineSegments;
  private outlineT = 0;
  private fx: Fx[] = [];
  private puffTex = canvasTexture(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.6, 'rgba(240,236,228,0.8)');
    grd.addColorStop(1, 'rgba(240,236,228,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  });
  private noteTex = canvasTexture(64, 64, (g) => {
    g.font = '700 52px "Be Vietnam Pro", sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#ffd36b';
    g.strokeStyle = '#3a2a10';
    g.lineWidth = 4;
    g.strokeText('♪', 32, 50);
    g.fillText('♪', 32, 50);
  });
  private ballGeo = new THREE.SphereGeometry(0.06, 10, 8);
  private ballMats = ['#ff6b6b', '#ffd36b', '#6fd6ff', '#9dff8a'].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  private models = new Map<string, { group: THREE.Group; box: THREE.Box3 }>();

  constructor(root: THREE.Group) {
    this.root = root;
    // the waiting room's roller shutter (slides up into the lintel)
    const w = PH_GATE.x1 - PH_GATE.x0;
    const slats = canvasTexture(64, 256, (g) => {
      g.fillStyle = '#8d96a3';
      g.fillRect(0, 0, 64, 256);
      for (let y = 0; y < 256; y += 16) {
        g.fillStyle = '#6c7582';
        g.fillRect(0, y, 64, 3);
        g.fillStyle = '#b2bac4';
        g.fillRect(0, y + 3, 64, 2);
      }
      g.fillStyle = '#f2c14e';
      g.fillRect(0, 236, 64, 20);
    });
    slats.wrapS = slats.wrapT = THREE.RepeatWrapping;
    slats.repeat.set(w / 0.6, 1);
    this.gate = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 0.06), new THREE.MeshStandardMaterial({ map: slats, roughness: 0.6, metalness: 0.5 }));
    this.gate.position.set(F6 + (PH_GATE.x0 + PH_GATE.x1) / 2, 1.2, PH_GATE.z);
    this.gate.castShadow = true;
    root.add(this.gate);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: '#4a5160', roughness: 0.5, metalness: 0.4 }));
    lintel.position.set(this.gate.position.x, 2.6, PH_GATE.z);
    root.add(lintel);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.42),
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        map: canvasTexture(512, 84, (g, cw) => {
          g.fillStyle = '#2a2233';
          g.fillRect(0, 0, cw, 84);
          g.textAlign = 'center';
          g.font = '800 40px "Be Vietnam Pro", sans-serif';
          g.fillStyle = '#ff9a6b';
          g.fillText('🔫 PHÒNG CHỜ NGƯỜI TÌM', cw / 2, 56);
        }),
      }),
    );
    sign.position.set(this.gate.position.x, 2.98, PH_GATE.z - 0.16);
    sign.rotation.y = Math.PI;
    root.add(sign);

    // the join board's screen (frame: furniture kind 'phBoard')
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 432;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.board = { tex, g: canvas.getContext('2d')!, key: '' };
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.125), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(F6 + PH_BOARD.x, 1.55, PH_BOARD.z - 0.045);
    screen.rotation.y = Math.PI;
    root.add(screen);
    this.drawBoard(null);

    // outline round the piece you'd turn into
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffd36b', toneMapped: false, transparent: true, depthTest: false }));
    this.outline.renderOrder = 5;
    this.outline.visible = false;
    root.add(this.outline);
  }

  // ------------------------------------------------------------------ hider models
  /** The piece's model at the origin (cached) and its bounds. */
  private model(fid: string): { group: THREE.Group; box: THREE.Box3 } | null {
    let m = this.models.get(fid);
    if (m) return m;
    const f = FURN.get(fid);
    if (!f || !PH_PROPS[f.kind]) return null;
    const group = buildFurniture({ ...f, x: 0, z: 0, ry: 0, y: 0 }, {});
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    m = { group, box };
    this.models.set(fid, m);
    return m;
  }

  /** A copy of piece `fid` to wear (shares geometry + materials with every other copy). */
  propModel(fid: string): THREE.Group | null {
    const m = this.model(fid);
    if (!m) return null;
    const g = m.group.clone();
    g.name = 'ph-prop';
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return g;
  }

  /** Local bounds of piece `fid` (for aiming at hiders). */
  propBox(fid: string): THREE.Box3 | null {
    return this.model(fid)?.box ?? null;
  }

  // ------------------------------------------------------------------ outline
  highlight(f: Furniture | null) {
    if (!f) {
      this.outline.visible = false;
      return;
    }
    const b = this.propBox(f.id);
    if (!b) {
      this.outline.visible = false;
      return;
    }
    const size = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    this.outline.visible = true;
    this.outline.scale.set(size.x + 0.08, size.y + 0.08, size.z + 0.08);
    this.outline.rotation.set(0, f.ry, 0);
    const off = c.applyAxisAngle(new THREE.Vector3(0, 1, 0), f.ry);
    this.outline.position.set(f.x + off.x, off.y, f.z + off.z);
  }

  // ------------------------------------------------------------------ gate
  setGate(open: boolean) {
    this.gateWant = open ? 1 : 0;
  }

  // ------------------------------------------------------------------ moments
  private sprite(tex: THREE.Texture, size: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    s.scale.setScalar(size);
    this.root.add(s);
    return s;
  }

  private add(obj: THREE.Object3D, life: number, step: Fx['step']) {
    this.fx.push({ obj, t: 0, life, step });
  }

  /** Someone turned into something (or stopped being something): a cloud of dust. */
  poof(x: number, z: number) {
    for (let i = 0; i < 7; i++) {
      const s = this.sprite(this.puffTex, 0.5);
      const a = (i / 7) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      s.position.set(x, 0.4 + Math.random() * 0.5, z);
      const mat = s.material as THREE.SpriteMaterial;
      this.add(s, 0.7, (k) => {
        s.position.set(x + dx * k * 0.9, 0.4 + k * 0.6, z + dz * k * 0.9);
        s.scale.setScalar(0.5 + k * 0.9);
        mat.opacity = 1 - k;
      });
    }
  }

  /** A taunt: notes float up from where the hider is. */
  note(x: number, z: number) {
    for (let i = 0; i < 3; i++) {
      const s = this.sprite(this.noteTex, 0.38);
      const mat = s.material as THREE.SpriteMaterial;
      const ph = Math.random() * 6;
      const delay = i * 0.18;
      this.add(s, 1.6 + delay, (k, _dt) => {
        const t = Math.max(0, k * (1.6 + delay) - delay) / 1.6;
        s.visible = t > 0;
        s.position.set(x + Math.sin(ph + t * 6) * 0.25, 1.0 + t * 1.6, z);
        mat.opacity = t < 0.8 ? 1 : (1 - t) * 5;
      });
    }
  }

  /** A foam ball from the gun to where it struck. */
  shot(from: THREE.Vector3, to: THREE.Vector3) {
    const ball = new THREE.Mesh(this.ballGeo, this.ballMats[Math.floor(Math.random() * this.ballMats.length)]);
    const a = from.clone();
    const b = to.clone();
    const life = Math.max(0.06, a.distanceTo(b) / 45);
    ball.position.copy(a);
    this.root.add(ball);
    this.add(ball, life + 0.5, (k) => {
      const t = Math.min(1, (k * (life + 0.5)) / life);
      ball.position.lerpVectors(a, b, t);
      // after the hit it drops and bounces once
      if (t >= 1) {
        const u = (k * (life + 0.5) - life) / 0.5;
        ball.position.y = Math.max(0.06, b.y - u * u * 2.2 + Math.sin(u * Math.PI) * 0.2);
      }
    });
  }

  /** A hider was hit: a burst of sparks. */
  hit(x: number, y: number, z: number) {
    for (let i = 0; i < 8; i++) {
      const s = this.sprite(this.puffTex, 0.14);
      const mat = s.material as THREE.SpriteMaterial;
      mat.color.set(i % 2 ? '#ffd36b' : '#ff6b6b');
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.add(s, 0.45, (k) => {
        s.position.set(x + v.x * k * 0.8, y + v.y * k * 0.8, z + v.z * k * 0.8);
        mat.opacity = 1 - k;
      });
    }
  }

  // ------------------------------------------------------------------ board
  drawBoard(v: PhView | null) {
    const lines: string[] = [];
    const playing = !!v && v.phase !== 'lobby';
    if (!v || v.phase === 'lobby') lines.push(`${v?.joined.length ?? 0} người đã tham gia`, 'Bấm "Tham gia" ở bảng bên trái màn hình');
    else if (v.phase === 'starting' || v.phase === 'roles') lines.push('Ván sắp bắt đầu…', `${v.players.length} người chơi`);
    else if (v.phase === 'hide') lines.push(`Vòng ${v.round}: đang trốn!`, 'Người tìm bị nhốt trong phòng chờ');
    else if (v.phase === 'seek') lines.push(`Vòng ${v.round}: đang săn`, `Còn ${v.hidersLeft} người trốn`);
    else if (v.phase === 'roundEnd') lines.push(`Hết vòng ${v.round}`, v.why);
    else lines.push('Kết thúc!', v.why);
    const key = lines.join('|') + (playing ? 1 : 0);
    if (key === this.board.key) return;
    this.board.key = key;
    const g = this.board.g;
    const W = 768;
    const H = 432;
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#2a2140');
    grd.addColorStop(1, '#1b2a3d');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.font = '800 64px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#ffd36b';
    g.fillText('🪑 TRỐN TÌM', W / 2, 108);
    g.font = '800 52px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('BIẾN HÌNH', W / 2, 170);
    g.font = '600 34px "Be Vietnam Pro", sans-serif';
    g.fillStyle = playing ? '#9dff8a' : '#cfe0ff';
    lines.forEach((l, i) => g.fillText(l.length > 40 ? l.slice(0, 39) + '…' : l, W / 2, 262 + i * 52));
    g.font = '500 24px "Be Vietnam Pro", sans-serif';
    g.fillStyle = '#9aa3c0';
    g.fillText('3–16 người · biến thành đồ vật · người tìm bắn nhầm là mất máu', W / 2, 400);
    this.board.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ per frame (only while you're on floor 6)
  tick(dt: number) {
    if (this.gateOpen !== this.gateWant) {
      this.gateOpen = this.gateWant > this.gateOpen ? Math.min(1, this.gateOpen + dt / 1.4) : Math.max(0, this.gateOpen - dt / 0.8);
      this.gate.position.y = 1.2 + this.gateOpen * 2.25;
      this.gate.scale.y = 1 - this.gateOpen * 0.9;
    }
    if (this.outline.visible) {
      this.outlineT += dt;
      (this.outline.material as THREE.LineBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(this.outlineT * 6);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.life);
      e.step(k, dt);
      if (k >= 1) {
        this.root.remove(e.obj);
        if ((e.obj as THREE.Sprite).isSprite) ((e.obj as THREE.Sprite).material as THREE.Material).dispose();
        this.fx.splice(i, 1);
      }
    }
  }
}
