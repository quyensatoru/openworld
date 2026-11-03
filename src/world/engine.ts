// The 3D world: renderer, camera rig, input, local + remote players, avatars and name tags.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AvatarConfig } from '../../shared/avatar';
import {
  CINEMA_SCREEN,
  FLOOR_H,
  FURNITURE,
  INTERACTABLES,
  LIFTS,
  OFFICE_D,
  OFFICE_W,
  SEATS,
  SEAT_BY_ID,
  STAIRWAYS,
  TALL_KINDS,
  WALLS,
  stairAt,
  stairPoints,
  type Floor,
  UP_DX,
  WORLD_D,
  WORLD_W,
  floorOf,
  groundAt,
  liftAtPos,
  onDanceFloor,
  sameFloorX,
  visualX,
  zoneAt,
  type Lift,
  type Seat,
} from '../../shared/map';
import type { AnimState, Emote, PlayerState, Task } from '../../shared/protocol';
import { avatars } from './avatar/manifest';
import type { Avatar } from './avatar/types';
import { LocalController, angleDamp, seatApproach } from './controller';
import { OfficeScene } from './office';
import { NameTag } from './overlays';
import { NavGrid } from './pathfinding';
import { BarStaff } from './npc';
import { VrmAvatar } from './avatar/vrm-avatar';
import { party } from './bar';

export interface WorldCallbacks {
  onLocalMove(x: number, z: number, ry: number, anim: AnimState): void;
  onSit(seat: Seat): void;
  onStandUp(): void;
  onInteract(id: string): void;
  onSelect(id: string | null): void;
  onPrompt(text: string | null): void;
  onZoneChange(zoneId: string): void;
  onEmoteKey(index: number): void;
  onViewMode(mode: ViewMode): void;
  onOpenMonitor(deskId: string): void;
  onOpenTv(zoneId: string): void;
  onStep(id: string, x: number, z: number, run: boolean, self: boolean): void;
  onSeatTaken(): void;
  onFloorChange(floor: Floor): void;
  onLift(phase: 'start' | 'arrive', from: Floor, to: Floor): void;
  /** Standing in a lift car (show the floor buttons), or null. */
  onLiftPanel(floor: Floor | null): void;
  /** true while a game window has the keyboard (BSS Net). */
  inputBlocked?(): boolean;
  /** The WebGL context was lost (true) / restored (false). */
  onGraphicsLost?(lost: boolean): void;
  taskTitle(taskId: string | null): string | null;
}

export type ViewMode = 'third' | 'first';

interface Sample {
  t: number;
  x: number;
  z: number;
  ry: number;
  anim: AnimState;
}

interface PlayerView {
  id: string;
  isMe: boolean;
  state: PlayerState;
  holder: THREE.Group;
  avatar: Avatar | null;
  avatarKey: string;
  tag: NameTag;
  proxy: THREE.Mesh;
  samples: Sample[];
  x: number;
  z: number;
  ry: number;
  speed: number;
  anim: AnimState;
  speaking: boolean;
  lookAt: THREE.Vector3 | null;
  lookTimer: number;
  stepAcc: number;
  groundY: number;
  jumpT: number; // < 0: not jumping
  danceT: number; // countdown to the next (auto) dance on the dance floor
  autoDance: boolean;
  /** Karaoke: holding a mic. */
  hold: 'mic' | null;
}

/** Room lighting while it is dark: the bar's party lights, karaoke colours, the werewolf village. */
export type Mood = 'bar' | 'kara' | 'night' | 'camp' | 'facility';
const KARA_HUES = ['#9b5cff', '#ff3ea5', '#2de2e6', '#5d9bff'].map((c) => new THREE.Color(c));

const INTERP_DELAY = 120;
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Pitch that puts a cinema seat's view on the middle of the screen. */
function cinemaPitch(seat: Seat): number {
  return Math.atan2(CINEMA_SCREEN.y - ((seat.y ?? 0) + 1.2), Math.abs(CINEMA_SCREEN.z - seat.z)) * 0.85;
}

/** The browser can't draw 3D (WebGL off / GPU blocked / driver crashed). */
export class WebGLUnavailable extends Error {}

/** Best renderer this machine allows: full quality, then a plain one (no MSAA, any GPU). */
function createRenderer(): THREE.WebGLRenderer {
  const attempts: THREE.WebGLRendererParameters[] = [
    { antialias: true, alpha: true, powerPreference: 'high-performance' },
    { antialias: false, alpha: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
  ];
  let last: unknown = null;
  for (const opts of attempts) {
    try {
      return new THREE.WebGLRenderer(opts);
    } catch (err) {
      last = err;
    }
  }
  throw new WebGLUnavailable(String((last as Error)?.message ?? last));
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 320);
  readonly office: OfficeScene;
  private nav = new NavGrid();
  private sun: THREE.DirectionalLight;
  private windowLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private css3d: CSS3DRenderer;
  /** CSS3D objects (the cinema's YouTube iframe) live in their own scene, rendered behind the canvas. */
  readonly cssScene = new THREE.Scene();
  viewMode: ViewMode = 'third';
  private fpPitch = 0;
  /** first-person look settings + mouse movement still to be eased in */
  private fpLook = { sens: 0.6, smooth: true, bob: false };
  private lookPend = { x: 0, y: 0 };
  setFpLook(v: { sens: number; smooth: boolean; bob: boolean }) {
    this.fpLook = { sens: Math.max(0.15, Math.min(2.5, v.sens)), smooth: v.smooth, bob: v.bob };
    if (!v.smooth) this.lookPend.x = this.lookPend.y = 0;
  }
  private eyeH = 1.6;
  private bob = 0;
  private dim = 0; // cinema darkness: film playing (local only)
  private dimTarget = 0;
  private dark = 0; // bar darkness: daylight off, the party lights do the rest
  private darkTarget = 0;
  private floorView = -1;
  private doorPeople: { x: number; z: number }[] = [];
  private warmPending = false;
  private shadowTick = 0;
  private hemiBase = new THREE.Color('#f4f7ff');
  private static readonly WHITE = new THREE.Color('#ffffff');
  /** Floor you are on (0 = office, 1 = cinema & bar). */
  myFloor: Floor = 0;
  private ride: { t: number; dur: number; from: Floor; to: Floor; switched: boolean; lift: Lift } | null = null;
  private liftPanel: Floor | null = null;
  /** Shared clock in seconds (server time; set by the game). */
  serverClock: () => number = () => performance.now() / 1000;
  /** Shared beat clock for the bar lights (set by the game to follow the music). */
  beatClock: () => number = () => this.serverClock() * (124 / 60);
  /** Bartender, waitress and DJ upstairs. */
  readonly staff: BarStaff;
  private tod = { exposure: 0.95, hemi: 0.6, key: 1.7, win: 0.6 };
  private todTimer = 0;
  private baseFov = 45;
  private players = new Map<string, PlayerView>();
  private me: PlayerView | null = null;
  controller: LocalController | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private ro: ResizeObserver;
  private ray = new THREE.Raycaster();
  private camYaw = 0;
  private camPitch = 0.78;
  private camDist = 11;
  /** fingers on the canvas (pinch zoom) */
  private touchPts = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; cam: number; fov: number } | null = null;

  /** On-screen stick (phones): x right, y forward, -1..1. */
  setStick(x: number, y: number) {
    if (this.controller) this.controller.stick = { x, y };
  }

  /** Jump (the Space key / the phone's jump button). */
  jump() {
    const c = this.controller;
    if (c && !c.seat && !c.busy) this.cb.onEmoteKey(-1);
  }

  /** What E would do right now (for the phone's action button), or null. */
  actionLabel(): string | null {
    return this.nearestAction()?.text ?? null;
  }
  private camTarget = new THREE.Vector3(20, 1.2, 24);
  private drag: { x: number; y: number; moved: boolean; button: number } | null = null;
  private lastSend = 0;
  private lastSent = { x: 0, z: 0, ry: 0, anim: 'idle' as AnimState };
  private zoneId = '';
  private promptTimer = 0;
  private wallTimer = 0;
  private uiTimer = 0;
  private marker: THREE.Mesh;
  private markerLife = 0;
  private voiceRing: THREE.Mesh;
  private selected: string | null = null;
  private disposed = false;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(
    private container: HTMLElement,
    private cb: WorldCallbacks,
    quality: 'high' | 'low',
  ) {
    // alpha: the cinema screen punches a transparent hole so the YouTube iframe behind shows through
    const r = createRenderer();
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; // refreshed every other frame (see frame())
    // reading shader logs forces a sync with the GPU driver the first time each program is used
    if (import.meta.env.PROD) r.debug.checkShaderErrors = false;
    r.domElement.className = 'world-canvas';
    // the GPU process can crash / reset (driver, sleep, too many tabs): three.js restores the context
    // by itself; tell the player meanwhile instead of showing a frozen picture
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.cb.onGraphicsLost?.(true);
    });
    r.domElement.addEventListener('webglcontextrestored', () => this.cb.onGraphicsLost?.(false));
    this.css3d = new CSS3DRenderer();
    this.css3d.domElement.className = 'world-css3d';
    container.appendChild(this.css3d.domElement);
    container.appendChild(r.domElement);
    this.renderer = r;
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'world-labels';
    container.appendChild(this.labels.domElement);

    const sky = new THREE.Color('#e8eef3');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 48, 125);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // Office lighting: soft sky fill, a near-overhead "ceiling" key light (shadows fall right under
    // things, like under office panels) and cool daylight through the north windows.
    this.hemi = new THREE.HemisphereLight('#f4f7ff', '#bfae94', 0.6);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff6ea', 1.7);
    sun.position.set(OFFICE_W / 2 - 5, 34, OFFICE_D / 2 - 4);
    sun.target.position.set(OFFICE_W / 2, 0, OFFICE_D / 2);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -33;
    sc.right = 33;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 5;
    sc.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.windowLight = new THREE.DirectionalLight('#dbe8ff', 0.6);
    this.windowLight.position.set(OFFICE_W / 2, 9, -22);
    this.windowLight.target.position.set(OFFICE_W / 2, 0, OFFICE_D / 3);
    this.scene.add(this.windowLight, this.windowLight.target);
    this.applyTimeOfDay();

    this.office = new OfficeScene();
    this.scene.add(this.office.group);
    this.staff = new BarStaff(this.scene, this.camera); // their eyes follow you
    // get the upper floor ready in the background, so the first trip upstairs doesn't stall
    window.setTimeout(() => void this.warmUpstairs(), 2000);

    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 32), new THREE.MeshBasicMaterial({ color: '#6b8cff', transparent: true, opacity: 0, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.02;
    this.scene.add(this.marker);
    this.voiceRing = new THREE.Mesh(new THREE.RingGeometry(4.42, 4.5, 80), new THREE.MeshBasicMaterial({ color: '#3fb27f', transparent: true, opacity: 0.22, depthWrite: false }));
    this.voiceRing.rotation.x = -Math.PI / 2;
    this.voiceRing.position.y = 0.015;
    this.voiceRing.visible = false;
    this.scene.add(this.voiceRing);

    this.setQuality(quality);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ setup
  setQuality(q: 'high' | 'low') {
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.css3d.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  private bindInput() {
    const el = this.renderer.domElement;
    this.on(window, 'keydown', ((e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.cb.inputBlocked?.()) {
        this.controller?.keys.clear();
        return;
      }
      const c = this.controller;
      if (!c) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        c.keys.add(e.code);
        e.preventDefault();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') c.run = true;
      else if (e.code === 'KeyE' && !e.repeat) this.interact();
      else if (e.code === 'KeyV' && !e.repeat) this.setViewMode(this.viewMode === 'first' ? 'third' : 'first');
      else if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (!c.seat && !c.busy) this.cb.onEmoteKey(-1); // jump
      }
      else if (e.code === 'Escape') {
        c.cancelPath();
        this.select(null);
      } else if (/^Digit[1-9]$/.test(e.code) && !e.repeat) this.cb.onEmoteKey(Number(e.code.slice(5)) - 1);
    }) as EventListener);
    this.on(window, 'keyup', ((e: KeyboardEvent) => {
      const c = this.controller;
      if (!c) return;
      c.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') c.run = false;
    }) as EventListener);
    this.on(window, 'blur', () => {
      this.controller?.keys.clear();
      if (this.controller) this.controller.run = false;
    });
    this.on(el, 'contextmenu', (e) => e.preventDefault());
    this.on(el, 'pointerdown', ((e: PointerEvent) => {
      this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touchPts.size === 2) {
        // two fingers: pinch to zoom (no drag, no tap)
        const [a, b] = [...this.touchPts.values()];
        this.pinch = { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), cam: this.camDist, fov: this.camera.fov };
        this.drag = null;
        return;
      }
      if (this.touchPts.size > 2) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
      el.setPointerCapture(e.pointerId);
    }) as EventListener);
    this.on(el, 'pointermove', ((e: PointerEvent) => {
      if (this.touchPts.has(e.pointerId)) this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touchPts.size >= 2) {
        const [a, b] = [...this.touchPts.values()];
        const k = this.pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
        if (this.viewMode === 'first') {
          this.camera.fov = Math.max(30, Math.min(85, this.pinch.fov * k));
          this.camera.updateProjectionMatrix();
        } else this.camDist = Math.max(4, Math.min(26, this.pinch.cam * k));
        return;
      }
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (!this.drag.moved && Math.hypot(dx, dy) > 6) this.drag.moved = true;
        if (this.drag.moved) {
          if (this.viewMode === 'first') {
            const k = this.fpLook.sens;
            if (this.fpLook.smooth) {
              this.lookPend.x -= dx * 0.005 * k;
              this.lookPend.y -= dy * 0.004 * k;
            } else {
              this.camYaw -= dx * 0.005 * k;
              this.fpPitch = Math.max(-1.2, Math.min(1.2, this.fpPitch - dy * 0.004 * k));
            }
          } else {
            this.camYaw -= dx * 0.006;
            this.camPitch = Math.max(0.3, Math.min(1.3, this.camPitch + dy * 0.004));
          }
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      } else this.hover(e);
    }) as EventListener);
    const lift = (e: PointerEvent) => {
      this.touchPts.delete(e.pointerId);
      if (this.touchPts.size < 2) this.pinch = null;
    };
    this.on(el, 'pointerup', ((e: PointerEvent) => {
      const wasPinch = !!this.pinch || this.touchPts.size > 1;
      lift(e);
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && d.button === 0 && !wasPinch) this.click(e);
    }) as EventListener);
    this.on(el, 'pointercancel', ((e: PointerEvent) => {
      lift(e);
      this.drag = null;
    }) as EventListener);
    this.on(
      el,
      'wheel',
      ((e: WheelEvent) => {
        e.preventDefault();
        if (this.viewMode === 'first') {
          this.camera.fov = Math.max(30, Math.min(85, this.camera.fov + Math.sign(e.deltaY) * 4));
          this.camera.updateProjectionMatrix();
          return;
        }
        this.camDist = Math.max(4, Math.min(26, this.camDist * (1 + Math.sign(e.deltaY) * Math.min(0.15, Math.abs(e.deltaY) * 0.0012))));
      }) as EventListener,
      { passive: false },
    );
  }

  private pointerNdc(e: PointerEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** What is under the pointer, on your floor only. `floor` comes back in logical coordinates. */
  private pick(e: PointerEvent): { player?: string; seat?: Seat; interact?: string; monitor?: string; tv?: string; stairs?: number; floor?: THREE.Vector3 } {
    this.ray.setFromCamera(this.pointerNdc(e), this.camera);
    const fl = this.myFloor;
    const proxies = [...this.players.values()].filter((p) => !p.isMe && p.holder.visible).map((p) => p.proxy);
    const hitP = this.ray.intersectObjects(proxies, false)[0];
    const mine = this.office.pickables.filter((p) => p.floor === fl);
    const hitO = this.ray.intersectObjects(mine.map((p) => p.object), false)[0];
    if (hitP && (!hitO || hitP.distance <= hitO.distance + 0.3)) return { player: hitP.object.userData.playerId };
    if (hitO) {
      const pk = mine.find((p) => p.object === hitO.object)!;
      return { seat: pk.seat, interact: pk.interact, monitor: pk.monitor, tv: pk.tv, stairs: pk.stairs };
    }
    const hitF = this.ray.intersectObjects([this.office.floors[fl], ...this.office.steps.filter((s) => s.userData.floor === fl)], false)[0];
    if (!hitF) return {};
    const p = hitF.point.clone();
    p.x += fl * UP_DX;
    return { floor: p };
  }

  private hoverAcc = 0;
  private hover(e: PointerEvent) {
    const now = performance.now();
    if (now - this.hoverAcc < 60) return;
    this.hoverAcc = now;
    const h = this.pick(e);
    this.renderer.domElement.style.cursor = h.player || h.seat || h.interact || h.tv || h.monitor || h.stairs !== undefined ? 'pointer' : 'default';
  }

  private click(e: PointerEvent) {
    const c = this.controller;
    if (!c) return;
    const h = this.pick(e);
    if (h.player) {
      this.select(h.player === this.selected ? null : h.player);
      return;
    }
    this.select(null);
    if (h.seat) {
      this.sitOn(h.seat);
      return;
    }
    if (h.tv) {
      this.cb.onOpenTv(h.tv);
      return;
    }
    if (h.monitor) {
      if (this.seatOccupant(h.monitor) || this.controller?.seat?.id === h.monitor) this.cb.onOpenMonitor(h.monitor);
      return;
    }
    if (h.stairs !== undefined) {
      this.useStairs(h.stairs);
      return;
    }
    if (h.interact) {
      const it = INTERACTABLES.find((i) => i.id === h.interact)!;
      if (it.kind === 'elevator') return this.callLift(LIFTS[floorOf(it.x)]);
      if (Math.hypot(it.x - c.x, it.z - c.z) < it.radius) this.cb.onInteract(it.id);
      else this.route(it.x, it.z, () => this.cb.onInteract(it.id));
      return;
    }
    if (h.floor) {
      if (this.route(h.floor.x, h.floor.z)) {
        this.marker.position.set(visualX(h.floor.x), groundAt(h.floor.x, h.floor.z) + 0.02, h.floor.z);
        this.markerLife = 1;
      }
    }
  }

  private select(id: string | null) {
    if (this.selected) this.players.get(this.selected)?.tag.setSelected(false);
    this.selected = id;
    if (id) this.players.get(id)?.tag.setSelected(true);
    this.cb.onSelect(id);
  }

  // ------------------------------------------------------------------ actions
  sitOn(seat: Seat) {
    const c = this.controller;
    if (!c || c.busy) return;
    if (this.seatOccupant(seat.id)) {
      this.cb.onSeatTaken();
      return;
    }
    const a = seatApproach(seat);
    const sit = () => {
      if (this.seatOccupant(seat.id)) return this.cb.onSeatTaken();
      c.sitOn(seat);
      if (seat.kind === 'meeting') {
        // turn towards the room's TV (east wall) so a shared screen is right in view
        const tv = FURNITURE.find((f) => f.kind === 'tv' && f.zone === seat.zone);
        if (tv) {
          this.camYaw = Math.atan2(-(tv.x - seat.x), -(tv.z - seat.z));
          this.fpPitch = 0.12;
          this.camPitch = 0.5;
        }
      } else if (this.viewMode === 'first' || seat.kind === 'cinema') {
        this.camYaw = seat.ry + Math.PI; // look where the seat faces
        this.fpPitch = seat.kind === 'cinema' ? cinemaPitch(seat) : -0.12;
        if (seat.kind === 'cinema') this.camPitch = 0.42;
      }
      this.cb.onSit(seat);
    };
    if (Math.hypot(a.x - c.x, a.z - c.z) < 0.35) sit();
    else if (!this.route(a.x, a.z, sit) && floorOf(a.x) === floorOf(c.x)) sit();
  }

  private seatOccupant(seatId: string): string | null {
    for (const p of this.players.values()) if (!p.isMe && p.state.seat === seatId) return p.id;
    return null;
  }

  private nearestAction(): { text: string; run: () => void } | null {
    const c = this.controller;
    if (!c || !this.me) return null;
    if (c.seat) return { text: `Đang ngồi · ${c.seat.label} — đi để đứng dậy`, run: () => c.standUp() };
    if (this.ride) return null;
    let best: { d: number; text: string; run: () => void } | null = null;
    for (const it of INTERACTABLES) {
      const d = Math.hypot(it.x - c.x, it.z - c.z);
      if (!(d < it.radius && (!best || d < best.d))) continue;
      const dyn = it.kind === 'mole' && this.interactLabel ? this.interactLabel(it.id) : '';
      if (dyn === null) continue;
      best = { d, text: dyn || it.label, run: it.kind === 'elevator' ? () => this.callLift(LIFTS[floorOf(it.x)]) : () => this.cb.onInteract(it.id) };
    }
    if (best) return best;
    for (const s of SEATS) {
      const a = seatApproach(s);
      const d = Math.min(Math.hypot(s.x - c.x, s.z - c.z), Math.hypot(a.x - c.x, a.z - c.z));
      if (d < 1.1 && !this.seatOccupant(s.id) && (!best || d < best.d)) best = { d, text: `Ngồi xuống · ${s.label}`, run: () => this.sitOn(s) };
    }
    return best;
  }

  interact() {
    this.nearestAction()?.run();
  }

  goTo(x: number, z: number) {
    this.route(x, z);
  }

  /** Walk anywhere; when the target is on another floor, take the stairs (one flight at a time). */
  route(tx: number, tz: number, onArrive?: () => void, forceRun?: boolean): boolean {
    const c = this.controller;
    if (!c || this.ride) return false;
    const from = floorOf(c.x);
    const to = floorOf(tx);
    if (from === to) return c.goTo(tx, tz, onArrive, forceRun);
    const run = forceRun ?? true;
    const next = () => void this.route(tx, tz, onArrive, run);
    if (to > from) {
      // foot of the flight, then climb past the landing (the controller changes floor on the way)
      const st = STAIRWAYS.find((q) => q.lower === from)!;
      const p = stairPoints(st);
      const dx = from * UP_DX;
      return c.goTo(p.foot + dx, p.z, () => void c.goTo(p.climb + dx, p.z, next, run), run);
    }
    const st = STAIRWAYS.find((q) => q.lower === from - 1)!;
    const p = stairPoints(st);
    const dx = from * UP_DX;
    return c.goTo(p.top + dx, p.z, () => void c.goTo(p.descend + dx, p.z, next, run), run);
  }

  /** Clicked a staircase: go to its other end. */
  useStairs(index: number) {
    const st = STAIRWAYS[index];
    const p = stairPoints(st);
    if (this.myFloor === st.lower) this.route(p.top + (st.lower + 1) * UP_DX + (st.dir < 0 ? -0.6 : 0.6), p.z - 1.0);
    else this.route(p.foot + st.lower * UP_DX + (st.dir < 0 ? 0.6 : -0.6), p.z - 1.2);
  }

  /** Walk into the lift car on your floor; the floor buttons show up once you are inside. */
  callLift(l: Lift) {
    const c = this.controller;
    if (!c || this.ride) return;
    if (liftAtPos(c.x, c.z) === l) return this.cb.onLiftPanel(l.floor);
    this.route(l.cx, l.cz);
  }

  /** Walk somewhere and turn to face `ry` on arrival (stands up first if seated). */
  walkAndFace(x: number, z: number, ry: number) {
    const c = this.controller;
    if (!c || this.ride) return;
    if (c.seat) c.standUp();
    const face = () => {
      c.ry = ry;
    };
    if (Math.hypot(c.x - x, c.z - z) < 0.3) face();
    else this.route(x, z, face);
  }

  /** Ride the lift you are standing in to floor `to`. */
  rideTo(to: Floor) {
    const c = this.controller;
    if (!c || this.ride || c.seat || c.busy) return;
    const l = liftAtPos(c.x, c.z);
    if (!l || l.floor === to) return;
    c.cancelPath();
    c.locked = true;
    this.ride = { t: 0, dur: 1.4 + 1.2 * Math.abs(to - l.floor), from: l.floor, to, switched: false, lift: l };
    this.office.setRideCar(visualX(l.cx), l.floor * FLOOR_H, l.cz);
    this.cb.onLift('start', l.floor, to);
  }

  get riding(): boolean {
    return !!this.ride;
  }

  goToPlayer(id: string) {
    const p = this.players.get(id);
    const c = this.controller;
    if (!p || !c) return;
    // stop a little in front of them
    const fx = Math.sin(p.ry);
    const fz = Math.cos(p.ry);
    let tx = p.x + fx * 1.1;
    let tz = p.z + fz * 1.1;
    if (!this.navFree(tx, tz)) {
      tx = p.x - fx * 1.1;
      tz = p.z - fz * 1.1;
    }
    this.route(tx, tz, () => {
      // turn to face them
      c.ry = Math.atan2(p.x - c.x, p.z - c.z);
    });
  }

  private navFree(x: number, z: number) {
    return x > 0.4 && z > 0.4 && x < WORLD_W - 0.4 && z < WORLD_D - 0.4 && this.nav.isFree(x, z);
  }

  // ------------------------------------------------------------------ players
  setLocal(p: PlayerState) {
    if (this.me && this.me.id !== p.id) this.removePlayer(this.me.id);
    let v = this.players.get(p.id);
    if (!v) {
      v = this.createView(p, true);
      this.me = v;
    }
    this.me = v;
    v.state = { ...p };
    this.controller = new LocalController(p.x, p.z, p.ry, this.nav, this.nav.rects);
    this.controller.onStandUp = () => this.cb.onStandUp();
    if (p.seat) {
      const seat = SEAT_BY_ID.get(p.seat);
      if (seat) this.controller.snapSeat(seat);
    }
    this.camTarget.set(visualX(p.x), 1.2 + groundAt(p.x, p.z), p.z);
    this.camYaw = p.ry + Math.PI; // start behind the character
    this.zoneId = zoneAt(p.x, p.z).id;
    this.myFloor = floorOf(p.x);
    this.updateUpstairs();
    this.refreshTag(v);
    this.refreshMonitors();
  }

  upsertRemote(p: PlayerState) {
    let v = this.players.get(p.id);
    if (!v) v = this.createView(p, false);
    else this.applyPatch(p.id, p);
    v.samples = [{ t: performance.now() - INTERP_DELAY, x: p.x, z: p.z, ry: p.ry, anim: p.anim }];
    v.x = p.x;
    v.z = p.z;
    v.ry = p.ry;
    this.refreshMonitors();
  }

  private createView(p: PlayerState, isMe: boolean): PlayerView {
    const holder = new THREE.Group();
    holder.position.set(visualX(p.x), groundAt(p.x, p.z), p.z);
    holder.rotation.y = p.ry;
    holder.visible = isMe || this.sharesFloor(p.x, p.z);
    this.scene.add(holder);
    const tag = new NameTag(isMe);
    tag.object.position.set(0, 1.95 * p.avatar.height, 0);
    holder.add(tag.object);
    const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 4, 8), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.y = 0.9;
    proxy.userData.playerId = p.id;
    holder.add(proxy);
    const v: PlayerView = {
      id: p.id,
      isMe,
      state: { ...p },
      holder,
      avatar: null,
      avatarKey: '',
      tag,
      proxy,
      samples: [],
      x: p.x,
      z: p.z,
      ry: p.ry,
      speed: 0,
      anim: p.anim,
      speaking: false,
      lookAt: null,
      lookTimer: Math.random(),
      stepAcc: 0,
      groundY: groundAt(p.x, p.z),
      jumpT: -1,
      danceT: 0.7,
      autoDance: false,
      hold: null,
    };
    this.players.set(p.id, v);
    this.loadAvatar(v, p.avatar);
    this.refreshTag(v);
    return v;
  }

  private loadAvatar(v: PlayerView, cfg: AvatarConfig) {
    const key = JSON.stringify(cfg);
    if (key === v.avatarKey) return;
    const prev = JSON.parse(v.avatarKey || '{}') as Partial<AvatarConfig>;
    const bodyChanged = !v.avatar || prev.body !== cfg.body || prev.build !== cfg.build;
    v.avatarKey = key;
    v.tag.object.position.y = 1.95 * cfg.height;
    if (v.avatar && !bodyChanged) {
      v.avatar.setConfig(cfg);
      return;
    }
    avatars.create(cfg).then((av) => {
      if (this.disposed || this.players.get(v.id) !== v || v.avatarKey !== key) {
        av.dispose();
        return;
      }
      if (v.avatar) {
        v.holder.remove(v.avatar.root);
        v.avatar.dispose();
      }
      v.avatar = av;
      v.holder.add(av.root);
    });
  }

  removePlayer(id: string) {
    const v = this.players.get(id);
    if (!v) return;
    this.players.delete(id);
    v.tag.dispose();
    v.avatar?.dispose();
    this.scene.remove(v.holder);
    if (this.selected === id) this.select(null);
    if (this.me === v) {
      this.me = null;
      this.controller = null;
    }
    this.refreshMonitors();
  }

  remoteMove(id: string, x: number, z: number, ry: number, anim: AnimState) {
    const v = this.players.get(id);
    if (!v || v.isMe) return;
    v.samples.push({ t: performance.now(), x, z, ry, anim });
    if (v.samples.length > 30) v.samples.splice(0, v.samples.length - 30);
    v.state.x = x;
    v.state.z = z;
    v.state.ry = ry;
    v.state.anim = anim;
  }

  applyPatch(id: string, patch: Partial<PlayerState>) {
    const v = this.players.get(id);
    if (!v) return;
    const prevSeat = v.state.seat;
    Object.assign(v.state, patch);
    if (patch.avatar) this.loadAvatar(v, patch.avatar);
    if (!v.isMe && patch.x != null && patch.z != null) this.remoteMove(id, patch.x, patch.z, patch.ry ?? v.state.ry, patch.anim ?? v.state.anim);
    if (v.isMe && 'seat' in patch && this.controller) {
      // Server refused or cleared our seat.
      if (!patch.seat && this.controller.seat && prevSeat) this.controller.standUp();
    }
    if ('seat' in patch) this.refreshMonitors();
    this.refreshTag(v);
  }

  refreshAllTags() {
    for (const v of this.players.values()) this.refreshTag(v);
  }

  private refreshTag(v: PlayerView) {
    v.tag.update(v.state, this.cb.taskTitle(v.state.taskId));
  }

  private refreshMonitors() {
    const occ = new Set<string>();
    for (const p of this.players.values()) {
      const seat = p.isMe ? this.controller?.seat?.id ?? null : p.state.seat;
      if (seat) occ.add(seat);
    }
    this.office.setMonitorsFrom(occ);
  }

  emote(id: string, e: Emote) {
    const v = this.players.get(id);
    if (!v) return;
    if (e === 'jump') {
      if (v.anim === 'sit' || v.jumpT >= 0) return;
      v.jumpT = 0;
    }
    v.avatar?.emote(e);
    v.tag.emote(e);
  }

  say(id: string, text: string) {
    this.players.get(id)?.tag.say(text);
  }

  confetti(id: string, cheer = true) {
    const v = this.players.get(id);
    if (!v) return;
    v.tag.confetti();
    if (cheer) v.avatar?.emote('cheer');
  }

  /** Drawn position of a player's head (for photos). */
  private headScreen(v: PlayerView, out: THREE.Vector3): boolean {
    v.holder.getWorldPosition(out);
    out.y += (v.anim === 'sit' ? 1.45 : 1.95) * v.state.avatar.height;
    out.project(this.camera);
    return out.z > -1 && out.z < 1;
  }

  /**
   * A photo of the current view: the 3D frame plus name labels and a caption strip (the HTML name
   * tags are not part of the WebGL canvas, so they are redrawn here).
   */
  capture(caption: string): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera); // the drawing buffer is only valid right after a render
    const src = this.renderer.domElement;
    const W = src.width;
    const H = src.height;
    const band = Math.round(H * 0.075);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H + band;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const scale = W / (src.clientWidth || W);
    const p = new THREE.Vector3();
    g.textAlign = 'center';
    g.font = `700 ${Math.round(13 * scale)}px "Be Vietnam Pro", sans-serif`;
    for (const v of this.players.values()) {
      if (!v.holder.visible || (v.isMe && this.viewMode === 'first')) continue;
      if (!this.headScreen(v, p)) continue;
      const x = ((p.x + 1) / 2) * W;
      const y = ((1 - p.y) / 2) * H;
      const tw = g.measureText(v.state.name).width + 16 * scale;
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.beginPath();
      g.roundRect(x - tw / 2, y - 22 * scale, tw, 20 * scale, 10 * scale);
      g.fill();
      g.fillStyle = '#2d3142';
      g.fillText(v.state.name, x, y - 7.5 * scale);
    }
    const grad = g.createLinearGradient(0, H, W, H);
    grad.addColorStop(0, '#6b8cff');
    grad.addColorStop(1, '#b56fd0');
    g.fillStyle = grad;
    g.fillRect(0, H, W, band);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.font = `800 ${Math.round(band * 0.42)}px "Be Vietnam Pro", sans-serif`;
    g.fillText('🏢 BSS Office', band * 0.4, H + band * 0.64);
    g.textAlign = 'right';
    g.font = `500 ${Math.round(band * 0.32)}px "Be Vietnam Pro", sans-serif`;
    g.fillText(caption, W - band * 0.4, H + band * 0.62);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  setSpeaking(id: string, on: boolean) {
    const v = this.players.get(id);
    if (!v || v.speaking === on) return;
    v.speaking = on;
    v.tag.setSpeaking(on);
  }

  setVoiceRing(on: boolean) {
    this.voiceRing.visible = on;
  }

  // ------------------------------------------------------------------ Nội Gián (floor 5)
  private vision: { radius: number; seeAll: boolean; seeGhosts: boolean; ghosts: Set<string> } | null = null;
  private visCache = new Map<string, { t: number; vis: boolean }>();
  private losRects: { x0: number; z0: number; x1: number; z1: number }[] = [
    ...WALLS.filter((w) => w.x0 >= 230 && w.kind !== 'hidden' && w.kind !== 'rail').map((w) => ({
      x0: Math.min(w.x0, w.x1) - 0.1,
      z0: Math.min(w.z0, w.z1) - 0.1,
      x1: Math.max(w.x0, w.x1) + 0.1,
      z1: Math.max(w.z0, w.z1) + 0.1,
    })),
    // tall furniture (racks, shelves, cabinets, screens) hides whoever stands behind it
    ...FURNITURE.filter((f) => f.x >= 230 && TALL_KINDS.has(f.kind)).map((f) => {
      const rot = Math.abs(Math.sin(f.ry)) > 0.7;
      const hw = (rot ? f.d : f.w) / 2 - 0.05;
      const hd = (rot ? f.w : f.d) / 2 - 0.05;
      return { x0: f.x - hw, z0: f.z - Math.max(0.02, hd), x1: f.x + hw, z1: f.z + Math.max(0.02, hd) };
    }),
  ];
  /** People hiding in a duct (never drawn). */
  private hiddenIds = new Set<string>();
  private extraRects: { x0: number; z0: number; x1: number; z1: number }[] = [];

  /** Fog of war on floor 5: see people within `radius` and not behind walls (null = see everyone). */
  setVision(v: { radius: number; seeAll: boolean; seeGhosts: boolean; ghosts: Set<string> } | null) {
    this.vision = v;
    this.visCache.clear();
    this.office.f5.canSee = (x, z) => this.canSeeSpot(x, z);
  }

  /** Freeze walking (meetings). */
  setFrozen(on: boolean) {
    if (this.controller && !this.ride) this.controller.locked = on;
  }

  /** Temporary walls (locked doors): collision + line of sight. */
  setExtraRects(rects: { x0: number; z0: number; x1: number; z1: number }[]) {
    const list = this.nav.rects;
    for (const r of this.extraRects) {
      const i = list.indexOf(r);
      if (i >= 0) list.splice(i, 1);
    }
    this.extraRects = rects.map((r) => ({ ...r }));
    list.push(...this.extraRects);
  }

  /** Is the straight line a→b free of walls (and locked doors)? */
  private lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    for (const r of [...this.losRects, ...this.extraRects]) {
      let t0 = 0;
      let t1 = 1;
      let ok = true;
      for (const [p, q] of [
        [-dx, ax - r.x0],
        [dx, r.x1 - ax],
        [-dz, az - r.z0],
        [dz, r.z1 - az],
      ]) {
        if (Math.abs(p) < 1e-9) {
          if (q < 0) {
            ok = false;
            break;
          }
          continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) {
          ok = false;
          break;
        }
      }
      if (ok) return false; // the segment crosses this wall
    }
    return true;
  }

  /** Fog of war check for a logical spot (floor 5). */
  canSee(x: number, z: number): boolean {
    return this.canSeeSpot(x, z);
  }

  /** Is this person drawn for you right now (same floor, in view)? */
  isShown(id: string): boolean {
    return this.players.get(id)?.holder.visible ?? false;
  }

  /** Nội Gián: people in a duct. */
  setHidden(ids: Iterable<string>) {
    this.hiddenIds = new Set(ids);
  }

  /** Dynamic text for an interactable's E prompt (null = no prompt, '' = the static label). */
  interactLabel: ((id: string) => string | null) | null = null;

  private canSeeSpot(x: number, z: number): boolean {
    const v = this.vision;
    if (!this.me || this.myFloor !== 4 || x < 230) return true;
    if (v?.seeAll) return true;
    // only the room you are in (and through an open door you stand by)
    if (!this.office.f5.roomVisible(x, z)) return false;
    if (!v) return true;
    const mx = this.me.x;
    const mz = this.me.z;
    if (Math.hypot(x - mx, z - mz) > v.radius) return false;
    return this.lineOfSight(mx, mz, x, z);
  }

  private canSeePlayer(p: PlayerView, now: number): boolean {
    const v = this.vision;
    if (this.myFloor !== 4 || p.x < 230) return true;
    if (this.hiddenIds.has(p.id)) return p.isMe ? false : !!v?.seeAll;
    if (p.isMe) return true;
    if (v?.ghosts.has(p.id)) return v.seeGhosts;
    if (v?.seeAll) return true;
    if (!v) return this.office.f5.roomVisible(p.x, p.z);
    const c = this.visCache.get(p.id);
    if (c && now - c.t < 100) return c.vis;
    const vis = this.canSeeSpot(p.x, p.z);
    this.visCache.set(p.id, { t: now, vis });
    return vis;
  }

  /** Where the local player is on screen (CSS px) and how many px `radius` metres is there. */
  screenCircle(radius: number): { x: number; y: number; r: number } | null {
    if (!this.me) return null;
    const p = new THREE.Vector3(visualX(this.me.x), this.me.groundY + 1.0, this.me.z);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const q = p.clone().addScaledVector(right, radius);
    p.project(this.camera);
    q.project(this.camera);
    const el = this.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const sx = ((p.x + 1) / 2) * w;
    const sy = ((1 - p.y) / 2) * h;
    const qx = ((q.x + 1) / 2) * w;
    const qy = ((1 - q.y) / 2) * h;
    return { x: sx, y: sy, r: Math.hypot(qx - sx, qy - sy) };
  }

  /** Karaoke: this person holds a mic (or not). */
  setHold(id: string, hold: 'mic' | null) {
    const v = this.players.get(id);
    if (v) v.hold = hold;
  }

  /** Extra marker on a name tag (Ma Sói: 💀, votes…). */
  setBadge(id: string, text: string | null) {
    this.players.get(id)?.tag.setBadge(text);
  }

  /** A karaoke reaction floating up from someone. */
  react(id: string, e: string) {
    const v = this.players.get(id);
    if (!v) return;
    const y = (v.anim === 'sit' ? 1.35 : 2.0) * v.state.avatar.height + (v.groundY - FLOOR_H * floorOf(v.x));
    this.office.karaFx.react(e, v.x, v.z, y);
  }

  private screenView: { x: number; y: number; z: number; w: number; h: number; ry: number } | null = null;
  /** Fill the view with a screen (karaoke lyrics); null goes back to the normal camera. */
  setScreenView(spot: { x: number; y: number; z: number; w: number; h: number; ry: number } | null) {
    this.screenView = spot;
  }
  get screenViewOn(): boolean {
    return !!this.screenView;
  }

  setTasks(tasks: Task[]) {
    this.office.updateKanban(tasks);
    this.refreshAllTags();
  }

  /** Latest known position (not the interpolated one) — used by proximity voice even when the tab is hidden. */
  positionOf(id: string): { x: number; z: number } | null {
    const v = this.players.get(id);
    if (!v) return null;
    if (v.isMe && this.controller) return { x: this.controller.x, z: this.controller.z };
    return { x: v.state.x, z: v.state.z };
  }

  get localSeat(): Seat | null {
    return this.controller?.seat ?? null;
  }

  // ------------------------------------------------------------------ frame
  private frame = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now();

    // local
    const c = this.controller;
    if (c && this.me) {
      const fpMode = this.viewMode === 'first';
      if (fpMode) {
        // first person: A/D (←/→) turn the body + view; W/S walk where you look
        const turn = (c.keys.has('KeyA') || c.keys.has('ArrowLeft') ? 1 : 0) - (c.keys.has('KeyD') || c.keys.has('ArrowRight') ? 1 : 0);
        if (turn) this.camYaw += turn * 2.4 * this.fpLook.sens * dt;
        // smoothed mouse look: the view eases toward where you dragged it
        if (this.lookPend.x || this.lookPend.y) {
          const f = 1 - Math.exp(-14 * dt);
          const ax = this.lookPend.x * f;
          const ay = this.lookPend.y * f;
          this.camYaw += ax;
          this.fpPitch = Math.max(-1.2, Math.min(1.2, this.fpPitch + ay));
          this.lookPend.x -= ax;
          this.lookPend.y -= ay;
          if (Math.abs(this.lookPend.x) < 1e-4 && Math.abs(this.lookPend.y) < 1e-4) this.lookPend.x = this.lookPend.y = 0;
        }
      }
      c.update(dt, this.camYaw, fpMode);
      this.updateFloors(c, dt);
      // click-to-move in first person: the view swings round to face where you are walking
      if (fpMode && c.hasPath && c.speed > 0.2) {
        const want = Math.atan2(-c.vx, -c.vz);
        this.camYaw += Math.atan2(Math.sin(want - this.camYaw), Math.cos(want - this.camYaw)) * (1 - Math.exp(-5 * dt));
        this.fpPitch += (0 - this.fpPitch) * (1 - Math.exp(-3 * dt));
      }
      const v = this.me;
      v.speed = c.speed;
      v.anim = c.seat ? 'sit' : c.anim;
      v.groundY = this.ride ? this.rideY() : damp(v.groundY, groundAt(c.x, c.z), 14, dt);
      v.holder.position.set(visualX(c.x), v.groundY + this.jumpY(v, dt), c.z);
      v.holder.rotation.y = c.ry;
      v.x = c.x;
      v.z = c.z;
      v.ry = c.ry;
      v.state.x = c.x;
      v.state.z = c.z;
      this.voiceRing.position.set(visualX(c.x), v.groundY + 0.015, c.z);
      const zone = zoneAt(c.x, c.z).id;
      if (zone !== this.zoneId) {
        this.zoneId = zone;
        this.cb.onZoneChange(zone);
      }
      const ls = this.lastSent;
      const changed = Math.abs(ls.x - c.x) > 0.01 || Math.abs(ls.z - c.z) > 0.01 || Math.abs(ls.ry - c.ry) > 0.03 || ls.anim !== v.anim;
      if (changed && (now - this.lastSend > 100 || (v.anim === 'idle' && ls.anim !== 'idle'))) {
        if (!c.seat && !c.busy) this.cb.onLocalMove(c.x, c.z, c.ry, v.anim);
        this.lastSend = now;
        this.lastSent = { x: c.x, z: c.z, ry: c.ry, anim: v.anim };
      }
    }

    // remotes: interpolate ~120 ms in the past
    const rt = now - INTERP_DELAY;
    for (const v of this.players.values()) {
      if (v.isMe) continue;
      const s = v.samples;
      let x = v.x;
      let z = v.z;
      let ry = v.ry;
      let anim = v.anim;
      if (s.length) {
        while (s.length >= 2 && s[1].t <= rt) s.shift();
        const a = s[0];
        const b = s[1];
        if (b && b.t > a.t && rt >= a.t) {
          const k = Math.min(1, (rt - a.t) / (b.t - a.t));
          // interpolate where they are drawn (crossing floors moves the logical x by 60 m)
          const ax = visualX(a.x);
          const bx = visualX(b.x);
          x = ax + (bx - ax) * k + (k < 0.5 ? a.x - ax : b.x - bx);
          z = a.z + (b.z - a.z) * k;
          ry = a.ry + Math.atan2(Math.sin(b.ry - a.ry), Math.cos(b.ry - a.ry)) * k;
          anim = k > 0.5 ? b.anim : a.anim;
        } else {
          x = damp(sameFloorX(v.x, a.x), a.x, 10, dt);
          z = damp(v.z, a.z, 10, dt);
          ry = v.ry + Math.atan2(Math.sin(a.ry - v.ry), Math.cos(a.ry - v.ry)) * (1 - Math.exp(-10 * dt));
          anim = a.anim;
        }
      }
      const inst = dt > 0 ? Math.hypot(visualX(x) - visualX(v.x), z - v.z) / dt : 0;
      v.speed = damp(v.speed, anim === 'sit' ? 0 : Math.min(inst, 6), 10, dt);
      v.x = x;
      v.z = z;
      v.ry = ry;
      v.anim = anim;
      v.groundY = damp(v.groundY, groundAt(x, z), liftAtPos(x, z) ? 2.2 : 14, dt);
      v.holder.position.set(visualX(x), v.groundY + this.jumpY(v, dt), z);
      v.holder.rotation.y = ry;
      v.holder.visible = this.sharesFloor(x, z) && this.canSeePlayer(v, now);
    }

    // automatic doors upstairs (cinema, bar) open for anyone close
    if (this.myFloor >= 1) {
      const ppl = this.doorPeople;
      ppl.length = 0;
      for (const v of this.players.values()) if (v.x >= 50) ppl.push(v);
      this.office.updateDoors(dt, ppl);
    }

    // footsteps (sound) for people walking nearby
    for (const v of this.players.values()) {
      if (v.anim === 'sit' || v.speed < 0.3) {
        v.stepAcc = 0;
        continue;
      }
      v.stepAcc += v.speed * dt;
      const stride = v.speed > 3 ? 1.05 : 0.72;
      if (v.stepAcc >= stride) {
        v.stepAcc -= stride;
        if (v.isMe || (this.me && Math.hypot(v.x - this.me.x, v.z - this.me.z) < 10)) this.cb.onStep(v.id, v.x, v.z, v.speed > 3, v.isMe);
      }
    }

    // avatars + gaze
    for (const v of this.players.values()) {
      v.lookTimer -= dt;
      if (v.lookTimer <= 0) {
        v.lookTimer = 0.35;
        v.lookAt = this.pickLookTarget(v);
      }
      // stand still on the LED floor and you start dancing (everyone sees it: positions are shared)
      if (v.anim === 'idle' && v.speed < 0.15 && v.jumpT < 0 && onDanceFloor(v.x, v.z)) {
        v.danceT -= dt;
        if (v.danceT <= 0) {
          v.avatar?.emote('dance');
          v.danceT = 5.3;
          v.autoDance = true;
        }
      } else {
        if (v.autoDance) v.avatar?.cancelEmote?.();
        v.autoDance = false;
        v.danceT = 0.6;
      }
      const seatId = v.isMe ? this.controller?.seat?.id : v.state.seat;
      // name tag just above the head (anime characters are shorter than the default bodies)
      const h = v.avatar?.height ?? 1.75 * v.state.avatar.height;
      const tagY = v.anim === 'sit' ? h * 0.78 + 0.12 : h + 0.25;
      // during a film, don't let name tags of the audience cover the screen
      if (!v.isMe) v.tag.object.visible = !(this.dimTarget > 0.9 && v.anim === 'sit' && v.state.zone === 'cinema');
      v.tag.object.position.y += (tagY - v.tag.object.position.y) * (1 - Math.exp(-6 * dt));
      v.avatar?.update(dt, {
        speed: v.speed,
        anim: v.anim,
        seatKind: seatId ? SEAT_BY_ID.get(seatId)?.kind ?? null : null,
        lookAt: v.lookAt,
        talking: v.speaking,
        hold: v.hold,
      });
    }

    // camera
    if (this.me) this.camTarget.lerp(new THREE.Vector3(visualX(this.me.x), 1.15 + this.me.groundY, this.me.z), 1 - Math.exp(-8 * dt));
    const fp = this.viewMode === 'first' && this.me && !this.screenView;
    const sv = this.screenView;
    if (sv) {
      // straight in front of the screen, just far enough back to see all of it
      const c = new THREE.Vector3(visualX(sv.x), floorOf(sv.x) * FLOOR_H + sv.y, sv.z);
      const n = new THREE.Vector3(Math.sin(sv.ry), 0, Math.cos(sv.ry));
      const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const d = Math.max(sv.h / 2 / tv, sv.w / 2 / (tv * this.camera.aspect)) * 1.1;
      this.camera.position.lerp(c.clone().addScaledVector(n, d), 1 - Math.exp(-6 * dt));
      this.camera.lookAt(c);
    } else if (fp && this.me) {
      const me = this.me;
      const seated = me.anim === 'sit';
      this.eyeH = damp(this.eyeH, (seated ? 1.2 : 1.62) * me.state.avatar.height, 6, dt);
      this.bob += me.speed * dt * 4.4;
      const bobY = this.fpLook.bob ? Math.sin(this.bob) * 0.022 * Math.min(1, me.speed / 1.5) : 0;
      const fx = -Math.sin(this.camYaw);
      const fz = -Math.cos(this.camYaw);
      // seated: the body is shifted onto the chair, and the eyes sit a bit forward of it
      const sf = seated ? 0.32 : 0.1;
      const eye = new THREE.Vector3(visualX(me.x) + Math.sin(me.ry) * sf, me.groundY + this.eyeH + bobY, me.z + Math.cos(me.ry) * sf);
      this.camera.position.copy(eye);
      const cp = Math.cos(this.fpPitch);
      this.camera.lookAt(eye.x + fx * cp, eye.y + Math.sin(this.fpPitch), eye.z + fz * cp);
    } else {
      const cp = Math.cos(this.camPitch);
      this.camera.position.set(
        this.camTarget.x + Math.sin(this.camYaw) * cp * this.camDist,
        this.camTarget.y + Math.sin(this.camPitch) * this.camDist,
        this.camTarget.z + Math.cos(this.camYaw) * cp * this.camDist,
      );
      this.camera.lookAt(this.camTarget);
    }
    if (this.me) {
      const ducked = this.hiddenIds.has(this.me.id); // in a duct: you're not drawn, even for yourself
      if (this.me.avatar) this.me.avatar.root.visible = !fp && !ducked;
      this.me.tag.object.visible = !fp && !ducked;
    }

    // lighting: time of day + cinema darkness for whoever sits in the dark
    this.todTimer -= dt;
    if (this.todTimer <= 0) {
      this.todTimer = 60;
      this.applyTimeOfDay();
    }
    this.dim = damp(this.dim, this.dimTarget, 1.6, dt);
    this.dark = damp(this.dark, this.darkTarget, 2.2, dt);
    const lit = 1 - 0.98 * this.dark;
    this.renderer.toneMappingExposure = this.tod.exposure * (1 - 0.45 * this.dim) * (1 - 0.15 * this.dark);
    this.hemi.intensity = this.tod.hemi * (1 - 0.75 * this.dim) * (1 - 0.92 * this.dark);
    this.hemi.color.copy(this.hemiBase);
    if (this.dark > 0.01 && this.mood === 'bar') {
      // the bar: the whole room washes over in the party colour, pumping on the kick, plus strobe hits
      const P = party(this.beatClock());
      this.hemi.color.lerp(P.strobe ? World.WHITE : P.color, 0.9 * this.dark);
      this.hemi.intensity += this.dark * (P.strobe ? 1.6 : 0.06 + 0.5 * P.kick);
    } else if (this.dark > 0.01) {
      const t = now / 1000;
      let add = 0.1;
      if (this.mood === 'kara') {
        // slow colour drift (the video is the light show)
        const k = t / 4;
        const i = Math.floor(k) % KARA_HUES.length;
        this.moodCol.copy(KARA_HUES[i]).lerp(KARA_HUES[(i + 1) % KARA_HUES.length], k % 1);
        add = 0.2;
      } else if (this.mood === 'night') {
        this.moodCol.set('#3d55b8');
        add = 0.12;
      } else if (this.mood === 'facility') {
        // cold, dim and unsteady: the lights dip now and then
        this.moodCol.set('#6f86c8');
        const dip = Math.sin(t * 0.7) * Math.sin(t * 2.3) > 0.82 ? 0.45 : 1;
        add = 0.2 * dip;
      } else {
        // camp fire: warm, flickering
        this.moodCol.set('#ffab66');
        add = 0.34 + 0.05 * Math.sin(t * 9) * Math.sin(t * 4.3);
      }
      this.hemi.color.lerp(this.moodCol, 0.9 * this.dark);
      this.hemi.intensity += this.dark * add;
    }
    this.sun.intensity = this.tod.key * (1 - 0.8 * this.dim) * lit;
    this.windowLight.intensity = this.tod.win * (1 - 0.85 * this.dim) * lit;
    this.scene.environmentIntensity = 0.35 * (1 - 0.9 * this.dark);
    VrmAvatar.glow = 0.05 + 0.37 * Math.max(this.dark, this.dim * 0.6);

    // walls between camera and me fade out
    this.wallTimer -= dt;
    if (this.wallTimer <= 0 && this.me) {
      this.wallTimer = 0.1;
      const head = new THREE.Vector3(visualX(this.me.x), this.me.groundY + 1.2, this.me.z);
      const dir = head.clone().sub(this.camera.position);
      const len = dir.length();
      this.ray.set(this.camera.position, dir.normalize());
      this.ray.far = len;
      const hits = new Set(this.ray.intersectObjects(this.office.fadeWalls.map((w) => w.mesh), false).map((h) => h.object));
      this.ray.far = Infinity;
      for (const w of this.office.fadeWalls) w.target = !fp && hits.has(w.mesh) ? 0.05 : 1;
      if (this.myFloor === 4) this.office.f5.cameraRay(this.camera.position, head);
    }
    for (const w of this.office.fadeWalls) {
      if (Math.abs(w.material.opacity - w.target) > 0.005) {
        w.material.opacity = damp(w.material.opacity, w.target, 10, dt);
        w.material.depthWrite = w.material.opacity > 0.95;
        w.mesh.castShadow = true;
      }
    }

    // markers, prompt, misc
    if (this.markerLife > 0) {
      this.markerLife = Math.max(0, this.markerLife - dt * 1.4);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = this.markerLife * 0.9;
      this.marker.scale.setScalar(1 + (1 - this.markerLife) * 0.8);
    }
    this.promptTimer -= dt;
    if (this.promptTimer <= 0) {
      this.promptTimer = 0.2;
      const a = this.nearestAction();
      this.cb.onPrompt(a ? a.text : null);
    }
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 1;
      const t = Date.now();
      for (const v of this.players.values()) v.tag.tickPomo(t);
    }
    if (this.myFloor === 4 && this.me) this.office.f5.setViewer(this.me.x, this.me.z, !!this.vision?.seeAll);
    else this.office.f5.setViewer(null, 0, true);
    this.office.tick(dt, this.beatClock(), this.myFloor);
    this.staff.update(dt, this.serverClock(), this.myFloor === 1);

    if (this.warmPending) {
      this.warmPending = false;
      this.warmRender();
    }
    // shadows: every other frame, and not at all in the dark (cinema film / bar)
    this.shadowTick = (this.shadowTick + 1) % 2;
    this.renderer.shadowMap.needsUpdate = this.shadowTick === 0 && this.dim < 0.9 && this.dark < 0.9;
    if (this.cssScene.children.length) this.css3d.render(this.cssScene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  /** Glance only at someone who is talking nearby (constant head-turning toward neighbours looked odd). */
  private pickLookTarget(v: PlayerView): THREE.Vector3 | null {
    let best: PlayerView | null = null;
    let bestScore = Infinity;
    for (const o of this.players.values()) {
      if (o === v || !o.speaking) continue;
      const d = Math.hypot(o.x - v.x, o.z - v.z);
      if (d > 4) continue;
      const score = d;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best ? new THREE.Vector3(visualX(best.x), best.groundY + (best.anim === 'sit' ? 1.2 : 1.55), best.z) : null;
  }

  get cameraYaw(): number {
    return this.camYaw;
  }

  setViewMode(mode: ViewMode) {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.office.setCeiling(mode === 'first');
    this.updateUpstairs();
    this.camera.near = mode === 'first' ? 0.05 : 0.1;
    this.camera.fov = mode === 'first' ? 70 : this.baseFov;
    this.camera.updateProjectionMatrix();
    if (mode === 'first') {
      const seat = this.controller?.seat;
      this.fpPitch = seat ? (seat.kind === 'cinema' ? cinemaPitch(seat) : -0.1) : 0;
      // look where the seat faces (the chair turn may still be animating), else where you face
      if (seat) this.camYaw = seat.ry + Math.PI;
      else if (this.controller && this.controller.speed < 0.1) this.camYaw = this.controller.ry + Math.PI;
    }
    this.cb.onViewMode(mode);
  }

  /** First person, facing the TV of a meeting room, zoomed in. */
  lookAtTv(zoneId: string) {
    const tv = FURNITURE.find((f) => f.kind === 'tv' && f.zone === zoneId);
    if (!tv || !this.me) return;
    this.setViewMode('first');
    this.camYaw = Math.atan2(-(tv.x - this.me.x), -(tv.z - this.me.z));
    this.fpPitch = Math.atan2(1.55 - this.eyeH, Math.hypot(tv.x - this.me.x, tv.z - this.me.z));
    this.camera.fov = 32;
    this.camera.updateProjectionMatrix();
  }

  /** Height of a jump arc (0.55 m, 0.62 s). */
  private jumpY(v: PlayerView, dt: number): number {
    if (v.jumpT < 0) return 0;
    v.jumpT += dt / 0.62;
    if (v.jumpT >= 1) {
      v.jumpT = -1;
      return 0;
    }
    return 4 * 0.55 * v.jumpT * (1 - v.jumpT);
  }

  /** Jump to another place (portals between the office and the cinema). */
  teleport(x: number, z: number, ry: number) {
    const c = this.controller;
    if (!c || !this.me) return;
    c.cancelPath();
    if (c.seat) c.seat = null;
    c.x = x;
    c.z = z;
    c.ry = ry;
    c.vx = c.vz = 0;
    this.me.groundY = groundAt(x, z);
    this.camTarget.set(visualX(x), 1.15 + this.me.groundY, z);
    this.camYaw = ry + Math.PI;
  }

  // ------------------------------------------------------------------ warm-up
  /**
   * Compile shaders and upload textures of hidden things (the upper floor, the bar staff) ahead of
   * time: otherwise the first frame that shows them does all of it at once and the game freezes.
   */
  private async prewarm(root: THREE.Object3D) {
    if (this.disposed) return;
    await this.renderer.compileAsync(root, this.camera, this.scene);
    const textures = new Set<THREE.Texture>();
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
        const uni = (m as THREE.ShaderMaterial).uniforms;
        if (uni) for (const u of Object.values(uni)) if ((u?.value as THREE.Texture)?.isTexture) textures.add(u.value as THREE.Texture);
      }
    });
    let n = 0;
    for (const t of textures) {
      if (this.disposed) return;
      this.renderer.initTexture(t);
      if (++n % 4 === 0) await new Promise((r) => requestAnimationFrame(r)); // a few uploads per frame
    }
  }

  private async warmUpstairs() {
    await this.prewarm(this.office.upstairs);
    await this.prewarm(this.office.top);
    await this.prewarm(this.office.roof4);
    await this.prewarm(this.office.roof5);
    await this.staff.preload((root) => this.prewarm(root));
    this.warmPending = !this.disposed;
  }

  /**
   * One frame with everything upstairs shown, drawn to the screen right before the real frame of
   * the same tick (so it is never displayed). Uses the very programs and buffers the real view
   * will use — an off-screen target would compile different (linear-colour) variants.
   */
  private warmRender() {
    const o = this.office;
    const holders = this.staff.holders();
    const prevHolders = holders.map((h) => h.visible);
    o.setFloorView([o.downstairs.visible, true, true, true, true], 1);
    holders.forEach((h) => (h.visible = true));
    const cam = new THREE.PerspectiveCamera(70, 1.6, 0.5, 300);
    cam.position.set(OFFICE_W / 2, 36, OFFICE_D + 18);
    cam.lookAt(OFFICE_W / 2, 3, OFFICE_D / 2);
    cam.aspect = this.camera.aspect;
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, cam);
    holders.forEach((h, i) => (h.visible = prevHolders[i]));
    this.floorView = -1; // updateUpstairs() puts the real view back next frame
    this.updateUpstairs();
  }

  private mood: Mood = 'bar';
  private moodCol = new THREE.Color();
  /** Darken the room locally: `dim` = film playing in the cinema you are in, `dark` = bar / karaoke / village. */
  setDim(dim: number, dark = 0, mood: Mood = 'bar') {
    this.dimTarget = dim;
    this.darkTarget = dark;
    if (dark > 0) this.mood = mood;
  }

  /** Someone at (x, z) is drawn for you: same floor, or on a flight of stairs touching your floor. */
  private sharesFloor(x: number, z: number): boolean {
    if (floorOf(x) === this.myFloor) return true;
    const st = stairAt(x, z);
    return !!st && (st.lower === this.myFloor || st.lower + 1 === this.myFloor);
  }

  /**
   * Draw the floor you are on (on floor 3 also floor 2: the cinema roof and the building around
   * it). In first person near the stairs / lift the floors above and below are drawn too, so you
   * can look up or down the stairwell.
   */
  private updateUpstairs() {
    const c = this.controller;
    const f = this.myFloor;
    // floor 2 is also drawn from floor 3: the double-height cinema walls belong to it
    const vis = [f === 0, f === 1 || f === 2, f === 2, f === 3, f === 4];
    const vx = c ? visualX(c.x) : 0;
    if (c && this.viewMode === 'first' && c.z > 21 && vx > 8 && vx < 36) {
      if (f > 0) vis[f - 1] = true;
      if (f < 4) vis[f + 1] = true;
    }
    if (this.ride) vis[this.ride.from] = vis[this.ride.to] = true;
    const key = vis.reduce((k, v, i) => k | (v ? 1 << i : 0), 0) | (f << 4);
    if (key === this.floorView) return;
    this.floorView = key;
    this.office.setFloorView(vis, f);
  }

  /** Stairs (crossing floors on the way), lift rides and floor-change notifications. */
  private updateFloors(c: LocalController, dt: number) {
    const r = this.ride;
    if (r) {
      r.t = Math.min(1, r.t + dt / r.dur);
      // glide to the middle of the car and face the doors
      c.x = damp(c.x, sameFloorX(r.lift.cx, c.x), 4, dt);
      c.z = damp(c.z, r.lift.cz, 4, dt);
      c.ry = angleDamp(c.ry, Math.PI, 4, dt);
      if (!r.switched && r.t >= 0.5) {
        r.switched = true;
        c.shiftX((r.to - r.from) * UP_DX);
      }
      this.office.setRideCar(visualX(r.lift.cx), this.rideY(), r.lift.cz);
      if (r.t >= 1) {
        this.ride = null;
        c.locked = false;
        this.office.setRideCar(null);
        this.cb.onLift('arrive', r.from, r.to);
      }
    } else {
      const st = stairAt(c.x, c.z);
      if (st) {
        const p = stairPoints(st);
        const vx = visualX(c.x);
        if (floorOf(c.x) === st.lower) {
          if (st.dir < 0 ? vx < p.upAt : vx > p.upAt) c.shiftX(UP_DX);
        } else if (st.dir < 0 ? vx > p.downAt : vx < p.downAt) c.shiftX(-UP_DX);
      }
    }
    // in a lift car: show its floor buttons
    const inLift = this.ride ? null : liftAtPos(c.x, c.z)?.floor ?? null;
    if (inLift !== this.liftPanel) {
      this.liftPanel = inLift;
      this.cb.onLiftPanel(inLift);
    }
    const fl = floorOf(c.x);
    if (fl !== this.myFloor) {
      this.myFloor = fl;
      this.cb.onFloorChange(fl);
    }
    this.updateUpstairs();
  }

  private rideY(): number {
    const r = this.ride;
    if (!r) return 0;
    const k = smooth(r.t);
    return FLOOR_H * (r.from + (r.to - r.from) * k);
  }

  private applyTimeOfDay() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const ss = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    const day = ss(5.5, 7.5, h) * (1 - ss(17.5, 19.5, h));
    const golden = h > 15.5 && h < 20 ? Math.max(0, 1 - Math.abs(h - 17.8) / 1.4) : 0;
    const sky = new THREE.Color('#1c2333').lerp(new THREE.Color('#e8eef3'), day).lerp(new THREE.Color('#f2d2b6'), golden * 0.55);
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.hemiBase.set('#f4f7ff').lerp(new THREE.Color('#c9d2ff'), 1 - day);
    this.windowLight.color.set('#dbe8ff').lerp(new THREE.Color('#ffc898'), golden).lerp(new THREE.Color('#5a6aa0'), 1 - day);
    this.tod = { exposure: 0.95 - (1 - day) * 0.06, hemi: 0.38 + 0.24 * day, key: 1.55 + 0.2 * day, win: 0.12 + 0.5 * day };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
    this.css3d.domElement.remove();
  }
}
