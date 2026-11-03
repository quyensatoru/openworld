import type { CaroGame, SnakeFrame } from '../shared/arcade';
import type { KaraState, MicFx } from '../shared/karaoke';
import type { Floor } from '../shared/map';
import type { WolfView } from '../shared/werewolf';
import type { MoleView } from '../shared/mole';
// Global UI state (React reads it through hooks; the 3D world and RTC write to it imperatively).
// High-frequency data (positions) deliberately lives outside this store, in the World.

import { create } from 'zustand';
import type { ActivityEvent, ChatMsg, CinemaState, MediaState, PlayerState, Task, TeamMember, WorklogDay } from '../shared/protocol';
import { loadPref } from './profile';

export type Phase = 'loading' | 'login' | 'creator' | 'office';
export type SidePanel = 'chat' | 'people' | 'today' | null;
export type Quality = 'high' | 'low';

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
  selected: string | null; // clicked player id
  prompt: string | null; // "Nhấn E để …"
  chatTab: 'global' | 'zone';
  chatDraft: string;
  unread: number;
  toasts: Toast[];
  quality: Quality;

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
  /** A big dramatic moment on screen (meeting called, you got laid off…). */
  moleSplash: { kind: 'report' | 'bell' | 'killed' | 'kill'; by?: string; body?: string | null; at: number } | null;
  wolfSpeech: boolean;
  activity: Record<string, ActivityEvent[]>;
  activityToken: string | null | undefined; // undefined = not requested yet
  screenOf: string | null; // player whose Claude screen is open
  ambience: { on: boolean; volume: number };
  voiceFailed: Record<string, number>;
}

export const useStore = create<OfficeStore>(() => ({
  phase: 'loading',
  officeName: 'BSS Office',
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
  selected: null,
  prompt: null,
  chatTab: 'global',
  chatDraft: '',
  unread: 0,
  toasts: [],
  quality: loadPref<Quality>('quality', 'high'),

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
  molePanel: true,
  moleTask: null,
  moleSplash: null,
  wolfSpeech: loadPref('wolfSpeech', true),
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
