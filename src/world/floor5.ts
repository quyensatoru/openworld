// Floor 5 ("Nội Gián") in 3D: crime scenes, sliding doors (shut by hand, slammed and locked by a
// mole), duct hatches, a marker over each of your unfinished tasks, a red alarm wash during the
// server overload, the game board, and the "you only see the room you're in" shroud: every other
// room is covered by a dark box until you walk in (or peek through an open door).
// Lives in the floor-5 group (logical coords).
import * as THREE from 'three';
import { DOOR_H, FLOOR_H, UP_DX, UP_WALL_H, WALL_T } from '../../shared/map';
import { MOLE_CAMS, MOLE_DOORS, MOLE_ROOMS, MOLE_VENTS, ROOM_META, STATION_BY_ID, TASK_META, doorMid, roomAt, type MoleRoom, type MoleView } from '../../shared/mole';
import { canvasTexture } from './materials';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

interface DoorFx {
  id: string;
  rooms: [MoleRoom, MoleRoom];
  left: THREE.Mesh;
  right: THREE.Mesh;
  strip: THREE.MeshBasicMaterial;
  leafMat: THREE.MeshStandardMaterial;
  beacon: THREE.Mesh;
  /** 1 = open, 0 = shut */
  open: number;
  half: number;
}

const STRIP = { open: new THREE.Color('#39ff88'), shut: new THREE.Color('#ffb02e'), locked: new THREE.Color('#ff2a3d') };

export class Floor5Fx {
  private bodies = new Map<string, THREE.Group>();
  private markers = new Map<string, THREE.Group>();
  private alarm: THREE.Mesh;
  private alarmOn = false;
  private t = 0;
  private board: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } | null = null;
  /** Can the local player see this logical spot? (fog of war; set by the world) */
  canSee: (x: number, z: number) => boolean = () => true;

  /** Pools of light under the ceiling lamps; some of them flicker. */
  private pools: { m: THREE.Mesh; base: number; flicker: boolean; seed: number }[] = [];
  private blackout = false;

  private doors = new Map<string, DoorFx>();
  private shut = new Set<string>();
  private locked = new Set<string>();

  /** The dark boxes over the rooms you can't see. */
  private shrouds = new Map<MoleRoom, { mat: THREE.MeshBasicMaterial; meshes: THREE.Mesh[] }>();
  /** world-space boxes of the shroud pieces (for the camera test) */
  private shroudBox = new Map<THREE.Mesh, THREE.Box3>();
  /** shroud pieces between the camera and you (hidden, like walls fading out) */
  private blocking = new Set<THREE.Mesh>();
  private visible = new Set<MoleRoom>();
  private seeAll = true;

  private vents = new Map<string, { lid: THREE.Group; t: number }>();
  /** the security cameras' red lights (blink while someone watches) */
  private camLeds: THREE.MeshBasicMaterial[] = [];
  private camModels: THREE.Group[] = [];
  private camsWatched = false;

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
    const shroudGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const k of MOLE_ROOMS) {
      const meta = ROOM_META[k];
      const mat = new THREE.MeshBasicMaterial({ color: '#04060b', transparent: true, opacity: 0, depthWrite: true, toneMapped: false });
      const meshes: THREE.Mesh[] = [];
      for (const r of meta.rects) {
        const w = r.x1 - r.x0;
        const d = r.z1 - r.z0;
        // light pools: one per ~5 m
        const cols = Math.max(1, Math.round(w / 5));
        const rows = Math.max(1, Math.round(d / 5));
        for (let i = 0; i < cols; i++)
          for (let j = 0; j < rows; j++) {
            const size = Math.min(5.2, Math.max(2.4, Math.min(w / cols, d / rows) * 1.3));
            const m = new THREE.Mesh(
              new THREE.PlaneGeometry(size, size),
              new THREE.MeshBasicMaterial({ map: glow, color: meta.light, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
            );
            m.rotation.x = -Math.PI / 2;
            m.position.set(r.x0 + ((i + 0.5) * w) / cols, 0.02, r.z0 + ((j + 0.5) * d) / rows);
            root.add(m);
            this.pools.push({ m, base: k === 'meet' ? 0.3 : 0.24, flicker: n % 5 === 2, seed: Math.random() * 100 });
            n++;
          }
        // the shroud: from the floor to just under the ceiling, wall centre to wall centre
        const s = new THREE.Mesh(shroudGeo, mat);
        s.scale.set(w, UP_WALL_H - 0.01, d);
        s.position.set((r.x0 + r.x1) / 2, (UP_WALL_H - 0.01) / 2, (r.z0 + r.z1) / 2);
        s.visible = false;
        s.renderOrder = 1;
        root.add(s);
        meshes.push(s);
        const y0 = 4 * FLOOR_H;
        this.shroudBox.set(s, new THREE.Box3(new THREE.Vector3(r.x0 - 4 * UP_DX, y0, r.z0), new THREE.Vector3(r.x1 - 4 * UP_DX, y0 + UP_WALL_H, r.z1)));
      }
      this.shrouds.set(k, { mat, meshes });
    }
    // parts that never move (door frames, duct openings) are merged into one mesh per material below
    const fixed: THREE.Mesh[] = [];
    // doors: a lintel, a frame, two sliding leaves with a status strip, a red lamp above
    const lintelMat = new THREE.MeshStandardMaterial({ color: '#5a6479', roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#232835', roughness: 0.6, metalness: 0.3 });
    const winMat = new THREE.MeshStandardMaterial({ color: '#1b2230', roughness: 0.2, metalness: 0.5 });
    for (const d of MOLE_DOORS) {
      const W = d.to - d.from;
      const g = new THREE.Group();
      const m = doorMid(d);
      g.position.set(m.x, 0, m.z);
      g.rotation.y = d.axis === 'x' ? 0 : Math.PI / 2;
      root.add(g);
      const lh = UP_WALL_H - DOOR_H;
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, lh, WALL_T), lintelMat);
      lintel.position.y = DOOR_H + lh / 2;
      g.add(lintel);
      fixed.push(lintel);
      const clear = W - WALL_T; // the walls reach WALL_T/2 into the gap on each side
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, DOOR_H, WALL_T + 0.05), frameMat);
        post.position.set(sx * (clear / 2 - 0.04), DOOR_H / 2, 0);
        g.add(post);
        fixed.push(post);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(clear, 0.1, WALL_T + 0.05), frameMat);
      head.position.y = DOOR_H - 0.05;
      g.add(head);
      fixed.push(head);
      const half = clear / 2 - 0.06;
      const leafMat = new THREE.MeshStandardMaterial({ color: '#7d8798', roughness: 0.45, metalness: 0.35, emissive: '#ff1f3d', emissiveIntensity: 0 });
      const strip = new THREE.MeshBasicMaterial({ color: STRIP.open.clone(), toneMapped: false });
      const leaf = (side: number) => {
        const L = new THREE.Mesh(new THREE.BoxGeometry(half + 0.02, DOOR_H - 0.12, 0.06), leafMat);
        L.castShadow = true;
        // a light strip down the meeting edge + a little window
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, DOOR_H - 0.6, 0.075), strip);
        s.position.x = -side * (half / 2 - 0.04);
        L.add(s);
        const win = new THREE.Mesh(new THREE.BoxGeometry(half * 0.45, 0.42, 0.07), winMat);
        win.position.set(0, 0.55, 0);
        L.add(win);
        L.position.y = (DOOR_H - 0.12) / 2 + 0.01;
        g.add(L);
        return L;
      };
      const left = leaf(-1);
      const right = leaf(1);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, WALL_T + 0.08), new THREE.MeshBasicMaterial({ color: '#ff2a3d', toneMapped: false, transparent: true, opacity: 0.3 }));
      beacon.position.y = DOOR_H + 0.2;
      g.add(beacon);
      const D: DoorFx = { id: d.id, rooms: d.rooms, left, right, strip, leafMat, beacon, open: 1, half };
      this.placeLeaves(D);
      this.doors.set(d.id, D);
    }
    // duct hatches
    const grateMat = new THREE.MeshStandardMaterial({ color: '#3a414f', roughness: 0.5, metalness: 0.6 });
    const holeMat = new THREE.MeshBasicMaterial({ color: '#050608' });
    const grateGeo = mergeGeometries([
      ...Array.from({ length: 6 }, (_, i) => new THREE.BoxGeometry(0.78, 0.02, 0.07).translate(0, 0, -0.33 + i * 0.132)),
      ...[-1, 1].map((sx) => new THREE.BoxGeometry(0.04, 0.025, 0.8).translate(sx * 0.39, 0, 0)),
    ])!;
    for (const v of MOLE_VENTS) {
      const g = new THREE.Group();
      g.position.set(v.x, 0, v.z);
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), holeMat);
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.012;
      g.add(hole);
      fixed.push(hole);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.03, 0.95), grateMat);
      rim.position.y = 0.006;
      g.add(rim);
      fixed.push(rim);
      // the lid hinges on its north edge
      const lid = new THREE.Group();
      lid.position.set(0, 0.03, -0.4);
      const plate = new THREE.Mesh(grateGeo, grateMat); // slats + side bars, one mesh
      plate.position.z = 0.4;
      lid.add(plate);
      g.add(lid);
      root.add(g);
      this.vents.set(v.id, { lid, t: 9 });
    }
    // security cameras: a wall bracket, a body pointing at what it films, a red light
    const camBody = new THREE.MeshStandardMaterial({ color: '#e9ecf2', roughness: 0.4 });
    const camDark = new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.5 });
    for (const c of MOLE_CAMS) {
      const g = new THREE.Group();
      g.position.set(c.x, 2.85, c.z);
      g.rotation.y = Math.atan2(c.tx - c.x, c.tz - c.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), camDark);
      arm.position.z = -0.1;
      g.add(arm);
      const head = new THREE.Group();
      head.rotation.x = 0.45; // tilted down at the room
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.32), camBody);
      head.add(body);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), camDark);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.17;
      head.add(lens);
      const ledMat = new THREE.MeshBasicMaterial({ color: '#5a0d16', toneMapped: false });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), ledMat);
      led.position.set(0.05, 0.05, 0.16);
      head.add(led);
      g.add(head);
      root.add(g);
      this.camLeds.push(ledMat);
      this.camModels.push(g);
    }
    bakeFixed(root, fixed);
    this.alarm = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 28),
      new THREE.MeshBasicMaterial({ color: '#ff1f3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.alarm.rotation.x = -Math.PI / 2;
    this.alarm.position.set(260, 0.04, 14);
    this.alarm.visible = false;
    root.add(this.alarm);
  }

  private placeLeaves(D: DoorFx) {
    const slide = (D.half + 0.02) * D.open;
    D.left.position.x = -(D.half / 2 + 0.01) - slide;
    D.right.position.x = D.half / 2 + 0.01 + slide;
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
      g.fillText(n ? `${n} người đã tham gia — cần ít nhất 4` : 'Lại gần bấm E (hoặc ✋) để tham gia', W / 2, 170);
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
    // doors: shut by hand (any time) or slammed + locked by a mole (in a game)
    this.setDoors(v?.doors ?? [], live ? v!.locks.filter((l) => l.until > now).map((l) => l.door) : []);
    // a bouncing marker over each of my unfinished tasks (employees and ghosts)
    const mine = new Set(live && v!.me.role === 'crew' && v!.phase === 'play' ? v!.me.tasks.filter((t) => !t.done).map((t) => t.st) : []);
    for (const [id, g] of this.markers)
      if (!mine.has(id)) {
        this.root.remove(g);
        this.markers.delete(id);
      }
    for (const id of mine) {
      if (this.markers.has(id)) continue;
      const st = STATION_BY_ID.get(id);
      if (!st) continue;
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

  /** Someone is watching the cameras: their red lights blink. */
  setCamsWatched(on: boolean) {
    this.camsWatched = on;
  }

  /**
   * About to film with a security camera: no shroud, no "your task" markers, every body shown.
   * Returns a function that puts everything back.
   */
  feedBegin(): () => void {
    const back: [THREE.Object3D, boolean][] = [];
    const set = (o: THREE.Object3D, v: boolean) => {
      back.push([o, o.visible]);
      o.visible = v;
    };
    for (const s of this.shrouds.values()) for (const m of s.meshes) set(m, false);
    for (const g of this.markers.values()) set(g, false);
    for (const g of this.bodies.values()) set(g, true);
    // the cameras themselves would sit right in front of their own lens
    for (const g of this.camModels) set(g, false);
    return () => {
      for (const [o, v] of back) o.visible = v;
    };
  }

  /** Doors shut / locked right now. */
  setDoors(shut: string[], locked: string[]) {
    this.shut = new Set([...shut, ...locked]);
    this.locked = new Set(locked);
  }

  isShut(id: string) {
    return this.shut.has(id);
  }

  /** A duct hatch pops open and bangs shut. */
  ventFx(id: string) {
    const v = this.vents.get(id);
    if (v) v.t = 0;
  }

  /**
   * Who is looking: you see the room you stand in, plus the room behind an open door you're
   * standing in / right next to. `seeAll` (ghosts) or null (not on floor 5) lifts the shroud.
   */
  setViewer(x: number | null, z: number, seeAll: boolean) {
    const r = x == null || seeAll ? null : roomAt(x, z);
    if (!r || x == null) {
      this.seeAll = true;
      return;
    }
    this.seeAll = false;
    const vis = new Set<MoleRoom>([r]);
    for (const d of MOLE_DOORS) {
      if (this.shut.has(d.id) || !d.rooms.includes(r)) continue;
      const perp = d.axis === 'x' ? Math.abs(z - d.at) : Math.abs(x - d.at);
      const along = d.axis === 'x' ? x : z;
      if (perp < 1.7 && along > d.from - 0.5 && along < d.to + 0.5) vis.add(d.rooms[0] === r ? d.rooms[1] : d.rooms[0]);
    }
    this.visible = vis;
  }

  private seg = new THREE.Ray();
  private hit = new THREE.Vector3();
  /** The camera looks at you from `cam` (world coords): shroud pieces in between step aside. */
  cameraRay(cam: THREE.Vector3, head: THREE.Vector3) {
    this.blocking.clear();
    if (this.seeAll) return;
    const len = cam.distanceTo(head);
    this.seg.origin.copy(cam);
    this.seg.direction.copy(head).sub(cam).normalize();
    for (const [m, box] of this.shroudBox) {
      if (box.containsPoint(cam)) {
        this.blocking.add(m);
        continue;
      }
      const p = this.seg.intersectBox(box, this.hit);
      if (p && p.distanceTo(cam) < len - 0.3) this.blocking.add(m);
    }
  }

  /** Is this spot in a room you can currently see? */
  roomVisible(x: number, z: number) {
    if (this.seeAll) return true;
    const r = roomAt(x, z);
    return !r || this.visible.has(r);
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
    const beat = this.alarmOn ? 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 8)) : this.blackout ? 0.6 : 0.22 + 0.06 * Math.sin(this.t * 1.5);
    const fast = 0.3 + 0.7 * Math.max(0, Math.sin(this.t * 10));
    for (const D of this.doors.values()) {
      const shut = this.shut.has(D.id);
      const locked = this.locked.has(D.id);
      const target = shut ? 0 : 1;
      // locked shutters slam down fast; normal doors glide
      const k = 1 - Math.exp(-(locked ? 18 : 8) * dt);
      if (Math.abs(D.open - target) > 0.001) {
        D.open += (target - D.open) * k;
        this.placeLeaves(D);
      }
      D.strip.color.copy(locked ? STRIP.locked : shut ? STRIP.shut : STRIP.open);
      D.leafMat.emissiveIntensity = locked ? 0.35 * fast : 0;
      (D.beacon.material as THREE.MeshBasicMaterial).opacity = locked ? fast : beat;
    }
    // the shroud over the rooms you can't see
    for (const [k, s] of this.shrouds) {
      const target = this.seeAll || this.visible.has(k) ? 0 : 0.93;
      const o = s.mat.opacity + (target - s.mat.opacity) * (1 - Math.exp(-7 * dt));
      s.mat.opacity = o < 0.01 && target === 0 ? 0 : o;
      for (const m of s.meshes) m.visible = s.mat.opacity > 0.005 && !this.blocking.has(m);
    }
    const blink = this.camsWatched && Math.sin(this.t * 7) > 0;
    for (const m of this.camLeds) m.color.set(blink ? '#ff2a3d' : this.camsWatched ? '#7a1020' : '#4a0a12');
    // duct hatches: flip up, then bang shut
    for (const v of this.vents.values()) {
      if (v.t > 1.2) continue;
      v.t += dt;
      const a = v.t < 0.15 ? v.t / 0.15 : Math.max(0, 1 - (v.t - 0.35) / 0.25);
      v.lid.rotation.x = -1.1 * Math.max(0, Math.min(1, a));
    }
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

/** Merge meshes that never move into one mesh per material, in `root`'s space (fewer draw calls). */
function bakeFixed(root: THREE.Object3D, meshes: THREE.Mesh[]) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const m of meshes) {
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    const list = byMat.get(mat) ?? [];
    list.push(g);
    byMat.set(mat, list);
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (merged) root.add(new THREE.Mesh(merged, mat));
  }
}
