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
import type { DeptId, RunnerMachine } from './agents';
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
  /** 'quick' = small and self-contained (a line or two, one file, an obvious fix): the session runs
   *  with the short briefing and no debrief. Left out = a full session. */
  mode?: 'quick' | 'full';
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
  /** action 'route': the project (repo name) the work belongs to, when several are on call */
  project?: string;
}

/** `reply`/`report` are what a person reads in the chat, so they have room for a real answer (an
 *  explanation of how the office works does not fit in a couple of sentences); the chat renders the
 *  whole thing, line breaks included. */
export const BRAIN_LIMITS = { reply: 2000, report: 2000, question: 300, title: 140, desc: 2400, parcels: 6 };

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
  /** while state === 'thinking': the runner holding it, until when, and the job it was handed as
   *  (a fresh tag per claim — an answer to an earlier claim of the same request is stale) */
  lease?: BrainLease;
  /** Claude could not be reached for it: don't try again before this */
  notBefore?: number;
  /** times the machine failed to think it through (network, Claude down) — never the person's fault */
  fails?: number;
  /** action 'route': the project it went to, and the cards its plan made */
  project?: string;
  tasks?: string[];
  /** action 'route': the final report back to the person, once every piece of the work is finished.
   *  'wait' = work still running · 'pending'/'thinking' = being written · 'sent' = they have it */
  report?: 'wait' | 'pending' | 'thinking' | 'sent';
  /** the 📋 report's chat message, once sent (what a 👍 / 👎 points at) */
  reportMsg?: string;
  /** when the report was claimed / how many times writing it failed */
  reportLease?: BrainLease;
  reportTries?: number;
  /** the improvement round this request is (the "Vòng cải tiến mới" button, not a person's words) */
  round?: string;
}

export interface BrainLease {
  by: string;
  until: number;
  /** the tag of the job this claim was handed out as (BrainJob.lease) */
  tag?: string;
}

/** Two thinking rounds per request: one to decide, one more after the person answers a question. */
export const BRAIN_MAX_TRIES = 3;
/** How long the runner lets the model think: a decision, and a final report. */
export const BRAIN_DECIDE_MS = 120_000;
export const BRAIN_REPORT_MS = 90_000;
/** A claimed thought goes back in the queue if the runner has not answered this long AFTER its own
 *  timeout ran out — the slack covers posting the answer back (and a retry or two), so a slow but
 *  live machine never has its thought handed to a second one and decided twice. */
export const BRAIN_LEASE_MS = 60_000;
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
  /** who answers when a session wants to do something its profile does not allow outright:
   *  'ask'  — always the machine's owner (a 🔐 card)
   *  'lead' — 🧠 Tổng quản decides; only irreversible things the work did not clearly ask for reach a person
   *  'auto' — sessions run in Claude Code's own auto mode, and Tổng quản decides the rest; nobody is asked */
  approvals: ApprovalMode;
  /** The project's definition of done: which departments must still run after the work itself, in
   *  order ('' = the default for every project). A plan that changes code but says nothing about
   *  checking or shipping it used to stop at "Chờ duyệt" and wait for a person to notice and drag
   *  the card on; these stages are appended by the office, so the chain finishes on its own. */
  flow?: Record<string, DeptId[]>;
}

/** Departments that may be chained after the work in a project's flow. */
export const FLOW_DEPTS: DeptId[] = ['qa', 'docs', 'ops'];

export type ApprovalMode = 'ask' | 'lead' | 'auto';

export const DEFAULT_BRAIN: BrainConfig = { model: 'sonnet', maxSessionsHour: 24, maxPerPersonHour: 8, meetings: false, approvals: 'lead', flow: {} };

export function sanitizeBrainConfig(v: unknown, fallback: BrainConfig = DEFAULT_BRAIN): BrainConfig {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : dflt);
  return {
    model: o.model === 'haiku' || o.model === 'sonnet' || o.model === 'opus' ? o.model : fallback.model,
    maxSessionsHour: num(o.maxSessionsHour, 1, 200, fallback.maxSessionsHour),
    maxPerPersonHour: num(o.maxPerPersonHour, 1, 100, fallback.maxPerPersonHour),
    meetings: typeof o.meetings === 'boolean' ? o.meetings : fallback.meetings,
    approvals: o.approvals === 'ask' || o.approvals === 'lead' || o.approvals === 'auto' ? o.approvals : fallback.approvals,
    flow: sanitizeFlow(o.flow, fallback.flow),
  };
}

/** project → the stages after the work. Unknown departments, duplicates and junk are dropped; a
 *  project with no stages left is dropped with them. */
function sanitizeFlow(v: unknown, fallback: Record<string, DeptId[]> = {}): Record<string, DeptId[]> {
  if (!v || typeof v !== 'object') return fallback;
  const out: Record<string, DeptId[]> = {};
  for (const [project, stages] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!Array.isArray(stages)) continue;
    const list = [...new Set(stages.filter((d): d is DeptId => FLOW_DEPTS.includes(d as DeptId)))].slice(0, FLOW_DEPTS.length);
    if (list.length) out[project.slice(0, 60)] = list;
  }
  return out;
}

/** What the office spent in the last hour. */
export interface BrainBudget {
  sessionsHour: number;
  thoughtsHour: number;
  /** what those sessions actually cost, as Claude Code reported it (USD) — the session count is a
   *  proxy, this is the bill */
  costHour: number;
  costDay: number;
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
  /** the on-call machines, and whether they can reach Claude */
  machines: RunnerMachine[];
  /** improvement rounds, newest first (what earlier rounds already did) */
  rounds?: ImproveRound[];
}

/** One "Vòng cải tiến": QA looks for bugs and Biz ranks improvements side by side, Dev does the top
 *  of both afterwards. Kept in D1 so the next round knows what was already done. */
export interface ImproveRound {
  id: string;
  project: string;
  at: number;
  byName: string;
  /** the chat thread it is discussed in (Tổng quản's opening line) */
  root: string;
  /** its cards: QA, Biz, then Dev */
  tasks: string[];
  /** what the round did, one line per card (refreshed from the board while the cards exist) */
  summary: string;
  /** every card of it is finished (done / review) */
  closed: boolean;
}

/** How much of earlier rounds goes into a new round's cards and into Tổng quản's prompt. */
export const ROUND_LIMITS = { summary: 1500, line: 420, history: 3, historyChars: 1000, prompt: 320 };

/** Browser → server. */
export type BrainMsg =
  | { a: 'brainConfig'; config: BrainConfig }
  | { a: 'brainCancel'; id: string }
  /** start a new improvement round in a project ('' = the only project on call) */
  | { a: 'improve'; project?: string }
  /** 👍 (1) / 👎 (-1) on a 📋 report in one's own thread; the reason is optional */
  | { a: 'rate'; id: string; v: 1 | -1; reason?: string };

/** The opening of Tổng quản's final report — what the 👍 / 👎 buttons hang on. */
export const REPORT_PREFIX = '📋 Kết quả';
export const RATE_REASON_MAX = 300;

/** Server → runner: one decision to make. The office writes the whole prompt; the runner just runs it. */
export interface BrainJob {
  id: string;
  /** decide a request · approve a session's action · write the final report */
  kind?: 'decide' | 'approve' | 'report';
  model: BrainConfig['model'];
  system: string;
  prompt: string;
  /** give up on the model after this long */
  timeoutMs?: number;
  /** which claim this is: the runner sends it back with the answer, so an answer posted twice (a retry
   *  after a timeout) or arriving after the request was handed out again is recognised as stale */
  lease?: string;
}

/** Tổng quản's answer about one action a session wants to take. */
export interface BrainVerdict {
  decision: 'allow' | 'deny' | 'ask';
  /** allow this kind of action for the rest of that session */
  session: boolean;
  reason: string;
}
/** How long a session waits for Tổng quản to judge an action before a person is asked instead. */
export const APPROVE_WAIT_MS = 40_000;

/** The orchestrator shares the player id space with the departments' agents. */
export const BRAIN_ID = 'ag-brain000000';
export const BRAIN_NAME = 'Tổng quản';
/** Its desk: the head of the quiet room, where the lead sits. */
export const BRAIN_SEAT = 'focus-1';

/** Every JSON object the model may have printed (it may wrap it in prose or a fence). */
function objects(raw: string): Record<string, unknown>[] {
  const text = String(raw ?? '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const out: Record<string, unknown>[] = [];
  for (const c of [fence?.[1], text]) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const o = JSON.parse(c.slice(start, end + 1));
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch {
      /* try the next candidate */
    }
  }
  return out;
}

/** Tổng quản's verdict on an action, or null when it did not answer in shape. */
export function parseVerdict(raw: string): BrainVerdict | null {
  for (const o of objects(raw)) {
    const d = o.decision;
    if (d !== 'allow' && d !== 'deny' && d !== 'ask') continue;
    return { decision: d, session: o.session === true, reason: typeof o.reason === 'string' ? o.reason : '' };
  }
  return null;
}

/** The final report: what to tell the person, and a lesson about splitting the work (may be ''). */
export function parseReport(raw: string): { reply: string; lesson: string; status: string } | null {
  for (const o of objects(raw))
    if (typeof o.reply === 'string' && o.reply.trim())
      return { reply: o.reply.trim(), lesson: typeof o.lesson === 'string' ? o.lesson.trim() : '', status: typeof o.status === 'string' ? o.status : '' };
  return null;
}

/** Pull the decision out of whatever the model printed (it may wrap it in prose or a fence). */
export function parseDecision(raw: string): BrainDecision | null {
  for (const o of objects(raw)) {
    const action = o.action;
    if (action !== 'answer' && action !== 'route' && action !== 'ask' && action !== 'merge' && action !== 'drop') continue;
    return {
      action,
      reply: typeof o.reply === 'string' ? o.reply : '',
      question: typeof o.question === 'string' ? o.question : undefined,
      mergeInto: typeof o.mergeInto === 'string' ? o.mergeInto : undefined,
      plan: Array.isArray(o.plan) ? (o.plan as BrainDecision['plan']) : undefined,
      project: typeof o.project === 'string' && o.project.trim() ? o.project.trim() : undefined,
    };
  }
  return null;
}
