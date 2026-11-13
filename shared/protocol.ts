import type { ArcadeMsg, CaroGame, SnakeFrame } from './arcade';
import type { KaraMsg, KaraState } from './karaoke';
import type { WolfMsg, WolfView } from './werewolf';
import type { MoleFx, MoleMsg, MoleView } from './mole';
import type { PhFx, PhMsg, PhView } from './prophunt';
import type { WedFx, WedMsg, WedState } from './wedding';
// Shared wire protocol between the browser client and the OfficeRoom Durable Object.
// Every message is JSON with a short `t` (type) field.

import type { AvatarConfig } from './avatar';
import type { AgentAccess, AgentBook, AgentMsg, AgentTag, Approval, DeptId, Meeting } from './agents';
import type { BrainView } from './brain';

export type Status = 'online' | 'working' | 'meeting' | 'break' | 'focus' | 'away';
export type AnimState = 'idle' | 'walk' | 'run' | 'sit';
export type TaskColumn = 'todo' | 'doing' | 'review' | 'done';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export const STATUS_META: Record<Status, { label: string; emoji: string; color: string }> = {
  online: { label: 'Có mặt', emoji: '🙂', color: '#7cc4a4' },
  working: { label: 'Đang làm việc', emoji: '🟢', color: '#3fb27f' },
  meeting: { label: 'Đang họp', emoji: '📅', color: '#6b8cff' },
  break: { label: 'Nghỉ giải lao', emoji: '☕', color: '#f0a35e' },
  focus: { label: 'Tập trung', emoji: '🎧', color: '#c46bd6' },
  away: { label: 'Vắng mặt', emoji: '💤', color: '#9aa3ad' },
};

export const COLUMNS: { id: TaskColumn; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Thấp', color: '#9aa3ad' },
  normal: { label: 'Thường', color: '#6b8cff' },
  high: { label: 'Cao', color: '#f0a35e' },
  urgent: { label: 'Gấp', color: '#e5566b' },
};

export const EMOTES = ['wave', 'clap', 'cheer', 'dance', 'think', 'heart', 'coffee', 'laugh', 'jump', 'toast'] as const;
/** Emotes offered in the picker / number keys 1-8 (jump is on Space, toast on 9). */
export const PICKER_EMOTES = [...EMOTES.slice(0, 8), 'toast'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_EMOJI: Record<Emote, string> = {
  wave: '👋',
  clap: '👏',
  cheer: '🎉',
  dance: '💃',
  think: '🤔',
  heart: '❤️',
  coffee: '☕',
  laugh: '😂',
  jump: '',
  toast: '🥂',
};

/** Lucky wheel in the bar (just for fun — nothing here is binding 😄). */
export const WHEEL_PRIZES = [
  '🍹 Một ly cocktail miễn phí',
  '🎤 Hát tặng cả team một bài',
  '☕ Được mời cà phê sáng mai',
  '🍀 Chúc may mắn lần sau',
  '💃 Lên sàn nhảy một điệu',
  '🍕 Bao cả team một bữa pizza',
  '🧧 Lì xì 0 đồng (tấm lòng là chính)',
  '👑 Làm "vua" bar trong 5 phút',
] as const;
export const WHEEL_SPIN_MS = 5200;

export interface Pomodoro {
  mode: 'focus' | 'break';
  startedAt: number;
  endsAt: number;
}

export interface MediaState {
  mic: boolean;
  cam: boolean;
  screen: boolean;
  /** This client can decode Opus voice (WebCodecs); senders fall back to µ-law otherwise. */
  opus?: boolean;
}

export interface PlayerState {
  id: string; // = clientId (one live session per clientId)
  name: string;
  avatar: AvatarConfig;
  x: number;
  z: number;
  ry: number;
  anim: AnimState;
  zone: string;
  status: Status;
  statusManual: boolean;
  statusText: string;
  seat: string | null;
  taskId: string | null;
  pomo: Pomodoro | null;
  media: MediaState;
  joinedAt: number;
  /** set on virtual employees (Claude Code sessions), never on people */
  agent?: AgentTag;
}

export interface Task {
  id: string;
  title: string;
  desc: string;
  col: TaskColumn;
  ord: number;
  assignee: string | null; // clientId
  priority: Priority;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  /** department the task is handed to (agents of that department pick it up) */
  dept?: DeptId | null;
  /** how many handoffs led here */
  hops?: number;
  /** ids of tasks that must finish first — one orchestrator plan, several departments at once */
  after?: string[];
  /** the chat thread this work is discussed in (root message id) */
  thread?: string;
  /** the project (repo name) it must be done in — only an on-call machine working there takes it */
  project?: string;
}

/** Whether the department that owns a task is finished with it — what the work chained after it
 *  waits for. A card in review is finished as far as the next department is concerned: it is only
 *  waiting for a person to look, and QA *is* that look. Waiting for `done` instead would stall
 *  every chain, because departments hand their work over in review. */
export const settled = (t: Task) => t.col === 'done' || t.col === 'review';

export interface ChatMsg {
  id: string;
  ch: string; // 'global' (the office's own announcements) | `ask:${userId}` (one person and the AI staff) | `zone:${zoneId}`
  from: string; // clientId or 'system'
  name: string;
  text: string;
  ts: number;
  /** said in this meeting (work channel) */
  meet?: string;
  /** id of the message that opened this thread — everything about one piece of work hangs off it */
  root?: string;
  /** a 📋 report of Tổng quản, as the person it was written for rated it */
  rate?: ReportRate;
}

/** 👍 / 👎 on a final report. A 👎 with a reason becomes a lesson for Tổng quản; a 👍 is only counted. */
export interface ReportRate {
  v: 1 | -1;
  reason?: string;
}

export interface WorklogDay {
  day: string; // YYYY-MM-DD in office timezone
  checkIn: number | null;
  workMs: number;
  pomodoros: number;
  tasksDone: number;
  activeSince?: number | null; // server time when the current working segment started
}

export interface CinemaState {
  videoId: string;
  startAt: number; // server ms at which the video was at 0s (when playing)
  pausedAt: number | null; // seconds into the video while paused
  by: string;
  byName: string;
  title: string;
  updatedAt: number;
}

/** One line on someone's "Claude Code screen" (sent by their Claude Code hooks). */
export interface ActivityEvent {
  ts: number;
  /** say / result: streamed by agent runners (what Claude wrote, what a tool returned) */
  kind: 'start' | 'prompt' | 'tool' | 'stop' | 'notify' | 'say' | 'result';
  icon: string;
  text: string;
  project?: string;
}

export const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Extract a YouTube video id (+ optional start second) from common link shapes. */
export function parseYouTube(input: string): { id: string; start: number } | null {
  const s = input.trim();
  if (YT_ID.test(s)) return { id: s, start: 0 };
  let url: URL;
  try {
    url = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.slice(1, 12);
  else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    id = url.searchParams.get('v') ?? '';
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (!id && m) id = m[1];
  }
  if (!YT_ID.test(id)) return null;
  const t = url.searchParams.get('t') ?? url.searchParams.get('start') ?? '0';
  const mm = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = mm ? Number(mm[1] ?? 0) * 3600 + Number(mm[2] ?? 0) * 60 + Number(mm[3] ?? 0) : 0;
  return { id, start: Number.isFinite(start) ? start : 0 };
}

export interface TeamMember {
  id: string;
  name: string;
  avatar: AvatarConfig;
  lastSeen: number;
  desk: string | null;
  today: WorklogDay | null;
}

// ---------- client -> server ----------
export type ClientMsg =
  | { t: 'hello'; cid: string; name: string; avatar: AvatarConfig; x?: number; z?: number; ry?: number }
  | { t: 'move'; x: number; z: number; ry: number; anim: AnimState }
  | { t: 'chat'; ch: 'global' | 'zone' | 'work' | 'ask'; text: string; root?: string }
  | { t: 'emote'; e: Emote }
  | { t: 'wave'; to: string }
  | { t: 'status'; status: Status; manual: boolean; text?: string }
  | { t: 'sit'; seat: string | null }
  | { t: 'pomo'; pomo: Pomodoro | null; completed?: boolean }
  | { t: 'profile'; name: string; avatar: AvatarConfig }
  | { t: 'task:create'; title: string; desc?: string; col?: TaskColumn; assignee?: string | null; priority?: Priority; dept?: DeptId | null }
  | { t: 'task:update'; id: string; patch: Partial<Pick<Task, 'title' | 'desc' | 'assignee' | 'priority' | 'dept'>> }
  | { t: 'task:move'; id: string; col: TaskColumn; ord: number }
  | { t: 'task:delete'; id: string }
  | { t: 'task:focus'; id: string | null }
  | { t: 'media'; media: MediaState }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'rtcBye'; to: string }
  | { t: 'cinema'; action: 'play' | 'pause' | 'resume' | 'stop' | 'seek' | 'title'; videoId?: string; at?: number; title?: string }
  | { t: 'jukebox'; action: 'play' | 'pause' | 'resume' | 'stop' | 'seek' | 'title'; videoId?: string; at?: number; title?: string }
  | { t: 'wheel' }
  | { t: 'arcade'; m: ArcadeMsg }
  | { t: 'kara'; m: KaraMsg }
  | { t: 'wolf'; m: WolfMsg }
  | { t: 'mole'; m: MoleMsg }
  | { t: 'prop'; m: PhMsg }
  | { t: 'wed'; m: WedMsg }
  | { t: 'activity:token' }
  | { t: 'activity:revoke' }
  | { t: 'agents'; m: AgentMsg }
  | { t: 'ping' };

// ---------- server -> client ----------
export type ServerMsg =
  | {
      t: 'welcome';
      build?: string;
      you: PlayerState;
      players: PlayerState[];
      tasks: Task[];
      chat: ChatMsg[];
      team: TeamMember[];
      today: WorklogDay;
      office: { name: string; tzOffsetMinutes: number };
      serverTime: number;
      cinema: CinemaState | null;
      jukebox?: CinemaState | null;
      kara?: KaraState;
      wed?: WedState;
      activity: Record<string, ActivityEvent[]>;
      meetings?: Meeting[];
      approvals?: Approval[];
      /** cards that stopped after breaking down too often (they get a "Làm tiếp" button) */
      stopped?: string[];
      access?: AgentAccess;
      brain?: BrainView;
    }
  | { t: 'join'; p: PlayerState }
  | { t: 'leave'; id: string }
  /** walk: an agent goes there on foot (each browser finds the way) instead of appearing there */
  | { t: 'upd'; id: string; patch: Partial<PlayerState>; walk?: boolean }
  | { t: 'mv'; id: string; x: number; z: number; ry: number; anim: AnimState }
  | { t: 'chat'; m: ChatMsg }
  /** the rating of a report changed (sent to the person who rated it) */
  | { t: 'chatRate'; id: string; rate: ReportRate | null }
  | { t: 'emote'; id: string; e: Emote }
  | { t: 'wave'; from: string; name: string }
  | { t: 'task'; task: Task; by: string }
  | { t: 'taskDel'; id: string }
  | { t: 'today'; today: WorklogDay }
  | { t: 'team'; member: TeamMember }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'rtcBye'; from: string }
  | { t: 'cinema'; state: CinemaState | null; by: string; action: string }
  | { t: 'jukebox'; state: CinemaState | null; by: string; action: string }
  | { t: 'wheel'; by: string; name: string; prize: number; at: number }
  | { t: 'snake'; f: SnakeFrame }
  | { t: 'caro'; g: CaroGame | null; queued: boolean }
  | { t: 'kara'; s: KaraState }
  | { t: 'karaReact'; id: string; e: string }
  | { t: 'wolf'; v: WolfView | null }
  | { t: 'mole'; v: MoleView }
  | { t: 'moleFx'; fx: MoleFx }
  | { t: 'prop'; v: PhView }
  | { t: 'propFx'; fx: PhFx }
  | { t: 'wed'; s: WedState }
  | { t: 'wedFx'; fx: WedFx }
  | { t: 'activity'; id: string; ev: ActivityEvent }
  | { t: 'activityToken'; token: string | null }
  | { t: 'agentBook'; book: AgentBook }
  | { t: 'meetings'; list: Meeting[] }
  | { t: 'approvals'; list: Approval[] }
  | { t: 'stopped'; ids: string[] }
  | { t: 'agentAccess'; v: AgentAccess }
  | { t: 'brain'; v: BrainView }
  | { t: 'kicked'; reason: string }
  | { t: 'err'; msg: string }
  | { t: 'pong' };

export const LIMITS = {
  name: 32,
  chat: 500,
  statusText: 60,
  taskTitle: 140,
  taskDesc: 2000,
};

export function clampStr(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** YYYY-MM-DD for the given epoch ms in a fixed-offset timezone. */
export function dayKey(ms: number, tzOffsetMinutes: number): string {
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  return d.toISOString().slice(0, 10);
}
