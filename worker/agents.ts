// Virtual employees (Claude Code sessions) for the OfficeRoom.
//
//  • Hooks (POST /api/activity?v=2) put a session at a desk of its department, stream what it does to
//    its monitor and feed it context: the briefing (playbook, skills, open work), then — between
//    steps — chat lines that call it by name, and at the end of a turn whatever it still owes
//    (an unanswered question, a meeting still going).
//  • The office MCP server (POST /api/mcp) lets a session talk in the "Khu làm việc" chat, wait for
//    answers, take and hand over Kanban work, open its department's skills, call and attend
//    meetings in the meeting rooms, read the playbook and file a debrief.
//  • Agent runners (public/office-agent.cjs on an always-on machine) poll /api/agents/jobs and start
//    a headless session — set up with its department's profile — for each task handed to a
//    department, each @department call in the chat, each seat at a meeting, and now and then for the
//    lead to distil the debriefs into the playbook.
import { DEFAULT_AVATAR, type AvatarConfig } from '../shared/avatar';
import {
  AGENT_ID,
  AGENT_IDLE_MS,
  APPROVAL_TTL,
  DEBRIEF_MAX,
  DEPTS,
  DEPT_BY_ID,
  LESSON_MAX,
  MAX_HOPS,
  MEETING_MS,
  MEET_ROOMS,
  isDept,
  mentionedDepts,
  mentionsName,
  sanitizeProfile,
  type AgentBook,
  type AgentKind,
  type AgentMsg,
  type AgentState,
  type Approval,
  type Debrief,
  type DeptId,
  type DeptProfile,
  type Lesson,
  type MeetRoom,
  type Meeting,
} from '../shared/agents';
import { DEFAULT_PROFILES } from '../shared/dept-profiles';
import { SEAT_BY_ID, SEATS, type Seat } from '../shared/map';
import { PRIORITY_META, clampStr, type ActivityEvent, type ChatMsg, type PlayerState, type Priority, type ServerMsg, type Task, type TaskColumn } from '../shared/protocol';
import { TOOLS } from './agent-tools';
import { humanError, humanSay } from '../shared/human-log';
import * as db from './db';

export interface AgentHost {
  DB: D1Database;
  storage: DurableObjectStorage;
  tz: number;
  broadcast(msg: ServerMsg): void;
  sendTo(id: string, msg: ServerMsg): void;
  /** a person sits there */
  seatTaken(seatId: string): boolean;
  getTasks(): Promise<Map<string, Task>>;
  /** broadcast + persist */
  saveTask(task: Task, by: string): Promise<void>;
  /** broadcast + persist a chat line ('global' or 'work') */
  chat(m: ChatMsg): Promise<void>;
  systemChat(text: string): Promise<void>;
  userName(uid: string): Promise<string>;
  pushActivity(id: string, ev: ActivityEvent): Promise<void>;
  dropActivity(id: string): Promise<void>;
  wakeAt(ms: number): Promise<void>;
}

interface Agent {
  p: PlayerState;
  /** Claude Code session id (from the hooks) */
  sid: string;
  name: string;
  dept: DeptId;
  kind: AgentKind;
  owner: string;
  last: number;
  /** chat read by chat_read up to here */
  chatTs: number;
  /** chat that concerns it has been handed to the session up to here */
  inboxTs: number;
  /** runner job: the distillation session */
  distill?: boolean;
  lastSay: number;
  /** how many agent-to-agent calls led to this session (0 = a person or the board asked) */
  depth: number;
  /** times its Stop hook kept it going */
  stopBlocks: number;
  /** meeting it sits in */
  meet: string | null;
  /** meeting lines heard up to here */
  meetTs: number;
  /** the meeting it was last in (to hear that it ended) */
  lastMeet?: string;
  /** runner started with --approvers anyone: anyone in the office may approve its requests */
  anyone?: boolean;
  /** kinds of action approved for the rest of the session */
  allowed?: string[];
}

interface Mention {
  id: string;
  dept: DeptId;
  from: string;
  name: string;
  text: string;
  ts: number;
  depth: number;
}

export interface HookIn {
  uid: string;
  sid: string;
  event: string;
  ev: ActivityEvent | null;
  dept?: string;
  agent?: string;
  project?: string;
}

type Json = Record<string, unknown>;

const RUNNER_IDLE_MS = 3 * 3600_000;
const MENTION_TTL = 30 * 60_000;
const DISTILL_EVERY = 6 * 3600_000;
const DISTILL_BATCH = 3;
const CONTEXT_MAX = 6000;
/** agent → @department calls may wake a fresh session this many links deep */
const MAX_CALL_DEPTH = 2;
/** and at most this many per hour, all agents together */
const AGENT_CALLS_PER_HOUR = 10;
/** an unclaimed meeting seat stops being offered after this */
const SEAT_OFFER_MS = 5 * 60_000;
const MEET_KEEP_MS = 2 * 3600_000;
const PRIO_ORDER: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const short = (id: string) => id.replace(/-/g, '').slice(0, 8);
const oneLine = (s: string, n: number) => clampStr(s.replace(/\s+/g, ' '), n);
const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hashNum(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const BODIES = ['shirt', 'longsleeve', 'suit', 'casual', 'female', 'male'];
const HAIRS = ['parted', 'buzzed', 'pixie', 'long', 'buns'];
const SKINS = ['#ffe0c7', '#f6cfae', '#eab48f', '#d59a6f', '#b97b52'];
const HAIR_COLORS = ['#1f1a17', '#3b2a20', '#6b4426', '#b8b8bd', '#5a7bd6'];

/** A look that stays the same for the same agent, dressed in its department's colour. */
function agentAvatar(id: string, dept: DeptId): AvatarConfig {
  const h = hashNum(id);
  const pick = <T,>(arr: T[], k: number) => arr[(h >>> k) % arr.length];
  const color = DEPT_BY_ID.get(dept)!.color;
  return {
    ...DEFAULT_AVATAR,
    body: dept === 'lead' ? 'suit' : pick(BODIES, 0),
    hair: pick(HAIRS, 3),
    skin: pick(SKINS, 6),
    hairColor: pick(HAIR_COLORS, 9),
    top: color,
    bottom: '#2d3142',
    shoes: '#333333',
    sleeves: (h >>> 12) % 2 ? 'long' : 'short',
    build: (h >>> 13) % 2 ? 'slim' : 'regular',
    accessories: dept === 'dev' || dept === 'ops' ? ['headphones'] : dept === 'lead' || dept === 'docs' ? ['glasses'] : [],
    height: 0.96 + ((h >>> 14) % 9) / 100,
  };
}

export class AgentHub {
  private agents = new Map<string, Agent>();
  private mentions: Mention[] = [];
  private meetings: Meeting[] = [];
  private profiles: Partial<Record<DeptId, DeptProfile>> = {};
  private lastDistill = 0;
  private agentCalls: number[] = [];
  /** recent global + work chat (newest last) */
  private ring: ChatMsg[] = [];
  private ringLoaded = false;
  /** people with the agent panel open */
  private watchers = new Set<string>();
  /** sessions blocked in chat_wait / meeting_wait / permission */
  private waiters = new Set<() => void>();
  /** permission requests from runner sessions (kept in memory: a waiting request keeps us awake) */
  private approvals: Approval[] = [];
  private approvalSig = new Map<string, { sig: string; key: string; used: boolean }>();

  constructor(private host: AgentHost) {}

  async restore(): Promise<void> {
    const s = this.host.storage;
    const list = (await s.get<Agent[]>('agents')) ?? [];
    for (const a of list) if (a?.p?.id && AGENT_ID.test(a.p.id)) this.agents.set(a.p.id, Object.assign({ depth: 0, stopBlocks: 0, meet: null, meetTs: 0 }, a));
    this.mentions = (await s.get<Mention[]>('agentMentions')) ?? [];
    this.lastDistill = (await s.get<number>('agentDistill')) ?? 0;
    this.meetings = (await s.get<Meeting[]>('agentMeetings')) ?? [];
    this.profiles = (await s.get<Partial<Record<DeptId, DeptProfile>>>('deptProfiles')) ?? {};
  }

  private save() {
    void this.host.storage.put('agents', [...this.agents.values()]).catch(() => {});
  }

  /** Virtual employees, shown like people. */
  players(): PlayerState[] {
    return [...this.agents.values()].map((a) => a.p);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  nameOf(id: string): string | null {
    return this.agents.get(id)?.p.name ?? null;
  }

  left(id: string) {
    this.watchers.delete(id);
  }

  profile(dept: DeptId): DeptProfile {
    return this.profiles[dept] ?? DEFAULT_PROFILES[dept];
  }

  private wake() {
    const list = [...this.waiters];
    this.waiters.clear();
    for (const w of list) w();
  }

  /** Resolve when something happens (a chat line, a meeting line…) or after `ms`. */
  private nudge(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  // ------------------------------------------------------------------ seats
  private seatFree(id: string, except?: Agent): boolean {
    if (this.host.seatTaken(id)) return false;
    for (const a of this.agents.values()) if (a !== except && a.p.seat === id) return false;
    return true;
  }

  private busyRooms() {
    return new Set(this.meetings.filter((m) => !m.endedAt).map((m) => m.room));
  }

  /** The department's own desks first, then a chair in a free meeting room, then a sofa. */
  private pickSeat(dept: DeptId, except?: Agent, avoid?: string): Seat | null {
    const busy = this.busyRooms();
    const own = DEPT_BY_ID.get(dept)!.seats.map((id) => SEAT_BY_ID.get(id)!);
    const spare = SEATS.filter((s) => (s.zone === 'meetA' || s.zone === 'meetB') && s.kind === 'meeting' && !busy.has(s.zone as MeetRoom));
    const sofas = SEATS.filter((s) => s.kind === 'sofa' && (s.zone === 'lounge' || s.zone === 'lobby'));
    for (const s of [...own, ...spare, ...sofas]) if (s.id !== avoid && this.seatFree(s.id, except)) return s;
    return null;
  }

  /** A chair in that meeting room (the head of the table for the chair of the meeting). */
  private meetSeat(room: MeetRoom, head: boolean, a: Agent): Seat | null {
    const chairs = SEATS.filter((s) => s.zone === room && s.kind === 'meeting');
    const headSeat = chairs.find((s) => s.id.endsWith('-head'));
    if (head && headSeat && this.seatFree(headSeat.id, a)) return headSeat;
    return chairs.find((s) => !s.id.endsWith('-head') && this.seatFree(s.id, a)) ?? (headSeat && this.seatFree(headSeat.id, a) ? headSeat : null);
  }

  private placeAt(p: PlayerState, dept: DeptId, seat: Seat | null) {
    if (seat) {
      Object.assign(p, { seat: seat.id, x: seat.x, z: seat.z, ry: seat.ry, anim: 'sit', zone: seat.zone });
    } else {
      // no chair left: stand by the department's desks
      const own = SEAT_BY_ID.get(DEPT_BY_ID.get(dept)!.seats[0])!;
      Object.assign(p, { seat: null, x: own.x + 1.2 + Math.random(), z: own.z + 1.4, ry: 0, anim: 'idle', zone: own.zone });
    }
  }

  private moveTo(a: Agent, seat: Seat | null) {
    this.placeAt(a.p, a.dept, seat);
    this.host.broadcast({ t: 'upd', id: a.p.id, patch: { seat: a.p.seat, x: a.p.x, z: a.p.z, ry: a.p.ry, anim: a.p.anim, zone: a.p.zone } });
    this.save();
  }

  /** A person wants this seat: whoever of us sits there moves. */
  vacate(seatId: string) {
    for (const a of this.agents.values()) {
      if (a.p.seat !== seatId) continue;
      const m = a.meet ? this.meetings.find((x) => x.id === a.meet && !x.endedAt) : null;
      this.moveTo(a, (m && this.meetSeat(m.room, false, a)) || this.pickSeat(a.dept, a, seatId));
    }
  }

  // ------------------------------------------------------------------ life cycle
  private nameFor(kind: AgentKind, dept: DeptId, ownerName: string): string {
    const taken = new Set([...this.agents.values()].map((a) => a.name));
    const base = kind === 'runner' ? (dept === 'lead' ? 'Tổng quản' : DEPT_BY_ID.get(dept)!.short) : `Claude-${ascii(ownerName.split(/\s+/).pop() ?? '') || 'Team'}`;
    if (kind === 'person' && !taken.has(base)) return base;
    if (kind === 'runner' && dept === 'lead' && !taken.has(base)) return base;
    for (let n = kind === 'runner' && dept !== 'lead' ? 1 : 2; ; n++) {
      const name = `${base}-${n}`;
      if (!taken.has(name)) return name;
    }
  }

  private async join(id: string, kind: AgentKind, dept: DeptId, owner: string, sid: string, project?: string, seat?: Seat | null): Promise<Agent> {
    const now = Date.now();
    const ownerName = await this.host.userName(owner);
    const name = this.nameFor(kind, dept, ownerName);
    const p: PlayerState = {
      id,
      name: `🤖 ${name}`,
      avatar: agentAvatar(id, dept),
      x: 0,
      z: 0,
      ry: 0,
      anim: 'sit',
      zone: 'workspace',
      status: 'online',
      statusManual: true,
      statusText: '',
      seat: null,
      taskId: null,
      pomo: null,
      media: { mic: false, cam: false, screen: false },
      joinedAt: now,
      agent: { dept, kind, owner, ownerName, state: 'idle', project },
    };
    const a: Agent = { p, sid, name, dept, kind, owner, last: now, chatTs: now - 10 * 60_000, inboxTs: now, lastSay: 0, depth: 0, stopBlocks: 0, meet: null, meetTs: now };
    this.placeAt(p, dept, seat === undefined ? this.pickSeat(dept) : seat);
    this.agents.set(id, a);
    this.save();
    this.host.broadcast({ t: 'join', p });
    await this.host.wakeAt(now + 5 * 60_000);
    return a;
  }

  private async leave(a: Agent) {
    if (!this.agents.delete(a.p.id)) return;
    this.save();
    if (this.approvals.some((x) => x.agent === a.p.id)) {
      this.approvals = this.approvals.filter((x) => x.agent !== a.p.id);
      this.pushApprovals();
    }
    this.host.broadcast({ t: 'leave', id: a.p.id });
    await this.host.dropActivity(a.p.id);
    const m = a.meet ? this.meetings.find((x) => x.id === a.meet && !x.endedAt) : null;
    if (m) {
      m.members = m.members.filter((x) => x.id !== a.p.id);
      if (m.host === a.p.id) m.host = null;
      await this.meetLine(m, 'system', 'Văn phòng', `${a.name} đã rời cuộc họp.`);
      if (!m.members.length) await this.endMeeting(m, 'Mọi người đã rời phòng họp.', []);
    }
  }

  /** Drop sessions that went quiet, end meetings that ran over. Returns true while anyone is left to watch. */
  async sweep(now: number): Promise<boolean> {
    for (const a of [...this.agents.values()]) {
      if (now - a.last > (a.kind === 'runner' ? RUNNER_IDLE_MS : AGENT_IDLE_MS)) await this.leave(a);
    }
    for (const m of this.meetings) {
      if (m.endedAt) continue;
      if (now - m.startedAt > MEETING_MS) await this.endMeeting(m, 'Hết giờ họp — cuộc họp tự kết thúc.', []);
      else if (!m.host && !m.members.length && now - m.startedAt > SEAT_OFFER_MS) await this.endMeeting(m, 'Không có máy trực nào tới chủ trì.', []);
    }
    let changed = false;
    for (const x of this.approvals) if (x.state === 'pending' && now - x.at > APPROVAL_TTL) ((x.state = 'deny'), (x.by = 'hết hạn'), (changed = true));
    const live = this.approvals.filter((x) => x.state === 'pending' || now - x.at < APPROVAL_TTL + 10 * 60_000);
    if (changed || live.length !== this.approvals.length) {
      this.approvals = live;
      this.pushApprovals();
      this.wake();
    }
    const kept = this.meetings.filter((m) => !m.endedAt || now - m.endedAt < MEET_KEEP_MS);
    if (kept.length !== this.meetings.length) {
      this.meetings = kept;
      this.saveMeetings();
    }
    const before = this.mentions.length;
    this.mentions = this.mentions.filter((m) => now - m.ts < MENTION_TTL);
    if (this.mentions.length !== before) void this.host.storage.put('agentMentions', this.mentions);
    return this.agents.size > 0 || this.meetings.some((m) => !m.endedAt);
  }

  private setState(a: Agent, state: AgentState, text?: string) {
    const tag = a.p.agent!;
    const patch: Partial<PlayerState> = {};
    if (tag.state !== state) {
      tag.state = state;
      patch.agent = { ...tag };
      patch.status = state === 'working' ? 'working' : 'online';
    }
    if (text !== undefined && text !== a.p.statusText) patch.statusText = text;
    if (!Object.keys(patch).length) return;
    Object.assign(a.p, patch);
    this.host.broadcast({ t: 'upd', id: a.p.id, patch });
  }

  // ------------------------------------------------------------------ hooks
  /** A hook event. Returns what the hook should print (context for Claude) or null. */
  async hook(h: HookIn): Promise<string | null> {
    const now = Date.now();
    let a: Agent | undefined;
    if (h.agent && AGENT_ID.test(h.agent)) {
      const x = this.agents.get(h.agent);
      if (x && x.owner === h.uid) a = x;
    }
    if (!a && h.sid) a = this.agents.get(await this.personId(h.uid, h.sid));
    if (h.event === 'SessionEnd') {
      if (a && a.kind === 'person') await this.leave(a);
      return null;
    }
    if (!a) {
      if (!h.sid) return null;
      a = await this.join(await this.personId(h.uid, h.sid), 'person', isDept(h.dept) ? h.dept : 'dev', h.uid, h.sid, h.project);
    }
    a.last = now;
    if (h.sid) a.sid = h.sid;
    if (h.project && a.p.agent!.project !== h.project) {
      a.p.agent = { ...a.p.agent!, project: h.project };
      this.host.broadcast({ t: 'upd', id: a.p.id, patch: { agent: a.p.agent } });
    }
    if (h.ev) {
      // a runner streams its whole session (feed); its hooks only add the turn markers
      if (a.kind !== 'runner' || h.ev.kind !== 'tool') await this.host.pushActivity(a.p.id, h.ev);
      const k = h.ev.kind;
      if (k === 'prompt' || k === 'tool') this.setState(a, 'working', a.meet ? '📅 đang họp' : oneLine(h.ev.text, 60));
      else if (k === 'notify') this.setState(a, 'waiting', '⏳ chờ người duyệt');
      else if (k === 'stop' || k === 'start') this.setState(a, 'idle', '');
    }
    this.save();
    switch (h.event) {
      case 'SessionStart':
        return this.hookJson('SessionStart', await this.briefing(a));
      case 'UserPromptSubmit': {
        const news = await this.news(a);
        return news ? this.hookJson('UserPromptSubmit', news) : null;
      }
      case 'PostToolUse': {
        // a person's own session is never interrupted by the chat; a runner's hears it between steps
        if (a.kind !== 'runner') return null;
        const news = await this.news(a);
        return news ? this.hookJson('PostToolUse', news) : null;
      }
      case 'Stop':
        return a.kind === 'runner' ? this.stopCheck(a) : null;
    }
    return null;
  }

  /** End of a runner's turn: keep it going while a meeting needs it or someone is waiting for an answer. */
  private async stopCheck(a: Agent): Promise<string | null> {
    const m = a.meet ? this.meetings.find((x) => x.id === a.meet && !x.endedAt) : null;
    if (m && a.stopBlocks < 15) {
      a.stopBlocks++;
      const chair = m.host === a.p.id;
      return JSON.stringify({
        decision: 'block',
        reason: chair
          ? `Bạn đang chủ trì cuộc họp "${m.topic}" và nó chưa kết thúc. Tiếp tục: mcp__office__meeting_wait để nghe, meeting_say để điều phối, rồi mcp__office__meeting_end (summary + actions) để chốt.`
          : `Cuộc họp "${m.topic}" vẫn đang diễn ra. Tiếp tục mcp__office__meeting_wait để nghe và meeting_say khi được hỏi, tới khi meeting_wait báo ĐÃ KẾT THÚC.`,
      });
    }
    if (a.stopBlocks < 3) {
      const news = await this.news(a);
      if (news) {
        a.stopBlocks++;
        return JSON.stringify({ decision: 'block', reason: `${news}\nTrả lời người hỏi bằng mcp__office__chat_send trước khi kết thúc (nếu cần).` });
      }
    }
    return null;
  }

  private async personId(uid: string, sid: string) {
    return `ag-${(await sha(`${uid}:${sid}`)).slice(0, 12)}`;
  }

  private hookJson(event: string, text: string) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text.slice(0, CONTEXT_MAX) } });
  }

  private time(ts: number) {
    const d = new Date(ts + this.host.tz * 60_000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  private chatLine(m: ChatMsg) {
    return `[${this.time(m.ts)}]${m.ch === 'global' ? ' 🌏' : m.meet ? ' 📅' : ''} ${m.name}: ${oneLine(m.text, 300)}`;
  }

  private colleagues(a: Agent) {
    const list = [...this.agents.values()].filter((x) => x !== a).map((x) => `${x.name} (${DEPT_BY_ID.get(x.dept)!.short}${x.meet ? ', đang họp' : ''})`);
    return list.length ? list.join(', ') : 'chưa có ai khác';
  }

  /** Everything a fresh session should know about its place in the office. */
  private async briefing(a: Agent): Promise<string> {
    const d = DEPT_BY_ID.get(a.dept)!;
    const project = a.p.agent?.project ?? '';
    const prof = this.profile(a.dept);
    const out = [
      `# ${a.name} — ${d.icon} ${d.name}`,
      `Mã của bạn: ${a.p.id} (truyền me="${a.p.id}" khi gọi mcp__office__*).`,
      a.kind === 'person' ? `Phòng: ${d.name}. Đây là phiên của ${a.p.agent!.ownerName}: luôn ưu tiên yêu cầu của họ.` : `Nhiệm vụ: ${d.brief.replace(/^Bạn thuộc [^:]+: /, '')}`,
      `Đồng nghiệp: ${this.colleagues(a)}. Gọi người bằng @Tên, gọi cả phòng bằng @dev @qa @ops @design @docs @biz @lead; hỏi xong thì chat_wait.`,
      'Công cụ mcp__office__*: chat_send/chat_read/chat_wait (kênh Khu làm việc), skill (quy trình của phòng), tasks/task_claim/task_update (Kanban), handoff (giao cho phòng khác), meeting_call/meeting_wait/meeting_say/meeting_end (họp), lessons, debrief (tóm tắt khi xong việc: làm gì, lỗi gì, bài học — không ghi mật khẩu/token).',
    ];
    if (prof.skills.length) {
      out.push('', `## Kỹ năng của phòng ${d.name} (mở bằng mcp__office__skill name="…")`);
      for (const s of prof.skills) out.push(`- ${s.id} — ${s.name}: dùng khi ${s.when}`);
    }
    const lessons = (await db.listLessons(this.host.DB)).filter((l) => (l.dept === 'all' || l.dept === a.dept) && (!l.project || l.project === project)).slice(0, 30);
    if (lessons.length) {
      out.push('', `## Sổ kinh nghiệm (${d.name}${project ? ` · ${project}` : ''})`);
      for (const l of lessons) out.push(`- ${l.text}${l.project ? ` (${l.project})` : ''}`);
    }
    const tasks = [...(await this.host.getTasks()).values()]
      .filter((t) => t.col !== 'done' && (t.dept === a.dept || t.assignee === a.p.id))
      .sort((x, y) => PRIO_ORDER[x.priority] - PRIO_ORDER[y.priority] || x.createdAt - y.createdAt)
      .slice(0, 8);
    if (tasks.length) {
      out.push('', `## Việc của phòng ${d.name} trên Kanban`);
      for (const t of tasks) out.push(`- #${short(t.id)} [${t.col}] ${t.title}${t.priority !== 'normal' ? ` (${PRIORITY_META[t.priority].label})` : ''}${t.assignee ? '' : ' — chưa ai nhận'}`);
    }
    const m = a.meet ? this.meetings.find((x) => x.id === a.meet && !x.endedAt) : null;
    if (m) out.push('', `## Đang họp: "${m.topic}"${m.host === a.p.id ? ' — bạn chủ trì' : ''}`);
    const chat = (await this.recent()).filter((x) => x.ts > Date.now() - 3600_000 && this.forMe(a, x)).slice(-6);
    if (chat.length) {
      out.push('', '## Tin nhắn gọi bạn / phòng bạn');
      for (const x of chat) out.push(`- ${this.chatLine(x)}`);
    }
    a.inboxTs = Date.now();
    return out.join('\n');
  }

  private forMe(a: Agent, m: ChatMsg) {
    if (m.from === a.p.id || m.meet) return false;
    return mentionsName(m.text, a.name) || mentionedDepts(m.text).includes(a.dept);
  }

  private async unread(a: Agent): Promise<ChatMsg[]> {
    return (await this.recent()).filter((m) => m.ts > a.inboxTs && this.forMe(a, m));
  }

  /** What happened since it last heard (only when something concerns this agent). */
  private async news(a: Agent): Promise<string | null> {
    const since = a.inboxTs;
    const chat = (await this.unread(a)).slice(-6);
    const tasks = a.kind === 'person' ? [...(await this.host.getTasks()).values()].filter((t) => t.col === 'todo' && t.dept === a.dept && !t.assignee && t.createdAt > since).slice(0, 5) : [];
    a.inboxTs = Date.now();
    if (!chat.length && !tasks.length) return null;
    const out = [a.kind === 'person' ? '📨 Tin mới (chỉ để biết — vẫn ưu tiên yêu cầu hiện tại):' : '📨 Tin nhắn mới gọi bạn:'];
    for (const m of chat) out.push(`- ${this.chatLine(m)}`);
    for (const t of tasks) out.push(`- Việc mới cho phòng ${DEPT_BY_ID.get(a.dept)!.name}: #${short(t.id)} ${t.title}`);
    return out.join('\n');
  }

  // ------------------------------------------------------------------ chat
  private async recent(): Promise<ChatMsg[]> {
    if (!this.ringLoaded) {
      this.ringLoaded = true;
      const old = (await db.recentChat(this.host.DB, 150)).filter((m) => m.ch === 'global' || m.ch === 'work');
      const seen = new Set(this.ring.map((m) => m.id));
      this.ring = [...old.filter((m) => !seen.has(m.id)), ...this.ring].sort((x, y) => x.ts - y.ts).slice(-200);
    }
    return this.ring;
  }

  /** Every global / work chat line passes through here (`zone` = where a person said it). */
  onChat(m: ChatMsg, zone?: string) {
    if (m.ch !== 'global' && m.ch !== 'work') return;
    this.ring.push(m);
    if (this.ring.length > 200) this.ring.splice(0, this.ring.length - 200);
    this.wake();
    if (m.from === 'system' || m.meet) return;
    const sender = this.agents.get(m.from);
    // a person talking in the work chat while standing in a meeting room joins the meeting's record
    if (!sender && m.ch === 'work' && zone) {
      const meet = this.meetings.find((x) => !x.endedAt && x.room === zone);
      if (meet) {
        meet.lines.push({ from: m.from, name: m.name, text: m.text, ts: m.ts });
        this.saveMeetings();
        this.pushMeetings();
      }
    }
    // @department (or @Name of someone who has left) → a job for the runners
    const depts = new Set(mentionedDepts(m.text));
    for (const w of m.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().matchAll(/@(lead|dev|qa|ops|design|docs|biz)-\d+\b/g)) {
      const name = w[0].slice(1);
      if (![...this.agents.values()].some((a) => a.name.toLowerCase() === name)) depts.add(w[1] as DeptId);
    }
    if (!depts.size) return;
    let depth = 0;
    if (sender) {
      // agents calling each other: only wake a fresh session when nobody of that department is here,
      // never too deep and never too often — or two of them could keep waking each other forever
      depth = sender.depth + 1;
      const now = Date.now();
      this.agentCalls = this.agentCalls.filter((t) => now - t < 3600_000);
      for (const d of [...depts]) if ([...this.agents.values()].some((a) => a.kind === 'runner' && a.dept === d && !a.meet && a !== sender)) depts.delete(d);
      if (depth > MAX_CALL_DEPTH || this.agentCalls.length >= AGENT_CALLS_PER_HOUR) return;
      if (depts.size) this.agentCalls.push(now);
    } else {
      for (const a of this.agents.values()) if (a.kind === 'runner' && mentionsName(m.text, a.name)) depts.delete(a.dept); // it is right here, it will hear it
    }
    for (const dept of depts) this.mentions.push({ id: crypto.randomUUID(), dept, from: m.from, name: m.name, text: m.text, ts: m.ts, depth });
    this.mentions = this.mentions.slice(-30);
    void this.host.storage.put('agentMentions', this.mentions);
  }

  private async say(a: Agent, text: string, ch: 'work' | 'global', meet?: string) {
    const now = Date.now();
    if (now - a.lastSay < 1500) await sleep(1500 - (now - a.lastSay));
    a.lastSay = Date.now();
    await this.host.chat({ id: crypto.randomUUID(), ch, from: a.p.id, name: a.p.name, text, ts: a.lastSay, ...(meet ? { meet } : {}) });
  }

  private async notice(text: string) {
    await this.host.chat({ id: crypto.randomUUID(), ch: 'work', from: 'system', name: 'Văn phòng', text, ts: Date.now() });
  }

  // ------------------------------------------------------------------ meetings
  private saveMeetings() {
    void this.host.storage.put('agentMeetings', this.meetings).catch(() => {});
  }

  /** What the browsers get (recent lines only). */
  meetingsView(): Meeting[] {
    return this.meetings.map((m) => ({ ...m, lines: m.lines.slice(-40) }));
  }

  private pushMeetings() {
    this.host.broadcast({ t: 'meetings', list: this.meetingsView() });
  }

  private async meetLine(m: Meeting, from: string, name: string, text: string) {
    m.lines.push({ from, name, text, ts: Date.now() });
    if (m.lines.length > 300) m.lines.splice(0, m.lines.length - 300);
    this.saveMeetings();
    this.pushMeetings();
    this.wake();
  }

  private async openMeeting(by: string, topic: string, agenda: string, depts: DeptId[], hostAgent: Agent | null): Promise<Meeting> {
    const busy = this.busyRooms();
    const room = MEET_ROOMS.find((r) => !busy.has(r.id));
    if (!room) throw new Error('cả hai phòng họp đều đang có người họp — thử lại sau');
    const now = Date.now();
    const m: Meeting = { id: crypto.randomUUID(), topic, agenda, room: room.id, by, host: hostAgent?.p.id ?? null, depts, waiting: [...depts], members: [], lines: [], startedAt: now, endedAt: null, summary: '' };
    this.meetings.push(m);
    if (hostAgent) {
      m.waiting = m.waiting.filter((d) => d !== hostAgent.dept || depts.filter((x) => x === d).length > 1);
      this.enter(m, hostAgent, true);
    }
    // agents of those departments already here and free are invited in person, the rest get a runner
    for (const a of this.agents.values()) {
      if (a === hostAgent || a.meet || a.kind !== 'runner' || !m.waiting.includes(a.dept) || a.distill) continue;
      // (they keep working; the invitation reaches them between steps)
    }
    this.saveMeetings();
    this.pushMeetings();
    await this.host.wakeAt(now + 5 * 60_000);
    const names = depts.map((d) => `${DEPT_BY_ID.get(d)!.icon} ${DEPT_BY_ID.get(d)!.name}`).join(', ');
    await this.notice(`📅 ${by} mời ${names} họp về “${topic}” ở ${room.name}.`);
    return m;
  }

  private enter(m: Meeting, a: Agent, chair: boolean) {
    a.meet = m.id;
    a.lastMeet = m.id;
    a.meetTs = m.startedAt - 1;
    a.stopBlocks = 0;
    if (chair) m.host = a.p.id;
    if (!m.members.some((x) => x.id === a.p.id)) m.members.push({ id: a.p.id, name: a.p.name, dept: a.dept });
    this.moveTo(a, this.meetSeat(m.room, chair, a));
    this.setState(a, 'working', '📅 đang họp');
    void this.meetLine(m, 'system', 'Văn phòng', `${a.name} vào phòng họp${chair ? ' và chủ trì' : ''}.`);
  }

  private async endMeeting(m: Meeting, summary: string, actions: { dept: DeptId; title: string; details: string; priority?: Priority }[], by?: Agent) {
    if (m.endedAt) return [];
    m.endedAt = Date.now();
    m.summary = summary;
    const made: Task[] = [];
    for (const x of actions.slice(0, 10)) made.push(await this.createTask(by ?? null, x.dept, x.title, `Từ cuộc họp “${m.topic}”:\n${x.details}\n\nBiên bản: ${summary}`, x.priority, 1));
    for (const mem of m.members) {
      const a = this.agents.get(mem.id);
      if (!a) continue;
      a.meet = null;
      a.stopBlocks = 0;
      this.moveTo(a, this.pickSeat(a.dept, a));
      this.setState(a, a.p.agent!.state, '');
    }
    m.lines.push({ from: 'system', name: 'Văn phòng', text: `Kết thúc. ${summary}`, ts: m.endedAt });
    this.saveMeetings();
    this.pushMeetings();
    this.wake();
    const list = made.map((t) => `${DEPT_BY_ID.get(t.dept!)!.icon} ${t.title}`).join(' · ');
    await this.notice(`📅 Họp xong về “${m.topic}”. ${oneLine(summary, 220)}${list ? ` Việc tiếp theo: ${list}.` : ''}`);
    return made;
  }

  // ------------------------------------------------------------------ approvals
  approvalsView(): Approval[] {
    return this.approvals;
  }

  private pushApprovals() {
    this.host.broadcast({ t: 'approvals', list: this.approvals });
  }

  /** Claude Code's --permission-prompt-tool: wait for a person to decide, a minute at a time. */
  private async permission(a: Agent, args: Json): Promise<string> {
    const tool = clampStr(String(args.tool_name ?? ''), 80) || 'tool';
    const input = args.input && typeof args.input === 'object' ? (args.input as Json) : {};
    const allow = () => JSON.stringify({ behavior: 'allow', updatedInput: input });
    const deny = (message: string) => JSON.stringify({ behavior: 'deny', message });
    const { summary, key } = describeAction(tool, input);
    if (a.allowed?.includes(key)) return allow();
    if (a.kind !== 'runner') return deny('Chỉ phiên của máy trực mới xin duyệt qua Office.');
    const sig = `${tool}:${JSON.stringify(input)}`.slice(0, 4000);
    let x = this.approvals.find((y) => y.agent === a.p.id && this.approvalSig.get(y.id)?.sig === sig && !this.approvalSig.get(y.id)?.used);
    if (!x) {
      if (this.approvals.filter((y) => y.agent === a.p.id && y.state === 'pending').length >= 3) return deny('Đang có quá nhiều yêu cầu chờ duyệt — đợi người duyệt rồi thử lại.');
      x = { id: crypto.randomUUID(), agent: a.p.id, agentName: a.p.name, dept: a.dept, owner: a.owner, ownerName: a.p.agent!.ownerName, anyone: !!a.anyone, tool, summary, at: Date.now(), state: 'pending' };
      this.approvals.push(x);
      this.approvalSig.set(x.id, { sig, key, used: false });
      this.pushApprovals();
      await this.host.wakeAt(Date.now() + APPROVAL_TTL + 60_000);
    }
    this.setState(a, 'waiting', `🔐 chờ duyệt: ${oneLine(summary, 40)}`);
    const until = Date.now() + 50_000;
    while (x.state === 'pending' && Date.now() < until) await this.nudge(until - Date.now());
    const s = this.approvalSig.get(x.id)!;
    if (x.state === 'pending') return deny(`Đang chờ ${x.ownerName} duyệt trong Office: ${oneLine(summary, 120)}. Làm phần việc khác trước nếu có, rồi thử lại đúng thao tác này sau khoảng một phút. Nếu bị từ chối thì tìm cách khác hoặc ghi vào note.`);
    s.used = true;
    this.setState(a, 'working', '');
    return x.state === 'allow' ? allow() : deny(`${x.by ?? 'Người duyệt'} không cho phép thao tác này. Tìm cách khác, hoặc ghi rõ lý do cần nó vào note.`);
  }

  // ------------------------------------------------------------------ runners
  async jobs(uid: string, deptsRaw: string): Promise<Json> {
    const depts = new Set(deptsRaw.split(',').filter(isDept));
    const now = Date.now();
    const tasks = [...(await this.host.getTasks()).values()]
      .filter((t) => t.col === 'todo' && !t.assignee && t.dept && depts.has(t.dept) && (t.hops ?? 0) <= MAX_HOPS)
      .sort((x, y) => PRIO_ORDER[x.priority] - PRIO_ORDER[y.priority] || x.createdAt - y.createdAt)
      .map((t) => ({ id: t.id, short: short(t.id), title: t.title, desc: t.desc, dept: t.dept, priority: t.priority }));
    const mentions = this.mentions.filter((m) => depts.has(m.dept) && now - m.ts < MENTION_TTL);
    const meetings = this.meetings
      .filter((m) => !m.endedAt && now - m.startedAt < SEAT_OFFER_MS)
      .flatMap((m) => m.waiting.filter((d) => depts.has(d)).map((dept) => ({ id: m.id, dept, topic: m.topic, host: !m.host && dept === 'lead' })));
    let distill = false;
    let pending = 0;
    if (depts.has('lead')) {
      pending = await db.countPendingDebriefs(this.host.DB);
      const busy = [...this.agents.values()].some((a) => a.distill);
      distill = !busy && (pending >= DISTILL_BATCH || (pending > 0 && now - this.lastDistill > DISTILL_EVERY));
    }
    const live = [...this.agents.values()].filter((a) => a.owner === uid && a.kind === 'runner').map((a) => ({ id: a.p.id, name: a.name, dept: a.dept }));
    return { tasks, mentions, meetings, distill, pending, live };
  }

  /** A runner takes a job: the agent sits down at once, before its session has even started. */
  async claim(uid: string, b: Json): Promise<Json> {
    const kind = String(b.kind);
    const now = Date.now();
    const out = (a: Agent, extra: Json = {}) => {
      a.anyone = b.approvers === 'anyone';
      return { ok: true, agent: this.wire(a), profile: this.profile(a.dept), ...extra };
    };
    if (kind === 'task') {
      const tasks = await this.host.getTasks();
      const t = tasks.get(String(b.id));
      if (!t || t.col !== 'todo' || t.assignee || !t.dept) return { ok: false, error: 'việc đã có người nhận' };
      const a = await this.join(await this.runnerId(), 'runner', t.dept, uid, '');
      t.assignee = a.p.id;
      t.col = 'doing';
      t.updatedAt = now;
      a.p.taskId = t.id;
      await this.host.saveTask(t, a.p.id);
      this.setState(a, 'working', oneLine(t.title, 60));
      return out(a, { task: { id: t.id, short: short(t.id), title: t.title, desc: t.desc, dept: t.dept, priority: t.priority } });
    }
    if (kind === 'mention') {
      const i = this.mentions.findIndex((m) => m.id === b.id);
      if (i < 0) return { ok: false, error: 'tin nhắn đã có agent khác nhận' };
      const [m] = this.mentions.splice(i, 1);
      void this.host.storage.put('agentMentions', this.mentions);
      const a = await this.join(await this.runnerId(), 'runner', m.dept, uid, '');
      a.depth = m.depth;
      a.inboxTs = m.ts; // the message it was called for is still news to it
      this.setState(a, 'working', `trả lời ${oneLine(m.name, 24)}`);
      return out(a, { mention: m });
    }
    if (kind === 'meeting') {
      const m = this.meetings.find((x) => x.id === b.id && !x.endedAt);
      const dept = b.dept;
      if (!m || !isDept(dept) || !m.waiting.includes(dept)) return { ok: false, error: 'ghế họp đã có người' };
      m.waiting.splice(m.waiting.indexOf(dept), 1);
      const chair = !m.host && dept === 'lead';
      const a = await this.join(await this.runnerId(), 'runner', dept, uid, '', undefined, null);
      this.enter(m, a, chair);
      this.saveMeetings();
      return out(a, { meeting: { id: m.id, topic: m.topic, agenda: m.agenda, room: MEET_ROOMS.find((r) => r.id === m.room)!.name, chair, depts: m.depts, by: m.by } });
    }
    if (kind === 'distill') {
      if ([...this.agents.values()].some((x) => x.distill)) return { ok: false, error: 'đang có phiên đúc rút' };
      const a = await this.join(await this.runnerId(), 'runner', 'lead', uid, '');
      a.distill = true;
      this.lastDistill = now;
      void this.host.storage.put('agentDistill', now);
      this.setState(a, 'working', 'đúc rút kinh nghiệm');
      return out(a);
    }
    return { ok: false, error: 'kind?' };
  }

  /** The runner streams its session (stream-json): every message and tool call goes on the monitor. */
  async feed(uid: string, b: Json): Promise<Json> {
    const a = this.agents.get(String(b.agent));
    if (!a || a.owner !== uid) return { ok: false };
    a.last = Date.now();
    const evs = Array.isArray(b.events) ? b.events.slice(0, 30) : [];
    for (const e of evs) {
      if (!e || typeof e !== 'object') continue;
      const x = e as Json;
      const kind = x.kind === 'say' || x.kind === 'tool' || x.kind === 'result' ? (x.kind as 'say' | 'tool' | 'result') : null;
      const raw = String(x.text ?? '');
      const text = kind === 'say' ? humanSay(raw) : kind === 'result' && x.icon === '❌' ? humanError(raw) : oneLine(raw, 160);
      if (!kind || !text) continue;
      await this.host.pushActivity(a.p.id, { ts: Date.now(), kind, icon: clampStr(String(x.icon ?? (kind === 'say' ? '⏺' : '🔧')), 8), text });
      if (kind === 'tool') this.setState(a, 'working', a.meet ? '📅 đang họp' : oneLine(text, 60));
    }
    return { ok: true };
  }

  /** The runner's session ended (or crashed): unfinished work goes back on the board. */
  async exit(uid: string, b: Json): Promise<Json> {
    const a = this.agents.get(String(b.agent));
    if (!a || a.owner !== uid) return { ok: false };
    const code = Number(b.code);
    const tasks = await this.host.getTasks();
    for (const t of tasks.values()) {
      if (t.assignee !== a.p.id || t.col !== 'doing') continue;
      const failed = code !== 0;
      t.desc = this.appendNote(t.desc, a.name, failed ? `Phiên làm việc bị dừng giữa chừng (mã ${Number.isFinite(code) ? code : '?'}), mình trả việc về To do để làm lại.` : 'Phiên làm việc đã kết thúc nhưng chưa kịp báo xong — nhờ mọi người kiểm tra giúp.');
      t.col = failed ? 'todo' : 'review';
      if (failed) t.assignee = null;
      t.updatedAt = Date.now();
      await this.host.saveTask(t, a.p.id);
    }
    await this.leave(a);
    return { ok: true };
  }

  private async runnerId() {
    return `ag-${(await sha(crypto.randomUUID())).slice(0, 12)}`;
  }

  private wire(a: Agent) {
    return { id: a.p.id, name: a.name, dept: a.dept };
  }

  private appendNote(desc: string, who: string, note: string) {
    const d = new Date(Date.now() + this.host.tz * 60_000);
    const stamp = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${this.time(Date.now())}`;
    let out = `${desc}${desc ? '\n\n' : ''}— ${who} (${stamp}): ${note}`;
    if (out.length > 2000) out = `${out.slice(0, 500)}\n…\n${out.slice(-1450)}`;
    return out;
  }

  private async createTask(a: Agent | null, dept: DeptId, title: string, desc: string, priority: Priority | undefined, hops: number): Promise<Task> {
    const tasks = await this.host.getTasks();
    let ord = 0;
    for (const t of tasks.values()) if (t.col === 'todo') ord = Math.max(ord, t.ord);
    const now = Date.now();
    const task: Task = {
      id: crypto.randomUUID(),
      title: clampStr(title, 140) || 'Việc mới',
      desc: clampStr(desc, 2000),
      col: 'todo',
      ord: ord + 1,
      assignee: null,
      priority: priority && priority in PRIORITY_META ? priority : 'normal',
      createdBy: a?.p.id ?? 'system',
      createdAt: now,
      updatedAt: now,
      doneAt: null,
      dept,
      hops,
    };
    await this.host.saveTask(task, a?.p.id ?? 'system');
    return task;
  }

  // ------------------------------------------------------------------ the people's side
  async handle(id: string, m: AgentMsg, by: string): Promise<void> {
    const now = Date.now();
    switch (m.a) {
      case 'lessons':
        this.watchers.add(id);
        break;
      case 'lesson': {
        const text = clampStr(m.text, LESSON_MAX);
        if (!text) return;
        const dept = m.dept === 'all' || isDept(m.dept) ? m.dept : 'all';
        await db.saveLesson(this.host.DB, { id: typeof m.id === 'string' && /^[a-z0-9-]{6,40}$/.test(m.id) ? m.id : crypto.randomUUID(), dept, project: clampStr(m.project ?? '', 40), text, by, at: now });
        break;
      }
      case 'lessonDel':
        await db.deleteLesson(this.host.DB, String(m.id));
        break;
      case 'dismiss':
        await db.finishDebriefs(this.host.DB, [String(m.id)], now);
        break;
      case 'profile': {
        if (!isDept(m.dept)) return;
        this.profiles[m.dept] = sanitizeProfile(m.profile, this.profile(m.dept));
        await this.host.storage.put('deptProfiles', this.profiles);
        await this.notice(`📋 ${by} vừa cập nhật cách làm việc của phòng ${DEPT_BY_ID.get(m.dept)!.name}.`);
        break;
      }
      case 'profileReset':
        if (!isDept(m.dept)) return;
        delete this.profiles[m.dept];
        await this.host.storage.put('deptProfiles', this.profiles);
        break;
      case 'meeting': {
        const topic = clampStr(m.topic, 120);
        const depts = [...new Set((Array.isArray(m.depts) ? m.depts : []).filter(isDept))].slice(0, 5);
        if (!topic || !depts.length) return;
        // a person calls it: the lead's session comes to chair it
        if (!depts.includes('lead')) depts.unshift('lead');
        try {
          await this.openMeeting(by, topic, clampStr(m.agenda ?? '', 600), depts, null);
        } catch (err) {
          this.host.sendTo(id, { t: 'err', msg: (err as Error).message });
        }
        return;
      }
      case 'approve': {
        const x = this.approvals.find((y) => y.id === m.id && y.state === 'pending');
        if (!x) return;
        if (x.owner !== id && !x.anyone) {
          this.host.sendTo(id, { t: 'err', msg: `Chỉ ${x.ownerName} (chủ máy trực) duyệt được yêu cầu này.` });
          return;
        }
        x.state = m.decision === 'deny' ? 'deny' : 'allow';
        x.by = by;
        const a = this.agents.get(x.agent);
        const key = this.approvalSig.get(x.id)?.key;
        if (a && key && m.decision === 'session') a.allowed = [...new Set([...(a.allowed ?? []), key])];
        this.pushApprovals();
        this.wake();
        const who = x.agentName.replace('🤖 ', '');
        await this.notice(x.state === 'allow' ? `🔐 ${by} đã cho ${who} ${m.decision === 'session' ? 'làm loại việc này suốt phiên' : 'làm'}: ${oneLine(x.summary, 120)}` : `🔐 ${by} không đồng ý cho ${who}: ${oneLine(x.summary, 120)}`);
        return;
      }
      case 'meetingEnd': {
        const meet = this.meetings.find((x) => x.id === m.id && !x.endedAt);
        if (meet) await this.endMeeting(meet, `Kết thúc bởi ${by}.`, []);
        return;
      }
      default:
        return;
    }
    await this.pushBook(m.a === 'lessons' ? id : undefined);
  }

  private async book(): Promise<AgentBook> {
    const [lessons, pending] = await Promise.all([db.listLessons(this.host.DB), db.pendingDebriefs(this.host.DB, 50)]);
    const profiles = Object.fromEntries(DEPTS.map((d) => [d.id, this.profile(d.id)])) as Record<DeptId, DeptProfile>;
    return { lessons, pending, profiles, custom: DEPTS.filter((d) => this.profiles[d.id]).map((d) => d.id) };
  }

  private async pushBook(only?: string) {
    if (!only && !this.watchers.size) return;
    const book = await this.book();
    for (const id of only ? [only] : this.watchers) this.host.sendTo(id, { t: 'agentBook', book });
  }

  // ------------------------------------------------------------------ MCP
  /** JSON-RPC over HTTP (MCP "streamable HTTP", stateless, JSON responses only). */
  async mcp(uid: string, agentHeader: string, body: unknown): Promise<Response> {
    const one = async (req: Json): Promise<Json | null> => {
      const id = req.id;
      const method = String(req.method ?? '');
      const params = (req.params ?? {}) as Json;
      if (id === undefined || id === null) return null; // notification
      const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
      switch (method) {
        case 'initialize':
          return ok({
            protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'office', version: '1.1.0' },
            instructions:
              'Công cụ làm việc nhóm: chat_send/chat_wait để trao đổi với đồng nghiệp (gọi @Tên hoặc @phòng), skill để mở quy trình của phòng, tasks/handoff cho Kanban, meeting_* để họp, debrief khi xong việc.',
          });
        case 'ping':
          return ok({});
        case 'tools/list':
          return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': {
          const name = String(params.name ?? '');
          const args = (params.arguments ?? {}) as Json;
          try {
            const text = await this.tool(uid, agentHeader, name, args);
            return ok({ content: [{ type: 'text', text }] });
          } catch (err) {
            return ok({ content: [{ type: 'text', text: `Lỗi: ${(err as Error).message}` }], isError: true });
          }
        }
        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      }
    };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((r) => one(r as Json)))).filter(Boolean);
      return out.length ? Response.json(out) : new Response(null, { status: 202 });
    }
    if (!body || typeof body !== 'object') return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
    const res = await one(body as Json);
    return res ? Response.json(res) : new Response(null, { status: 202 });
  }

  /** Which agent is calling: `me`, the runner's header, or the owner's most recently active session. */
  private me(uid: string, header: string, args: Json): Agent {
    for (const id of [args.me, header]) {
      if (typeof id !== 'string' || !id) continue;
      const a = this.agents.get(id);
      if (a && a.owner === uid) return a;
    }
    let best: Agent | null = null;
    for (const a of this.agents.values()) if (a.owner === uid && (!best || a.last > best.last)) best = a;
    if (!best) throw new Error('chưa nhận ra phiên này (hook chưa chạy?). Mở lại Claude Code sau khi cài hook.');
    return best;
  }

  private async findTask(idRaw: unknown): Promise<Task> {
    const q = String(idRaw ?? '').replace(/^#/, '').replace(/-/g, '').toLowerCase();
    if (q.length < 4) throw new Error('thiếu mã việc (vd "#1a2b3c4d")');
    const hits = [...(await this.host.getTasks()).values()].filter((t) => t.id.replace(/-/g, '').startsWith(q));
    if (hits.length !== 1) throw new Error(hits.length ? 'mã việc trùng nhiều việc, ghi dài hơn' : `không có việc #${q}`);
    return hits[0];
  }

  private lead(a: Agent) {
    if (a.dept !== 'lead') throw new Error('chỉ Ban điều hành (dept lead) được sửa sổ kinh nghiệm');
  }

  private myMeeting(a: Agent): Meeting {
    const id = a.meet ?? a.lastMeet;
    const m = id ? this.meetings.find((x) => x.id === id) : null;
    if (!m) throw new Error('bạn không ở trong cuộc họp nào');
    return m;
  }

  private async tool(uid: string, header: string, name: string, args: Json): Promise<string> {
    const a = this.me(uid, header, args);
    a.last = Date.now();
    const tasks = await this.host.getTasks();
    switch (name) {
      case 'permission':
        return this.permission(a, args);
      case 'chat_read': {
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        const all = (await this.recent()).filter((m) => !m.meet);
        let list = all.filter((m) => m.ts > a.chatTs);
        if (!list.length) list = all.slice(-Math.min(limit, 5));
        list = list.slice(-limit);
        a.chatTs = Date.now();
        a.inboxTs = Math.max(a.inboxTs, a.chatTs);
        return list.length ? list.map((m) => this.chatLine(m)).join('\n') : '(chưa có tin nhắn nào)';
      }
      case 'chat_send': {
        const text = clampStr(String(args.text ?? ''), 500);
        if (!text) throw new Error('tin nhắn trống');
        await this.say(a, text, args.channel === 'global' ? 'global' : 'work');
        return 'Đã gửi.';
      }
      case 'chat_wait': {
        const until = Date.now() + Math.max(5, Math.min(50, Number(args.seconds) || 40)) * 1000;
        this.setState(a, 'waiting', '💬 chờ trả lời');
        for (;;) {
          const got = await this.unread(a);
          if (got.length) {
            a.inboxTs = Date.now();
            this.setState(a, 'working', '');
            return got.slice(-8).map((m) => this.chatLine(m)).join('\n');
          }
          const left = until - Date.now();
          if (left <= 0) break;
          await this.nudge(left);
        }
        this.setState(a, 'working', '');
        return '(chưa có ai trả lời — làm tiếp phần khác, hoặc chờ thêm, hoặc ghi giả định vào note)';
      }
      case 'skill': {
        const dept = isDept(args.dept) ? args.dept : a.dept;
        const prof = this.profile(dept);
        const q = String(args.name ?? '').trim().toLowerCase();
        if (!q) return prof.skills.length ? prof.skills.map((s) => `- ${s.id} — ${s.name}: dùng khi ${s.when}`).join('\n') : 'Phòng này chưa có kỹ năng nào.';
        const s = prof.skills.find((x) => x.id === q || x.name.toLowerCase() === q) ?? prof.skills.find((x) => x.id.includes(q) || x.name.toLowerCase().includes(q));
        if (!s) throw new Error(`không có kỹ năng "${q}" — có: ${prof.skills.map((x) => x.id).join(', ')}`);
        return `# ${s.name}\nDùng khi: ${s.when}\n\n${s.body}`;
      }
      case 'tasks': {
        const dept = isDept(args.dept) ? args.dept : a.dept;
        const list = [...tasks.values()]
          .filter((t) => (args.all ? t.col !== 'done' : t.col !== 'done' && (t.dept === dept || t.assignee === a.p.id)))
          .sort((x, y) => PRIO_ORDER[x.priority] - PRIO_ORDER[y.priority] || x.createdAt - y.createdAt)
          .slice(0, 30);
        if (!list.length) return `Không có việc nào đang mở cho phòng ${DEPT_BY_ID.get(dept)!.name}.`;
        return list
          .map((t) => `#${short(t.id)} [${t.col}] ${t.title}${t.dept ? ` · ${DEPT_BY_ID.get(t.dept)!.name}` : ''}${t.priority !== 'normal' ? ` · ${PRIORITY_META[t.priority].label}` : ''}${t.assignee ? ` · ${t.assignee === a.p.id ? 'bạn đang làm' : `${this.nameOf(t.assignee) ?? 'đã có người nhận'}`}` : ''}`)
          .join('\n');
      }
      case 'task_get': {
        const t = await this.findTask(args.id);
        return `#${short(t.id)} [${t.col}] ${t.title}\nPhòng: ${t.dept ? DEPT_BY_ID.get(t.dept)!.name : '—'} · Ưu tiên: ${PRIORITY_META[t.priority].label} · Bàn giao lần thứ ${t.hops ?? 0}\n\n${t.desc || '(không có mô tả)'}`;
      }
      case 'task_claim': {
        const t = await this.findTask(args.id);
        if (t.col === 'done') throw new Error('việc này đã xong');
        if (t.assignee && t.assignee !== a.p.id) throw new Error('việc này đã có người nhận');
        t.assignee = a.p.id;
        t.col = 'doing';
        t.updatedAt = Date.now();
        a.p.taskId = t.id;
        await this.host.saveTask(t, a.p.id);
        return `Đã nhận #${short(t.id)}: ${t.title}\n\n${t.desc}`;
      }
      case 'task_update': {
        const t = await this.findTask(args.id);
        const col = String(args.col ?? '') as TaskColumn;
        const note = clampStr(String(args.note ?? ''), 1200);
        if (!['todo', 'doing', 'review', 'done', ''].includes(col)) throw new Error('col phải là todo / doing / review / done');
        if (!col && !note) throw new Error('cần col hoặc note');
        const was = t.col;
        if (note) t.desc = this.appendNote(t.desc, a.name, note);
        if (col) {
          t.col = col;
          if (col === 'todo') t.assignee = null;
          else if (!t.assignee) t.assignee = a.p.id;
          t.doneAt = col === 'done' ? Date.now() : null;
        }
        t.updatedAt = Date.now();
        await this.host.saveTask(t, a.p.id);
        if (col === 'done' && was !== 'done') await this.host.systemChat(`🎉 ${a.name} vừa hoàn thành “${t.title}”`);
        if (col === 'review' && was !== 'review') await this.notice(`👀 ${a.name} đã làm xong “${t.title}”, nhờ mọi người xem lại trên Kanban nhé.`);
        return `Đã cập nhật #${short(t.id)} → ${t.col}.`;
      }
      case 'handoff': {
        const dept = args.dept;
        if (!isDept(dept)) throw new Error(`dept phải là một trong: ${DEPTS.map((d) => d.id).join(', ')}`);
        const title = clampStr(String(args.title ?? ''), 140);
        if (!title) throw new Error('thiếu title');
        const details = clampStr(String(args.details ?? ''), 1700);
        const from = args.from_task ? await this.findTask(args.from_task) : a.p.taskId ? tasks.get(a.p.taskId) : undefined;
        const hops = (from?.hops ?? 0) + 1;
        const d = DEPT_BY_ID.get(a.dept)!;
        const task = await this.createTask(
          a,
          dept,
          title,
          `Bàn giao từ ${a.name} (${d.icon} ${d.name})${from ? ` — tiếp nối #${short(from.id)} “${from.title}”` : ''}:\n${details}`,
          (typeof args.priority === 'string' && args.priority in PRIORITY_META ? args.priority : from?.priority) as Priority | undefined,
          hops,
        );
        const to = DEPT_BY_ID.get(dept)!;
        await this.notice(
          hops > MAX_HOPS
            ? `📨 ${a.name} muốn chuyển “${title}” cho bên ${to.name}, nhưng việc này đã qua tay quá nhiều lần — cần một người xem giúp trước.`
            : `📨 ${a.name} vừa chuyển việc “${title}” cho bên ${to.name}.`,
        );
        return `Đã bàn giao #${short(task.id)} cho phòng ${to.name}.${hops > MAX_HOPS ? ' Việc này đã qua quá nhiều lần bàn giao nên sẽ chờ người duyệt thay vì tự chạy.' : ''}`;
      }
      case 'meeting_call': {
        if (a.meet && this.meetings.some((x) => x.id === a.meet && !x.endedAt)) throw new Error('bạn đang ở trong một cuộc họp rồi');
        const topic = clampStr(String(args.topic ?? ''), 120);
        if (!topic) throw new Error('thiếu topic');
        const depts = [...new Set((Array.isArray(args.depts) ? args.depts : []).filter(isDept))].slice(0, 5);
        if (!depts.length) throw new Error('cần mời ít nhất một phòng (depts)');
        if (a.depth >= MAX_CALL_DEPTH) throw new Error('phiên này được gọi qua quá nhiều tầng — không tổ chức họp mới, hãy nhờ người');
        const m = await this.openMeeting(a.p.name, topic, clampStr(String(args.agenda ?? ''), 600), depts, a);
        const room = MEET_ROOMS.find((r) => r.id === m.room)!.name;
        return `Đã mở cuộc họp ở ${room}. Đã mời: ${depts.map((d) => DEPT_BY_ID.get(d)!.name).join(', ')} (máy trực sẽ cử người tới trong khoảng 15–60 giây). Bắt đầu bằng meeting_say giới thiệu mục tiêu, rồi meeting_wait để nghe.`;
      }
      case 'meeting_wait': {
        const m = this.myMeeting(a);
        const until = Date.now() + Math.max(5, Math.min(45, Number(args.seconds) || 30)) * 1000;
        for (;;) {
          const lines = m.lines.filter((l) => l.ts > a.meetTs && l.from !== a.p.id);
          // someone arriving only matters to the chair; everyone else waits for words
          const news = lines.some((l) => l.from !== 'system' || m.host === a.p.id);
          if (news || m.endedAt) {
            a.meetTs = Math.max(a.meetTs, ...m.lines.map((l) => l.ts));
            const head = `Cuộc họp “${m.topic}” — có mặt: ${m.members.map((x) => x.name).join(', ') || '—'}${m.waiting.length ? ` · đang chờ: ${m.waiting.map((d) => DEPT_BY_ID.get(d)!.name).join(', ')}` : ''}`;
            const body = lines.map((l) => `[${this.time(l.ts)}] ${l.name}: ${l.text}`).join('\n');
            return `${head}\n${body}${m.endedAt ? `\n\nĐÃ KẾT THÚC. Biên bản: ${m.summary}\nViệc của bạn trong cuộc họp đã xong — nộp debrief nếu có bài học rồi dừng.` : ''}`;
          }
          const left = until - Date.now();
          if (left <= 0) return `(chưa ai nói thêm) — có mặt: ${m.members.map((x) => x.name).join(', ')}${m.waiting.length ? ` · đang chờ: ${m.waiting.map((d) => DEPT_BY_ID.get(d)!.name).join(', ')}` : ''}`;
          await this.nudge(left);
        }
      }
      case 'meeting_say': {
        const m = this.myMeeting(a);
        if (m.endedAt) throw new Error('cuộc họp đã kết thúc');
        const text = clampStr(String(args.text ?? ''), 600);
        if (!text) throw new Error('trống');
        await this.say(a, text, 'work', m.id);
        await this.meetLine(m, a.p.id, a.p.name, text);
        a.meetTs = Date.now();
        return 'Đã nói.';
      }
      case 'meeting_end': {
        const m = this.myMeeting(a);
        if (m.endedAt) return `Cuộc họp đã kết thúc: ${m.summary}`;
        if (m.host && m.host !== a.p.id && this.agents.has(m.host)) throw new Error('chỉ chủ trì được kết thúc cuộc họp');
        const summary = clampStr(String(args.summary ?? ''), 1200);
        if (!summary) throw new Error('thiếu summary');
        const actions = (Array.isArray(args.actions) ? args.actions : [])
          .map((x) => (x && typeof x === 'object' ? (x as Json) : {}))
          .filter((x) => isDept(x.dept) && typeof x.title === 'string' && x.title.trim())
          .map((x) => ({ dept: x.dept as DeptId, title: String(x.title), details: String(x.details ?? ''), priority: x.priority as Priority | undefined }));
        const made = await this.endMeeting(m, summary, actions, a);
        return `Đã kết thúc cuộc họp${made.length ? ` và tạo ${made.length} việc: ${made.map((t) => `#${short(t.id)} ${t.title}`).join('; ')}` : ''}.`;
      }
      case 'lessons': {
        const dept = isDept(args.dept) ? args.dept : null;
        const q = String(args.query ?? '').toLowerCase();
        const list = (await db.listLessons(this.host.DB)).filter((l) => (!dept || l.dept === dept || l.dept === 'all') && (!q || l.text.toLowerCase().includes(q) || l.project.toLowerCase().includes(q)));
        if (!list.length) return 'Sổ kinh nghiệm chưa có mục nào khớp.';
        return list
          .slice(0, 80)
          .map((l) => `[${l.id.slice(0, 8)}] (${l.dept === 'all' ? 'chung' : l.dept}${l.project ? `/${l.project}` : ''}) ${l.text}`)
          .join('\n');
      }
      case 'debrief': {
        const summary = clampStr(String(args.summary ?? ''), DEBRIEF_MAX);
        if (summary.length < 20) throw new Error('tóm tắt quá ngắn');
        const lessons = Array.isArray(args.lessons) ? args.lessons.map((x) => clampStr(String(x), 300)).filter(Boolean).slice(0, 8) : [];
        const text = clampStr(`${summary}${lessons.length ? `\n\nBài học:\n${lessons.map((l) => `- ${l}`).join('\n')}` : ''}`, DEBRIEF_MAX);
        const d: Debrief = { id: crypto.randomUUID(), agent: a.p.id, agentName: a.name, dept: a.dept, project: clampStr(String(args.project ?? a.p.agent?.project ?? ''), 40), text, at: Date.now() };
        await db.addDebrief(this.host.DB, d, a.owner);
        void this.pushBook();
        return 'Đã nộp tóm tắt. Ban điều hành sẽ đúc rút vào sổ kinh nghiệm.';
      }
      case 'debriefs_pending': {
        this.lead(a);
        const list = await db.pendingDebriefs(this.host.DB, Math.max(1, Math.min(60, Number(args.limit) || 30)));
        if (!list.length) return 'Không có bản tóm tắt nào đang chờ.';
        return list.map((d) => `### [${d.id}] ${d.agentName} · ${d.dept}${d.project ? ` · ${d.project}` : ''} · ${new Date(d.at).toISOString().slice(0, 10)}\n${d.text}`).join('\n\n');
      }
      case 'lesson_save': {
        this.lead(a);
        const dept = args.dept === 'all' || isDept(args.dept) ? (args.dept as DeptId | 'all') : null;
        if (!dept) throw new Error('dept phải là "all" hoặc mã phòng ban');
        const text = clampStr(String(args.text ?? ''), LESSON_MAX);
        if (text.length < 8) throw new Error('bài học quá ngắn');
        let id: string = crypto.randomUUID();
        if (args.replace_id) {
          const q = String(args.replace_id);
          const hit = (await db.listLessons(this.host.DB)).find((l) => l.id.startsWith(q));
          if (!hit) throw new Error(`không có bài học ${q}`);
          id = hit.id;
        }
        const lesson: Lesson = { id, dept, project: clampStr(String(args.project ?? ''), 40), text, by: a.name, at: Date.now() };
        await db.saveLesson(this.host.DB, lesson);
        void this.pushBook();
        return `Đã lưu bài học [${id.slice(0, 8)}].`;
      }
      case 'lesson_retire': {
        this.lead(a);
        const q = String(args.id ?? '');
        const hit = (await db.listLessons(this.host.DB)).find((l) => q.length >= 4 && l.id.startsWith(q));
        if (!hit) throw new Error(`không có bài học ${q}`);
        await db.deleteLesson(this.host.DB, hit.id);
        void this.pushBook();
        return 'Đã gỡ bài học.';
      }
      case 'debriefs_done': {
        this.lead(a);
        const ids = Array.isArray(args.ids) ? args.ids.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100) : [];
        const n = await db.finishDebriefs(this.host.DB, ids, Date.now());
        void this.pushBook();
        return `Đã đánh dấu ${n} bản tóm tắt là đã xử lý.`;
      }
      default:
        throw new Error(`không có tool ${name}`);
    }
  }
}

/** What a permission request is about, in one line, and what "allow for the whole session" covers. */
function describeAction(tool: string, input: Record<string, unknown>): { summary: string; key: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (tool) {
    case 'Bash': {
      const cmd = str(input.command).trim().replace(/[A-Za-z0-9_\-]{32,}/g, '•••');
      return { summary: `$ ${clampStr(cmd, 300)}${str(input.description) ? `  (${clampStr(str(input.description), 80)})` : ''}`, key: `Bash:${cmd.split(/\s+/).slice(0, 2).join(' ')}` };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return { summary: `${tool === 'Write' ? 'Viết' : 'Sửa'} ${clampStr(str(input.file_path) || str(input.notebook_path), 200)}`, key: 'edit' };
    case 'WebFetch': {
      let host = '';
      try {
        host = new URL(str(input.url)).hostname;
      } catch {
        /* ignore */
      }
      return { summary: `Đọc web ${clampStr(str(input.url), 200)}`, key: `WebFetch:${host}` };
    }
    case 'WebSearch':
      return { summary: `Tìm trên web “${clampStr(str(input.query), 120)}”`, key: 'WebSearch' };
    default:
      return { summary: `${tool} ${clampStr(JSON.stringify(input), 200)}`, key: tool };
  }
}
