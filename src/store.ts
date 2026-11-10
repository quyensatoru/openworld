import type { CaroGame, SnakeFrame } from '../shared/arcade';
import type { KaraState, MicFx } from '../shared/karaoke';
import type { Floor } from '../shared/map';
import type { WolfView } from '../shared/werewolf';
import type { MoleView } from '../shared/mole';
import type { PhView } from '../shared/prophunt';
import { emptyWed, type WedStep, type WedState } from '../shared/wedding';
import { fallbackWeather, type Weather } from '../shared/weather';
// Global UI state (React reads it through hooks; the 3D world and RTC write to it imperatively).
// High-frequency data (positions) deliberately lives outside this store, in the World.

import { create } from 'zustand';
import type { ActivityEvent, ChatMsg, CinemaState, MediaState, PlayerState, Task, TeamMember, WorklogDay } from '../shared/protocol';
import { bootTrouble, loadPref } from './profile';
import { IS_TOUCH } from './ui/touch-detect';

export interface FpLook {
  sens: number;
  smooth: boolean;
  bob: boolean;
}
/** Gentle by default: slower turning, smoothed, no head bob (people got dizzy). */
export const FP_LOOK_DEFAULT: FpLook = { sens: 0.6, smooth: true, bob: false };

export type Phase = 'loading' | 'login' | 'creator' | 'office';
export type SidePanel = 'chat' | 'people' | 'today' | null;
export type Quality = 'high' | 'low' | 'eco';
/** Frame cap: 60, or 0 = as fast as the screen refreshes (120/144 Hz). */
export type FpsCap = 60 | 0;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'warn' | 'wave';
}

export interface PeerView {
  id: string;
  state: 'connected';
  cam: string | null; // object URL of the latest camera JPEG
  screen: string | null; // object URL of the latest screen JPEG
  speaking: boolean;
}

export interface OfficeStore {
  phase: Phase;
  officeName: string;
  /** Minutes east of UTC the office keeps time in (Hanoi = +420). */
  tzOffsetMinutes: number;
  /** Hanoi's weather right now — drives the sky and the chip in the corner. */
  weather: Weather;
  needPasscode: boolean;
  connected: boolean;
  kicked: string | null;
  serverOffset: number; // serverTime - Date.now()

  me: PlayerState | null;
  players: Record<string, PlayerState>;
  tasks: Record<string, Task>;
  chat: ChatMsg[];
  team: Record<string, TeamMember>;
  today: WorklogDay | null;

  panel: SidePanel;
  kanbanOpen: boolean;
  creatorOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  /** iPhone: how to get rid of the browser bars (add to home screen) */
  installHelp: boolean;
  selected: string | null; // clicked player id
  prompt: string | null; // "Nhấn E để …"
  chatTab: 'global' | 'zone';
  chatDraft: string;
  unread: number;
  toasts: Toast[];
  quality: Quality;
  fpsCap: FpsCap;
  /** show the phone controls (thumb stick, use / jump buttons) */
  touch: boolean;
  /** first-person view: look sensitivity (×), smoothing, head bob */
  fpLook: FpLook;

  media: MediaState;
  peers: Record<string, PeerView>;
  localCam: MediaStream | null;
  localScreen: MediaStream | null;
  meSpeaking: boolean;
  bigScreen: string | null; // peer id (or 'me') whose screen share is enlarged

  viewMode: 'third' | 'first';
  floor: Floor;
  /** Standing in a lift car on this floor (show the floor buttons). */
  liftPanel: Floor | null;
  updateReady: boolean;
  /** the server still runs an older build than this page (mid-deploy) */
  serverStale: boolean;
  cinema: CinemaState | null;
  cinemaPanel: boolean;
  jukebox: CinemaState | null;
  barPanel: boolean;
  arcadeOpen: boolean;
  arcadeTab: 'snake' | 'caro';
  snake: SnakeFrame | null;
  caro: CaroGame | null;
  caroQueued: boolean;
  kara: KaraState;
  karaPanel: boolean;
  karaTab: 'queue' | 'search' | 'mic';
  /** Your own mic settings (sent to the server while you hold a mic). */
  myFx: MicFx | null;
  karaMonitor: boolean;
  karaMonitorVol: number;
  /** Singer wears headphones (null = not asked yet). */
  karaPhones: boolean | null;
  /** Ask "headphones or speakers?" (first time you get a mic). */
  karaAsk: boolean;
  /** Full-screen lyrics view of the karaoke screen. */
  karaZoom: boolean;
  /** 3D can't start on this machine (WebGL unavailable): message for the help screen. */
  glError: string | null;
  /** WebGL context lost right now (GPU reset). */
  glLost: boolean;
  wolf: WolfView | null;
  wolfPanel: boolean;
  mole: MoleView | null;
  molePanel: boolean;
  /** Open mini-game: a station id, 'fuse', or a critical console id. `fake` for moles pretending. */
  moleTask: { id: string; fake: boolean } | null;
  /** a mole's pretend tasks they already "did" (ticked locally only, so the act looks right) */
  moleFakeDone: string[];
  /** watching the security cameras (Phòng An Ninh) */
  cctv: boolean;
  /** the mic is on but held (Ma Sói night: villagers sleep) */
  micHeld: boolean;
  /** A big dramatic moment on screen (meeting called, you got laid off…). */
  moleSplash: { kind: 'report' | 'bell' | 'killed' | 'kill'; by?: string; body?: string | null; at: number } | null;
  wolfSpeech: boolean;
  /** Trốn tìm biến hình (floor 6) */
  ph: PhView | null;
  phPanel: boolean;
  /** the piece a hider would turn into right now */
  phCand: { fid: string; name: string } | null;
  /** your health as the last shot left it (the view only refreshes on bigger moments) */
  phHp: number | null;
  /** last time your shot hit a hider / you hit furniture / you got hit (for the crosshair + screen flashes) */
  phMark: { kind: 'hit' | 'miss' | 'hurt'; at: number } | null;
  /** Tiệc cưới (floor 7) */
  wed: WedState;
  wedPanel: boolean;
  wedTab: 'program' | 'music' | 'gift' | 'dress';
  /** A big title for a moment when a step of the programme starts. */
  wedBanner: { step: WedStep; at: number } | null;
  /** Someone's gift and wish, popping up for a moment. */
  wedGift: { name: string; amount: number; wish: string; at: number } | null;
  /** The bouquet landed (who caught it, how close to the perfect moment, out of how many). */
  wedCatch: { name: string | null; me: boolean; at: number; off: number | null; tries: number } | null;
  /** The "Hôn đi!" meter (from the guests' shouts as they come in). */
  wedChant: { n: number; goal: number; stepAt: number } | null;
  /** Tables whose toast is counting: table → clink time (server ms) + who raised a glass. */
  wedDzo: Record<number, { at: number; ids: string[] }>;
  /** My reach for the bouquet (ms after the step began, my clock), shown until it lands. */
  wedGrab: { el: number; stepAt: number } | null;
  /** The wedding band's volume, 0..100 (the YouTube player and the synth band). */
  wedVolume: number;
  activity: Record<string, ActivityEvent[]>;
  activityToken: string | null | undefined; // undefined = not requested yet
  screenOf: string | null; // player whose Claude screen is open
  ambience: { on: boolean; volume: number };
  voiceFailed: Record<string, number>;
}

/**
 * The graphics setting to actually start with. After a start that never settled — on a phone that
 * means the browser killed the tab for using too much memory — come back a step lower instead of
 * walking into the same wall again. The player's own choice is kept; only this session is lowered.
 */
function safeQuality(saved: Quality): Quality {
  const t = bootTrouble();
  if (t >= 2) return 'eco';
  if (t >= 1) return saved === 'high' ? 'low' : saved === 'low' ? 'eco' : saved;
  return saved;
}

export const useStore = create<OfficeStore>(() => ({
  phase: 'loading',
  officeName: 'Office',
  tzOffsetMinutes: 420,
  weather: fallbackWeather(),
  needPasscode: true,
  connected: false,
  kicked: null,
  serverOffset: 0,

  me: null,
  players: {},
  tasks: {},
  chat: [],
  team: {},
  today: null,

  panel: loadPref<SidePanel>('panel2', null),
  kanbanOpen: false,
  creatorOpen: false,
  settingsOpen: false,
  helpOpen: false,
  installHelp: false,
  selected: null,
  prompt: null,
  chatTab: 'global',
  chatDraft: '',
  unread: 0,
  toasts: [],
  quality: safeQuality(loadPref<Quality>('quality', IS_TOUCH ? 'low' : 'high')),
  fpsCap: loadPref<FpsCap>('fpsCap', 60),
  touch: (() => {
    try {
      const v = localStorage.getItem('office-touch-ui');
      if (v === '1' || v === '0') return v === '1';
    } catch {
      /* private mode */
    }
    return IS_TOUCH;
  })(),
  fpLook: { ...FP_LOOK_DEFAULT, ...loadPref<Partial<FpLook>>('fpLook', {}) },

  media: { mic: false, cam: false, screen: false },
  peers: {},
  localCam: null,
  localScreen: null,
  meSpeaking: false,
  bigScreen: null,

  viewMode: 'third',
  floor: 0,
  liftPanel: null,
  updateReady: false,
  serverStale: false,
  cinema: null,
  cinemaPanel: false,
  jukebox: null,
  barPanel: false,
  arcadeOpen: false,
  arcadeTab: 'snake',
  snake: null,
  caro: null,
  caroQueued: false,
  kara: { queue: [], now: null, mics: [], last: null },
  karaPanel: true,
  karaTab: 'queue',
  myFx: loadPref('karaFx', null),
  karaMonitor: loadPref('karaMonitor2', true),
  karaMonitorVol: loadPref('karaMonitorVol', 1),
  karaPhones: loadPref<boolean | null>('karaPhones', null),
  karaAsk: false,
  karaZoom: false,
  glError: null,
  glLost: false,
  wolf: null,
  wolfPanel: true,
  mole: null,
  molePanel: !IS_TOUCH, // phones: start folded into the little pill
  moleTask: null,
  moleFakeDone: [],
  cctv: false,
  micHeld: false,
  moleSplash: null,
  wolfSpeech: loadPref('wolfSpeech', true),
  ph: null,
  phPanel: !IS_TOUCH,
  phCand: null,
  phHp: null,
  phMark: null,
  wed: emptyWed(),
  wedPanel: !IS_TOUCH,
  wedTab: 'program',
  wedBanner: null,
  wedGift: null,
  wedCatch: null,
  wedChant: null,
  wedDzo: {},
  wedGrab: null,
  wedVolume: loadPref('wedVolume', 80),
  activity: {},
  activityToken: undefined,
  screenOf: null,
  ambience: loadPref('ambience', { on: true, volume: 0.6 }),
  voiceFailed: {},
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

let toastSeq = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4500): void {
  const id = toastSeq++;
  setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function playerById(id: string): PlayerState | null {
  const s = getState();
  if (s.me?.id === id) return s.me;
  return s.players[id] ?? null;
}

export function nameOf(id: string | null | undefined): string {
  if (!id) return '';
  return playerById(id)?.name ?? getState().team[id]?.name ?? 'Ai đó';
}

export function serverNow(): number {
  return Date.now() + getState().serverOffset;
}
