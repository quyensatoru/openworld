// 🧠 Tổng quản — the office's one orchestrator. See shared/brain.ts for the contract.
//
// It owns the front door. A person's request never starts a department session directly any more:
// it lands in this queue, one short model call decides what happens to it, and only then — if the
// work really needs a repo — does a department session start. Deciding costs a few seconds and a
// few thousand tokens; doing costs a whole `claude -p` in the project, so everything that can be
// settled by deciding is settled here.
//
// The call itself runs on the on-call machine (it has the Claude login), but the office writes the
// prompt and parses the answer: the runner only shuttles text, so all the judgement about what is
// worth asking and what is worth answering lives in this file.
import {
  APPROVE_WAIT_MS,
  BRAIN_ASK_TTL,
  BRAIN_DECIDE_MS,
  BRAIN_ID,
  BRAIN_KEEP_MS,
  BRAIN_LEASE_MS,
  BRAIN_LIMITS,
  BRAIN_MAX_TRIES,
  BRAIN_NAME,
  BRAIN_REPORT_MS,
  DEFAULT_BRAIN,
  RATE_REASON_MAX,
  REPORT_PREFIX,
  ROUND_LIMITS,
  parseDecision,
  parseReport,
  parseVerdict,
  sanitizeBrainConfig,
  type BrainBudget,
  type BrainConfig,
  type BrainDecision,
  type BrainItem,
  type BrainJob,
  type BrainLease,
  type BrainLog,
  type BrainParcel,
  type BrainSource,
  type BrainVerdict,
  type BrainView,
  type ImproveRound,
} from '../shared/brain';
import { DEPTS, DEPT_BY_ID, isDept, lessonFits, rankLessons, type Debrief, type DeptId, type Lesson, type RunnerMachine } from '../shared/agents';
import { PRIORITY_META, clampStr, settled, type ActivityEvent, type ChatMsg, type Priority, type ServerMsg, type Task } from '../shared/protocol';
import * as db from './db';

export interface BrainHost {
  DB: D1Database;
  storage: DurableObjectStorage;
  tz: number;
  broadcast(msg: ServerMsg): void;
  sendTo(id: string, msg: ServerMsg): void;
  getTasks(): Promise<Map<string, Task>>;
  saveTask(task: Task, by: string): Promise<void>;
  chat(m: ChatMsg): Promise<void>;
  userName(uid: string): Promise<string>;
  wakeAt(ms: number): Promise<void>;
  pushActivity(id: string, ev: ActivityEvent): Promise<void>;
  /** the departments' sessions working right now */
  atWork(): { dept: DeptId; name: string; what: string }[];
  /** does any on-call machine take work from this person? */
  canAssign(uid: string): boolean;
  /** why not, in words */
  noRightMsg(): string;
  /** remember who a task is answerable to */
  setTaskOrigin(taskId: string, uid: string): void;
  /** …and who it is answerable to now (the thread a running session listens in) */
  taskOrigin(t: Task): string;
  /** put the orchestrator at (or take it from) its desk in the 3D office */
  showBrain(online: boolean, what: string): Promise<void>;
  /** the on-call machines seen in the last few minutes */
  machines(): RunnerMachine[];
  /** …plus the ones gone quiet lately, and how many sessions each runs (for the 🧠 panel) */
  machinesView(): RunnerMachine[];
  /** times the sessions working on a task broke down */
  taskFails(id: string): number;
  /** stopped after breaking down too often, waiting for a person (not finished work) */
  parked(t: Task): boolean;
  /** cards in a thread that stopped after breaking down go back to To do; returns them */
  revive(root: string, by: string): Promise<Task[]>;
}

/** One action a session wants to take, waiting for Tổng quản's judgement. */
interface Check {
  id: string;
  at: number;
  state: 'pending' | 'thinking' | 'done';
  lease?: BrainLease;
  system: string;
  prompt: string;
  verdict?: BrainVerdict | null;
}

/** What Tổng quản is told about an action it must judge. */
export interface CheckRequest {
  agentName: string;
  dept: DeptId;
  project: string;
  task: Task | null;
  tool: string;
  summary: string;
  /** 'review' = ordinary but not obviously safe · 'danger' = hard to undo, or leaves the machine */
  risk: 'review' | 'danger';
  /** the department profile's own rules (what it may edit, which commands) */
  lane: string;
}

const HOUR = 3600_000;
/** What each department owns, and where its work stops. The departments' own briefs (shared/agents.ts)
 *  say what an employee is; these say which parcel belongs to whom, which is all the orchestrator
 *  needs — one list, so the two can never contradict each other in the same prompt. `lead` is left
 *  out on purpose: splitting work is this file's job, and routing to it costs a second session. */
const OWNS: Partial<Record<DeptId, string>> = {
  dev: 'mọi thay đổi code sản phẩm, kể cả sửa lỗi. Chỉ dev được sửa code.',
  qa: 'chạy test/build, tìm lỗi, kết luận đạt hay không đạt. Không sửa code sản phẩm.',
  ops: 'build, deploy, hạ tầng, sự cố production. Chỉ ops được deploy.',
  design: 'giao diện, CSS, bố cục, chữ hiển thị. Không sửa logic hay dữ liệu.',
  docs: 'README, hướng dẫn, changelog, ghi chú kỹ thuật — chỉ sửa file tài liệu.',
  biz: 'làm rõ yêu cầu mơ hồ, viết spec, soạn câu trả lời khách. Không đụng vào code.',
};
const oneLine = (s: string, n: number) => clampStr(String(s ?? '').replace(/\s+/g, ' '), n);
const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8);
/** The last note appended to a card ("— Ai (dd/mm hh:mm): …"), without who and when. */
const lastNote = (desc: string) => {
  const i = desc.lastIndexOf('\n\n— ');
  return i < 0 ? '' : desc.slice(i + 4).replace(/^[^\n]*?\(\d\d\/\d\d [^)]*\):\s*/, '');
};
/** A claim on something to think about: who holds it, until when, and a fresh tag for this very claim. */
const claim = (by: string, until: number): BrainLease => ({ by, until, tag: crypto.randomUUID().slice(0, 8) });
/** Is this answer for the claim that is out right now? `tag` is what the runner sent back with it
 *  (runners from before tags send none: then holding the claim is all that can be checked). */
const holds = (lease: BrainLease | undefined, uid: string, tag: string) => !!lease && lease.by === uid && (!tag || !lease.tag || lease.tag === tag);
/** The same person saying the same thing twice in this window is one request. */
const DEDUPE_MS = 10 * 60_000;
/** Claude unreachable: wait this long before thinking the same request again (doubles, capped). */
const RETRY_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
/** Work can take days; its request is kept until its report went out, at most this long. */
const REPORT_KEEP_MS = 7 * 86400_000;
/** A report nobody's machine could write for this long goes out as a plain list instead. */
const REPORT_FALLBACK_MS = 15 * 60_000;

export class Brain {
  private items: BrainItem[] = [];
  private logs: BrainLog[] = [];
  private cfg: BrainConfig = { ...DEFAULT_BRAIN };
  /** when department sessions started, and on whose behalf */
  private sessions: { at: number; origin: string }[] = [];
  /** when decisions were made */
  private thoughts: number[] = [];
  /** last time a machine asked for a decision to make */
  private served = 0;
  /** people with the 🧠 panel open */
  private watchers = new Set<string>();
  /** actions sessions are waiting to have judged (in memory: a session waits at most a minute) */
  private checks: Check[] = [];
  /** runners long-polling for something to think about */
  private waiters = new Set<() => void>();
  /** improvement rounds, newest first, mirrored from D1 (null = not read yet) */
  private rounds: ImproveRound[] | null = null;
  /** a round is being opened right now (a double click opens one, not two) */
  private opening = false;

  constructor(private host: BrainHost) {}

  /** Wake every runner waiting for a thought. */
  private kick() {
    for (const w of [...this.waiters]) w();
    this.waiters.clear();
  }

  private nap(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.waiters.add(done);
    });
  }

  async restore(): Promise<void> {
    const s = this.host.storage;
    this.items = (await s.get<BrainItem[]>('brainItems')) ?? [];
    this.logs = (await s.get<BrainLog[]>('brainLogs')) ?? [];
    this.cfg = sanitizeBrainConfig(await s.get('brainConfig'));
    this.sessions = (await s.get<{ at: number; origin: string }[]>('brainSessions')) ?? [];
    // a decision claimed before a restart is nobody's now
    for (const it of this.items) {
      if (it.state === 'thinking') ((it.state = 'pending'), (it.lease = undefined));
      if (it.report === 'thinking') ((it.report = 'pending'), (it.reportLease = undefined));
    }
  }

  private save() {
    void this.host.storage.put('brainItems', this.items).catch(() => {});
  }

  private saveLogs() {
    void this.host.storage.put('brainLogs', this.logs.slice(-60)).catch(() => {});
  }

  config(): BrainConfig {
    return this.cfg;
  }

  /** A machine is serving the orchestrator (it asked for work in the last few minutes). */
  online(): boolean {
    return Date.now() - this.served < 3 * 60_000;
  }

  /** …and it can reach Claude right now (a machine waiting out an outage does not think). */
  thinking(): boolean {
    if (!this.online()) return false;
    const ms = this.host.machines();
    return !ms.length || ms.some((m) => !m.outage || m.outage.until < Date.now());
  }

  watch(uid: string) {
    this.watchers.add(uid);
    this.host.sendTo(uid, { t: 'brain', v: this.view() });
    if (!this.rounds) void this.allRounds().then((r) => r.length && this.push());
  }

  left(uid: string) {
    this.watchers.delete(uid);
  }

  view(): BrainView {
    return {
      config: this.cfg,
      // waiting to be decided, and — once decided — work still out until its report goes back
      // (claims stay in the office: a tag is what makes a runner's answer count)
      queue: this.items
        .filter((i) => i.state !== 'done' || i.report === 'wait' || i.report === 'pending' || i.report === 'thinking')
        .slice(-40)
        .map(({ lease, reportLease, ...i }) => i),
      recent: this.logs.slice(-25),
      budget: this.budget(),
      online: this.online(),
      machines: this.host.machinesView(),
      rounds: (this.rounds ?? []).slice(0, 8),
    };
  }

  /** Threads Tổng quản is still working on: deciding, asking, or waiting to report. */
  openRoots(): Set<string> {
    return new Set(this.items.filter((i) => i.root && (i.state !== 'done' || i.report === 'wait' || i.report === 'pending' || i.report === 'thinking')).map((i) => i.root));
  }

  /** Something in the office changed that the 🧠 panel shows. */
  refresh() {
    this.push();
  }

  private push() {
    const v = this.view();
    for (const id of this.watchers) this.host.sendTo(id, { t: 'brain', v });
  }

  async setConfig(v: unknown, by: string, byId: string) {
    this.cfg = sanitizeBrainConfig(v, this.cfg);
    await this.host.storage.put('brainConfig', this.cfg);
    const approvals = this.cfg.approvals === 'ask' ? 'mọi quyền đều hỏi chủ máy' : this.cfg.approvals === 'lead' ? 'Tổng quản tự duyệt quyền, chỉ hỏi người việc khó đảo ngược' : 'tự động hoàn toàn, không hỏi ai';
    await this.say(`⚙️ ${by} vừa chỉnh cách làm việc của Tổng quản: model ${this.cfg.model}, tối đa ${this.cfg.maxSessionsHour} phiên/giờ cho cả văn phòng, ${approvals}.`, Brain.thread(byId));
    this.push();
  }

  // ------------------------------------------------------------------ budget
  budget(): BrainBudget {
    const since = Date.now() - HOUR;
    const recent = this.sessions.filter((s) => s.at > since);
    const per = new Map<string, number>();
    for (const s of recent) per.set(s.origin, (per.get(s.origin) ?? 0) + 1);
    return {
      sessionsHour: recent.length,
      thoughtsHour: this.thoughts.filter((t) => t > since).length,
      throttled: [...per.entries()].filter(([, n]) => n >= this.cfg.maxPerPersonHour).map(([id]) => id),
    };
  }

  /** May a department session start now for work that `origin` asked for? */
  mayStart(origin: string): boolean {
    const b = this.budget();
    if (b.sessionsHour >= this.cfg.maxSessionsHour) return false;
    if (!origin || origin === 'system') return true;
    return !b.throttled.includes(origin);
  }

  /** A department session just started — it counts against the hour. */
  noteSession(origin: string) {
    const now = Date.now();
    this.sessions = [...this.sessions.filter((s) => now - s.at < 2 * HOUR), { at: now, origin: origin || 'system' }];
    void this.host.storage.put('brainSessions', this.sessions).catch(() => {});
    this.push();
  }

  // ------------------------------------------------------------------ improvement rounds
  /** The rounds, newest first — read from D1 the first time they are needed. */
  private async allRounds(): Promise<ImproveRound[]> {
    if (!this.rounds) this.rounds = await db.listRounds(this.host.DB, 20).catch(() => null);
    return this.rounds ?? [];
  }

  private day(ms: number) {
    const d = new Date(ms + this.host.tz * 60_000);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** What a round did, read off its cards: one line each — department, title, state, and the last
   *  note (where results are written). null = its cards are gone from the board. */
  private roundOf(r: ImproveRound, tasks: Map<string, Task>): { summary: string; closed: boolean } | null {
    const cards = [...tasks.values()].filter((t) => r.tasks.includes(t.id) || (r.root && t.thread === r.root && t.createdAt >= r.at)).sort((a, b) => a.createdAt - b.createdAt);
    if (!cards.length) return null;
    const state = (t: Task) => (t.col === 'done' ? 'xong' : t.col === 'review' ? 'chờ duyệt' : t.col === 'doing' ? 'đang làm' : 'chưa làm');
    const lines = cards.map((t) => {
      const note = lastNote(t.desc);
      return oneLine(`${t.dept ? DEPT_BY_ID.get(t.dept)!.short : '?'} #${shortId(t.id)} ${t.title} [${state(t)}]${note ? `: ${note}` : ''}`, ROUND_LIMITS.line);
    });
    return { summary: clampStr(lines.join('\n'), ROUND_LIMITS.summary), closed: cards.every((t) => settled(t) && !this.host.parked(t)) };
  }

  /** Rounds still running take what their cards say now; a round's text outlives its cards in D1. */
  private async refreshRounds(tasks: Map<string, Task>): Promise<void> {
    let changed = false;
    for (const r of await this.allRounds()) {
      if (r.closed) continue;
      const now = this.roundOf(r, tasks);
      const next = now ?? { summary: r.summary, closed: true };
      if (next.summary === r.summary && next.closed === r.closed) continue;
      Object.assign(r, next);
      await db.saveRound(this.host.DB, r, Date.now()).catch(() => {});
      changed = true;
    }
    if (changed) this.push();
  }

  /** Earlier rounds in this project, for a new round's cards and for Tổng quản's prompt. */
  private history(rounds: ImproveRound[], project: string, perRound: number): string[] {
    return rounds
      .filter((r) => !project || !r.project || r.project === project)
      .slice(0, ROUND_LIMITS.history)
      .map((r) => `Vòng ${this.day(r.at)}${r.project ? ` (${r.project})` : ''}${r.closed ? '' : ' — đang chạy'}:\n${clampStr(r.summary || '(chưa có kết quả)', perRound)}`);
  }

  /**
   * "Vòng cải tiến mới" (the 🧠 panel). The same split as a person asking for one in words, without a
   * decision to pay for: QA looks for bugs and Biz ranks improvements at the same time, Dev waits
   * for both and does the top of each. Every card carries what earlier rounds did, so nothing is
   * proposed twice, and the person who pressed it gets the one 📋 report when all three are done.
   */
  async startRound(uid: string, whoName: string, rawProject: unknown): Promise<void> {
    const err = (msg: string) => this.host.sendTo(uid, { t: 'err', msg });
    if (!this.host.canAssign(uid)) return err(this.host.noRightMsg());
    const projects = this.projects();
    const want = typeof rawProject === 'string' ? rawProject.trim() : '';
    const project = want ? projects.find((p) => p === want) : projects.length <= 1 ? (projects[0] ?? '') : undefined;
    if (project === undefined) return err(want ? `Không có máy trực nào đang làm ở dự án ${clampStr(want, 60)}.` : 'Có nhiều dự án đang có máy trực — chọn dự án cho vòng cải tiến.');
    if (this.opening) return;
    this.opening = true;
    try {
      const tasks = await this.host.getTasks();
      await this.refreshRounds(tasks);
      const rounds = await this.allRounds();
      const open = rounds.find((r) => !r.closed && r.project === project);
      if (open) return err(`Vòng cải tiến ngày ${this.day(open.at)}${project ? ` của ${project}` : ''} vẫn đang chạy — xong vòng đó rồi mở vòng mới nhé.`);
      const now = Date.now();
      const id = crypto.randomUUID();
      const root = crypto.randomUUID();
      const where = project ? ` cho dự án ${project}` : '';
      const hist = this.history(rounds, project, Math.floor(ROUND_LIMITS.historyChars / ROUND_LIMITS.history));
      const done = hist.length ? hist.join('\n') : '(chưa có vòng nào trước đây)';
      await this.host.chat({ id: root, ch: Brain.thread(uid), from: BRAIN_ID, name: `🧠 ${BRAIN_NAME}`, text: `🔁 ${whoName} mở vòng cải tiến mới${where}: Kiểm thử rà lỗi và Kinh doanh xếp ưu tiên cải tiến chạy song song, Phát triển làm các mục ưu tiên nối sau. Xong hết mình báo kết quả trong luồng này.`, ts: now });
      const it: BrainItem = { id: crypto.randomUUID(), source: 'chat', who: uid, whoName, text: `Vòng cải tiến mới${where}`, root, at: now, followUps: [], state: 'done', tries: 0, round: id };
      const plan: BrainParcel[] = [
        {
          dept: 'qa',
          title: `Vòng cải tiến: rà lỗi${where}`,
          desc: `Vòng cải tiến mới do ${whoName} mở. Phần của Kiểm thử: rà lỗi dự án — chạy các bộ test/kiểm tra sẵn có, thử các luồng chính (cả trên điện thoại nếu có giao diện), đọc lại các thay đổi gần đây. Ghi vào note danh sách lỗi theo mức độ (Cao/Trung bình/Thấp), mỗi lỗi: cách tái hiện, file/khu vực nghi ngờ. Không sửa code. KHÔNG handoff Phát triển: việc của Phát triển đã xếp nối sau phần này và sẽ đọc note của bạn. Kinh doanh đang xếp ưu tiên cải tiến song song.\n\nCác vòng trước đã làm (lỗi đã sửa thì chỉ báo lại nếu tái phát):\n${done}`,
          priority: 'normal',
          after: [],
        },
        {
          dept: 'biz',
          title: `Vòng cải tiến: xếp ưu tiên cải tiến, tính năng mới${where}`,
          desc: `Vòng cải tiến mới do ${whoName} mở. Phần của Kinh doanh & CSKH: đánh giá sản phẩm, chọn 3–5 cải tiến hoặc tính năng mới đáng làm nhất và xếp theo ưu tiên. Mỗi mục: tên ngắn, vì sao (đau thực tế của người dùng), tiêu chí chấp nhận kiểm được, ngoài phạm vi. Ghi danh sách vào note của việc này. KHÔNG đề xuất lại những gì các vòng trước đã làm (bên dưới). KHÔNG handoff Phát triển: việc của Phát triển đã xếp nối sau và sẽ đọc note của bạn. Kiểm thử đang rà lỗi song song.\n\nCác vòng trước đã làm:\n${done}`,
          priority: 'normal',
          after: [],
        },
        {
          dept: 'dev',
          title: `Vòng cải tiến: sửa lỗi QA và làm các mục ưu tiên của Biz${where}`,
          desc: `Phần này nối sau hai việc của cùng vòng: Kiểm thử rà lỗi ({QA}) và Kinh doanh xếp ưu tiên ({BIZ}) — đọc note của chúng bằng task_get. Sửa các lỗi Kiểm thử ghi (Cao trước), rồi làm các mục Kinh doanh xếp ưu tiên theo thứ tự; mỗi mục xong thì bàn giao Kiểm thử kiểm theo tiêu chí. Không deploy, không push. Mục nào quá lớn thì làm phần đầu và ghi rõ phần còn lại vào note.\n\nCác vòng trước đã làm (đừng làm lại):\n${done}`,
          priority: 'normal',
          after: [0, 1],
        },
      ];
      const made = await this.dispatch(it, { action: 'route', reply: '', project, plan });
      if (made.length !== plan.length) return err('Chưa tạo được đủ việc cho vòng cải tiến, bạn thử lại nhé.');
      // the Dev card names the two it waits for, so the session reads their notes
      const [qa, biz, dev] = made;
      dev.desc = dev.desc.replace('{QA}', `#${shortId(qa.id)}`).replace('{BIZ}', `#${shortId(biz.id)}`);
      await this.host.saveTask(dev, BRAIN_ID);
      it.tasks = made.map((t) => t.id);
      it.project = made[0].project;
      it.report = 'wait';
      this.items.push(it);
      this.save();
      const round: ImproveRound = { id, project: it.project ?? project, at: now, byName: whoName, root, tasks: it.tasks, summary: '', closed: false };
      this.rounds = [round, ...rounds].slice(0, 20);
      await db.saveRound(this.host.DB, round, now).catch(() => {});
      await this.log(it, { action: 'route', reply: `Mở vòng cải tiến: ${made.map((t) => `#${shortId(t.id)} ${DEPT_BY_ID.get(t.dept!)!.short}`).join(', ')}` }, made.map((t) => t.dept!));
      this.push();
    } finally {
      this.opening = false;
    }
  }

  // ------------------------------------------------------------------ the front door
  /** The channel a person and the AI talk in, just the two of them. */
  static thread(uid: string) {
    return `ask:${uid}`;
  }

  /** A person said something to the AI. `root` opens (or continues) the thread it is discussed in. */
  async request(who: string, whoName: string, text: string, root: string, source: BrainSource = 'chat', taskId?: string): Promise<void> {
    const body = oneLine(text, 1500);
    if (!body) return;
    const now = Date.now();
    // a reply inside a thread we asked a question in is the answer, not a new request
    // (only from the person it was asked of: someone else talking in the same thread is not the answer)
    const asked = this.items.find((i) => i.state === 'asked' && i.who === who && (i.root === root || root === ''));
    if (asked && source === 'chat') {
      const open = asked.followUps[asked.followUps.length - 1];
      if (open && !open.a) open.a = body;
      else asked.followUps.push({ q: '', a: body });
      asked.state = 'pending';
      asked.at = now;
      this.save();
      this.push();
      this.kick(); // a runner long-polling for a thought takes it now, not when its wait runs out
      await this.host.wakeAt(now + 10_000);
      return;
    }
    if (!this.host.canAssign(who)) {
      await this.say(this.host.noRightMsg(), Brain.thread(who), root);
      return;
    }
    // the same card edited twice, or the same sentence sent twice, is one request — not two decisions
    const dupe = this.items.find((i) => i.state !== 'done' && (taskId ? i.taskId === taskId : i.who === who && now - i.at < DEDUPE_MS && i.text === body));
    if (dupe) {
      if (dupe.state === 'pending') dupe.text = body;
      this.save();
      return;
    }
    this.items.push({ id: crypto.randomUUID(), source, who, whoName, text: body, taskId, root, at: now, followUps: [], state: 'pending', tries: 0 });
    // the log is capped, but a request whose work is still out keeps its place until it is reported
    // (and so does one still waiting for its decision or for the person's answer)
    if (this.items.length > 120) this.items = this.items.filter((x, i, arr) => i >= arr.length - 120 || x.state !== 'done' || x.report === 'wait' || x.report === 'pending' || x.report === 'thinking');
    this.save();
    this.push();
    if (!this.online()) await this.say('Chưa có máy trực nào đang chạy Tổng quản, nên mình ghi lại đây và sẽ xử lý ngay khi có máy lên.', Brain.thread(who), root);
    else if (!this.thinking()) await this.say('Máy trực đang mất kết nối tới Claude. Mình giữ yêu cầu này lại và tự xử lý ngay khi có kết nối, bạn không cần nhắn lại.', Brain.thread(who), root);
    this.kick();
    await this.host.wakeAt(now + 10_000);
  }

  // ------------------------------------------------------------------ the runner's side
  /** Something to think about, or null — an action to judge first (a session is waiting on it), then
   *  a report (the person is waiting for it), then a decision. Claiming leases it, so two machines
   *  never think the same thought. With `waitMs` it waits that long for something to turn up. */
  async job(uid: string, waitMs = 0): Promise<BrainJob | null> {
    const until = Date.now() + Math.min(25_000, Math.max(0, waitMs));
    for (;;) {
      const j = await this.next(uid);
      if (j || Date.now() >= until) return j;
      await this.nap(until - Date.now());
    }
  }

  private async next(uid: string): Promise<BrainJob | null> {
    const now = Date.now();
    this.served = now;
    const c = this.checks.find((x) => x.state === 'pending');
    if (c) {
      c.state = 'thinking';
      c.lease = claim(uid, now + APPROVE_WAIT_MS);
      return { id: c.id, kind: 'approve', model: this.cfg.model, system: c.system, prompt: c.prompt, timeoutMs: APPROVE_WAIT_MS, lease: c.lease.tag };
    }
    const r = this.items.find((i) => i.report === 'pending' && (i.notBefore ?? 0) <= now);
    if (r) {
      r.report = 'thinking';
      r.reportLease = claim(uid, now + BRAIN_REPORT_MS + BRAIN_LEASE_MS);
      this.save();
      return { id: r.id, kind: 'report', model: this.cfg.model, system: this.reportSystem(), prompt: await this.reportPrompt(r), timeoutMs: BRAIN_REPORT_MS, lease: r.reportLease.tag };
    }
    const it = this.items.find((i) => i.state === 'pending' && (i.notBefore ?? 0) <= now);
    if (!it) {
      this.push();
      return null;
    }
    if (it.tries >= BRAIN_MAX_TRIES) {
      // out of tries: the person hears it (never a silent drop), and the machine gets the next one
      const reply = 'Mình vẫn chưa hiểu rõ yêu cầu này. Bạn mô tả lại giúp mình trong một câu: muốn kết quả cuối cùng là gì?';
      await this.say(reply, Brain.thread(it.who), it.root);
      await this.finish(it, { action: 'answer', reply }, []);
      return this.next(uid);
    }
    it.state = 'thinking';
    it.lease = claim(uid, now + BRAIN_DECIDE_MS + BRAIN_LEASE_MS);
    const lease = it.lease.tag;
    this.save();
    await this.host.showBrain(true, `nghĩ: ${oneLine(it.text, 40)}`);
    await this.host.pushActivity(BRAIN_ID, { ts: now, kind: 'prompt', icon: '🧠', text: `${it.whoName}: ${oneLine(it.text, 120)}` });
    this.push();
    return { id: it.id, kind: 'decide', model: this.cfg.model, system: await this.system(), prompt: await this.user(it), timeoutMs: BRAIN_DECIDE_MS, lease };
  }

  /** The machine brings back whatever the model printed — or that it could not reach Claude. */
  /** Idempotent: only the answer to the claim that is out right now (same machine, same `tag`) is
   *  applied. The runner re-sends an answer whose POST timed out, an answer can arrive after its claim
   *  ran out and the thing was handed out again, after the person answered a question and it went
   *  back in the queue, or after it was cancelled — none of those may count a second time. */
  async result(uid: string, id: string, raw: string, error = '', tag = ''): Promise<{ ok: boolean; error?: string }> {
    const stale = { ok: false, error: 'kết quả này đã nhận rồi hoặc không còn hiệu lực' };
    const c = this.checks.find((x) => x.id === id);
    if (c) {
      if (c.state === 'done') return { ok: true };
      if (c.state !== 'thinking' || !holds(c.lease, uid, tag)) return stale;
      const v = error ? null : parseVerdict(raw);
      if (!v && !error && c.verdict === undefined) {
        // one more go in the right shape, then the person decides
        c.verdict = null;
        c.state = 'pending';
        c.lease = undefined;
        this.kick();
        return { ok: false, error: 'không đọc được phán quyết (cần JSON)' };
      }
      c.verdict = v;
      c.state = 'done';
      this.kick();
      return { ok: true };
    }
    const it = this.items.find((x) => x.id === id);
    if (!it) return { ok: false, error: 'không còn yêu cầu này' };
    // (a report is only ever written for a request already decided, so the two never mix)
    if (it.report === 'thinking' && it.reportLease) {
      if (holds(it.reportLease, uid, tag)) return this.reported(it, error ? null : parseReport(raw), error);
      if (it.reportLease.by !== uid) return { ok: false, error: 'báo cáo này do máy khác viết' };
      return stale;
    }
    // only the claim that is out takes a decision: a retried POST, an error arriving after the answer
    // already landed, a request back in the queue (answered question, unreadable answer, lease ran out)
    // or one the person cancelled must never be decided again
    if (it.state === 'done') return { ok: true };
    if (it.state !== 'thinking' || !it.lease) return stale;
    if (it.lease.by !== uid) return { ok: false, error: 'yêu cầu này do máy khác nhận' };
    if (!holds(it.lease, uid, tag)) return stale;
    if (error) {
      // the machine could not reach Claude: that is not the request's fault, so it costs no try —
      // it waits a little (longer each time) and the person hears once that it is not forgotten
      it.state = 'pending';
      it.lease = undefined;
      it.fails = (it.fails ?? 0) + 1;
      it.notBefore = Date.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.min(5, it.fails - 1));
      this.save();
      this.push();
      if (it.fails === 2) await this.say('Kết nối tới Claude đang chập chờn nên mình chưa xử lý được. Yêu cầu của bạn vẫn được giữ, mình tự thử lại — bạn không cần nhắn lại.', Brain.thread(it.who), it.root);
      await this.host.wakeAt(it.notBefore);
      return { ok: true };
    }
    const d = parseDecision(raw);
    it.tries++;
    it.fails = 0;
    this.thoughts = [...this.thoughts.filter((t) => Date.now() - t < 2 * HOUR), Date.now()];
    if (!d) {
      // the model did not answer in the shape we asked for: back in the queue (tries caps it)
      it.state = 'pending';
      it.lease = undefined;
      this.save();
      this.push();
      this.kick();
      return { ok: false, error: 'không đọc được quyết định (cần JSON)' };
    }
    await this.apply(it, d);
    return { ok: true };
  }

  // ------------------------------------------------------------------ judging a session's action
  /** Ask Tổng quản whether a session may do something. Null = nobody could judge it in time. */
  async judge(r: CheckRequest): Promise<BrainVerdict | null> {
    if (!this.thinking()) return null;
    const c: Check = { id: crypto.randomUUID(), at: Date.now(), state: 'pending', system: this.judgeSystem(), prompt: await this.judgePrompt(r) };
    this.checks.push(c);
    this.kick();
    const until = Date.now() + APPROVE_WAIT_MS;
    while (c.state !== 'done' && Date.now() < until) await this.nap(Math.min(2000, until - Date.now()));
    this.checks = this.checks.filter((x) => x !== c && Date.now() - x.at < 5 * 60_000);
    if (c.state === 'done') this.thoughts = [...this.thoughts.filter((t) => Date.now() - t < 2 * HOUR), Date.now()];
    return c.state === 'done' ? (c.verdict ?? null) : null;
  }

  private judgeSystem(): string {
    return [
      `Bạn là ${BRAIN_NAME} — người điều phối của một văn phòng. Một nhân viên (một phiên Claude Code đang làm việc trong dự án) xin làm một thao tác mà hồ sơ phòng ban của họ chưa cho sẵn. Bạn duyệt thay chủ máy.`,
      '',
      'Trả về ĐÚNG MỘT object JSON, không viết gì ngoài nó:',
      '{"decision":"allow|deny|ask","session":false,"reason":"…"}',
      '',
      'Cách quyết:',
      '- "allow" khi thao tác cần cho đúng việc đang làm, đúng phần việc của phòng đó, và hỏng thì sửa lại được trên máy (đọc, chạy test/build/lint, cài thư viện của dự án, sửa file trong dự án, git commit/branch cục bộ).',
      '- Thao tác khó đảo ngược hoặc ra khỏi máy (push, deploy, xoá dữ liệu/nhánh, ghi vào DB thật, gửi tin/email/gọi API ghi dữ liệu, đổi secret, chạy với quyền root): CHỈ "allow" khi mô tả việc yêu cầu rõ đúng việc đó và đúng phòng được làm (deploy là việc của ops). Không rõ thì "ask".',
      '- "deny" khi thao tác lạc đề so với việc, vượt ranh giới phòng ban (ví dụ QA sửa code sản phẩm, docs sửa code), lộ bí mật, hoặc nguy hiểm mà việc không cần. Nói ngắn cách làm khác trong "reason".',
      '- "session": true chỉ khi cả loại thao tác này (cùng lệnh, khác tham số) an toàn cho suốt phiên — ví dụ chạy test, cài thư viện. Không bao giờ true cho thao tác khó đảo ngược.',
      '- Đọc kỹ cả lệnh: lệnh ghép bằng && ; | hay $( ) thì phần nguy hiểm nhất quyết định.',
      '- "reason": tiếng Việt, một câu, như đồng nghiệp nói với nhau.',
    ].join('\n');
  }

  private async judgePrompt(r: CheckRequest): Promise<string> {
    const lessons = rankLessons((await db.listLessons(this.host.DB).catch(() => [] as Lesson[])).filter((l) => lessonFits(l, { dept: r.dept, project: r.project }) && (l.dept === 'all' || l.dept === r.dept))).slice(0, 10);
    const t = r.task;
    return [
      `## Ai xin`,
      `${r.agentName} — phòng ${DEPT_BY_ID.get(r.dept)!.name}${r.project ? `, dự án ${r.project}` : ''}.`,
      r.lane ? `Hồ sơ phòng cho sẵn: ${r.lane}` : '',
      '',
      '## Việc đang làm',
      t ? `#${shortId(t.id)} ${t.title}\n${oneLine(t.desc, 1500)}` : '(không gắn với việc nào trên bảng)',
      lessons.length ? `\n## Sổ kinh nghiệm\n${lessons.map((l) => `- ${oneLine(l.text, 200)}`).join('\n')}` : '',
      '',
      '## Thao tác xin làm',
      `Công cụ: ${r.tool}`,
      r.summary,
      `Mức rủi ro hệ thống đánh giá: ${r.risk === 'danger' ? 'khó đảo ngược hoặc ra khỏi máy' : 'bình thường nhưng chưa chắc an toàn'}.`,
      '',
      'Trả về đúng một object JSON.',
    ]
      .filter((x) => x !== '')
      .join('\n');
  }

  // ------------------------------------------------------------------ the prompt
  private async system(): Promise<string> {
    const depts = DEPTS.filter((d) => OWNS[d.id])
      .map((d) => `- ${d.id} (${d.name}): ${OWNS[d.id]}`)
      .join('\n');
    return [
      `Bạn là ${BRAIN_NAME} — người điều phối duy nhất của một văn phòng. Bạn KHÔNG tự làm việc: bạn quyết định ai làm, và bảo vệ thời gian lẫn ngân sách của văn phòng.`,
      '',
      'Các phòng ban nhận việc — mỗi phần việc thuộc đúng MỘT phòng, không để hai phòng cùng làm một thứ:',
      depts,
      '',
      'Mỗi lượt bạn nhận MỘT yêu cầu và trả về ĐÚNG MỘT object JSON, không viết gì ngoài nó:',
      '{"action":"answer|route|ask|merge|drop","reply":"…","question":"…","mergeInto":"#abc12345","project":"tên-dự-án","plan":[{"dept":"dev","title":"…","desc":"…","priority":"normal","after":[]}]}',
      '',
      'Chọn action:',
      '- "answer" — trả lời được ngay bằng thông tin trong phần "Tình hình văn phòng" (ai đang làm gì, trên bảng có gì, việc xong chưa, giải thích cách văn phòng chạy). KHÔNG tốn phiên nào. Đây là mặc định cho mọi câu hỏi.',
      '- "route" — phải đọc hoặc sửa code, chạy test, viết tài liệu, deploy. Chia thành các phần, MỖI phần một phòng, theo đúng ranh giới ở trên.',
      '- "ask" — CHỈ khi thiếu một thông tin mà đoán sai thì giao nhầm phòng hoặc cả việc thành vô ích. Đúng MỘT câu hỏi, một dòng, trả lời được bằng một câu.',
      '- "merge" — yêu cầu này chính là việc đang chạy trên bảng. Ghi mã việc vào "mergeInto".',
      '- "drop" — không phải yêu cầu công việc (chào hỏi, đùa, nói với người khác). "reply" để trống.',
      '',
      'Chia việc cho đúng phòng (chỉ tạo phần việc mà phòng đó thật sự phải làm):',
      '- Sửa lỗi hay tính năng nhỏ: đúng MỘT phần cho dev. Đừng tự thêm phần qa — dev tự bàn giao Kiểm thử khi thấy cần.',
      '- Thay đổi lớn, dễ gây hồi quy, hoặc người gửi muốn kiểm kỹ: dev, rồi qa nối sau.',
      '- Phải đưa lên production: ops là phần CUỐI, nối sau dev (và sau qa nếu có).',
      '- Tài liệu/changelog: docs chạy song song với dev; chỉ nối sau dev khi phải mô tả đúng kết quả cuối cùng.',
      '- Yêu cầu của khách còn mơ hồ: biz viết spec trước, dev (hoặc design nếu chủ yếu là giao diện) nối sau.',
      '- Sự cố production: ops điều tra trước, dev sửa nguyên nhân gốc nối sau.',
      '',
      'Dùng "after" (thứ tự giữa các phần trong cùng plan này):',
      '- Song song là mặc định: "after": [] là bắt đầu ngay. Chỉ nối tiếp khi phần sau KHÔNG thể bắt đầu nếu chưa có kết quả phần trước (qa cần bản sửa, ops cần bản đã kiểm).',
      '- Chỉ ghi chỉ số của các phần ĐỨNG TRƯỚC trong chính plan này (0 là phần đầu tiên). Không trỏ vào chính nó, không trỏ tới việc đã có trên bảng.',
      '- Hai phần sửa cùng một file hay cùng một màn hình thì PHẢI nối tiếp, đừng để chạy song song — chúng sẽ đè lên nhau.',
      '- Phần nối sau tự khởi động khi phần trước xong hoặc chuyển sang chờ duyệt; không ai phải nhắc nó.',
      '',
      'Dùng "mergeInto" (yêu cầu này chính là việc đã có):',
      '- Chỉ gộp vào một việc còn mở trong "Bảng việc đang mở", ghi đúng mã #. Việc đã xong thì không gộp được — hãy "route" phần còn thiếu (giữ đúng dự án của luồng).',
      '- Gộp khi người gửi nói thêm, đổi ý hoặc nhắc lại cùng việc đó. Yêu cầu thật sự khác thì "route", đừng gộp cho gọn.',
      '- Người gửi bảo "làm tiếp", "tiếp tục", "chạy lại" trong luồng có việc DỪNG (xem "Luồng này"): "merge" vào việc đó — mọi việc đã dừng của luồng sẽ tự chạy lại, đừng tạo việc mới.',
      '- Tin nhắn nằm trong một luồng đã có việc (xem "Luồng này") thường là bổ sung cho việc đó: gộp vào việc còn mở của luồng. Việc đang chờ duyệt mà người gửi muốn sửa/thêm thì cũng gộp — việc sẽ được đưa về làm lại kèm phần bổ sung.',
      '- Một yêu cầu chỉ gộp vào đúng MỘT việc, và khi gộp thì không kèm "plan".',
      '',
      'Dự án ("project"):',
      '- Mỗi máy trực làm trong đúng một dự án; việc chỉ đến được máy của dự án mình ghi. Khi "route", ghi "project" là một tên trong danh sách "Dự án có máy trực".',
      '- Chỉ có một dự án thì ghi dự án đó. Yêu cầu nối tiếp việc đã có (cùng luồng) thì giữ đúng dự án của việc đó.',
      '- Có nhiều dự án mà yêu cầu không nói rõ là dự án nào, và đoán sai là làm hỏng việc: "ask" đúng câu đó.',
      '',
      'Dựa vào kinh nghiệm:',
      '- "Sổ kinh nghiệm" và "Kết quả gần đây" là những gì văn phòng đã học được. Áp dụng chúng khi chia việc: phòng nào hay làm hỏng loại việc gì, phần nào từng phải làm lại, cách nào đã hiệu quả. Ghi bài học liên quan vào "desc" để phòng nhận việc biết.',
      '',
      'Quy tắc:',
      '- Hỏi ít. Nếu còn thiếu chi tiết nhỏ: đừng hỏi — chọn "route" và ghi rõ giả định của bạn vào "desc". Chỉ hỏi thứ đáng hỏi.',
      '- Trả lời gọn. "reply" là tiếng Việt, 1–3 câu, như đồng nghiệp nói với nhau, không markdown, không gạch đầu dòng. Nói rõ ai sẽ làm gì hoặc câu trả lời là gì.',
      '- Mỗi phần việc là một phiên tốn tiền và tốn thời gian. Việc nhỏ → đúng 1 phần. Đừng chia nhỏ hơn mức cần, đừng thêm phòng chỉ để cho đủ.',
      '- "desc" viết cho người chưa biết bối cảnh: làm gì, xong thì như thế nào, file/khu vực nào nếu bạn biết, và phần này nối tiếp phần nào. Không bịa tên file.',
      '- Không bịa trạng thái. Chỉ nói những gì có trong "Tình hình văn phòng".',
      '- priority: urgent | high | normal | low.',
    ].join('\n');
  }

  private async user(it: BrainItem): Promise<string> {
    const all = await this.host.getTasks();
    const tasks = [...all.values()];
    // a card held by an earlier part of its plan is not stalled, so say so: otherwise the next
    // decision sees work "not moving" and plans it a second time
    const waitsFor = (t: Task) =>
      (t.after ?? [])
        .map((id) => all.get(id))
        .filter((p): p is Task => !!p && !settled(p))
        .map((p) => `#${shortId(p.id)}`);
    const open = tasks
      .filter((t) => t.col !== 'done')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 25)
      .map((t) => {
        const waits = waitsFor(t);
        return `- #${shortId(t.id)} [${t.col}] ${t.dept ? DEPT_BY_ID.get(t.dept)!.short : 'chưa giao'}: ${oneLine(t.title, 90)}${waits.length ? ` (đang chờ ${waits.join(', ')})` : ''}`;
      });
    const busy = this.host.atWork().map((a) => `- ${a.name} (${DEPT_BY_ID.get(a.dept)!.name}): ${oneLine(a.what, 60) || 'đang làm'}`);
    const b = this.budget();
    const projects = this.projects();
    // the request's own thread already belongs to a project when earlier work in it was routed there
    const threadProject = tasks.find((t) => t.thread && t.thread === it.root && t.project)?.project ?? '';
    // the playbook as far as deciding goes: the lead's own lessons and everyone's, for the projects
    // that can actually take work — never another project's commands or another machine's quirks
    const book = await db.listLessons(this.host.DB).catch(() => [] as Lesson[]);
    const fits = (l: Lesson) => !l.machine && (!l.project || projects.includes(l.project) || l.project === threadProject);
    const lessons = rankLessons(book.filter(fits))
      .sort((x, y) => Number(y.dept === 'lead') - Number(x.dept === 'lead'))
      .slice(0, 20)
      .map((l) => `- ${l.dept === 'all' ? 'chung' : DEPT_BY_ID.get(l.dept as DeptId)?.short ?? l.dept}${l.project ? ` · ${l.project}` : ''}: ${oneLine(l.text, 180)}`);
    // how recent work actually went: what finished, what had to be redone
    const since = Date.now() - 3 * 86400_000;
    const outcomes = tasks
      .filter((t) => t.dept && t.createdBy && (t.col === 'done' || t.col === 'review') && t.updatedAt > since)
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .slice(0, 10)
      .map((t) => {
        const fails = this.host.taskFails(t.id);
        return `- ${DEPT_BY_ID.get(t.dept!)!.short}${t.project ? ` · ${t.project}` : ''}: ${oneLine(t.title, 80)} → ${t.col === 'done' ? 'xong' : 'chờ duyệt'}${fails ? `, hỏng giữa chừng ${fails} lần` : ''}${(t.hops ?? 0) > 1 ? `, qua ${t.hops} lần bàn giao` : ''}`;
      });
    const d = new Date(Date.now() + this.host.tz * 60_000);
    const clock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    // a line inside a thread that already has work is most likely about that work
    const inThread = it.root
      ? tasks
          .filter((t) => t.thread === it.root)
          .sort((x, y) => x.createdAt - y.createdAt)
          .slice(-8)
          .map((t) => {
            const stopped = this.host.parked(t);
            return `- #${shortId(t.id)} [${t.col}] ${t.dept ? DEPT_BY_ID.get(t.dept)!.short : 'chưa giao'}: ${oneLine(t.title, 90)}${stopped ? ' (DỪNG vì hỏng giữa chừng nhiều lần, chưa xong — gộp vào luồng này là nó chạy lại)' : ''}`;
          })
      : [];
    // what earlier improvement rounds already did, so nothing is proposed or routed twice
    const rounds = this.history((await this.allRounds()).filter((r) => !r.project || projects.includes(r.project) || r.project === threadProject), '', ROUND_LIMITS.prompt);
    const asked = it.root ? this.items.filter((x) => x !== it && x.root === it.root && x.at < it.at).slice(-4).map((x) => `- ${x.whoName}: “${oneLine(x.text, 200)}”`) : [];
    const followUps = it.followUps.filter((f) => f.a).map((f) => `Bạn đã hỏi: “${oneLine(f.q, 200)}” — Họ trả lời: “${oneLine(f.a, 400)}”`);
    return [
      `## Tình hình văn phòng (lúc ${clock})`,
      busy.length ? `Đang làm:\n${busy.join('\n')}` : 'Không có nhân viên văn phòng nào đang làm việc.',
      '',
      open.length ? `Bảng việc đang mở:\n${open.join('\n')}` : 'Bảng việc đang trống.',
      '',
      `Ngân sách giờ này: đã dùng ${b.sessionsHour}/${this.cfg.maxSessionsHour} phiên cho cả văn phòng.`,
      '',
      projects.length ? `Dự án có máy trực: ${projects.join(', ')}` : 'Chưa có máy trực nào báo dự án (việc giao đi sẽ chờ máy lên).',
      threadProject ? `Luồng này đang làm ở dự án: ${threadProject}` : '',
      lessons.length ? `\n## Sổ kinh nghiệm\n${lessons.join('\n')}` : '',
      outcomes.length ? `\n## Kết quả gần đây\n${outcomes.join('\n')}` : '',
      rounds.length ? `\n## Vòng cải tiến trước (mục đã làm — đừng đề xuất hay giao lại)\n${rounds.join('\n')}` : '',
      inThread.length || asked.length ? `\n## Luồng này (tin nhắn dưới đây được gửi trong luồng đó)\n${[...(asked.length ? ['Đã nhắn trước đó:', ...asked] : []), ...(inThread.length ? ['Việc của luồng:', ...inThread] : [])].join('\n')}` : '',
      '',
      '## Yêu cầu cần quyết định',
      `Người gửi: ${it.whoName}`,
      it.source === 'task' ? 'Nguồn: một thẻ trên bảng Kanban chưa giao phòng nào.' : 'Nguồn: tin nhắn trong văn phòng.',
      `Nội dung: “${it.text}”`,
      ...followUps,
      '',
      'Trả về đúng một object JSON.',
    ]
      .filter((x) => x !== '')
      .join('\n');
  }

  // ------------------------------------------------------------------ applying a decision
  private async apply(it: BrainItem, d: BrainDecision) {
    let reply = oneLine(d.reply, BRAIN_LIMITS.reply);
    const thread = Brain.thread(it.who);
    if (d.action === 'drop') {
      await this.finish(it, d, []);
      return;
    }
    if (d.action === 'ask') {
      const q = oneLine(d.question || d.reply, BRAIN_LIMITS.question);
      if (!q) {
        // nothing to ask after all — treat it as an answer so the request does not stall (said out loud)
        const answer = reply || 'Mình chưa rõ yêu cầu, bạn nói thêm một câu nhé.';
        await this.say(answer, thread, it.root);
        await this.finish(it, { ...d, action: 'answer', reply: answer }, []);
        return;
      }
      it.followUps.push({ q, a: '' });
      it.state = 'asked';
      it.lease = undefined;
      this.save();
      await this.say(q, thread, it.root);
      await this.log(it, d, []);
      await this.host.wakeAt(Date.now() + BRAIN_ASK_TTL);
      this.push();
      return;
    }
    // going on with a thread whose work stopped after breaking down (a quota ran out, Claude was
    // down…): those cards run again — that is what "làm tiếp" means there
    const revived = (d.action === 'merge' || d.action === 'route') && it.root ? await this.host.revive(it.root, BRAIN_ID) : [];
    const again = revived.length ? ` Mình cũng cho chạy lại ${revived.length} việc đã dừng giữa chừng: ${revived.map((t) => `#${shortId(t.id)}`).join(', ')}.` : '';
    const owe = (ids: string[]) => {
      // the person hears back once the cards are finished — unless an earlier request already waits on them
      const open = ids.filter((id) => !this.items.some((x) => x !== it && x.tasks?.includes(id) && (x.report === 'wait' || x.report === 'pending' || x.report === 'thinking')));
      if (!open.length) return;
      it.tasks = [...new Set([...(it.tasks ?? []), ...open])];
      it.project = it.project || revived[0]?.project;
      it.report = 'wait';
    };
    if (d.action === 'merge') {
      const t = d.mergeInto ? await this.findTask(d.mergeInto) : null;
      // only work still open can absorb anything — a finished card is never read again
      if (t && t.col !== 'done') {
        const note = `— ${it.whoName} nhắn thêm: ${it.text}`;
        // the card keeps its head (what the work is), its latest notes, and the addition at the end —
        // cutting from the end would drop what was said most recently, a line at a time
        const room = Math.max(0, 2000 - note.length - 2);
        const kept = t.desc.length <= room ? t.desc : room > 800 ? `${t.desc.slice(0, 500)}\n…\n${t.desc.slice(t.desc.length - (room - 503))}` : t.desc.slice(0, room);
        t.desc = t.desc ? `${kept}\n\n${note}` : note.slice(0, 2000);
        // a card waiting for review that the person adds to goes back to be done again, with the addition
        const rework = t.col === 'review';
        if (rework) {
          t.col = 'todo';
          t.assignee = null;
        }
        t.updatedAt = Date.now();
        await this.host.saveTask(t, BRAIN_ID);
        // a session already working on it read the description long ago, so say it out loud too
        const owner = t.col === 'doing' && t.thread ? this.host.taskOrigin(t) : '';
        if (owner) await this.say(`${it.whoName} nhắn thêm cho “${oneLine(t.title, 60)}”: ${it.text}`, Brain.thread(owner), t.thread);
        it.project = t.project;
        owe([t.id, ...revived.map((x) => x.id)]);
        await this.say(`${reply || (rework ? `Mình đưa việc #${shortId(t.id)} về làm lại kèm phần bạn bổ sung, xong sẽ báo kết quả nhé.` : `Mình gộp vào việc #${shortId(t.id)} rồi nhé.`)}${again}`, thread, it.root);
        await this.finish(it, d, []);
        return;
      }
      if (revived.length && !d.plan?.length) {
        owe(revived.map((x) => x.id));
        await this.say(`Mình cho chạy lại ${revived.length} việc đã dừng giữa chừng trong luồng này: ${revived.map((t) => `#${shortId(t.id)} ${oneLine(t.title, 50)}`).join('; ')}. Xong sẽ báo kết quả nhé.`, thread, it.root);
        await this.finish(it, d, []);
        return;
      }
      // it named a card that is finished or not on the board: the plan stands in its place, and if
      // there is no plan the person hears that nothing happened instead of "đã gộp rồi"
      d = d.plan?.length ? { ...d, action: 'route', reply: '' } : { ...d, action: 'answer', reply: 'Việc bạn nhắc tới không còn mở trên bảng nên mình chưa gộp được. Bạn nhắn lại yêu cầu trong một câu để mình giao cho đúng phòng nhé.' };
      reply = oneLine(d.reply, BRAIN_LIMITS.reply);
    }
    if (d.action === 'route') {
      const made = await this.dispatch(it, d);
      if (made.length) {
        it.tasks = [...new Set([...(it.tasks ?? []), ...made.map((t) => t.id)])];
        it.project = made[0].project;
        it.report = 'wait';
        owe(revived.map((x) => x.id));
        const who = made.map((t) => `${DEPT_BY_ID.get(t.dept!)!.icon} ${DEPT_BY_ID.get(t.dept!)!.name}`);
        const line = reply || `Mình giao cho ${[...new Set(who)].join(', ')} rồi, bạn theo dõi trên bảng nhé.`;
        const throttled = !this.mayStart(it.who);
        await this.say(`${throttled ? `${line} (Văn phòng đang chạm trần ${this.cfg.maxSessionsHour} phiên/giờ nên việc sẽ vào hàng chờ.)` : line}${again}`, thread, it.root);
        await this.finish(it, d, made.map((t) => t.dept!));
        return;
      }
      // an empty plan is an answer with extra steps
    }
    if (revived.length) owe(revived.map((x) => x.id));
    await this.say(`${reply || (revived.length ? '' : 'Mình đã ghi nhận.')}${again}`.trim(), thread, it.root);
    await this.finish(it, { ...d, action: 'answer' }, []);
  }

  /** The plan becomes cards on the board: independent parcels start at once, the rest wait. */
  private async dispatch(it: BrainItem, d: BrainDecision): Promise<Task[]> {
    const parcels = (d.plan ?? []).filter((p) => p && isDept(p.dept) && String(p.title ?? '').trim()).slice(0, BRAIN_LIMITS.parcels);
    if (!parcels.length) return [];
    const tasks = await this.host.getTasks();
    let ord = 0;
    for (const t of tasks.values()) if (t.col === 'todo') ord = Math.max(ord, t.ord);
    const now = Date.now();
    const made: Task[] = [];
    const project = this.pickProject(d.project, it.root, tasks);
    // the card the request came from is reused for the first parcel, so nothing is duplicated
    const from = it.taskId ? tasks.get(it.taskId) ?? null : null;
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      const after = (Array.isArray(p.after) ? p.after : [])
        .map((n) => made[Number(n)])
        .filter((t): t is Task => !!t && Number.isFinite(Number(t.ord)))
        .map((t) => t.id);
      const reuse = i === 0 && from;
      const t: Task = reuse
        ? Object.assign(from, { dept: p.dept as DeptId, title: clampStr(p.title, BRAIN_LIMITS.title) || from.title, desc: clampStr(p.desc ?? from.desc, BRAIN_LIMITS.desc), priority: this.prio(p.priority, from.priority), updatedAt: now, after: after.length ? after : undefined, thread: it.root || undefined })
        : {
            id: crypto.randomUUID(),
            title: clampStr(p.title, BRAIN_LIMITS.title),
            desc: clampStr(p.desc ?? '', BRAIN_LIMITS.desc),
            col: 'todo',
            ord: ++ord,
            assignee: null,
            priority: this.prio(p.priority, 'normal'),
            createdBy: BRAIN_ID,
            createdAt: now,
            updatedAt: now,
            doneAt: null,
            dept: p.dept as DeptId,
            hops: 0,
            after: after.length ? after : undefined,
            thread: it.root || undefined,
          };
      if (project) t.project = project;
      this.host.setTaskOrigin(t.id, it.who);
      await this.host.saveTask(t, BRAIN_ID);
      made.push(t);
    }
    return made;
  }

  /** Online projects (repo names of the on-call machines seen lately). */
  private projects(): string[] {
    return [...new Set(this.host.machines().map((m) => m.project).filter(Boolean))].sort();
  }

  /** Which project a plan goes to: what it named (if a machine works there), the thread's own, or
   *  the only one on call. '' = any machine may take it (no machine says where it works). */
  private pickProject(named: string | undefined, root: string, tasks: Map<string, Task>): string {
    const projects = this.projects();
    const want = String(named ?? '').trim().toLowerCase();
    const hit = projects.find((p) => p.toLowerCase() === want);
    if (hit) return hit;
    const thread = root ? [...tasks.values()].find((t) => t.thread === root && t.project)?.project : undefined;
    if (thread) return thread;
    if (want && projects.length !== 1) return clampStr(named!, 60); // a project whose machine is not up yet
    return projects.length === 1 ? projects[0] : '';
  }

  private prio(v: unknown, dflt: Priority): Priority {
    return typeof v === 'string' && v in PRIORITY_META ? (v as Priority) : dflt;
  }

  private async findTask(idRaw: string): Promise<Task | null> {
    const q = String(idRaw).replace(/^#/, '').replace(/-/g, '').toLowerCase();
    if (q.length < 4) return null;
    const hits = [...(await this.host.getTasks()).values()].filter((t) => t.id.replace(/-/g, '').startsWith(q));
    return hits.length === 1 ? hits[0] : null;
  }

  private async finish(it: BrainItem, d: BrainDecision, depts: DeptId[]) {
    it.state = 'done';
    it.lease = undefined;
    this.save();
    await this.log(it, d, depts);
    await this.host.showBrain(this.items.some((x) => x.state === 'pending'), '');
    this.push();
  }

  private async log(it: BrainItem, d: BrainDecision, depts: DeptId[]) {
    const entry: BrainLog = { id: it.id, at: Date.now(), whoName: it.whoName, text: oneLine(it.text, 160), action: d.action, reply: oneLine(d.action === 'ask' ? d.question ?? d.reply : d.reply, 240), depts };
    this.logs.push(entry);
    if (this.logs.length > 60) this.logs = this.logs.slice(-60);
    this.saveLogs();
    const icon = d.action === 'route' ? '📨' : d.action === 'ask' ? '❓' : d.action === 'merge' ? '🧵' : d.action === 'drop' ? '🤫' : '💬';
    await this.host.pushActivity(BRAIN_ID, { ts: entry.at, kind: 'say', icon, text: entry.reply || d.action });
  }

  private async say(text: string, ch: string, root?: string) {
    if (!text) return;
    await this.host.chat({ id: crypto.randomUUID(), ch, from: BRAIN_ID, name: `🧠 ${BRAIN_NAME}`, text: oneLine(text, BRAIN_LIMITS.reply), ts: Date.now(), ...(root ? { root } : {}) });
  }

  // ------------------------------------------------------------------ the final report
  /** Every card that belongs to a request: the ones its plan made and the ones handed on from them. */
  private workOf(it: BrainItem, tasks: Map<string, Task>): Task[] {
    const ids = new Set(it.tasks ?? []);
    return [...tasks.values()].filter((t) => ids.has(t.id) || (it.root && t.thread === it.root && t.createdAt >= it.at));
  }

  /** Work moved on the board: a request whose every piece is finished gets its report written. */
  async progress(): Promise<void> {
    const waiting = this.items.filter((i) => i.report === 'wait');
    const live = this.rounds?.some((r) => !r.closed) || waiting.some((i) => i.round);
    if (!waiting.length && !live) return;
    const tasks = await this.host.getTasks();
    if (live) await this.refreshRounds(tasks).catch(() => {});
    let changed = false;
    for (const it of waiting) {
      const work = this.workOf(it, tasks);
      if (!work.length) {
        it.report = 'sent'; // the cards were deleted: nothing left to report on
        changed = true;
        continue;
      }
      // a card that stopped after breaking down is not finished work: the person was told, and the
      // report waits until it runs again ("làm tiếp") and really settles
      if (!work.every((t) => settled(t) && !this.host.parked(t))) continue;
      // `at` restarts below (it times the report), and workOf only finds handed-over cards created
      // after `at` — so pin every card of the work now, or the report would forget the handoffs
      it.tasks = [...new Set([...(it.tasks ?? []), ...work.map((t) => t.id)])];
      it.report = 'pending';
      it.reportTries = 0;
      it.notBefore = undefined;
      it.at = Date.now();
      changed = true;
    }
    if (changed) {
      this.save();
      this.push();
      this.kick();
      await this.host.wakeAt(Date.now() + REPORT_FALLBACK_MS);
    }
  }

  private reportSystem(): string {
    return [
      `Bạn là ${BRAIN_NAME} — người điều phối của một văn phòng. Một yêu cầu bạn đã giao cho các phòng ban vừa xong hết. Viết BÁO CÁO CUỐI gửi người đã yêu cầu: họ chỉ đọc đúng tin này, không đọc từng trao đổi giữa các phòng.`,
      '',
      'Trả về ĐÚNG MỘT object JSON, không viết gì ngoài nó:',
      '{"status":"done|partial|failed","reply":"…","lesson":"…"}',
      '',
      '- "reply": tiếng Việt, 2–6 câu, không markdown, không gạch đầu dòng. Nói kết quả cuối cùng (đã làm được gì, ở đâu: nhánh/file/link nếu ghi chú có), điều gì chưa xong hoặc rủi ro còn lại, và người đó cần làm gì tiếp (duyệt, merge, thử lại…) nếu có. Chỉ dựa vào ghi chú của các việc, không bịa.',
      '- "status": done nếu đạt đúng yêu cầu, partial nếu còn thiếu, failed nếu không làm được.',
      '- "lesson": một câu kinh nghiệm về CÁCH CHIA VIỆC rút ra từ lần này (phòng nào thừa/thiếu, phần nào phải làm lại, nên nối tiếp hay song song) — để trống nếu không có gì đáng nhớ.',
    ].join('\n');
  }

  private async reportPrompt(it: BrainItem): Promise<string> {
    const tasks = await this.host.getTasks();
    const work = this.workOf(it, tasks).sort((a, b) => a.createdAt - b.createdAt);
    const followUps = it.followUps.filter((f) => f.a).map((f) => `Đã hỏi: “${oneLine(f.q, 200)}” — trả lời: “${oneLine(f.a, 300)}”`);
    return [
      `## Yêu cầu của ${it.whoName}`,
      `“${it.text}”`,
      ...followUps,
      it.project ? `Dự án: ${it.project}` : '',
      '',
      '## Các phần việc',
      ...work.map((t) => {
        const fails = this.host.taskFails(t.id);
        // the notes are appended, so the end of the description is where the results are
        const notes = t.desc.length > 1400 ? `…${t.desc.slice(-1400)}` : t.desc;
        return `### #${shortId(t.id)} ${t.dept ? DEPT_BY_ID.get(t.dept)!.name : 'chưa giao'} — ${t.title} [${t.col === 'done' ? 'xong' : 'chờ duyệt'}${fails ? `, hỏng giữa chừng ${fails} lần` : ''}]\n${notes || '(không có ghi chú)'}`;
      }),
      '',
      'Trả về đúng một object JSON.',
    ]
      .filter((x) => x !== '')
      .join('\n');
  }

  /** The report came back (or could not be written). */
  private async reported(it: BrainItem, r: { reply: string; lesson: string } | null, error: string): Promise<{ ok: boolean; error?: string }> {
    it.reportLease = undefined;
    if (!r) {
      it.reportTries = (it.reportTries ?? 0) + 1;
      it.report = 'pending';
      if (error) it.notBefore = Date.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.min(5, it.reportTries - 1));
      this.save();
      if (it.reportTries >= 3 && !error) await this.plainReport(it);
      return { ok: !!error, error: error ? undefined : 'không đọc được báo cáo (cần JSON)' };
    }
    this.thoughts = [...this.thoughts.filter((t) => Date.now() - t < 2 * HOUR), Date.now()];
    await this.sendReport(it, r.reply);
    // how the split went is the lead's experience: it goes through the same distillation as the rest
    if (r.lesson.length >= 12) await db.addDebrief(this.host.DB, Brain.lessonDebrief(it, r.lesson), 'system').catch(() => {});
    return { ok: true };
  }

  private async sendReport(it: BrainItem, reply: string) {
    it.report = 'sent';
    it.notBefore = undefined;
    it.reportMsg = crypto.randomUUID();
    this.save();
    this.push();
    await this.host.chat({ id: it.reportMsg, ch: Brain.thread(it.who), from: BRAIN_ID, name: `🧠 ${BRAIN_NAME}`, text: `${REPORT_PREFIX}: ${clampStr(reply.replace(/\s+/g, ' '), 1200)}`, ts: Date.now(), ...(it.root ? { root: it.root } : {}) });
    await this.host.pushActivity(BRAIN_ID, { ts: Date.now(), kind: 'say', icon: '📋', text: `Báo cáo cho ${it.whoName}: ${oneLine(reply, 140)}` });
  }

  /**
   * 👍 / 👎 on a 📋 report. Only the person the report was written for can rate it (it sits in their
   * own thread, "Văn phòng của bạn"). A 👎 with a reason becomes a lesson for Tổng quản in the
   * project the work was done in, so the next decisions see it; a 👍 (or a 👎 without a reason) is
   * only counted. Rating again replaces the earlier one, and takes back its lesson if need be.
   * Returns whether the playbook changed.
   */
  async rate(uid: string, by: string, msgId: string, vote: number, rawReason?: string): Promise<boolean> {
    const v: 1 | -1 = vote > 0 ? 1 : -1;
    const m = /^[\w-]{6,80}$/.test(msgId) ? await db.getChat(this.host.DB, msgId) : null;
    if (!m || m.from !== BRAIN_ID || !m.text.startsWith(REPORT_PREFIX)) {
      this.host.sendTo(uid, { t: 'err', msg: 'Chỉ chấm được tin 📋 Kết quả của Tổng quản.' });
      return false;
    }
    if (m.ch !== Brain.thread(uid)) {
      this.host.sendTo(uid, { t: 'err', msg: 'Chỉ người nhận báo cáo này mới chấm được.' });
      return false;
    }
    const reason = v < 0 ? oneLine(rawReason ?? '', RATE_REASON_MAX) : '';
    const before = await db.getRating(this.host.DB, msgId);
    let lessonId: string | null = before?.lessonId ?? null;
    let changed = false;
    if (v < 0 && reason) {
      const it = this.items.find((x) => x.reportMsg === msgId) ?? (m.root ? this.items.find((x) => x.root === m.root && x.report === 'sent') : undefined);
      // the lesson belongs to the project the work was done in (the request's, else its thread's cards')
      let project = it?.project ?? '';
      if (!project && m.root) project = [...(await this.host.getTasks()).values()].find((t) => t.thread === m.root && t.project)?.project ?? '';
      const asked = it ? `“${oneLine(it.text, 140)}”` : 'một yêu cầu';
      lessonId ??= crypto.randomUUID();
      await db.saveLesson(this.host.DB, { id: lessonId, dept: 'lead', project, machine: '', text: `👎 ${by} chưa hài lòng với kết quả ${asked}: ${reason}`, by, at: Date.now() });
      changed = true;
    } else if (lessonId) {
      await db.deleteLesson(this.host.DB, lessonId).catch(() => false);
      lessonId = null;
      changed = true;
    }
    await db.saveRating(this.host.DB, { msgId, thread: m.root ?? m.id, userId: uid, vote: v, reason, lessonId }, Date.now());
    this.host.sendTo(uid, { t: 'chatRate', id: msgId, rate: { v, ...(reason ? { reason } : {}) } });
    return changed;
  }

  /** Nobody could write the report: the person still hears how each piece ended. */
  private async plainReport(it: BrainItem) {
    const tasks = await this.host.getTasks();
    const work = this.workOf(it, tasks);
    const parts = work.map((t) => `${t.dept ? DEPT_BY_ID.get(t.dept)!.short : '?'} “${oneLine(t.title, 60)}” ${t.col === 'done' ? 'đã xong' : 'đang chờ bạn duyệt'}`);
    await this.sendReport(it, `Mọi phần việc cho “${oneLine(it.text, 80)}” đã xong: ${parts.join('; ')}. Chi tiết nằm trong ghi chú từng việc trên bảng.`);
  }

  /** The report's own lesson about splitting work becomes a debrief for the lead's distillation. */
  static lessonDebrief(it: BrainItem, lesson: string): Debrief {
    return { id: crypto.randomUUID(), agent: BRAIN_ID, agentName: BRAIN_NAME, dept: 'lead', project: it.project ?? '', text: `Yêu cầu: ${oneLine(it.text, 300)}\nBài học chia việc: ${oneLine(lesson, 300)}`, at: Date.now() };
  }

  // ------------------------------------------------------------------ housekeeping
  /** Returns true while something still needs the room awake. */
  async sweep(now: number): Promise<boolean> {
    let changed = false;
    for (const it of this.items) {
      if (it.state === 'thinking' && it.lease && now > it.lease.until) {
        it.state = 'pending';
        it.lease = undefined;
        changed = true;
      } else if (it.state === 'asked' && now - it.at > BRAIN_ASK_TTL) {
        it.state = 'done';
        changed = true;
      }
      if (it.report === 'thinking' && it.reportLease && now > it.reportLease.until) {
        it.report = 'pending';
        it.reportLease = undefined;
        changed = true;
      }
      // no machine managed to write it: the person still gets the outcome, just plainer
      if (it.report === 'pending' && now - it.at > REPORT_FALLBACK_MS) await this.plainReport(it);
    }
    for (const c of this.checks) if (c.state === 'thinking' && c.lease && now > c.lease.until) ((c.state = 'pending'), (c.lease = undefined));
    this.checks = this.checks.filter((c) => now - c.at < 5 * 60_000);
    // a request is kept for the log a day, and — while its work is still running — until its report went out
    const live = (i: BrainItem) => i.state !== 'done' || now - i.at < BRAIN_KEEP_MS || ((i.report === 'wait' || i.report === 'pending' || i.report === 'thinking') && now - i.at < REPORT_KEEP_MS);
    const kept = this.items.filter(live);
    if (kept.length !== this.items.length) {
      this.items = kept;
      changed = true;
    }
    if (changed) {
      this.save();
      this.push();
    }
    await this.progress();
    const waiting = this.items.some((i) => i.state === 'pending' || i.state === 'thinking');
    if (!waiting) await this.host.showBrain(false, '');
    return waiting || this.items.some((i) => i.report === 'pending' || i.report === 'thinking');
  }

  /** Is this thread a request Tổng quản will report on when its work is finished? */
  reports(root: string | null | undefined): boolean {
    return !!root && this.items.some((i) => i.root === root && (i.report === 'wait' || i.report === 'pending' || i.report === 'thinking'));
  }

  /** A person cancelled a request of theirs. */
  async cancel(uid: string, id: string) {
    const it = this.items.find((x) => x.id === id && x.state !== 'done');
    if (!it || it.who !== uid) return;
    // a machine still thinking about it is told "done" when its answer comes back, and nothing is applied
    it.state = 'done';
    it.lease = undefined;
    this.save();
    this.push();
  }
}
