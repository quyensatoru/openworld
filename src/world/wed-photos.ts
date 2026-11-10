// The couple's photos on floor 7: loads them (one at a time, only once you are up there), shows a
// slideshow on the LED wall (crossfades on the shared clock with a slow Ken Burns drift), hangs them
// in gold frames with picture lights along the hall's north wall (more than fit rotate through),
// and hands the cover to the welcome sign. The bytes come from /api/wed/photo/<id>.
import * as THREE from 'three';
import { WED_ALBUM, WED_SCREEN, wedPhotoUrl, type WedPhoto } from '../../shared/wedding';
import { canvasTexture, mat } from './materials';

interface Pic {
  id: string;
  canvas: HTMLCanvasElement | null;
  tex: THREE.CanvasTexture | null;
  state: 'idle' | 'loading' | 'ready' | 'failed';
  /** Has its texture been put on screen yet (first uploads are spread over frames). */
  shown: boolean;
}

/** Longest side kept in memory / on the GPU. */
const PIC_MAX = 1024;
/** One slide on the LED wall, and the crossfade into it. */
export const SLIDE_MS = 7000;
const FADE_MS = 1300;

// ------------------------------------------------------------------ LED wall layout (relative to its centre)
/** The photo's box on the LED wall: the left part (the names stand on the right). */
export const LED_PHOTO = { cx: -0.95, cy: 0.02, w: 3.25, h: 2.1 };

// ------------------------------------------------------------------ the album wall
const WALL_Y = 1.62;
const FRAME_BORDER = 0.065;
const MAT_BORDER = 0.07;
const FRAME_D = 0.045;
const MAX_FRAMES = 5;
const ROTATE_MS = 6500;

/** Fit an image of aspect `a` (w/h) inside a w×h box. */
function contain(a: number, w: number, h: number) {
  return a > w / h ? { w, h: w / a } : { w: h * a, h };
}

function aspect(p: WedPhoto | undefined) {
  return p && p.w > 0 && p.h > 0 ? Math.max(0.4, Math.min(2.5, p.w / p.h)) : 1.5;
}

interface Layer {
  shadow: THREE.Mesh;
  border: THREE.Mesh;
  photo: THREE.Mesh;
  tex: THREE.Texture | null;
  id: string | null;
  /** The slide it belongs to (for the Ken Burns drift). */
  slide: number;
}

interface Slot {
  /** Index into the album shown here (-1 = empty). */
  idx: number;
  /** Size of the photo (without the mat), now and where it is going. */
  w: number;
  h: number;
  tw: number;
  th: number;
  /** 0..1 photo visibility; swapping fades out, resizes, fades in. */
  fade: number;
  next: number | null;
  photo: THREE.Mesh;
  x: number;
}

export class WedPhotos {
  /** A picture finished loading (the sign redraws when it is the cover). */
  onLoad: (id: string) => void = () => {};

  private list: WedPhoto[] = [];
  private pics = new Map<string, Pic>();
  private loading = false;
  private uploadsLeft = 1;

  // LED wall
  private led: THREE.Group | null = null;
  private layers: Layer[] = [];
  private ledOn = false;
  private swapAt = 0;

  // album wall
  private wall = new THREE.Group();
  private frames: THREE.InstancedMesh;
  private mats: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private washes: THREE.InstancedMesh;
  private slots: Slot[] = [];
  private placeholder: THREE.Mesh;
  private title: THREE.Mesh;
  private titleG: CanvasRenderingContext2D;
  private titleTex: THREE.CanvasTexture;
  private titleKey = '';
  private rotAcc = 0;
  private rotSlot = 0;
  private cursor = 0;
  private dummy = new THREE.Object3D();

  constructor(root: THREE.Group) {
    const n = MAX_FRAMES;
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitPlane = new THREE.PlaneGeometry(1, 1);
    this.frames = new THREE.InstancedMesh(unitBox, mat('#d8b26e', { metal: 0.7, rough: 0.3 }), n);
    this.mats = new THREE.InstancedMesh(unitPlane, mat('#fbf6ee', { rough: 0.9 }), n);
    // a brass picture light over each frame, and the warm wash it throws down the picture
    const lampGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 10);
    lampGeo.rotateZ(Math.PI / 2);
    this.lamps = new THREE.InstancedMesh(lampGeo, mat('#c9a35f', { metal: 0.8, rough: 0.28 }), n);
    const washTex = canvasTexture(64, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      // soft sides
      const sx = g.createLinearGradient(0, 0, w, 0);
      sx.addColorStop(0, 'rgba(0,0,0,1)');
      sx.addColorStop(0.25, 'rgba(0,0,0,0)');
      sx.addColorStop(0.75, 'rgba(0,0,0,0)');
      sx.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = sx;
      g.fillRect(0, 0, w, h);
    });
    this.washes = new THREE.InstancedMesh(
      unitPlane,
      new THREE.MeshBasicMaterial({ map: washTex, color: '#2a2016', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      n,
    );
    for (const m of [this.frames, this.mats, this.lamps, this.washes]) {
      m.count = 0;
      m.frustumCulled = false;
      this.wall.add(m);
    }
    this.frames.castShadow = false;
    for (let i = 0; i < n; i++) {
      const photo = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ color: '#f2efea', transparent: true, opacity: 0, depthWrite: false }));
      photo.visible = false;
      photo.renderOrder = 2;
      this.wall.add(photo);
      this.slots.push({ idx: -1, w: 0, h: 0, tw: 0, th: 0, fade: 0, next: null, photo, x: 0 });
    }
    // an empty album: a card in the middle frame that says how to fill it
    const card = canvasTexture(512, 640, (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#fffaf3');
      bg.addColorStop(1, '#f6e1e4');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d8b26e';
      g.lineWidth = 3;
      g.strokeRect(26, 26, w - 52, h - 52);
      g.textAlign = 'center';
      g.fillStyle = '#e06c88';
      g.font = '120px serif';
      g.fillText('📷', w / 2, 250);
      g.fillStyle = '#7a3b4d';
      g.font = 'italic 700 46px "Be Vietnam Pro", serif';
      g.fillText('Album ảnh cưới', w / 2, 350);
      g.fillStyle = '#9b6b78';
      g.font = '500 25px "Be Vietnam Pro", sans-serif';
      g.fillText('Cô dâu, chú rể hoặc MC', w / 2, 410);
      g.fillText('đăng ảnh ở bảng 💒 › 📷 Ảnh', w / 2, 446);
      g.fillText('— ảnh sẽ treo ở đây 💕', w / 2, 482);
    });
    this.placeholder = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ map: card, color: '#f2efea' }));
    this.placeholder.visible = false;
    this.wall.add(this.placeholder);
    // "Our Love Story" + the names, over the frames
    this.titleTex = canvasTexture(1024, 256, () => {});
    this.titleG = (this.titleTex.image as HTMLCanvasElement).getContext('2d')!;
    this.title = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: this.titleTex, transparent: true, depthWrite: false, color: '#e8e4dc' }));
    this.title.position.set(0, 2.78, 0.01);
    this.wall.add(this.title);
    this.wall.position.set(WED_ALBUM.x, 0, WED_ALBUM.z);
    root.add(this.wall);
    this.layout(true);
  }

  // ------------------------------------------------------------------ state
  apply(photos: WedPhoto[]) {
    const ids = new Set(photos.map((p) => p.id));
    const same = photos.length === this.list.length && photos.every((p, i) => p.id === this.list[i]?.id);
    this.list = photos;
    for (const [id, pic] of this.pics)
      if (!ids.has(id)) {
        pic.tex?.dispose();
        this.pics.delete(id);
      }
    for (const p of photos) if (!this.pics.has(p.id)) this.pics.set(p.id, { id: p.id, canvas: null, tex: null, state: 'idle', shown: false });
    if (!same) this.layout(false);
  }

  get count() {
    return this.list.length;
  }

  /** A loaded picture (for drawing into the sign's canvas), or null while it loads. */
  image(id: string | undefined | null): HTMLCanvasElement | null {
    const p = id ? this.pics.get(id) : null;
    return p?.state === 'ready' ? p.canvas : null;
  }

  /** Load the next picture (cover first, then in album order). Only called while floor 7 is in view. */
  private pump(first: string | null) {
    if (this.loading) return;
    const order = first ? [first, ...this.list.map((p) => p.id)] : this.list.map((p) => p.id);
    const pic = order.map((id) => this.pics.get(id)).find((p) => p && p.state === 'idle');
    if (!pic) return;
    this.loading = true;
    pic.state = 'loading';
    const img = new Image();
    img.decoding = 'async';
    img.src = wedPhotoUrl(pic.id);
    img
      .decode()
      .then(() => {
        if (this.pics.get(pic.id) !== pic) return;
        const k = Math.min(1, PIC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        pic.canvas = c;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        pic.tex = tex;
        pic.state = 'ready';
        this.onLoad(pic.id);
      })
      .catch(() => {
        pic.state = 'failed';
      })
      .finally(() => {
        this.loading = false;
      });
  }

  /** Ready, and allowed on screen this frame (at most one new texture upload per frame). */
  private texOf(id: string | undefined): THREE.CanvasTexture | null {
    const p = id ? this.pics.get(id) : null;
    if (!p || p.state !== 'ready' || !p.tex) return null;
    if (!p.shown) {
      if (this.uploadsLeft <= 0) return null;
      this.uploadsLeft--;
      p.shown = true;
    }
    return p.tex;
  }

  // ------------------------------------------------------------------ the LED wall
  setupLed(parent: THREE.Object3D) {
    const g = new THREE.Group();
    g.position.set(WED_SCREEN.x + LED_PHOTO.cx, WED_SCREEN.y + LED_PHOTO.cy, WED_SCREEN.z + 0.012);
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 2; i++) {
      const base = { transparent: true, depthWrite: false, toneMapped: false, opacity: 0 };
      const shadow = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ ...base, color: '#000000' }));
      const border = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ ...base, color: '#fff8ef' }));
      const photo = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ ...base, color: '#ffffff' }));
      shadow.renderOrder = 10 + i * 3;
      border.renderOrder = 11 + i * 3;
      photo.renderOrder = 12 + i * 3;
      shadow.position.z = 0;
      border.position.z = 0.004;
      photo.position.z = 0.008;
      g.add(shadow, border, photo);
      this.layers.push({ shadow, border, photo, tex: null, id: null, slide: 0 });
    }
    g.visible = false;
    parent.add(g);
    this.led = g;
  }

  /** Should the LED wall run the slideshow (the screen draws the names beside it)? */
  setLed(on: boolean) {
    this.ledOn = on && this.list.length > 0;
  }

  private setLayer(l: Layer, p: WedPhoto, tex: THREE.CanvasTexture, slide: number) {
    l.tex?.dispose();
    // a clone shares the picture on the GPU but has its own pan / zoom
    l.tex = tex.clone();
    l.id = p.id;
    l.slide = slide;
    const m = l.photo.material as THREE.MeshBasicMaterial;
    m.map = l.tex;
    m.needsUpdate = true;
    const s = contain(aspect(p), LED_PHOTO.w, LED_PHOTO.h);
    const b = Math.min(s.w, s.h) * 0.035;
    l.photo.scale.set(s.w, s.h, 1);
    l.border.scale.set(s.w + b * 2, s.h + b * 2, 1);
    l.shadow.scale.set(s.w + b * 2, s.h + b * 2, 1);
    l.shadow.position.set(0.05, -0.06, 0);
  }

  /** The top layer's picture goes to the bottom one (to fade out under the next). */
  private sink() {
    const [a, b] = this.layers;
    a.tex?.dispose();
    a.tex = b.tex;
    a.id = b.id;
    a.slide = b.slide;
    const am = a.photo.material as THREE.MeshBasicMaterial;
    am.map = a.tex;
    am.needsUpdate = true;
    a.photo.scale.copy(b.photo.scale);
    a.border.scale.copy(b.border.scale);
    a.shadow.scale.copy(b.shadow.scale);
    a.shadow.position.copy(b.shadow.position);
    b.tex = null;
    b.id = null;
  }

  private setLayerAlpha(l: Layer, a: number) {
    (l.photo.material as THREE.MeshBasicMaterial).opacity = a;
    (l.border.material as THREE.MeshBasicMaterial).opacity = a;
    (l.shadow.material as THREE.MeshBasicMaterial).opacity = a * 0.28;
    l.photo.visible = l.border.visible = l.shadow.visible = a > 0.001 && !!l.id;
  }

  /** Ken Burns: a slow zoom with a drift, its direction picked by the slide number. */
  private kenBurns(l: Layer, now: number) {
    if (!l.tex) return;
    const k = Math.max(0, Math.min(1, (now - l.slide * SLIDE_MS) / (SLIDE_MS + FADE_MS)));
    const zoom = 1.0 + 0.08 * (l.slide % 2 ? 1 - k : k);
    const r = 1 / zoom;
    const dirs = [
      [0.5, 0.7],
      [0.2, 0.5],
      [0.8, 0.55],
      [0.5, 0.35],
    ];
    const [fx, fy] = dirs[((l.slide % dirs.length) + dirs.length) % dirs.length];
    l.tex.repeat.set(r, r);
    l.tex.offset.set((1 - r) * fx, (1 - r) * fy);
  }

  private tickLed(now: number) {
    const g = this.led;
    if (!g) return;
    const n = this.list.length;
    if (!this.ledOn || !n) {
      g.visible = false;
      // start over (with a fade in) next time
      for (const l of this.layers) {
        l.tex?.dispose();
        l.tex = null;
        l.id = null;
      }
      return;
    }
    g.visible = true;
    const slide = Math.floor(now / SLIDE_MS);
    const cur = this.list[((slide % n) + n) % n];
    const [a, b] = this.layers;
    if (b.id !== cur.id) {
      // until the slide's picture is here, keep showing whatever is up
      const tex = this.texOf(cur.id);
      if (tex) {
        if (b.id) this.sink();
        this.setLayer(b, cur, tex, slide);
        this.swapAt = performance.now();
      }
    }
    const k = Math.min(1, (performance.now() - this.swapAt) / FADE_MS);
    const e = k * k * (3 - 2 * k);
    this.setLayerAlpha(b, e);
    this.setLayerAlpha(a, e < 1 ? 1 : 0);
    if (e >= 1 && a.id) {
      a.tex?.dispose();
      a.tex = null;
      a.id = null;
    }
    this.kenBurns(b, now);
    this.kenBurns(a, now);
  }

  // ------------------------------------------------------------------ the album wall
  /** How many frames hang, where and how big (the middle one biggest). */
  private layout(instant: boolean) {
    const n = this.list.length;
    const k = Math.min(MAX_FRAMES, n);
    const spacing = k >= 5 ? 2.3 : k === 4 ? 2.55 : 2.7;
    for (let i = 0; i < MAX_FRAMES; i++) {
      const s = this.slots[i];
      if (i >= k) {
        s.idx = -1;
        s.next = null;
        s.tw = s.th = 0;
        continue;
      }
      s.x = (i - (k - 1) / 2) * spacing;
      const want = i;
      if (instant || s.idx < 0) {
        s.idx = want;
        s.next = null;
        s.fade = 0;
      } else if (s.idx !== want || s.idx >= n) s.next = want;
    }
    this.cursor = k % Math.max(1, n);
    this.rotSlot = 0;
    for (let i = 0; i < k; i++) this.target(this.slots[i]);
    this.placeholder.visible = n === 0;
    if (!n) {
      this.placeholder.position.set(0, WALL_Y, FRAME_D + 0.003);
      this.placeholder.scale.set(1.12, 1.4, 1);
    }
  }

  private boxOf(s: Slot) {
    const k = Math.min(MAX_FRAMES, this.list.length);
    const mid = (k - 1) / 2;
    const d = Math.abs(this.slots.indexOf(s) - mid);
    const f = 1 - 0.11 * d;
    return { w: 1.75 * f, h: 1.55 * f };
  }

  private target(s: Slot) {
    const p = this.list[s.next ?? s.idx];
    const box = this.boxOf(s);
    const c = contain(aspect(p), box.w, box.h);
    s.tw = c.w;
    s.th = c.h;
  }

  private tickWall(dt: number) {
    const n = this.list.length;
    const k = Math.min(MAX_FRAMES, n);
    // more photos than frames: one frame at a time moves on to the next unseen picture
    if (n > k) {
      this.rotAcc += dt * 1000;
      if (this.rotAcc > ROTATE_MS) {
        this.rotAcc = 0;
        const s = this.slots[this.rotSlot % k];
        if (s.next === null) {
          s.next = this.cursor % n;
          this.cursor = (this.cursor + 1) % n;
          this.target(s);
        }
        this.rotSlot = (this.rotSlot + 1) % k;
      }
    }
    const d = this.dummy;
    let shown = 0;
    for (let i = 0; i < MAX_FRAMES; i++) {
      const s = this.slots[i];
      const m = s.photo.material as THREE.MeshBasicMaterial;
      if (i >= k) {
        s.photo.visible = false;
        continue;
      }
      if (s.next !== null) {
        // fade out, then take the new picture and grow / shrink to it
        s.fade = Math.max(0, s.fade - dt * 3);
        if (s.fade === 0) {
          s.idx = s.next;
          s.next = null;
          this.target(s);
        }
      }
      const p = this.list[s.idx];
      const tex = s.next === null && p ? this.texOf(p.id) : null;
      if (tex && m.map !== tex) {
        m.map = tex;
        m.needsUpdate = true;
      }
      const lerp = 1 - Math.exp(-dt * 7);
      if (s.w === 0) {
        s.w = s.tw;
        s.h = s.th;
      } else {
        s.w += (s.tw - s.w) * lerp;
        s.h += (s.th - s.h) * lerp;
      }
      const settled = Math.abs(s.w - s.tw) < 0.01 && Math.abs(s.h - s.th) < 0.01;
      if (s.next === null && tex && settled) s.fade = Math.min(1, s.fade + dt * 2.2);
      m.opacity = s.fade;
      s.photo.visible = s.fade > 0.001 && !!m.map;
      s.photo.position.set(s.x, WALL_Y, FRAME_D + 0.004);
      s.photo.scale.set(s.w, s.h, 1);
      // gold frame, ivory mat, picture light, its wash
      const ow = s.w + (MAT_BORDER + FRAME_BORDER) * 2;
      const oh = s.h + (MAT_BORDER + FRAME_BORDER) * 2;
      d.position.set(s.x, WALL_Y, FRAME_D / 2);
      d.scale.set(ow, oh, FRAME_D);
      d.updateMatrix();
      this.frames.setMatrixAt(shown, d.matrix);
      d.position.set(s.x, WALL_Y, FRAME_D + 0.002);
      d.scale.set(s.w + MAT_BORDER * 2, s.h + MAT_BORDER * 2, 1);
      d.updateMatrix();
      this.mats.setMatrixAt(shown, d.matrix);
      d.position.set(s.x, WALL_Y + oh / 2 + 0.07, 0.16);
      d.scale.set(Math.min(0.7, ow * 0.45), 1, 1);
      d.updateMatrix();
      this.lamps.setMatrixAt(shown, d.matrix);
      d.position.set(s.x, WALL_Y + oh / 2 - oh * 0.3, FRAME_D + 0.008);
      d.scale.set(ow * 1.15, oh * 0.85, 1);
      d.updateMatrix();
      this.washes.setMatrixAt(shown, d.matrix);
      shown++;
    }
    // the empty album's card has a frame too
    if (!n) {
      const ow = 1.12 + FRAME_BORDER * 2;
      const oh = 1.4 + FRAME_BORDER * 2;
      d.position.set(0, WALL_Y, FRAME_D / 2);
      d.scale.set(ow, oh, FRAME_D);
      d.updateMatrix();
      this.frames.setMatrixAt(0, d.matrix);
      d.position.set(0, WALL_Y + oh / 2 + 0.07, 0.16);
      d.scale.set(0.5, 1, 1);
      d.updateMatrix();
      this.lamps.setMatrixAt(0, d.matrix);
      d.position.set(0, WALL_Y + oh / 2 - oh * 0.3, FRAME_D + 0.008);
      d.scale.set(ow * 1.15, oh * 0.85, 1);
      d.updateMatrix();
      this.washes.setMatrixAt(0, d.matrix);
      this.frames.count = this.lamps.count = this.washes.count = 1;
      this.mats.count = 0;
    } else {
      this.frames.count = this.mats.count = this.lamps.count = this.washes.count = shown;
    }
    for (const m of [this.frames, this.mats, this.lamps, this.washes]) m.instanceMatrix.needsUpdate = true;
  }

  /** "Our Love Story" and the couple's names over the frames. */
  drawTitle(names: { a: string; b: string } | null) {
    const key = names ? `${names.a}|${names.b}` : '';
    if (key === this.titleKey) return;
    this.titleKey = key;
    const g = this.titleG;
    const w = 1024;
    const h = 256;
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const gold = g.createLinearGradient(0, 0, w, 0);
    gold.addColorStop(0, '#b88a3e');
    gold.addColorStop(0.5, '#e9c77f');
    gold.addColorStop(1, '#b88a3e');
    g.fillStyle = gold;
    g.font = 'italic 400 116px "Great Vibes", "Allura", "Segoe Script", "Brush Script MT", Georgia, cursive';
    g.fillText('Our Love Story', w / 2, 128);
    g.fillRect(w / 2 - 230, 160, 160, 2);
    g.fillRect(w / 2 + 70, 160, 160, 2);
    g.fillStyle = '#c75b73';
    g.font = '28px serif';
    g.fillText('♥', w / 2, 170);
    if (names) {
      g.fillStyle = '#8a5060';
      g.font = '600 40px "Be Vietnam Pro", sans-serif';
      const t = `${names.a}  &  ${names.b}`;
      const tw = g.measureText(t).width;
      if (tw > w - 80) {
        g.save();
        g.translate(w / 2, 228);
        g.scale((w - 80) / tw, 1);
        g.fillText(t, 0, 0);
        g.restore();
      } else g.fillText(t, w / 2, 228);
    }
    this.titleTex.needsUpdate = true;
  }

  /** Fonts arrived: draw the title again. */
  redrawTitle(names: { a: string; b: string } | null) {
    this.titleKey = '\u0000';
    this.drawTitle(names);
  }

  // ------------------------------------------------------------------ per frame (only while floor 7 is drawn)
  tick(dt: number, now: number, cover: string | null) {
    this.uploadsLeft = 1;
    this.pump(cover);
    this.tickLed(now);
    this.tickWall(dt);
  }
}
