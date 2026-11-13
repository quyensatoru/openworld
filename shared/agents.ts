// Virtual employees: headless Claude Code sessions started by an on-call machine. Each one sits at
// a desk of its department on floor 1, shows what it is doing on its monitor, talks in the office
// chat and hands work to other departments via the Kanban board. Nobody's own Claude Code session
// becomes an employee any more — the office staffs itself.
//
// Above them sits one orchestrator, 🧠 Tổng quản (shared/brain.ts): it takes every request, decides
// who does what, and is the only thing allowed to start a department session.

import type { BrainMsg } from './brain';

export type DeptId = 'lead' | 'dev' | 'qa' | 'ops' | 'design' | 'docs' | 'biz';

export interface Dept {
  id: DeptId;
  name: string;
  /** ASCII, used for agent names ("Dev-2") and @mentions */
  short: string;
  icon: string;
  color: string;
  /** What this department does — appended to the system prompt of its agents. */
  brief: string;
  /** Seat ids, preferred in this order. */
  seats: string[];
  /** @mention words (accent-free, lower case). */
  alias: string[];
}

const desks = (from: number) => [0, 1, 2, 3].map((i) => `desk-${String(from + i).padStart(2, '0')}`);

export const DEPTS: Dept[] = [
  {
    id: 'lead',
    name: 'Ban điều hành',
    short: 'Lead',
    icon: '🧠',
    color: '#b56fd0',
    brief:
      'Bạn thuộc Ban điều hành: điều phối cả văn phòng và đúc rút kinh nghiệm. Việc lớn thì chia nhỏ cho đúng phòng ban bằng handoff; viết sổ kinh nghiệm ngắn gọn, cụ thể, dùng được ngay.',
    seats: ['focus-1', 'focus-2', 'focus-3', 'focus-4'],
    // @ai / @bot / @agent: "someone handle this" — the lead works out which department does it
    alias: ['lead', 'tongquan', 'sep', 'boss', 'dieuhanh', 'ai', 'bot', 'agent', 'agents'],
  },
  {
    id: 'dev',
    name: 'Phát triển',
    short: 'Dev',
    icon: '💻',
    color: '#6b8cff',
    brief:
      'Bạn thuộc phòng Phát triển: viết và sửa code — chỉ phòng bạn được sửa code sản phẩm. Chạy test liên quan trước khi bàn giao; phần kiểm thử, giao diện, tài liệu hay deploy thì handoff đúng phòng. Không deploy, không push trừ khi việc ghi rõ.',
    seats: desks(1),
    alias: ['dev', 'phattrien', 'code'],
  },
  {
    id: 'qa',
    name: 'Kiểm thử',
    short: 'QA',
    icon: '🧪',
    color: '#3fb27f',
    brief:
      'Bạn thuộc phòng Kiểm thử: đọc thay đổi, chạy test/build, kết luận đạt hay không đạt. Không sửa code sản phẩm — có lỗi thì handoff về Phát triển (wait=true) rồi chờ bản sửa; ổn thì đánh dấu xong, hoặc handoff Vận hành nếu cần deploy.',
    seats: desks(5),
    alias: ['qa', 'test', 'tester', 'kiemthu'],
  },
  {
    id: 'ops',
    name: 'Vận hành',
    short: 'Ops',
    icon: '🚀',
    color: '#f0a35e',
    brief:
      'Bạn thuộc phòng Vận hành: build, deploy, hạ tầng, theo dõi lỗi production — chỉ phòng bạn được deploy, và thường là chặng cuối của một đợt việc. Chỉ deploy/push khi việc ghi rõ yêu cầu và test đã qua; việc sửa nguyên nhân gốc thì handoff Phát triển.',
    seats: desks(9),
    alias: ['ops', 'devops', 'vanhanh', 'deploy'],
  },
  {
    id: 'design',
    name: 'Thiết kế',
    short: 'Design',
    icon: '🎨',
    color: '#e889b0',
    brief:
      'Bạn thuộc phòng Thiết kế: giao diện, trải nghiệm, CSS, chữ hiển thị. Giữ phong cách sẵn có của sản phẩm; phần logic và dữ liệu thì handoff Phát triển, đừng tự sửa.',
    seats: desks(13),
    alias: ['design', 'designer', 'thietke', 'ui', 'ux'],
  },
  {
    id: 'docs',
    name: 'Tài liệu',
    short: 'Docs',
    icon: '📝',
    color: '#4f9d8a',
    brief:
      'Bạn thuộc phòng Tài liệu: README, hướng dẫn, changelog, ghi chú kỹ thuật — chỉ sửa file tài liệu. Viết ngắn, đúng với code hiện tại; thấy code sai thì handoff Phát triển.',
    seats: desks(17),
    alias: ['docs', 'doc', 'tailieu'],
  },
  {
    id: 'biz',
    name: 'Kinh doanh & CSKH',
    short: 'Biz',
    icon: '🤝',
    color: '#d9a62e',
    brief:
      'Bạn thuộc phòng Kinh doanh & CSKH: phân tích yêu cầu khách, soạn câu trả lời, viết spec rõ ràng rồi handoff cho Phát triển (hoặc Thiết kế nếu chủ yếu là giao diện). Không sửa code.',
    seats: desks(21),
    alias: ['biz', 'cskh', 'sale', 'sales', 'kinhdoanh', 'support'],
  },
];

export const DEPT_BY_ID = new Map<DeptId, Dept>(DEPTS.map((d) => [d.id, d]));
export const isDept = (v: unknown): v is DeptId => typeof v === 'string' && DEPT_BY_ID.has(v as DeptId);

/** Cluster centre of each department's four desks (for the hanging signs). */
export const DEPT_SIGNS: { dept: DeptId; x: number; z: number }[] = [
  { dept: 'dev', x: 14.5, z: 4.6 },
  { dept: 'qa', x: 20, z: 4.6 },
  { dept: 'ops', x: 25.5, z: 4.6 },
  { dept: 'design', x: 14.5, z: 11.2 },
  { dept: 'docs', x: 20, z: 11.2 },
  { dept: 'biz', x: 25.5, z: 11.2 },
  { dept: 'lead', x: 4.9, z: 3.3 },
];

/** 'runner' = a department session doing the work; 'brain' = the one orchestrator above them. */
export type AgentKind = 'runner' | 'brain';
export type AgentState = 'working' | 'idle' | 'waiting' | 'thinking';

/** Marks a PlayerState as a virtual employee. */
export interface AgentTag {
  dept: DeptId;
  kind: AgentKind;
  /** clientId of the person whose machine runs it */
  owner: string;
  ownerName: string;
  state: AgentState;
  project?: string;
}

export interface Lesson {
  id: string;
  dept: DeptId | 'all';
  /** '' = every project */
  project: string;
  /** '' = every machine; otherwise the one on-call machine it is true for (its label, "host·abcd") */
  machine?: string;
  text: string;
  by: string;
  at: number;
}

export interface Debrief {
  id: string;
  agent: string;
  agentName: string;
  dept: DeptId;
  project: string;
  /** the on-call machine the session ran on */
  machine?: string;
  text: string;
  at: number;
}

/** Agent ids look like this (they share the player id space). */
export const AGENT_ID = /^ag-[a-z0-9]{8,16}$/;
/** The orchestrator leaves its desk after this long without a single decision to make. */
export const AGENT_IDLE_MS = 30 * 60_000;
/** Handoff chains longer than this wait for a human (stops agents bouncing work forever). */
export const MAX_HOPS = 6;

export const LESSON_MAX = 400;
export const DEBRIEF_MAX = 3000;

// ------------------------------------------------------------------ department profiles
/** A procedure an agent opens when it needs it (MCP tool `skill`), like a Claude Code skill. */
export interface DeptSkill {
  id: string;
  name: string;
  /** when to use it (shown in the briefing) */
  when: string;
  body: string;
}

export type AgentModel = 'default' | 'opus' | 'sonnet' | 'haiku';
export const AGENT_MODELS: { id: AgentModel; label: string }[] = [
  { id: 'default', label: 'Mặc định của máy trực' },
  { id: 'opus', label: 'Opus (mạnh nhất)' },
  { id: 'sonnet', label: 'Sonnet (cân bằng)' },
  { id: 'haiku', label: 'Haiku (nhanh, rẻ)' },
];

/** How a department's agents work. The runner turns it into flags for `claude -p`. */
export interface DeptProfile {
  /** appended to the system prompt of the department's runner sessions */
  prompt: string;
  skills: DeptSkill[];
  /** which files it may edit: 'all', 'none' or comma-separated globs ("**\/*.md,docs/**") */
  edit: string;
  /** shell commands it may run without asking, as Claude Code rules ("Bash(npm test:*)") —
   *  only those the runner's owner also allowed (--allow) are granted */
  bash: string[];
  model: AgentModel;
}

export const PROFILE_LIMITS = { prompt: 4000, skills: 8, skillBody: 3000, when: 200, bash: 20, edit: 240 };
const SKILL_ID = /^[a-z0-9-]{2,40}$/;
const BASH_RULE = /^Bash\([^()\n]{1,100}\)$/;
const EDIT_RULE = /^(all|none|[\w*./{},\- ]{1,240})$/;

export function sanitizeProfile(v: unknown, fallback: DeptProfile): DeptProfile {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.replace(/\r/g, '').slice(0, n) : '');
  const skills = Array.isArray(o.skills)
    ? o.skills
        .map((k) => (k && typeof k === 'object' ? (k as Record<string, unknown>) : {}))
        .map((k) => ({ id: str(k.id, 40).toLowerCase(), name: str(k.name, 60).trim(), when: str(k.when, PROFILE_LIMITS.when).trim(), body: str(k.body, PROFILE_LIMITS.skillBody).trim() }))
        .filter((k) => SKILL_ID.test(k.id) && k.name && k.body)
        .slice(0, PROFILE_LIMITS.skills)
    : fallback.skills;
  const edit = typeof o.edit === 'string' && EDIT_RULE.test(o.edit.trim()) ? o.edit.trim() : fallback.edit;
  const bash = Array.isArray(o.bash) ? [...new Set(o.bash.filter((b): b is string => typeof b === 'string' && BASH_RULE.test(b.trim())).map((b) => b.trim()))].slice(0, PROFILE_LIMITS.bash) : fallback.bash;
  const model = AGENT_MODELS.some((m) => m.id === o.model) ? (o.model as AgentModel) : fallback.model;
  return { prompt: typeof o.prompt === 'string' ? str(o.prompt, PROFILE_LIMITS.prompt).trim() : fallback.prompt, skills, edit, bash, model };
}

// ------------------------------------------------------------------ meetings
export type MeetRoom = 'meetA' | 'meetB';
export const MEET_ROOMS: { id: MeetRoom; name: string }[] = [
  { id: 'meetA', name: 'Phòng họp Hạ Long' },
  { id: 'meetB', name: 'Phòng họp Sa Pa' },
];
/** A meeting ends by itself after this long. */
export const MEETING_MS = 25 * 60_000;

export interface MeetLine {
  from: string;
  name: string;
  text: string;
  ts: number;
}

export interface Meeting {
  id: string;
  topic: string;
  agenda: string;
  room: MeetRoom;
  /** who asked for it (a person or an agent) */
  by: string;
  /** the agent chairing it (null until the lead's session arrives, when a person called it) */
  host: string | null;
  depts: DeptId[];
  /** departments whose seat is still waiting for a runner */
  waiting: DeptId[];
  members: { id: string; name: string; dept: DeptId }[];
  lines: MeetLine[];
  startedAt: number;
  endedAt: number | null;
  summary: string;
  /** the person on whose behalf it was called (a runner only sends someone if its owner trusts them) */
  origin?: string;
}

/** A runner session asks to do something its profile does not allow by itself (a shell command,
 *  an edit outside its files…). The runner's owner decides in the office. */
export interface Approval {
  id: string;
  agent: string;
  agentName: string;
  dept: DeptId;
  /** who may decide: the runner's owner, or anyone in the office */
  owner: string;
  ownerName: string;
  anyone: boolean;
  tool: string;
  /** what exactly (the command, the file…) */
  summary: string;
  at: number;
  state: 'pending' | 'allow' | 'deny';
  by?: string;
  /** decided by 🧠 Tổng quản instead of a person: why */
  reason?: string;
}
/** Unanswered requests are refused after this long. */
export const APPROVAL_TTL = 30 * 60_000;

/** Browser → server (over the WebSocket). */
export type AgentMsg =
  | { a: 'lessons' }
  | { a: 'lesson'; id?: string; dept: DeptId | 'all'; project?: string; machine?: string; text: string }
  | { a: 'lessonDel'; id: string }
  | { a: 'dismiss'; id: string }
  | { a: 'profile'; dept: DeptId; profile: DeptProfile }
  | { a: 'profileReset'; dept: DeptId }
  | { a: 'meeting'; topic: string; agenda?: string; depts: DeptId[] }
  | { a: 'meetingEnd'; id: string }
  | { a: 'approve'; id: string; decision: 'once' | 'session' | 'deny' }
  | { a: 'access'; all: boolean; users: string[] }
  /** "Làm tiếp" on a card that stopped after breaking down: back to To do with fresh tries */
  | { a: 'revive'; id: string }
  | BrainMsg;

/** Who may give work to whose agents. Every runner owner decides for their own machine; by default
 *  only they themselves. A person may give work to the AI when at least one owner trusts them. */
export interface AgentAccess {
  owners: { id: string; name: string; all: boolean; users: string[] }[];
}

export function canAssign(acc: AgentAccess | null | undefined, uid: string): boolean {
  return !!acc?.owners.some((o) => o.id === uid || o.all || o.users.includes(uid));
}

export function isAgentOwner(acc: AgentAccess | null | undefined, uid: string): boolean {
  return !!acc?.owners.some((o) => o.id === uid);
}

/** Server → browser: the playbook, the debriefs waiting to be distilled, the department profiles. */
export interface AgentBook {
  lessons: Lesson[];
  pending: Debrief[];
  profiles: Record<DeptId, DeptProfile>;
  /** departments whose profile differs from the built-in one */
  custom: DeptId[];
}

/** An on-call machine, as the office sees it (one runner process). */
export interface RunnerMachine {
  /** stable per machine (~/.office-agent/machine.json) */
  id: string;
  /** "host·abcd" — what lessons and debriefs are tagged with */
  label: string;
  owner: string;
  ownerName: string;
  /** the project (repo name) it works in */
  project: string;
  depts: DeptId[];
  /** last time it asked for work */
  at: number;
  /** it cannot reach Claude right now: until when it waits before trying again, and why */
  outage?: { until: number; why: string } | null;
  /** (the 🧠 panel only) sessions it is running right now */
  busy?: number;
  /** (the 🧠 panel only) it has not asked for work for a few minutes: off, asleep or cut off */
  offline?: boolean;
}

// ---------------------------------------------------------------- the playbook, scoped
// A lesson is true everywhere ('' project, '' machine), in one project, or on one machine. Sessions
// only ever read the lessons that fit where they work — lessons from another repo, or about another
// machine's shell, are noise that sends them the wrong way.

/** Does this lesson apply to a session of `dept` working in `project` on `machine`? */
export function lessonFits(l: Lesson, at: { dept?: DeptId | null; project?: string; machine?: string }): boolean {
  if (at.dept && l.dept !== 'all' && l.dept !== at.dept) return false;
  if (l.project && l.project !== (at.project ?? '')) return false;
  if (l.machine && l.machine !== (at.machine ?? '')) return false;
  return true;
}

/** The most specific first: this machine, then this project, then the department, then everyone. */
export function rankLessons(list: Lesson[]): Lesson[] {
  const score = (l: Lesson) => (l.machine ? 4 : 0) + (l.project ? 2 : 0) + (l.dept !== 'all' ? 1 : 0);
  return [...list].sort((a, b) => score(b) - score(a) || b.at - a.at);
}

/** The words that carry a lesson's meaning (no accents, no short filler). */
export function lessonWords(text: string): Set<string> {
  return new Set(
    strip(text)
      .split(/[^a-z0-9_./-]+/)
      .filter((w) => w.length >= 3),
  );
}

/** 0..1 — how much two lessons say the same thing (shared words over the shorter one). */
export function lessonOverlap(a: string, b: string): number {
  const x = lessonWords(a);
  const y = lessonWords(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

/** Departments @mentioned in a chat line ("@qa xem giúp", "@phattrien"). */
export function mentionedDepts(text: string): DeptId[] {
  const out = new Set<DeptId>();
  for (const m of strip(text).matchAll(/@([a-z0-9_-]+)/g)) {
    for (const d of DEPTS) if (d.alias.includes(m[1])) out.add(d.id);
  }
  return [...out];
}

/** Does `text` @mention this agent by name ("@Dev-2", "@claude-an")? */
export function mentionsName(text: string, name: string): boolean {
  const n = strip(name).replace(/\s+/g, '');
  if (!n) return false;
  const re = new RegExp(`@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_-])`);
  return re.test(strip(text).replace(/@\s+/g, '@'));
}
