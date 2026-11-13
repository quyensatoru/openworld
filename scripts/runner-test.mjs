// The on-call runner (public/office-agent.cjs) against a misbehaving Claude (scripts/fake-claude.cjs):
// Claude unreachable in the middle of a session, the runner killed outright and started again, and
// the runner stopped on purpose. The work must never be lost, and never redone from scratch.
//   BASE=http://localhost:5174 PASSCODE=office-dev node scripts/runner-test.mjs
// Runs the runner with its own HOME, so it never touches a real ~/.office-agent.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'office-dev';
const here = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(here, '..', 'public', 'office-agent.cjs');
const FAKE = path.join(here, 'fake-claude.cjs');
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 8);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-runner-test-'));
const HOME = path.join(tmp, 'home');
const FAKE_DIR = path.join(tmp, 'fake');
const PROJ = path.join(tmp, 'proj');
for (const d of [HOME, FAKE_DIR, PROJ]) fs.mkdirSync(d, { recursive: true });

const calls = () =>
  fs.existsSync(path.join(FAKE_DIR, 'calls.jsonl'))
    ? fs.readFileSync(path.join(FAKE_DIR, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
async function until(fn, ms, every = 300) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(every);
  }
}

(async () => {
  console.log(`Office: ${BASE}`);
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/ws`, { headers: { Cookie: cookie, Origin: BASE } });
  const inbox = [];
  ws.on('message', (raw, bin) => !bin && inbox.push(JSON.parse(raw.toString())));
  await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
  const send = (m) => ws.send(JSON.stringify(m));
  const seen = (pred) => [...inbox].reverse().find(pred);
  send({ t: 'hello', cid: `rtest_${run}`, name: 'Runner Tester', avatar: { body: 'default', hair: 'parted', skin: '#f6cfae', hairColor: '#3b2a20', top: '#7fa7c9', bottom: '#2d3142', shoes: '#333333', accessories: [], height: 1 } });
  const me = (await until(() => seen((m) => m.t === 'welcome'), 5000))?.you?.id;
  send({ t: 'activity:token' });
  const token = (await until(() => seen((m) => m.t === 'activityToken' && m.token), 5000))?.token;
  ok(!!me && !!token, 'a person with a connection code');

  const runners = [];
  const startRunner = () => {
    const child = spawn(process.execPath, [RUNNER, '--url', BASE, '--token', token, '--dir', PROJ, '--depts', 'dev', '--max', '1', '--claude', FAKE, '--no-brain', '--project', `rt-${run}`], {
      env: { ...process.env, HOME, FAKE_DIR, ANTHROPIC_BASE_URL: BASE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    runners.push(child);
    return { child, out: () => out };
  };
  const task = async (title) => {
    send({ t: 'task:create', title, col: 'todo', dept: 'dev', priority: 'urgent' });
    return (await until(() => seen((m) => m.t === 'task' && m.task.title === title), 5000))?.task;
  };
  const col = (id) => seen((m) => m.t === 'task' && m.task.id === id)?.task;

  // ---- 1. Claude unreachable mid-session: the employee waits, then the SAME session goes on
  let r = startRunner();
  const t1 = await task(`MAT-MANG ${run}`);
  const doing = await until(() => col(t1?.id)?.col === 'doing', 30_000);
  ok(!!doing, 'the runner takes the task');
  const told = await until(() => seen((m) => m.t === 'chat' && m.m.ch === `ask:${me}` && /bị ngắt giữa chừng/.test(m.m.text)), 30_000);
  ok(!!told, 'the API fails → the person hears it will go on by itself (no "trả về To do")');
  ok(col(t1?.id)?.col === 'doing', 'the task stays in Doing while it waits');
  const resumed = await until(() => col(t1?.id)?.col === 'review', 90_000, 1000);
  ok(!!resumed, 'once Claude answers again the work finishes');
  const c1 = calls().filter((c) => c.prompt.includes(`MAT-MANG ${run}`) || c.resumed);
  ok(c1.length >= 2 && c1[1].resumed && c1[1].sid === c1[0].sid, 'and it was the same conversation, resumed — not started over');
  ok(/Tiếp tục đúng việc đang làm dở/.test(c1[1]?.prompt ?? ''), 'the resumed session is told to go on from where it stopped');

  // ---- 2. the runner dies outright mid-session, and is started again
  const t2 = await task(`TREO ${run}`);
  const hung = await until(() => calls().find((c) => c.prompt.includes(`TREO ${run}`)), 30_000);
  ok(!!hung && col(t2?.id)?.col === 'doing', 'a second task is being worked on');
  r.child.kill('SIGKILL');
  try {
    process.kill(hung.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  const stateFile = fs.readdirSync(path.join(HOME, '.office-agent')).find((f) => /^r-[0-9a-f]+\.json$/.test(f));
  const saved = stateFile ? JSON.parse(fs.readFileSync(path.join(HOME, '.office-agent', stateFile), 'utf8')) : null;
  ok(Object.values(saved?.sessions ?? {}).some((s) => s.sid === hung?.sid), 'the session was written down before the crash');
  r = startRunner();
  const adopted = await until(() => calls().find((c) => c.resumed && c.sid === hung?.sid), 30_000);
  ok(!!adopted, 'the restarted runner picks the very same session back up');
  ok(!!(await until(() => col(t2?.id)?.col === 'review', 30_000)), 'and finishes it');
  ok(/nhận lại phiên/.test(r.out()), 'its log says so');

  // ---- 3. stopping the runner on purpose gives the work back without blaming it
  const t3 = await task(`TREO lần hai ${run}`);
  const hung3 = await until(() => calls().find((c) => c.prompt.includes(`TREO lần hai ${run}`)), 30_000);
  ok(!!hung3, 'a third task is being worked on');
  r.child.kill('SIGINT');
  const back = await until(() => col(t3?.id)?.col === 'todo' && /máy trực được tắt|Máy trực được tắt/.test(col(t3?.id)?.desc ?? ''), 15_000);
  ok(!!back, 'Ctrl+C puts it back in To do, saying why');
  try {
    process.kill(hung3.pid, 'SIGKILL');
  } catch {
    /* gone */
  }

  for (const t of [t1, t2, t3]) if (t) send({ t: 'task:delete', id: t.id });
  send({ t: 'activity:revoke' });
  await sleep(500);
  for (const c of runners) c.kill('SIGKILL');
  for (const c of calls()) {
    try {
      process.kill(c.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  ws.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
