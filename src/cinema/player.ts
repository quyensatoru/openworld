// A shared YouTube screen (the cinema, the bar's jukebox): an iframe placed in 3D with CSS3DRenderer
// behind the WebGL canvas (the screen mesh punches a transparent hole). Everyone in the room follows
// the same shared state from the server, so the video plays in sync for the whole room.
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { FLOOR_H, floorOf, visualX } from '../../shared/map';
import type { CinemaState } from '../../shared/protocol';
import type { World } from '../world/engine';

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id: string; title: string };
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => reject(new Error('Không tải được YouTube'));
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Screen centre in upper-floor local coordinates (logical x, height above that floor). */
export interface ScreenSpot {
  x: number;
  y: number;
  z: number;
  w: number;
  ry: number;
}
export interface PlayerOpts {
  screen: ScreenSpot;
  /** true: show the iframe through the screen mesh, false: back to the idle picture. */
  setVideo(on: boolean): void;
  /** Start over when the video ends (music). */
  loop?: boolean;
  /** Seconds this client plays behind the shared timeline (karaoke listeners hear the singer late). */
  lag?: () => number;
  /** The video can't be played here (embedding disabled, removed…). */
  onError?: (code: number) => void;
}

const PX_W = 1280;
const PX_H = 720;
const PLAYING = 1;
const BUFFERING = 3;

export class CinemaPlayer {
  private state: CinemaState | null = null;
  private inside = false;
  private obj: CSS3DObject | null = null;
  private player: YTPlayer | null = null;
  private ready = false;
  private loadedId = '';
  private creating = false;
  private blockedSince = 0;
  private unmuteArmed = false;
  volume = 100;
  /** 0..1 on top of `volume` (quieter when you are just outside the room). */
  private level = 1;
  onTitle: ((title: string) => void) | null = null;
  /** Title + length once the video is loaded. */
  onMeta: ((title: string, duration: number) => void) | null = null;
  private leadTimer: number | undefined;
  onNeedsClick: (() => void) | null = null;

  constructor(
    private world: World,
    private serverNow: () => number,
    private opts: PlayerOpts,
  ) {}

  get hasVideo(): boolean {
    return !!this.state;
  }

  get isPlaying(): boolean {
    return !!this.state && this.state.pausedAt == null;
  }

  /** The video is actually playing here with its sound on (not blocked, buffering or broken). */
  audible(): boolean {
    try {
      return !!this.player && this.ready && this.player.getPlayerState() === PLAYING && !this.player.isMuted() && this.volume * this.level > 0;
    } catch {
      return false;
    }
  }

  /** Seconds into the film right now according to the shared state. */
  position(): number {
    const s = this.state;
    if (!s) return 0;
    const t = s.pausedAt ?? Math.max(0, (this.serverNow() - s.startAt) / 1000 - (this.opts.lag?.() ?? 0));
    const dur = this.opts.loop ? this.duration() : 0;
    return dur > 1 ? t % dur : t;
  }

  duration(): number {
    try {
      return this.player?.getDuration() ?? 0;
    } catch {
      return 0;
    }
  }

  setState(s: CinemaState | null) {
    this.state = s;
    this.refresh();
  }

  setInside(inside: boolean) {
    if (inside === this.inside) return;
    this.inside = inside;
    this.refresh();
  }

  setVolume(v: number) {
    this.volume = v;
    this.player?.setVolume(v * this.level);
  }

  setLevel(l: number) {
    if (Math.abs(l - this.level) < 0.02) return;
    this.level = l;
    try {
      this.player?.setVolume(this.volume * l);
    } catch {
      /* not ready */
    }
  }

  private refresh() {
    if (this.inside && this.state) {
      if (!this.obj && !this.creating) void this.create();
      else this.sync(true);
    } else this.destroy();
  }

  private async create() {
    this.creating = true;
    try {
      const YT = await loadApi();
      if (!this.inside || !this.state) return;
      const wrap = document.createElement('div');
      wrap.style.width = `${PX_W}px`;
      wrap.style.height = `${PX_H}px`;
      wrap.style.background = '#000';
      wrap.style.pointerEvents = 'none';
      const host = document.createElement('div');
      wrap.appendChild(host);
      const obj = new CSS3DObject(wrap);
      const sc = this.opts.screen;
      obj.position.set(visualX(sc.x), floorOf(sc.x) * FLOOR_H + sc.y, sc.z);
      obj.rotation.y = sc.ry;
      obj.scale.setScalar(sc.w / PX_W);
      this.world.cssScene.add(obj);
      this.obj = obj;
      const start = Math.floor(this.position());
      this.player = new YT.Player(host, {
        width: PX_W,
        height: PX_H,
        videoId: this.state.videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: this.state.startAt > this.serverNow() ? 0 : 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, start, origin: location.origin },
        events: {
          onReady: () => {
            this.ready = true;
            this.loadedId = this.state?.videoId ?? '';
            this.player?.setVolume(this.volume * this.level);
            this.sync(true);
          },
          onStateChange: () => this.reportTitle(),
          onError: (e: { data: number }) => this.opts.onError?.(e.data),
        },
      });
      this.opts.setVideo(true);
    } catch (err) {
      console.warn('[cinema]', err);
    } finally {
      this.creating = false;
    }
  }

  private metaSent = '';
  private reportTitle() {
    try {
      const t = this.player?.getVideoData()?.title;
      if (t && this.state && !this.state.title) this.onTitle?.(t);
      const d = this.player?.getDuration() ?? 0;
      const id = this.state?.videoId ?? '';
      if (d > 1 && t && this.metaSent !== id) {
        this.metaSent = id;
        this.onMeta?.(t, d);
      }
    } catch {
      /* not ready */
    }
  }

  /** Keep the local player within ~1.5 s of the shared timeline. */
  sync(force = false) {
    const p = this.player;
    const s = this.state;
    if (!p || !this.ready || !s) return;
    try {
      const want = this.position();
      if (this.loadedId !== s.videoId) {
        this.loadedId = s.videoId;
        const early = s.pausedAt == null && s.startAt > this.serverNow();
        if (s.pausedAt == null && !early) p.loadVideoById({ videoId: s.videoId, startSeconds: want });
        else p.cueVideoById({ videoId: s.videoId, startSeconds: want });
        if (early) {
          clearTimeout(this.leadTimer);
          this.leadTimer = window.setTimeout(() => this.sync(true), (s.startAt - this.serverNow()) / 1000 * 1000 + (this.opts.lag?.() ?? 0) * 1000);
        }
        return;
      }
      const st = p.getPlayerState();
      const cur = p.getCurrentTime();
      // count-in (karaoke): wait at 0 until the shared start time, then go exactly on time
      const lead = s.pausedAt == null ? (s.startAt - this.serverNow()) / 1000 + (this.opts.lag?.() ?? 0) : 0;
      if (lead > 0.05) {
        if (st === PLAYING || st === BUFFERING) p.pauseVideo();
        if (cur > 0.3) p.seekTo(0, true);
        clearTimeout(this.leadTimer);
        this.leadTimer = window.setTimeout(() => this.sync(true), lead * 1000);
        return;
      }
      if (s.pausedAt != null) {
        if (st === PLAYING || st === BUFFERING) p.pauseVideo();
        if (Math.abs(cur - want) > 1) p.seekTo(want, true);
        return;
      }
      const dur = p.getDuration();
      if (dur && want > dur + 1 && !this.opts.loop) return; // film finished
      if (Math.abs(cur - want) > (force ? 0.8 : 1.8)) p.seekTo(want, true);
      if (st !== PLAYING && st !== BUFFERING) {
        p.playVideo();
        // Autoplay with sound can be blocked until the user clicks: fall back to muted, ask for a click.
        if (!this.blockedSince) this.blockedSince = performance.now();
        else if (performance.now() - this.blockedSince > 2500 && !p.isMuted()) {
          p.mute();
          p.playVideo();
          this.armUnmute();
        }
      } else this.blockedSince = 0;
    } catch {
      /* player not fully ready */
    }
  }

  private armUnmute() {
    if (this.unmuteArmed) return;
    this.unmuteArmed = true;
    this.onNeedsClick?.();
    const go = () => {
      this.unmuteArmed = false;
      try {
        this.player?.unMute();
        this.player?.setVolume(this.volume * this.level);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointerdown', go, true);
    };
    window.addEventListener('pointerdown', go, true);
  }

  private destroy() {
    clearTimeout(this.leadTimer);
    try {
      this.player?.destroy();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.ready = false;
    this.loadedId = '';
    if (this.obj) {
      this.world.cssScene.remove(this.obj);
      this.obj.element.remove();
      this.obj = null;
    }
    this.opts.setVideo(false);
  }

  dispose() {
    this.inside = false;
    this.destroy();
  }
}
