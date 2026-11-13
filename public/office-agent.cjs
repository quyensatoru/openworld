#!/usr/bin/env node
// Office agent runner — keeps the departments' agents working on an always-on machine.
//
//   curl -fsSL https://<office>/office-agent.cjs -o office-agent.cjs
//   node office-agent.cjs --url https://<office> --token <mã-kết-nối> --dir ~/code/du-an [options]
//
// It does two different jobs, and the difference is the whole point:
//
//   1. THINKING (cheap).  It asks the office whether 🧠 Tổng quản has something to decide — a request,
//      an action a session wants approved, a final report to write — and runs a short `claude -p`
//      with no repo access at all (an empty working directory, no tools, no MCP) that returns JSON.
//   2. DOING (expensive).  Only work the orchestrator actually put on the board starts a real
//      department session: `claude -p` in your project, set up with that department's profile.
//
// It is built to survive the network and Claude going away. A session that breaks off (Claude
// unreachable, rate/usage limits, a stalled connection) is NOT thrown away: its employee waits at
// the desk, and once Claude answers again the very same conversation is resumed (`--resume`) from
// where it stopped. If the office itself is unreachable, sessions keep working and their results
// are delivered when it is back. If this runner restarts, it picks its sessions back up.
//
// The connection code can be given as OFFICE_TOKEN=<mã> in the environment instead of --token.
// Only one runner may run per machine + office + folder; a second one refuses to start.
//
// Options:
//   --depts dev,qa,ops,design,docs,biz,lead   departments this machine works for (default: all)
//   --project <tên>      the project name the office files work and lessons under (default: the git
//                        remote's repo name, else the folder name)
//   --max 3              sessions at the same time (default 3), --per-dept 1 (default 1, meetings excepted)
//   --timeout 40         minutes before a session is stopped (default 40)
//   --stall 12           minutes without a word from a session before it counts as stuck (default 12)
//   --allow "Bash(npm test:*),Bash(git diff:*)"   commands you allow at most; a department only gets
//                        the ones its profile asks for AND you allow here
//   --trust-profiles     grant whatever commands the departments' profiles ask for
//                        Anything else a session wants to do is decided as the office is set up in
//                        🧠 → "Duyệt quyền": by Tổng quản, or a 🔐 card for you.
//   --approvers anyone   let anyone in the office approve (default: only you, the token's owner)
//   --mode <mode>        force one Claude Code permission mode for every session
//   --claude claude      the Claude Code command
//   --no-brain           do not serve the orchestrator's thinking from this machine (another one does)
//   --once               run one round, wait for the sessions, exit (for testing)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');

const ALL = ['lead', 'dev', 'qa', 'ops', 'design', 'docs', 'biz'];
const NAMES = { lead: 'Ban điều hành', dev: 'Phát triển', qa: 'Kiểm thử', ops: 'Vận hành', design: 'Thiết kế', docs: 'Tài liệu', biz: 'Kinh doanh & CSKH' };

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) o[k] = true;
    else {
      o[k] = next;
      i++;
    }
  }
  return o;
}

const opt = parse(process.argv.slice(2));
const die = (m) => {
  console.error(m);
  process.exit(1);
};
// the connection code may also come from the environment (OFFICE_TOKEN), where `ps` does not show it
const token = typeof opt.token === 'string' ? opt.token : String(process.env.OFFICE_TOKEN || '');
if (!opt.url || !token) die('Cách dùng: node office-agent.cjs --url https://<office> --token <mã-kết-nối> --dir <thư mục dự án> [--depts dev,qa] [--max 3]\n   (hoặc đặt mã kết nối trong biến môi trường OFFICE_TOKEN thay cho --token)');
const base = new URL(opt.url).origin;
const workdir = path.resolve(String(opt.dir || process.cwd()).replace(/^~(?=$|\/)/, os.homedir()));
// other users on this machine can read every process's command line: keep the code out of it
try {
  process.title = `node office-agent.cjs --url ${base} --dir ${workdir}`;
} catch {
  /* not supported here */
}
if (!fs.existsSync(workdir)) die(`Không thấy thư mục ${workdir}`);
const depts = String(opt.depts || ALL.join(',')).split(',').map((s) => s.trim()).filter((d) => ALL.includes(d));
if (!depts.length) die(`--depts phải gồm: ${ALL.join(', ')}`);
const MAX = Math.max(1, Number(opt.max) || 3);
const PER_DEPT = Math.max(1, Number(opt['per-dept']) || 1);
const TIMEOUT = Math.max(2, Number(opt.timeout) || 40) * 60_000;
const STALL = Math.max(3, Number(opt.stall) || 12) * 60_000;
const OWNER_ALLOW = String(opt.allow || '').split(',').map((s) => s.trim()).filter(Boolean);
const TRUST = !!opt['trust-profiles'];
const CLAUDE = String(opt.claude || 'claude');
const APPROVERS = opt.approvers === 'anyone' ? 'anyone' : 'owner';
const BRAIN = !opt['no-brain'];
/** a session resumed this many times after outages and still not done goes back to the office */
const MAX_RESUMES = 6;
const home = path.join(os.homedir(), '.office-agent');
const logs = path.join(home, 'logs');
fs.mkdirSync(logs, { recursive: true });

// ---------------------------------------------------------------- who and where this runner is
/** The physical machine: one id per computer, kept across restarts. Lessons about this machine's
 *  quirks (its shell, its tools) are tagged with its label and never shown on another computer. */
function machineId() {
  const f = path.join(home, 'machine.json');
  try {
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (m && typeof m.id === 'string' && m.id.length >= 8) return m.id;
  } catch {
    /* first run */
  }
  const id = crypto.randomUUID();
  fs.writeFileSync(f, JSON.stringify({ id }));
  return id;
}
const MACHINE = machineId();
const MACHINE_LABEL = `${os.hostname().split('.')[0].slice(0, 40)}·${MACHINE.slice(0, 4)}`;
/** This runner: one machine may run several (one per project), and each keeps its own sessions. */
const RUNNER = `r-${crypto.createHash('sha256').update(`${MACHINE}|${base}|${workdir}`).digest('hex').slice(0, 24)}`;

/** The project's name, the same on every machine: the git remote's repo name, else the folder's. */
function detectProject() {
  if (typeof opt.project === 'string' && opt.project.trim()) return opt.project.trim().slice(0, 60);
  const git = (...a) => execFileSync('git', ['-C', workdir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
  try {
    const name = git('remote', 'get-url', 'origin').replace(/\/+$/, '').split(/[/:]/).pop().replace(/\.git$/, '');
    if (name) return name.slice(0, 60);
  } catch {
    /* no remote */
  }
  try {
    return path.basename(git('rev-parse', '--show-toplevel')).slice(0, 60);
  } catch {
    return path.basename(workdir).slice(0, 60);
  }
}
const PROJECT = detectProject();

// ---------------------------------------------------------------- talking to the office
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function api(p, body, timeoutMs = 30_000) {
  const res = await fetch(`${base}${p}`, {
    ...(body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) die('❌ Mã kết nối sai hoặc đã bị đổi. Lấy mã mới trong Office → 🧠 → Kết nối.');
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
}

const log = (...a) => console.log(new Date().toLocaleTimeString('vi-VN'), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- what survives a restart
// Every session this runner owns, with what it needs to be resumed: the office's agent, the job, the
// department profile and the Claude Code session id. Results the office has not heard yet wait here
// too, so a network cut never loses "this task is finished".
const stateFile = path.join(home, `${RUNNER}.json`);

// One process per runner. Two processes with the same id (same machine, office and folder — say the
// old one is still up after the connection code changed) would each tell the office only about their
// own sessions, and the office would hand the other one's work back to the board. The second one
// refuses to start instead.
const lockFile = path.join(home, `${RUNNER}.lock`);
function holder() {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid) || 0;
    if (!pid || pid === process.pid) return 0;
    process.kill(pid, 0); // throws when no such process
    return pid;
  } catch (e) {
    if (e && e.code === 'EPERM') return -1; // alive, someone else's
    // half-written by a runner starting this very moment: give it the benefit of the doubt
    if (e instanceof SyntaxError) {
      try {
        return Date.now() - fs.statSync(lockFile).mtimeMs < 5000 ? -1 : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }
}
function takeLock() {
  for (let i = 0; i < 4; i++) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') return; // cannot lock here at all (read-only home…): run as before
    }
    if (!holder()) {
      // left behind by a runner that was killed outright
      try {
        fs.unlinkSync(lockFile);
      } catch {
        /* another one got to it first */
      }
      continue;
    }
    // the old one may be shutting down right now — give it a moment before giving up
    if (i < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  const pid = holder();
  die(
    `❌ Một runner khác${pid > 0 ? ` (pid ${pid})` : ''} đang chạy cho cùng Office và thư mục ${workdir}.\n` +
      `   Hai runner trùng nhau sẽ thả phiên làm việc của nhau. Tắt runner cũ${pid > 0 ? ` (kill ${pid})` : ''} rồi chạy lại.\n` +
      `   Nếu chắc chắn không còn runner nào, xoá ${lockFile}.`,
  );
}
takeLock();
process.on('exit', () => {
  try {
    if (Number(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid) === process.pid) fs.unlinkSync(lockFile);
  } catch {
    /* not ours, or already gone */
  }
});

let state = { sessions: {}, exits: [] };
try {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (s && typeof s === 'object') state = { sessions: s.sessions || {}, exits: Array.isArray(s.exits) ? s.exits : [] };
} catch {
  /* first run */
}
function saveState() {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  } catch (e) {
    log('⚠️  không ghi được trạng thái:', e.message);
  }
}

/** agent id → the live child process */
const running = new Map();
/** agent id → { until, why } — sessions waiting to be resumed */
const waiting = new Map();

/** Claude cannot be reached from this machine: nothing new starts until it answers again. */
let outage = null; // { until, why, n }
let outageStreak = 0;
let lastOutageEnd = 0;

const TRANSIENT = /api.?error|connection|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|overloaded|\b5\d\d\b|rate.?limit|usage limit|hit your limit|timed? ?out|temporarily|unavailable/i;
// the plan's quota ran out ("You've hit your 5-hour limit · resets 2:30pm (Asia/Ho_Chi_Minh)",
// "Claude AI usage limit reached|1731500000", "weekly limit"…): nothing is broken, the work just
// waits for the reset — it never counts as a failure, and nothing new is started until then
// a minute after the reset, so the first try lands on a fresh quota (tests shorten it)
const RESET_GRACE = Number(process.env.OFFICE_RESET_GRACE_MS) || 60_000;
const LIMIT = /hit your [\w -]{0,24}limit|usage limit|limit reached|out of (extra )?usage|(5-hour|weekly|opus|session) limit/i;
/** A whole answer that is only Claude Code saying the quota ran out (not work that mentions limits). */
const limitOnly = (text) => typeof text === 'string' && text.length < 300 && LIMIT.test(text);

/** Minutes the zone is ahead of UTC at `t`. */
function zoneOffset(zone, t) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t) / 60_000);
  } catch {
    return -new Date(t).getTimezoneOffset();
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** When a quota message says it resets: "|1731500000", "resets 2:30pm (Asia/Ho_Chi_Minh)",
 *  "resets Nov 15, 9am (Europe/Paris)", "resets at 14:30". 0 when it does not say. */
function resetAt(text, now = Date.now()) {
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;
  const m = /resets?\s+(?:at\s+|on\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(text);
  if (!m) return 0;
  let h = Number(m[3]);
  const min = Number(m[4] || 0);
  if (m[5]) h = (h % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0);
  if (h > 23 || min > 59) return 0;
  const t0 = Math.floor(now / 60_000) * 60_000;
  const off = zoneOffset(m[6] || Intl.DateTimeFormat().resolvedOptions().timeZone, t0);
  const wall = new Date(t0 + off * 60_000);
  const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (m[1] && month >= 0) {
    let at = Date.UTC(wall.getUTCFullYear(), month, Number(m[2]), h, min) - off * 60_000;
    if (at < now - 86400_000) at = Date.UTC(wall.getUTCFullYear() + 1, month, Number(m[2]), h, min) - off * 60_000;
    return at;
  }
  let at = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), h, min) - off * 60_000;
  if (at <= now) at += 86400_000;
  return at;
}

/** Claude is down or unreachable: back off (30 s, 1, 2, 4, 8, 10 min…) and say so. */
function enterOutage(why) {
  const now = Date.now();
  outageStreak = now - lastOutageEnd < 5 * 60_000 || outage ? outageStreak + 1 : 1;
  let delay = Math.min(10 * 60_000, 30_000 * 2 ** (outageStreak - 1));
  // a quota that ran out says when it resets: wait for that instead of knocking every few minutes
  if (LIMIT.test(why)) {
    const reset = resetAt(why, now);
    delay = reset > now ? Math.min(8 * 86400_000, reset - now + RESET_GRACE) : 15 * 60_000;
  }
  outage = { until: now + delay, why: clip(why, 100) || 'mất kết nối tới Claude', n: outageStreak };
  log(`📶 Claude không trả lời (${outage.why}) — thử lại sau ${Math.round(delay / 1000)} giây`);
}

/** Is the internet (and Claude's API host) there at all? Any HTTP answer counts. */
async function online() {
  try {
    await fetch(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', { method: 'HEAD', signal: AbortSignal.timeout(6000) });
    return true;
  } catch {
    return false;
  }
}

async function checkOutage() {
  if (!outage || Date.now() < outage.until) return;
  if (!(await online())) {
    enterOutage(`${outage.why} (vẫn chưa có mạng)`);
    return;
  }
  log('📶 có kết nối lại — làm tiếp');
  outage = null;
  lastOutageEnd = Date.now();
}

/** `auth` is a file holding the Authorization header: on the command line curl would show it in `ps`. */
function hooksFor(agent, auth) {
  const cmd = `curl -sf -m 4 -X POST -H @'${auth}' -H 'X-Office-Agent: ${agent.id}' -H 'X-Office-Dept: ${agent.dept}' -H 'Content-Type: application/json' --data-binary @- '${base}/api/activity?v=2' 2>/dev/null || true # office-runner`;
  const h = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] }];
  return { hooks: { SessionStart: h(), UserPromptSubmit: h(), PostToolUse: h('*'), Notification: h(), Stop: h(), SessionEnd: h() } };
}

/** The department's profile → claude flags. Commands: only what the profile asks for AND you allow. */
function flagsFor(profile, approvals) {
  const args = [];
  const allowed = ['mcp__office'];
  const bash = (profile.bash || []).filter((b) => TRUST || OWNER_ALLOW.includes(b));
  allowed.push(...bash);
  const edit = String(profile.edit || 'all').trim();
  let mode = 'acceptEdits';
  if (edit === 'none') {
    mode = 'default';
    args.push('--disallowedTools', 'Edit,Write,MultiEdit,NotebookEdit');
  } else if (edit !== 'all') {
    mode = 'default';
    for (const g of edit.split(',').map((s) => s.trim()).filter(Boolean)) allowed.push(`Edit(${g})`, `Write(${g})`, `MultiEdit(${g})`);
  }
  // office set to "tự động": Claude Code's own auto mode — but only where the department may edit
  // everything anyway, so a lane limited to some files stays limited
  if (approvals === 'auto' && edit === 'all') mode = 'auto';
  // whatever is not allowed outright is asked in the office (Tổng quản, or a 🔐 card) instead of failing
  args.push('--permission-mode', String(opt.mode || mode), '--allowedTools', allowed.join(','), '--permission-prompt-tool', 'mcp__office__permission');
  if (profile.model && profile.model !== 'default') args.push('--model', profile.model);
  const rules = [
    profile.prompt || '',
    '',
    '## Quy tắc chung',
    '- Mỗi việc có một luồng trao đổi riêng: mcp__office__chat_send để báo tiến độ/kết quả, mcp__office__ask_human khi thật sự cần người giao việc quyết. Đồng nghiệp đang làm cùng việc đó nghe được bạn (mcp__office__chat_wait để nghe họ), người giao việc đọc được cả luồng.',
    '- Nhắn như người với người: tiếng Việt tự nhiên, 1–3 câu, không markdown, không dán log/mã lỗi dài (để chi tiết trong note của việc). Ví dụ: "Mình sửa xong lỗi giỏ hàng rồi, phần mã giảm giá mình để QA kiểm lại nhé."',
    '- Hỏi ít, hỏi đúng: chỉ hỏi thứ mà đoán sai là phải làm lại. Còn lại tự quyết và ghi giả định vào note.',
    '- Phần việc của phòng khác → mcp__office__handoff, ghi rõ đã làm gì, còn gì, file nào. Việc phân công chung do 🧠 Tổng quản lo, bạn không cần gọi phòng khác.',
    '- Không làm việc phá huỷ hoặc ra bên ngoài (deploy, push, xoá dữ liệu, gửi email…) nếu việc không ghi rõ yêu cầu.',
    '- Note cuối cùng của việc là thứ Tổng quản đọc để báo kết quả cho người giao: ghi rõ kết quả (file, nhánh, link, lệnh kiểm tra) và điều còn dở.',
    '- Xong việc: mcp__office__debrief (làm gì, lỗi gì, cách xử lý, bài học; không ghi mật khẩu/token). Bài học chỉ đúng với dự án này hay với máy này thì nói rõ.',
  ].join('\n');
  args.push('--append-system-prompt', rules);
  return { args, bash, mode: String(opt.mode || mode) };
}

function promptFor(job, agent) {
  const who = `Bạn là ${agent.name} (phòng ${NAMES[agent.dept]}). Mã: ${agent.id}.`;
  if (job.kind === 'task') {
    const t = job.task;
    return [
      who,
      `Việc #${t.short}: ${t.title}`,
      t.desc ? `\n${t.desc}` : '',
      '',
      agent.dept === 'lead'
        ? `Đọc bối cảnh (code, tài liệu) nếu cần, rồi giao từng phần cho đúng phòng bằng mcp__office__handoff. Xong: mcp__office__task_update id="${t.short}" col="done" kèm note kế hoạch (ai làm gì).`
        : `Mở kỹ năng phù hợp (mcp__office__skill) rồi làm trong thư mục hiện tại. Thiếu một thông tin mà đoán sai thì hỏng cả việc: mcp__office__ask_human một câu duy nhất; chi tiết nhỏ thì tự quyết và ghi giả định vào note. Xong: mcp__office__task_update id="${t.short}" col="review" (hoặc "done" nếu chắc chắn không cần duyệt) kèm note kết quả. Không làm được: col="todo" và note lý do.`,
    ].join('\n');
  }
  if (job.kind === 'meeting') {
    const m = job.meeting;
    const others = m.depts.filter((d) => d !== agent.dept).map((d) => NAMES[d]).join(', ');
    return m.chair
      ? [
          who,
          `Bạn chủ trì cuộc họp "${m.topic}" (${m.by} yêu cầu, ${m.room}). Thành phần: ${others || 'chỉ phòng bạn'}.`,
          m.agenda ? `Chương trình: ${m.agenda}` : '',
          'Mở kỹ năng "chu-tri-hop" (mcp__office__skill) nếu có. Mở đầu bằng mcp__office__meeting_say, nghe bằng mcp__office__meeting_wait (người các phòng tới trong khoảng một phút), điều phối từng người, rồi mcp__office__meeting_end với summary và actions (mỗi việc một phòng).',
        ].join('\n')
      : [
          who,
          `Bạn được mời họp "${m.topic}" (${m.by} gọi, ${m.room}) để góp ý từ phía phòng ${NAMES[agent.dept]}.`,
          m.agenda ? `Chương trình: ${m.agenda}` : '',
          'Nghe bằng mcp__office__meeting_wait; phát biểu ngắn bằng mcp__office__meeting_say khi được hỏi hoặc có ý quan trọng. Được đọc code/tài liệu để trả lời chính xác. Ở lại tới khi meeting_wait báo ĐÃ KẾT THÚC rồi dừng.',
        ].join('\n');
  }
  return [
    who,
    'Việc: đúc rút kinh nghiệm từ các bản tóm tắt phiên làm việc.',
    'Làm theo kỹ năng "dut-rut" (mcp__office__skill name="dut-rut"): debriefs_pending → lessons → lesson_save / lesson_retire → debriefs_done → chat_send một dòng tổng kết.',
  ].join('\n');
}


/** What a resumed session is told: it is the same conversation, picked up after a break. */
function resumePrompt(why) {
  return [
    `Phiên làm việc vừa bị ngắt giữa chừng (${why || 'mất kết nối'}) và giờ đã có kết nối lại.`,
    'Tiếp tục đúng việc đang làm dở, từ chỗ đã dừng — đừng làm lại từ đầu. Trước khi làm tiếp, kiểm tra nhanh trạng thái hiện tại (file đã sửa tới đâu, lệnh cuối chạy xong chưa) vì thao tác cuối có thể chưa hoàn tất.',
    'Nếu việc đã xong trước khi bị ngắt thì báo kết quả như bình thường (task_update, debrief).',
  ].join('\n');
}

const base_ = (p) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() || '' : '');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** One stream-json tool call → a line a colleague would say (copy of shared/human-log.ts humanTool). */
const DEPT_NAME = (d) => NAMES[d] || 'phòng khác';
function toolLine(name, input = {}) {
  const office = /^mcp__office__(.+)$/.exec(name);
  if (office) {
    switch (office[1]) {
      case 'chat_send':
        return { icon: '💬', text: input.text ? `Nhắn: “${clip(input.text, 110)}”` : 'Nhắn cho đồng nghiệp' };
      case 'chat_read':
        return { icon: '💬', text: 'Đọc tin nhắn mới' };
      case 'chat_wait':
        return { icon: '⏳', text: 'Đang chờ trả lời' };
      case 'ask_human':
        return { icon: '🙋', text: input.question ? `Hỏi lại: “${clip(input.question, 110)}”` : 'Hỏi lại người giao việc' };
      case 'skill':
        return { icon: '📘', text: input.name ? `Xem lại quy trình “${clip(input.name, 40)}”` : 'Xem các quy trình của phòng' };
      case 'tasks':
        return { icon: '📋', text: 'Xem bảng công việc' };
      case 'task_get':
        return { icon: '📋', text: 'Đọc kỹ đầu việc' };
      case 'task_claim':
        return { icon: '🙋', text: 'Nhận việc' };
      case 'task_update':
        return input.col === 'review'
          ? { icon: '👀', text: 'Báo xong việc, chờ người duyệt' }
          : input.col === 'done'
            ? { icon: '✅', text: 'Đánh dấu việc đã hoàn thành' }
            : input.col === 'todo'
              ? { icon: '↩️', text: 'Trả việc lại bảng' }
              : { icon: '📝', text: 'Ghi chú tiến độ vào việc' };
      case 'handoff':
        return { icon: '📨', text: `Chuyển việc cho bên ${DEPT_NAME(input.dept)}: “${clip(input.title, 80)}”` };
      case 'meeting_call':
        return { icon: '📅', text: `Mời họp: “${clip(input.topic, 80)}”` };
      case 'meeting_wait':
        return { icon: '👂', text: 'Đang nghe mọi người trong cuộc họp' };
      case 'meeting_say':
        return { icon: '🗣️', text: input.text ? `Phát biểu: “${clip(input.text, 110)}”` : 'Phát biểu trong cuộc họp' };
      case 'meeting_end':
        return { icon: '📅', text: 'Chốt lại cuộc họp và giao việc' };
      case 'lessons':
        return { icon: '📚', text: 'Xem sổ kinh nghiệm' };
      case 'debrief':
        return { icon: '🧾', text: 'Viết tóm tắt sau khi xong việc' };
      case 'debriefs_pending':
        return { icon: '🧾', text: 'Đọc các bản tóm tắt của mọi người' };
      case 'lesson_save':
        return { icon: '📚', text: 'Ghi thêm một bài học vào sổ' };
      case 'lesson_retire':
        return { icon: '📚', text: 'Gỡ một bài học đã cũ' };
      case 'debriefs_done':
        return { icon: '📚', text: 'Đánh dấu đã đúc rút xong' };
      default:
        return { icon: '🔌', text: 'Dùng công cụ của văn phòng' };
    }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { icon: '🔌', text: `Dùng ${mcp[1]} (${mcp[2].replace(/_/g, ' ')})` };
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✏️', text: `Đang sửa ${base_(input.file_path)}` };
    case 'Write':
      return { icon: '📝', text: `Đang viết ${base_(input.file_path)}` };
    case 'Read':
      return { icon: '📖', text: `Đang đọc ${base_(input.file_path)}` };
    case 'Bash': {
      if (input.description) return { icon: '⚡', text: `Chạy lệnh: ${clip(input.description, 90)}` };
      const cmd = String(input.command || '').trim().split(/\s+/).slice(0, 2).join(' ').replace(/[A-Za-z0-9_-]{24,}/g, '•••');
      return { icon: '⚡', text: cmd ? `Chạy lệnh ${clip(cmd, 40)}` : 'Chạy một lệnh terminal' };
    }
    case 'Grep':
      return { icon: '🔎', text: `Tìm “${clip(input.pattern, 40)}” trong code` };
    case 'Glob':
      return { icon: '🗂️', text: `Tìm các file ${clip(input.pattern, 40)}` };
    case 'WebFetch': {
      let host = '';
      try {
        host = new URL(String(input.url)).hostname;
      } catch {
        /* ignore */
      }
      return { icon: '🌐', text: `Đọc trang ${host || 'web'}` };
    }
    case 'WebSearch':
      return { icon: '🌐', text: `Tra cứu “${clip(input.query, 50)}”` };
    case 'TodoWrite':
      return { icon: '📋', text: `Lên danh sách ${Array.isArray(input.todos) ? input.todos.length : 0} việc cần làm` };
    case 'Task':
    case 'Agent':
      return { icon: '🤖', text: `Nhờ trợ lý làm: ${clip(input.description, 60) || 'một phần việc'}` };
    default:
      return { icon: '🔧', text: `Dùng ${clip(name, 40)}` };
  }
}

/** Batches stream events to the office (one POST a second at most). */
function feeder(agentId) {
  let queue = [];
  let timer = null;
  const flush = async () => {
    timer = null;
    if (!queue.length) return;
    const events = queue.splice(0, 30);
    await api('/api/agents/feed', { agent: agentId, events }).catch(() => {});
    if (queue.length) timer = setTimeout(flush, 800);
  };
  return {
    push(e) {
      queue.push(e);
      if (queue.length > 120) queue = queue.slice(-60);
      if (!timer) timer = setTimeout(flush, 800);
    },
    flush,
  };
}

/** Tell the office a session is over — now, or as soon as the office can be reached. */
async function reportExit(agentId, code, why) {
  state.exits.push({ agent: agentId, code, why: why || '' });
  delete state.sessions[agentId];
  saveState();
  await flushExits();
}

async function flushExits() {
  while (state.exits.length) {
    const e = state.exits[0];
    try {
      await api('/api/agents/exit', e);
    } catch (err) {
      return; // the office is unreachable: try again next round
    }
    state.exits.shift();
    saveState();
  }
}

/**
 * Start (or resume) one session. `entry` is what state.sessions keeps for it:
 * { agent, job, profile, approvals, sid, resumes, fresh }
 */
function start(entry, resume = false, why = '') {
  const { agent, job, profile } = entry;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-'));
  const settings = path.join(dir, 'settings.json');
  const mcp = path.join(dir, 'mcp.json');
  const auth = path.join(dir, 'auth.txt');
  // the connection code is in these files: readable by this user only
  fs.writeFileSync(auth, `Authorization: Bearer ${token}\n`, { mode: 0o600 });
  fs.writeFileSync(settings, JSON.stringify(hooksFor(agent, auth)), { mode: 0o600 });
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { office: { type: 'http', url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}`, 'X-Office-Agent': agent.id } } } }), { mode: 0o600 });
  const logFile = path.join(logs, `${new Date().toISOString().replace(/[:.]/g, '-')}-${agent.name.replace(/[^\w-]+/g, '_')}${resume ? '-tiep' : ''}.log`);
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  const f = flagsFor(profile || {}, entry.approvals);
  if (!entry.sid) entry.sid = crypto.randomUUID();
  // a known session id from the start, so a broken-off conversation can be resumed exactly
  const session = resume ? ['--resume', entry.sid] : ['--session-id', entry.sid];
  const args = ['-p', ...session, '--settings', settings, '--mcp-config', mcp, '--output-format', 'stream-json', '--verbose', ...f.args];
  state.sessions[agent.id] = entry;
  saveState();
  const child = spawn(CLAUDE, args, {
    cwd: workdir,
    env: { ...process.env, OFFICE_RUNNER: '1', OFFICE_AGENT_ID: agent.id, OFFICE_DEPT: agent.dept },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  child.stdin.end(resume ? resumePrompt(why) : promptFor(job, agent));
  const feed = feeder(agent.id);
  if (resume) feed.push({ kind: 'say', icon: '🔁', text: 'Có kết nối lại rồi, mình làm tiếp phần đang dở.' });
  const run = { child, dept: agent.dept, name: agent.name, meeting: job.kind === 'meeting', started: Date.now(), last: Date.now(), retries: 0, error: '', killed: '' };
  running.set(agent.id, run);
  let stderr = '';
  let gotResult = false;
  // stream-json: one JSON object per line — every message and tool call goes to the monitor
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    run.last = Date.now();
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      out.write(`${line}\n`);
      return;
    }
    if (m.type === 'system' && m.subtype === 'api_retry') {
      // Claude Code is retrying a failed API call by itself: note it, the watchdog decides later
      run.retries++;
      run.error = `lỗi API${m.error_status ? ` ${m.error_status}` : ''} (${m.error || 'không rõ'})`;
      out.write(`  📶 thử lại lần ${m.attempt}/${m.max_retries} — ${run.error}\n`);
      if (m.attempt === 3) feed.push({ kind: 'tool', icon: '📶', text: 'Kết nối tới Claude đang chập chờn, mình đợi một chút' });
    } else if (m.type === 'assistant') {
      run.retries = 0;
      if (outage) outage = null; // it answers again
      for (const c of m.message?.content || []) {
        if (c.type === 'text' && c.text?.trim()) {
          out.write(`⏺ ${c.text.trim()}\n`);
          feed.push({ kind: 'say', icon: '💭', text: String(c.text).slice(0, 600) }); // the office strips markdown
        } else if (c.type === 'tool_use') {
          const t = toolLine(c.name, c.input);
          out.write(`  ${t.icon} ${t.text}\n`);
          feed.push({ kind: 'tool', ...t });
        }
      }
    } else if (m.type === 'user') {
      for (const c of m.message?.content || []) {
        if (c.type === 'tool_result' && c.is_error) {
          const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '');
          out.write(`  ❌ ${clip(text, 300)}\n`);
          feed.push({ kind: 'result', icon: '❌', text: clip(text, 300) || 'lỗi' }); // the office says it plainly
        }
      }
    } else if (m.type === 'result') {
      gotResult = true;
      if (m.is_error || limitOnly(m.result)) run.error = clip(typeof m.result === 'string' ? m.result : m.subtype, 200) || run.error || 'lỗi';
      out.write(`\n= ${m.subtype} · ${m.num_turns ?? '?'} lượt · ${m.total_cost_usd != null ? `$${Number(m.total_cost_usd).toFixed(3)}` : ''}\n`);
      if (!m.is_error) feed.push({ kind: 'result', icon: '✅', text: `Xong việc sau ${m.num_turns ?? '?'} bước` });
    }
  });
  child.stderr.on('data', (d) => {
    out.write(d);
    stderr = (stderr + d).slice(-2000);
  });
  const kill = (reason) => {
    if (run.killed) return;
    run.killed = reason;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
  };
  run.kill = kill;
  // the whole session has a time limit; a session that says nothing for too long is stuck
  const timer = setTimeout(() => {
    log(`⏱️  ${agent.name} quá ${TIMEOUT / 60_000} phút — dừng phiên`);
    kill('timeout');
  }, TIMEOUT);
  const watchdog = setInterval(() => {
    if (Date.now() - run.last > STALL) {
      log(`🧊 ${agent.name} im lặng ${Math.round(STALL / 60_000)} phút — coi như treo, dừng để làm tiếp sau`);
      kill('stall');
    }
  }, 30_000);
  let done = false;
  const finish = async (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    running.delete(agent.id);
    await feed.flush();
    out.end();
    fs.rmSync(dir, { recursive: true, force: true });
    if (run.killed === 'gone' || run.killed === 'shutdown') return; // the office let it go / we are stopping
    const errText = `${run.error} ${clip(stderr, 300)}`;
    // resuming a conversation Claude Code never saved: start it over (not a failure)
    if (resume && code !== 0 && /no conversation found|session.*not found|could not find session/i.test(errText)) {
      log(`↩️  ${agent.name}: không mở lại được phiên cũ, bắt đầu lại từ đầu`);
      entry.sid = crypto.randomUUID();
      start(entry, false);
      return;
    }
    const ok = code === 0 && !run.error && !run.killed;
    if (ok) {
      outageStreak = 0;
      log(`✅ ${agent.name} xong — log: ${logFile}`);
      await reportExit(agent.id, 0, '');
      return;
    }
    // broke off because Claude could not be reached: keep the session, resume it later
    const limited = LIMIT.test(errText);
    const transient = limited || run.killed === 'stall' || run.retries > 0 || TRANSIENT.test(errText) || (!gotResult && !(await online()));
    if (transient && run.killed !== 'timeout') {
      // waiting out a quota is not a breakdown: it never uses up the session's tries
      if (!limited) entry.resumes = (entry.resumes || 0) + 1;
      if (entry.resumes > MAX_RESUMES) {
        log(`⚠️  ${agent.name}: đã làm tiếp ${MAX_RESUMES} lần vẫn bị ngắt — trả việc về Office`);
        await reportExit(agent.id, 75, `bị ngắt kết nối ${MAX_RESUMES} lần liền`);
        return;
      }
      const why = run.killed === 'stall' ? 'phiên bị treo, không phản hồi' : run.error || 'mất kết nối tới Claude';
      enterOutage(why);
      entry.why = why;
      state.sessions[agent.id] = entry;
      saveState();
      waiting.set(agent.id, { until: outage.until, why });
      log(`⏸️  ${agent.name} tạm dừng (${why}) — sẽ làm tiếp đúng phiên này khi có kết nối (lần ${entry.resumes}/${MAX_RESUMES})`);
      return;
    }
    const why = run.killed === 'timeout' ? `quá ${TIMEOUT / 60_000} phút` : clip(run.error || stderr, 150) || `mã ${code}`;
    log(`⚠️  ${agent.name} dừng (${why}) — log: ${logFile}`);
    await reportExit(agent.id, code || 1, why);
  };
  child.on('exit', (code) => void finish(code ?? 1));
  child.on('error', (e) => {
    log(`❌ không chạy được "${CLAUDE}": ${e.message}`);
    void finish(127);
  });
  const what = job.kind === 'task' ? job.task.title : job.kind === 'meeting' ? `${job.meeting.chair ? 'chủ trì' : 'họp'}: ${job.meeting.topic}` : 'đúc rút kinh nghiệm';
  log(`${resume ? '🔁' : '▶️ '} ${agent.name} (${NAMES[agent.dept]}) ${what}  [${f.mode}${f.bash.length ? `, lệnh: ${f.bash.join(' ')}` : ''}${profile?.model && profile.model !== 'default' ? `, ${profile.model}` : ''}]`);
}

// ---------------------------------------------------------------- the orchestrator's thinking
// One empty directory, reused for every decision. Empty on purpose — no project files, no CLAUDE.md,
// nothing to read or change — and the SAME one every time, so Claude Code's own prompt prefix stays
// byte-identical and gets served from cache. A fresh temp dir each time costs about twice as much.
const brainDir = path.join(home, 'brain');
fs.mkdirSync(brainDir, { recursive: true });
fs.writeFileSync(path.join(brainDir, 'settings.json'), '{}');

/** One thought: a short prompt, no repo, no tools. Returns what the model printed. */
function think(job) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model',
      job.model,
      '--output-format',
      'json',
      '--settings',
      path.join(brainDir, 'settings.json'),
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--disallowed-tools',
      'Bash,Edit,Write,MultiEdit,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite',
      '--system-prompt',
      job.system,
    ];
    const child = spawn(CLAUDE, args, { cwd: brainDir, env: { ...process.env, OFFICE_RUNNER: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(e));
    const timer = setTimeout(() => child.kill('SIGTERM'), job.timeoutMs || 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      let m = null;
      try {
        m = JSON.parse(out);
      } catch {
        /* not JSON */
      }
      // an API error comes back as a "result" too — that is Claude being unreachable, not an answer
      if (m && (m.is_error || limitOnly(m.result))) return reject(new Error(clip(typeof m.result === 'string' ? m.result : m.subtype, 200) || 'lỗi API'));
      if (code !== 0) return reject(new Error(code === null ? 'quá thời gian' : `claude thoát mã ${code}: ${clip(err, 200)}`));
      resolve(m && typeof m.result === 'string' ? m.result : out); // the office parses it either way
    });
    child.stdin.end(job.prompt);
  });
}

let thinkingNow = 0;
const LABEL = { decide: 'quyết định', approve: 'duyệt quyền', report: 'báo cáo kết quả' };

async function thought(job) {
  const started = Date.now();
  let raw;
  try {
    raw = await think(job);
    outageStreak = 0;
  } catch (e) {
    const msg = clip(e.message, 200);
    log(`🧠 ⚠️  ${LABEL[job.kind] || 'quyết định'}: ${msg}`);
    if (TRANSIENT.test(msg) || !(await online())) enterOutage(msg);
    // the office puts it back without blaming the request
    await api('/api/agents/brain', { id: job.id, raw: '', error: msg || 'lỗi' }).catch(() => {});
    return;
  }
  // the model answered: deliver THAT answer, never an error in its place — a POST that timed out may
  // well have landed, and the office takes the same answer twice as once. Three tries fit in the
  // lease's slack; after that the lease runs out and the office hands it out again.
  for (let i = 0; i < 3; i++) {
    try {
      const res = await api('/api/agents/brain', { id: job.id, raw }, 15_000);
      log(`🧠 ${LABEL[job.kind] || 'quyết định'} xong sau ${((Date.now() - started) / 1000).toFixed(1)}s${res && res.ok === false ? ` — office: ${res.error}` : ''}`);
      return;
    } catch (e) {
      log(`🧠 ⚠️  chưa gửi được ${LABEL[job.kind] || 'quyết định'} về Office: ${clip(e.message, 120)}`);
      if (i < 2) await sleep(3000 * (i + 1));
    }
  }
}

/** Long-polls the office for something to think about; two thoughts at a time at most. */
async function brainLoop() {
  for (;;) {
    if (outage || thinkingNow >= 2) {
      await sleep(2000);
      continue;
    }
    const asked = Date.now();
    let job = null;
    try {
      ({ job } = await api('/api/agents/brain?wait=20', undefined, 40_000));
    } catch {
      await sleep(5000);
      continue;
    }
    if (!job) {
      if (Date.now() - asked < 2000) await sleep(3000); // an office without long-polling answers at once
      continue;
    }
    thinkingNow++;
    void thought(job).finally(() => thinkingNow--);
  }
}

// ---------------------------------------------------------------- the work
const busyIn = (dept) => [...running.values()].filter((r) => r.dept === dept && !r.meeting).length;
const slots = () => running.size + [...waiting.keys()].length;

/** Check in with the office: who this runner is, what it runs, what waits — and get work back. */
async function round() {
  await flushExits();
  const jobs = await api('/api/agents/jobs', {
    depts: depts.join(','),
    machine: { id: RUNNER, label: MACHINE_LABEL, project: PROJECT },
    running: [...running.keys()],
    waiting: [...waiting.entries()].map(([agent, w]) => ({ agent, until: w.until, why: w.why })),
    outage: outage ? { until: outage.until, why: outage.why } : null,
  });
  // sessions the office already gave to someone else: stop them
  for (const id of jobs.gone || []) {
    const r = running.get(id);
    if (r) {
      log(`🛑 ${r.name}: Office đã trả việc này về bảng — dừng phiên`);
      r.kill('gone');
    }
    waiting.delete(id);
    delete state.sessions[id];
    saveState();
  }
  // broken-off sessions go on from where they stopped, once Claude answers again
  if (!outage)
    for (const [id, w] of [...waiting]) {
      if (Date.now() < w.until) continue;
      const entry = state.sessions[id];
      waiting.delete(id);
      if (entry) start(entry, true, w.why);
    }
  if (outage || slots() >= MAX) return;
  const queue = [];
  for (const m of jobs.meetings || []) queue.push({ kind: 'meeting', id: m.id, dept: m.dept, meeting: true });
  if (jobs.distill) queue.push({ kind: 'distill', dept: 'lead' });
  for (const t of jobs.tasks) queue.push({ kind: 'task', id: t.id, dept: t.dept });
  for (const j of queue) {
    if (slots() >= MAX) break;
    if (!j.meeting && busyIn(j.dept) >= PER_DEPT) continue;
    const r = await api('/api/agents/claim', { kind: j.kind, id: j.id, dept: j.dept, approvers: APPROVERS, machine: RUNNER, dir: workdir });
    if (!r.ok) continue;
    start({ agent: r.agent, job: { kind: j.kind, task: r.task, meeting: r.meeting }, profile: r.profile, approvals: r.approvals, sid: crypto.randomUUID(), resumes: 0 });
  }
}

/** After a restart: the sessions this runner had are picked up again where the office still has them. */
async function adoptAll() {
  for (const [id, entry] of Object.entries(state.sessions)) {
    let r;
    try {
      r = await api('/api/agents/adopt', { agent: id, machine: RUNNER });
    } catch (e) {
      log(`⚠️  chưa hỏi được Office về phiên ${entry.agent?.name || id}: ${e.message} — thử lại sau`);
      waiting.set(id, { until: Date.now() + 30_000, why: 'máy trực khởi động lại' });
      continue;
    }
    if (!r.ok) {
      log(`🗑️  ${entry.agent?.name || id}: ${r.error || 'Office không còn giữ phiên này'}`);
      delete state.sessions[id];
      continue;
    }
    entry.agent = r.agent;
    entry.profile = r.profile;
    entry.approvals = r.approvals;
    entry.job = { kind: r.kind, task: r.task, meeting: r.meeting };
    state.sessions[id] = entry;
    waiting.set(id, { until: Date.now(), why: 'máy trực vừa khởi động lại' });
    log(`♻️  nhận lại phiên của ${r.agent.name} — sẽ làm tiếp`);
  }
  saveState();
}

async function main() {
  log(`🏢 Office agent runner → ${base}`);
  log(`   dự án ${PROJECT} · máy ${MACHINE_LABEL} · thư mục ${workdir}`);
  log(`   phòng ban: ${depts.map((d) => NAMES[d]).join(', ')} · tối đa ${MAX} phiên`);
  log(`   tự cho phép: ${TRUST ? 'lệnh theo hồ sơ phòng ban (--trust-profiles)' : OWNER_ALLOW.length ? OWNER_ALLOW.join(', ') : 'không lệnh nào (chỉ đọc/sửa file theo hồ sơ)'}`);
  log(`   còn lại: theo cài đặt "Duyệt quyền" trong Office (Tổng quản duyệt, hoặc hỏi ${APPROVERS === 'anyone' ? 'bất kỳ ai' : 'bạn'})`);
  log(`   🧠 Tổng quản: ${BRAIN ? 'máy này phục vụ các quyết định điều phối' : 'tắt (--no-brain)'}`);
  if (Object.keys(state.sessions).length) await adoptAll();
  if (BRAIN && !opt.once) void brainLoop();
  for (;;) {
    await checkOutage();
    if (opt.once && BRAIN) {
      const r = await api('/api/agents/brain').catch(() => ({}));
      if (r.job) await thought(r.job);
    }
    try {
      await round();
    } catch (e) {
      log('⚠️  chưa liên lạc được Office:', e.message, '— các phiên vẫn làm tiếp, kết quả sẽ gửi khi có mạng');
    }
    if (opt.once) break;
    await sleep(waiting.size || outage ? 5_000 : 8_000);
  }
  if (opt.once) {
    while (running.size) await sleep(500);
    await flushExits();
  }
}

async function shutdown() {
  log('Đang dừng — trả việc dở dang về Kanban…');
  for (const [id, r] of running) {
    r.kill('shutdown');
    state.exits.push({ agent: id, code: 130, why: 'máy trực được tắt' });
  }
  for (const id of waiting.keys()) state.exits.push({ agent: id, code: 130, why: 'máy trực được tắt' });
  state.sessions = {};
  saveState();
  await flushExits().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
void main();
