// Tổng quản — the office's one orchestrator ("super agent").
//
// Everything a person asks the AI goes through it: it reads the whole office state (board, who is
// busy, the playbook) and decides in ONE cheap model call what happens — answer on the spot, split
// the work across departments and dispatch them in parallel, ask the single question that actually
// changes the outcome, fold the request into work already running, or drop noise.
//
// The point is that deciding is cheap and doing is expensive: a decision is a short prompt with no
// repo access (a few seconds, a few thousand tokens), while a department session is a full
// `claude -p` in the project. Before this, triage cost as much as the work it was triaging.
import type { DeptId } from './agents';
import type { Priority } from './protocol';

/** What the orchestrator decided to do with a request. */
export type BrainAction = 'answer' | 'route' | 'ask' | 'merge' | 'drop';

/** One parcel of work for one department. Parcels without `after` start at the same time. */
export interface BrainParcel {
  dept: DeptId;
  title: string;
  desc: string;
  priority: Priority;
  /** indices of earlier parcels in this same plan that must finish first ([] = start now) */
  after: number[];
}

export interface BrainDecision {
  action: BrainAction;
  /** what to say back to the person, in their own thread (1–3 câu, no markdown) */
  reply: string;
  /** action 'ask': the one question worth stopping for */
  question?: string;
  /** action 'merge': short id of the task this request folds into */
  mergeInto?: string;
  /** action 'route': the work, split so independent parts run at once */
  plan?: BrainParcel[];
}

export const BRAIN_LIMITS = { reply: 400, question: 300, title: 140, desc: 1800, parcels: 6 };

/** Where a request came from. */
export type BrainSource = 'chat' | 'task';

export type BrainItemState = 'pending' | 'thinking' | 'asked' | 'done';

/** A request waiting for (or carrying) a decision. */
export interface BrainItem {
  id: string;
  source: BrainSource;
  /** the person who asked (clientId) */
  who: string;
  whoName: string;
  text: string;
  /** source 'task': the unassigned Kanban card this came from */
  taskId?: string;
  /** the chat thread this request opened — every word about it hangs off this message */
  root: string;
  at: number;
  /** questions it asked and the answers it got back, oldest first */
  followUps: { q: string; a: string }[];
  state: BrainItemState;
  /** decisions spent on this item (a request never costs more than BRAIN_MAX_TRIES) */
  tries: number;
  /** while state === 'thinking': the runner holding it, and until when */
  lease?: { by: string; until: number };
}

/** Two thinking rounds per request: one to decide, one more after the person answers a question. */
export const BRAIN_MAX_TRIES = 3;
/** A claimed decision goes back in the queue if the runner does not answer in time. */
export const BRAIN_LEASE_MS = 90_000;
/** A question nobody answers stops waiting after this. */
export const BRAIN_ASK_TTL = 6 * 3600_000;
/** Items are kept this long after they are done (for the log). */
export const BRAIN_KEEP_MS = 24 * 3600_000;

/** What it decided, for the people to read. */
export interface BrainLog {
  id: string;
  at: number;
  whoName: string;
  text: string;
  action: BrainAction;
  reply: string;
  /** departments it dispatched (action 'route') */
  depts: DeptId[];
}

/** The office's throttle. Owners of the on-call machines set it; it is the whole cost ceiling. */
export interface BrainConfig {
  /** the model that decides — small and fast on purpose */
  model: 'haiku' | 'sonnet' | 'opus';
  /** department sessions the whole office may start in an hour */
  maxSessionsHour: number;
  /** …and how many of those one person may cause */
  maxPerPersonHour: number;
  /** let the orchestrator call a meeting of department sessions (expensive — off by default) */
  meetings: boolean;
}

export const DEFAULT_BRAIN: BrainConfig = { model: 'sonnet', maxSessionsHour: 24, maxPerPersonHour: 8, meetings: false };

export function sanitizeBrainConfig(v: unknown, fallback: BrainConfig = DEFAULT_BRAIN): BrainConfig {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : dflt);
  return {
    model: o.model === 'haiku' || o.model === 'sonnet' || o.model === 'opus' ? o.model : fallback.model,
    maxSessionsHour: num(o.maxSessionsHour, 1, 200, fallback.maxSessionsHour),
    maxPerPersonHour: num(o.maxPerPersonHour, 1, 100, fallback.maxPerPersonHour),
    meetings: typeof o.meetings === 'boolean' ? o.meetings : fallback.meetings,
  };
}

/** What the office spent in the last hour. */
export interface BrainBudget {
  sessionsHour: number;
  thoughtsHour: number;
  /** people who hit their own cap right now */
  throttled: string[];
}

/** Server → browser: the 🧠 panel. */
export interface BrainView {
  config: BrainConfig;
  /** waiting, being decided, or waiting for an answer from a person */
  queue: BrainItem[];
  recent: BrainLog[];
  budget: BrainBudget;
  /** a machine is serving the orchestrator right now */
  online: boolean;
}

/** Browser → server. */
export type BrainMsg = { a: 'brainConfig'; config: BrainConfig } | { a: 'brainCancel'; id: string };

/** Server → runner: one decision to make. The office writes the whole prompt; the runner just runs it. */
export interface BrainJob {
  id: string;
  model: BrainConfig['model'];
  system: string;
  prompt: string;
}

/** The orchestrator shares the player id space with the departments' agents. */
export const BRAIN_ID = 'ag-brain000000';
export const BRAIN_NAME = 'Tổng quản';
/** Its desk: the head of the quiet room, where the lead sits. */
export const BRAIN_SEAT = 'focus-1';

/** Pull the decision out of whatever the model printed (it may wrap it in prose or a fence). */
export function parseDecision(raw: string): BrainDecision | null {
  const text = String(raw ?? '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const o = JSON.parse(c.slice(start, end + 1)) as Record<string, unknown>;
      const action = o.action;
      if (action !== 'answer' && action !== 'route' && action !== 'ask' && action !== 'merge' && action !== 'drop') continue;
      return {
        action,
        reply: typeof o.reply === 'string' ? o.reply : '',
        question: typeof o.question === 'string' ? o.question : undefined,
        mergeInto: typeof o.mergeInto === 'string' ? o.mergeInto : undefined,
        plan: Array.isArray(o.plan) ? (o.plan as BrainDecision['plan']) : undefined,
      };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
