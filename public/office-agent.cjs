#!/usr/bin/env node
// Office agent runner — keeps the departments' agents working on an always-on machine.
//
//   curl -fsSL https://<office>/office-agent.cjs -o office-agent.cjs
//   node office-agent.cjs --url https://<office> --token <mã-kết-nối> --dir ~/code/du-an [options]
//
// It does two different jobs, and the difference is the whole point:
//
//   1. THINKING (cheap).  It asks the office whether 🧠 Tổng quản has a decision to make, and if so
//      runs a short `claude -p` with no repo access at all — an empty working directory, no tools,
//      no MCP — that returns one JSON decision. A few seconds, a few thousand tokens.
//   2. DOING (expensive).  Only work the orchestrator actually put on the board starts a real
//      department session: `claude -p` in your project, set up with that department's profile
//      (prompt, model, which files it may edit, which commands it may run).
//
// Everything a doing session says and does is streamed to the office (its desk monitor).
//
// Options:
//   --depts dev,qa,ops,design,docs,biz,lead   departments this machine works for (default: all)
//   --max 3              sessions at the same time (default 3), --per-dept 1 (default 1, meetings excepted)
//   --timeout 40         minutes before a session is stopped (default 40)
//   --allow "Bash(npm test:*),Bash(git diff:*)"   commands you allow at most; a department only gets
//                        the ones its profile asks for AND you allow here
//   --trust-profiles     grant whatever commands the departments' profiles ask for
//                        Anything else a session wants to do (another command, a file outside its
//                        profile…) is asked in the office: you get a 🔐 card with Cho phép / Từ chối.
//   --approvers anyone   let anyone in the office approve (default: only you, the token's owner)
//   --mode <mode>        force one Claude Code permission mode for every session
//   --claude claude      the Claude Code command
//   --no-brain           do not serve the orchestrator's decisions from this machine (another one does)
//   --once               run one round, wait for the sessions, exit (for testing)
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

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
if (!opt.url || !opt.token) die('Cách dùng: node office-agent.cjs --url https://<office> --token <mã-kết-nối> --dir <thư mục dự án> [--depts dev,qa] [--max 3]');
const base = new URL(opt.url).origin;
const token = String(opt.token);
const workdir = path.resolve(String(opt.dir || process.cwd()).replace(/^~(?=$|\/)/, os.homedir()));
if (!fs.existsSync(workdir)) die(`Không thấy thư mục ${workdir}`);
const depts = String(opt.depts || ALL.join(',')).split(',').map((s) => s.trim()).filter((d) => ALL.includes(d));
if (!depts.length) die(`--depts phải gồm: ${ALL.join(', ')}`);
const MAX = Math.max(1, Number(opt.max) || 3);
const PER_DEPT = Math.max(1, Number(opt['per-dept']) || 1);
const TIMEOUT = Math.max(2, Number(opt.timeout) || 40) * 60_000;
const OWNER_ALLOW = String(opt.allow || '').split(',').map((s) => s.trim()).filter(Boolean);
const TRUST = !!opt['trust-profiles'];
const CLAUDE = String(opt.claude || 'claude');
const APPROVERS = opt.approvers === 'anyone' ? 'anyone' : 'owner';
const BRAIN = !opt['no-brain'];
const home = path.join(os.homedir(), '.office-agent');
const logs = path.join(home, 'logs');
fs.mkdirSync(logs, { recursive: true });

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function api(p, body) {
  const res = await fetch(`${base}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H });
  if (res.status === 401) die('❌ Mã kết nối sai hoặc đã bị đổi. Lấy mã mới trong Office → 🧠 → Kết nối.');
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
}

/** agent id → { child, dept, name, started } */
const running = new Map();
const log = (...a) => console.log(new Date().toLocaleTimeString('vi-VN'), ...a);

function hooksFor(agent) {
  const cmd = `curl -sf -m 4 -X POST -H 'Authorization: Bearer ${token}' -H 'X-Office-Agent: ${agent.id}' -H 'X-Office-Dept: ${agent.dept}' -H 'Content-Type: application/json' --data-binary @- '${base}/api/activity?v=2' 2>/dev/null || true # office-runner`;
  const h = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] }];
  return { hooks: { SessionStart: h(), UserPromptSubmit: h(), PostToolUse: h('*'), Notification: h(), Stop: h(), SessionEnd: h() } };
}

/** The department's profile → claude flags. Commands: only what the profile asks for AND you allow. */
function flagsFor(profile) {
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
  // whatever is not allowed outright is asked in the office (🔐 card for the owner) instead of failing
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
    '- Xong việc: mcp__office__debrief (làm gì, lỗi gì, cách xử lý, bài học; không ghi mật khẩu/token).',
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

function start(job, agent, profile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-agent-'));
  const settings = path.join(dir, 'settings.json');
  const mcp = path.join(dir, 'mcp.json');
  fs.writeFileSync(settings, JSON.stringify(hooksFor(agent)));
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { office: { type: 'http', url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}`, 'X-Office-Agent': agent.id } } } }));
  const logFile = path.join(logs, `${new Date().toISOString().replace(/[:.]/g, '-')}-${agent.name.replace(/[^\w-]+/g, '_')}.log`);
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  const f = flagsFor(profile || {});
  const args = ['-p', '--settings', settings, '--mcp-config', mcp, '--output-format', 'stream-json', '--verbose', ...f.args];
  const child = spawn(CLAUDE, args, {
    cwd: workdir,
    env: { ...process.env, OFFICE_RUNNER: '1', OFFICE_AGENT_ID: agent.id, OFFICE_DEPT: agent.dept },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  child.stdin.end(promptFor(job, agent));
  const feed = feeder(agent.id);
  // stream-json: one JSON object per line — every message and tool call goes to the monitor
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      out.write(`${line}\n`);
      return;
    }
    if (m.type === 'assistant') {
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
      out.write(`\n= ${m.subtype} · ${m.num_turns ?? '?'} lượt · ${m.total_cost_usd != null ? `$${Number(m.total_cost_usd).toFixed(3)}` : ''}\n`);
      feed.push({ kind: 'result', icon: m.is_error ? '⚠️' : '✅', text: m.is_error ? 'Phải dừng giữa chừng' : `Xong việc sau ${m.num_turns ?? '?'} bước` });
    }
  });
  child.stderr.on('data', (d) => out.write(d));
  running.set(agent.id, { child, dept: agent.dept, name: agent.name, meeting: job.kind === 'meeting', started: Date.now() });
  const timer = setTimeout(() => {
    log(`⏱️  ${agent.name} quá ${TIMEOUT / 60_000} phút — dừng phiên`);
    child.kill('SIGTERM');
  }, TIMEOUT);
  let reported = false;
  const finish = async (code) => {
    if (reported) return;
    reported = true;
    clearTimeout(timer);
    running.delete(agent.id);
    await feed.flush();
    out.end();
    fs.rmSync(dir, { recursive: true, force: true });
    log(`${code === 0 ? '✅' : '⚠️ '} ${agent.name} xong (mã ${code}) — log: ${logFile}`);
    await api('/api/agents/exit', { agent: agent.id, code }).catch((e) => log('exit report failed', e.message));
  };
  child.on('exit', (code) => void finish(code ?? 1));
  child.on('error', (e) => {
    log(`❌ không chạy được "${CLAUDE}": ${e.message}`);
    void finish(127);
  });
  const what = job.kind === 'task' ? job.task.title : job.kind === 'meeting' ? `${job.meeting.chair ? 'chủ trì' : 'họp'}: ${job.meeting.topic}` : 'đúc rút kinh nghiệm';
  log(`▶️  ${agent.name} (${NAMES[agent.dept]}) ${what}  [${f.mode}${f.bash.length ? `, lệnh: ${f.bash.join(' ')}` : ''}${profile?.model && profile.model !== 'default' ? `, ${profile.model}` : ''}]`);
}

// ---------------------------------------------------------------- the orchestrator's thinking
let thinking = false;

// One empty directory, reused for every decision. Empty on purpose — no project files, no CLAUDE.md,
// nothing to read or change — and the SAME one every time, so Claude Code's own prompt prefix stays
// byte-identical and gets served from cache. A fresh temp dir each time costs about twice as much.
const brainDir = path.join(home, 'brain');
fs.mkdirSync(brainDir, { recursive: true });
fs.writeFileSync(path.join(brainDir, 'settings.json'), '{}');

/** One decision: a short prompt, no repo, no tools. Returns what the model printed. */
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
    const done = (fn, v) => fn(v);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => done(reject, e));
    child.on('exit', (code) => {
      if (code !== 0) return done(reject, new Error(`claude thoát mã ${code}: ${clip(err, 200)}`));
      try {
        const m = JSON.parse(out);
        done(resolve, typeof m.result === 'string' ? m.result : out);
      } catch {
        done(resolve, out); // the office parses it either way
      }
    });
    child.stdin.end(job.prompt);
    setTimeout(() => child.kill('SIGTERM'), 120_000);
  });
}

async function brainRound() {
  if (!BRAIN || thinking) return;
  const { job } = await api('/api/agents/brain');
  if (!job) return;
  thinking = true;
  const started = Date.now();
  try {
    const raw = await think(job);
    const res = await api('/api/agents/brain', { id: job.id, raw });
    log(`🧠 quyết định xong sau ${((Date.now() - started) / 1000).toFixed(1)}s${res && res.ok === false ? ` — office: ${res.error}` : ''}`);
  } catch (e) {
    log('🧠 ⚠️ ', e.message);
  } finally {
    thinking = false;
  }
}

const busyIn = (dept) => [...running.values()].filter((r) => r.dept === dept && !r.meeting).length;

async function round() {
  if (running.size >= MAX) return;
  const jobs = await api(`/api/agents/jobs?depts=${depts.join(',')}`);
  const queue = [];
  for (const m of jobs.meetings || []) queue.push({ kind: 'meeting', id: m.id, dept: m.dept, meeting: true });
  if (jobs.distill) queue.push({ kind: 'distill', dept: 'lead' });
  for (const t of jobs.tasks) queue.push({ kind: 'task', id: t.id, dept: t.dept });
  for (const j of queue) {
    if (running.size >= MAX) break;
    if (!j.meeting && busyIn(j.dept) >= PER_DEPT) continue;
    const r = await api('/api/agents/claim', { kind: j.kind, id: j.id, dept: j.dept, approvers: APPROVERS });
    if (!r.ok) continue;
    start({ kind: j.kind, task: r.task, meeting: r.meeting }, r.agent, r.profile);
  }
}

async function main() {
  log(`🏢 Office agent runner → ${base}`);
  log(`   phòng ban: ${depts.map((d) => NAMES[d]).join(', ')} · tối đa ${MAX} phiên · thư mục ${workdir}`);
  log(`   tự cho phép: ${TRUST ? 'lệnh theo hồ sơ phòng ban (--trust-profiles)' : OWNER_ALLOW.length ? OWNER_ALLOW.join(', ') : 'không lệnh nào (chỉ đọc/sửa file theo hồ sơ)'}`);
  log(`   còn lại: hỏi ${APPROVERS === 'anyone' ? 'bất kỳ ai' : 'bạn'} trong Office (thẻ 🔐 chờ duyệt)`);
  log(`   🧠 Tổng quản: ${BRAIN ? 'máy này phục vụ các quyết định điều phối' : 'tắt (--no-brain)'}`);
  for (;;) {
    // thinking first: a decision is what puts work on the board in the first place
    await brainRound().catch((e) => log('🧠 ⚠️ ', e.message));
    try {
      await round();
    } catch (e) {
      log('⚠️ ', e.message);
    }
    if (opt.once) break;
    await new Promise((r) => setTimeout(r, thinking ? 3_000 : 8_000));
  }
  if (opt.once) {
    while (running.size) await new Promise((r) => setTimeout(r, 500));
  }
}

async function shutdown() {
  log('Đang dừng — trả việc dở dang về Kanban…');
  for (const [id, r] of running) {
    r.child.kill('SIGTERM');
    await api('/api/agents/exit', { agent: id, code: 130 }).catch(() => {});
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
void main();
