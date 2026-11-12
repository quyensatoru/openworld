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
  BRAIN_ASK_TTL,
  BRAIN_ID,
  BRAIN_KEEP_MS,
  BRAIN_LEASE_MS,
  BRAIN_LIMITS,
  BRAIN_MAX_TRIES,
  BRAIN_NAME,
  DEFAULT_BRAIN,
  parseDecision,
  sanitizeBrainConfig,
  type BrainBudget,
  type BrainConfig,
  type BrainDecision,
  type BrainItem,
  type BrainJob,
  type BrainLog,
  type BrainSource,
  type BrainView,
} from '../shared/brain';
import { DEPTS, DEPT_BY_ID, isDept, type DeptId, type Lesson } from '../shared/agents';
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
/** The same person saying the same thing twice in this window is one request. */
const DEDUPE_MS = 10 * 60_000;

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

  constructor(private host: BrainHost) {}

  async restore(): Promise<void> {
    const s = this.host.storage;
    this.items = (await s.get<BrainItem[]>('brainItems')) ?? [];
    this.logs = (await s.get<BrainLog[]>('brainLogs')) ?? [];
    this.cfg = sanitizeBrainConfig(await s.get('brainConfig'));
    this.sessions = (await s.get<{ at: number; origin: string }[]>('brainSessions')) ?? [];
    // a decision claimed before a restart is nobody's now
    for (const it of this.items) if (it.state === 'thinking') ((it.state = 'pending'), (it.lease = undefined));
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

  watch(uid: string) {
    this.watchers.add(uid);
    this.host.sendTo(uid, { t: 'brain', v: this.view() });
  }

  left(uid: string) {
    this.watchers.delete(uid);
  }

  view(): BrainView {
    return {
      config: this.cfg,
      queue: this.items.filter((i) => i.state !== 'done').slice(-40),
      recent: this.logs.slice(-25),
      budget: this.budget(),
      online: this.online(),
    };
  }

  private push() {
    const v = this.view();
    for (const id of this.watchers) this.host.sendTo(id, { t: 'brain', v });
  }

  async setConfig(v: unknown, by: string, byId: string) {
    this.cfg = sanitizeBrainConfig(v, this.cfg);
    await this.host.storage.put('brainConfig', this.cfg);
    await this.say(`⚙️ ${by} vừa chỉnh cách làm việc của Tổng quản: model ${this.cfg.model}, tối đa ${this.cfg.maxSessionsHour} phiên/giờ cho cả văn phòng.`, Brain.thread(byId));
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
    const asked = this.items.find((i) => i.state === 'asked' && (i.root === root || (i.who === who && root === '')));
    if (asked && source === 'chat') {
      const open = asked.followUps[asked.followUps.length - 1];
      if (open && !open.a) open.a = body;
      else asked.followUps.push({ q: '', a: body });
      asked.state = 'pending';
      asked.at = now;
      this.save();
      this.push();
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
    if (this.items.length > 120) this.items = this.items.slice(-120);
    this.save();
    this.push();
    if (!this.online()) await this.say('Chưa có máy trực nào đang chạy Tổng quản, nên mình ghi lại đây và sẽ xử lý ngay khi có máy lên.', Brain.thread(who), root);
    await this.host.wakeAt(now + 10_000);
  }

  // ------------------------------------------------------------------ the runner's side
  /** One decision to make, or null. Claiming it leases it, so two machines never think the same thought. */
  async job(uid: string): Promise<BrainJob | null> {
    const now = Date.now();
    this.served = now;
    const it = this.items.find((i) => i.state === 'pending');
    if (!it) {
      this.push();
      return null;
    }
    it.state = 'thinking';
    it.tries++;
    it.lease = { by: uid, until: now + BRAIN_LEASE_MS };
    this.save();
    if (it.tries > BRAIN_MAX_TRIES) {
      await this.finish(it, { action: 'answer', reply: 'Mình vẫn chưa hiểu rõ yêu cầu này. Bạn mô tả lại giúp mình trong một câu: muốn kết quả cuối cùng là gì?' }, []);
      return null;
    }
    await this.host.showBrain(true, `nghĩ: ${oneLine(it.text, 40)}`);
    await this.host.pushActivity(BRAIN_ID, { ts: now, kind: 'prompt', icon: '🧠', text: `${it.whoName}: ${oneLine(it.text, 120)}` });
    this.push();
    return { id: it.id, model: this.cfg.model, system: await this.system(), prompt: await this.user(it) };
  }

  /** The machine brings back whatever the model printed. */
  async result(uid: string, id: string, raw: string): Promise<{ ok: boolean; error?: string }> {
    const it = this.items.find((x) => x.id === id);
    if (!it) return { ok: false, error: 'không còn yêu cầu này' };
    if (it.lease && it.lease.by !== uid) return { ok: false, error: 'yêu cầu này do máy khác nhận' };
    const d = parseDecision(raw);
    this.thoughts = [...this.thoughts.filter((t) => Date.now() - t < 2 * HOUR), Date.now()];
    if (!d) {
      // the model did not answer in the shape we asked for: put it back once, then give up
      it.state = 'pending';
      it.lease = undefined;
      this.save();
      this.push();
      return { ok: false, error: 'không đọc được quyết định (cần JSON)' };
    }
    await this.apply(it, d);
    return { ok: true };
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
      '{"action":"answer|route|ask|merge|drop","reply":"…","question":"…","mergeInto":"#abc12345","plan":[{"dept":"dev","title":"…","desc":"…","priority":"normal","after":[]}]}',
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
      '- Chỉ gộp vào một việc còn mở trong "Bảng việc đang mở", ghi đúng mã #. Việc đã xong thì không gộp được — hãy "route" phần còn thiếu.',
      '- Gộp khi người gửi nói thêm, đổi ý hoặc nhắc lại cùng việc đó. Yêu cầu thật sự khác thì "route", đừng gộp cho gọn.',
      '- Một yêu cầu chỉ gộp vào đúng MỘT việc, và khi gộp thì không kèm "plan".',
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
    const lessons = (await db.listLessons(this.host.DB).catch(() => [] as Lesson[])).slice(0, 12).map((l) => `- ${l.dept === 'all' ? 'chung' : DEPT_BY_ID.get(l.dept as DeptId)?.short ?? l.dept}: ${oneLine(l.text, 160)}`);
    const d = new Date(Date.now() + this.host.tz * 60_000);
    const clock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const followUps = it.followUps.filter((f) => f.a).map((f) => `Bạn đã hỏi: “${oneLine(f.q, 200)}” — Họ trả lời: “${oneLine(f.a, 400)}”`);
    return [
      `## Tình hình văn phòng (lúc ${clock})`,
      busy.length ? `Đang làm:\n${busy.join('\n')}` : 'Không có nhân viên văn phòng nào đang làm việc.',
      '',
      open.length ? `Bảng việc đang mở:\n${open.join('\n')}` : 'Bảng việc đang trống.',
      '',
      `Ngân sách giờ này: đã dùng ${b.sessionsHour}/${this.cfg.maxSessionsHour} phiên cho cả văn phòng.`,
      lessons.length ? `\n## Sổ kinh nghiệm\n${lessons.join('\n')}` : '',
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
        // nothing to ask after all — treat it as an answer so the request does not stall
        await this.finish(it, { ...d, action: 'answer', reply: reply || 'Mình chưa rõ yêu cầu, bạn nói thêm một câu nhé.' }, []);
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
    if (d.action === 'merge') {
      const t = d.mergeInto ? await this.findTask(d.mergeInto) : null;
      // only work still open can absorb anything — a finished card is never read again
      if (t && t.col !== 'done') {
        t.desc = `${t.desc}${t.desc ? '\n\n' : ''}— ${it.whoName} nhắn thêm: ${it.text}`.slice(0, 2000);
        t.updatedAt = Date.now();
        await this.host.saveTask(t, BRAIN_ID);
        // a session already working on it read the description long ago, so say it out loud too
        const owner = t.col === 'doing' && t.thread ? this.host.taskOrigin(t) : '';
        if (owner) await this.say(`${it.whoName} nhắn thêm cho “${oneLine(t.title, 60)}”: ${it.text}`, Brain.thread(owner), t.thread);
        await this.say(reply || `Mình gộp vào việc #${shortId(t.id)} đang chạy rồi nhé.`, thread, it.root);
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
        const who = made.map((t) => `${DEPT_BY_ID.get(t.dept!)!.icon} ${DEPT_BY_ID.get(t.dept!)!.name}`);
        const line = reply || `Mình giao cho ${[...new Set(who)].join(', ')} rồi, bạn theo dõi trên bảng nhé.`;
        const throttled = !this.mayStart(it.who);
        await this.say(throttled ? `${line} (Văn phòng đang chạm trần ${this.cfg.maxSessionsHour} phiên/giờ nên việc sẽ vào hàng chờ.)` : line, thread, it.root);
        await this.finish(it, d, made.map((t) => t.dept!));
        return;
      }
      // an empty plan is an answer with extra steps
    }
    await this.say(reply || 'Mình đã ghi nhận.', thread, it.root);
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
      this.host.setTaskOrigin(t.id, it.who);
      await this.host.saveTask(t, BRAIN_ID);
      made.push(t);
    }
    return made;
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
    }
    const kept = this.items.filter((i) => i.state !== 'done' || now - i.at < BRAIN_KEEP_MS);
    if (kept.length !== this.items.length) {
      this.items = kept;
      changed = true;
    }
    if (changed) {
      this.save();
      this.push();
    }
    const waiting = this.items.some((i) => i.state === 'pending' || i.state === 'thinking');
    if (!waiting) await this.host.showBrain(false, '');
    return waiting;
  }

  /** A person cancelled a request of theirs. */
  async cancel(uid: string, id: string) {
    const it = this.items.find((x) => x.id === id && x.state !== 'done');
    if (!it || it.who !== uid) return;
    it.state = 'done';
    this.save();
    this.push();
  }
}
