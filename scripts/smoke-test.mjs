// Protocol smoke test: two fake clients talk to a running office (vite dev or a deployed URL).
//   BASE=http://localhost:5173 PASSCODE=office-dev node scripts/smoke-test.mjs
import WebSocket from 'ws';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'office-dev';
const WS_BASE = BASE.replace(/^http/, 'ws');
const host = new URL(BASE).host;

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

async function login(passcode) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, cookie };
}

function client(cookie, cid, name) {
  const ws = new WebSocket(`${WS_BASE}/api/ws`, { headers: { Cookie: cookie, Origin: BASE } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  });
  const api = {
    ws,
    inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 4000) =>
      new Promise((resolve) => {
        const hit = inbox.find(pred);
        if (hit) return resolve(hit);
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            resolve(null);
          }
        }, ms);
      }),
    clear: () => inbox.splice(0),
    hello: async () => {
      if (ws.readyState !== WebSocket.OPEN)
        await new Promise((r, j) => {
          ws.once('open', r);
          ws.once('error', j);
        });
      api.send({ t: 'hello', cid, name, avatar: { body: 'default', hair: 'short', skin: '#f6cfae', hairColor: '#3b2a20', top: '#7fa7c9', bottom: '#2d3142', shoes: '#333333', accessories: [], height: 1 } });
      return api.wait((m) => m.t === 'welcome');
    },
    close: () => ws.close(),
  };
  return api;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Office: ${BASE}`);
  const session = await (await fetch(`${BASE}/api/session`)).json();
  ok(session.needPasscode === true, `/api/session says a passcode is required (office: ${session.office})`);

  const bad = await login('definitely-wrong');
  ok(bad.status === 401, 'wrong passcode is rejected');

  const denied = await new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/api/ws`, { headers: { Origin: BASE } });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('open', () => resolve(101));
    ws.on('error', () => resolve('error'));
  });
  ok(denied !== 101, `websocket without session is refused (${denied})`);

  const good = await login(PASSCODE);
  ok(good.status === 200 && good.cookie.startsWith('bo_sess='), 'correct passcode sets a session cookie');

  const run = Date.now().toString(36);
  const A = client(good.cookie, `smokeA_${run}`, 'Smoke A');
  const B = client(good.cookie, `smokeB_${run}`, 'Smoke B');
  const wa = await A.hello();
  ok(wa?.t === 'welcome' && wa.you.name === 'Smoke A', 'A gets welcome');
  const wb = await B.hello();
  ok(wb?.players?.some((p) => p.id === `smokeA_${run}`), 'B sees A in the welcome player list');
  ok(!!(await A.wait((m) => m.t === 'join' && m.p.id === `smokeB_${run}`)), 'A is told B joined');

  // movement relay (A walks into the lobby centre)
  A.send({ t: 'move', x: 20, z: 24, ry: 1, anim: 'walk' });
  ok(!!(await B.wait((m) => m.t === 'mv' && m.id === `smokeA_${run}` && m.x === 20)), 'B receives A movement');

  // zone chat isolation: B walks into the pantry
  B.send({ t: 'move', x: 35, z: 24, ry: 0, anim: 'idle' });
  ok(!!(await A.wait((m) => m.t === 'upd' && m.id === `smokeB_${run}` && m.patch.zone === 'pantry')), 'zone change of B is broadcast (pantry)');
  B.clear();
  A.send({ t: 'chat', ch: 'zone', text: 'chỉ sảnh nghe thấy' });
  ok(!!(await A.wait((m) => m.t === 'chat' && m.m.ch === 'zone:lobby')), 'A gets its own zone message');
  ok(!(await B.wait((m) => m.t === 'chat' && m.m.ch.startsWith('zone:'), 800)), 'B (other zone) does not get it');
  A.send({ t: 'chat', ch: 'global', text: `xin chào @Smoke B ${run}` });
  ok(!!(await B.wait((m) => m.t === 'chat' && m.m.ch === 'global' && m.m.text.includes(run))), 'global chat reaches B');

  // status + seat + worklog
  A.send({ t: 'sit', seat: 'desk-01' });
  ok(!!(await B.wait((m) => m.t === 'upd' && m.id === `smokeA_${run}` && m.patch.seat === 'desk-01')), 'A sits at desk-01');
  B.send({ t: 'sit', seat: 'desk-01' });
  ok(!!(await B.wait((m) => m.t === 'err' && /Ghế/.test(m.msg))), 'B cannot take an occupied seat');
  A.send({ t: 'status', status: 'working', manual: false });
  const todayA = await A.wait((m) => m.t === 'today' && m.today.checkIn);
  ok(!!todayA, 'A is checked in once working at a desk');

  // tasks
  A.send({ t: 'task:create', title: `Smoke task ${run}`, col: 'todo', assignee: `smokeA_${run}` });
  const created = await B.wait((m) => m.t === 'task' && m.task.title === `Smoke task ${run}`);
  ok(!!created, 'B receives the new task');
  const id = created?.task.id;
  A.send({ t: 'task:move', id, col: 'doing', ord: 1 });
  ok(!!(await B.wait((m) => m.t === 'upd' && m.id === `smokeA_${run}` && m.patch.taskId === id)), 'moving own task to Doing sets current task');
  A.send({ t: 'task:move', id, col: 'done', ord: 1 });
  ok(!!(await B.wait((m) => m.t === 'chat' && m.m.from === 'system' && m.m.text.includes(run))), 'finishing a task posts a system message');
  ok(!!(await A.wait((m) => m.t === 'today' && m.today.tasksDone >= 1)), 'A worklog counts the finished task');

  // WebRTC signaling relay
  A.send({ t: 'rtc', to: `smokeB_${run}`, data: { type: 'offer', sdp: 'v=0 smoke' } });
  ok(!!(await B.wait((m) => m.t === 'rtc' && m.from === `smokeA_${run}` && m.data.sdp === 'v=0 smoke')), 'rtc signal relayed A → B');

  // cinema: shared playback state
  A.send({ t: 'cinema', action: 'play', videoId: 'dQw4w9WgXcQ', at: 30 });
  const cine = await B.wait((m) => m.t === 'cinema' && m.state?.videoId === 'dQw4w9WgXcQ');
  ok(!!cine && Math.abs((Date.now() - cine.state.startAt) / 1000 - 30) < 5, 'cinema play is broadcast with a shared start time');
  await sleep(450);
  B.send({ t: 'cinema', action: 'pause' });
  ok(!!(await A.wait((m) => m.t === 'cinema' && m.state?.pausedAt != null)), 'anyone can pause the cinema');

  // bar jukebox: separate shared state, same rules as the cinema
  await new Promise((r) => setTimeout(r, 450)); // per-connection media rate limit
  A.send({ t: 'jukebox', action: 'play', videoId: 'kJQP7kiw5Fk', at: 0 });
  const jb = await B.wait((m) => m.t === 'jukebox' && m.state?.videoId === 'kJQP7kiw5Fk');
  ok(!!jb && jb.state.pausedAt == null, 'jukebox song is broadcast to the bar');

    // Office Net: snake arena + caro
  A.send({ t: 'arcade', m: { a: 'snake:join' } });
  B.send({ t: 'arcade', m: { a: 'snake:join' } });
  const cd = await A.wait((m) => m.t === 'snake' && m.f.phase === 'countdown' && m.f.queue.length === 2);
  ok(!!cd, 'snake: both players are in the countdown');
  const play = await B.wait((m) => m.t === 'snake' && m.f.phase === 'play' && m.f.players.length === 2, 7000);
  ok(!!play && play.f.players.every((p) => p.body.length === 6 && p.alive), 'snake: round starts with two snakes');
  A.send({ t: 'arcade', m: { a: 'snake:dir', d: 2 } });
  const moved = await A.wait((m) => m.t === 'snake' && m.f.phase === 'play' && m.f.players.find((p) => p.id === `smokeA_${run}`)?.body[1] !== play.f.players.find((p) => p.id === `smokeA_${run}`).body[1]);
  ok(!!moved, 'snake: steering changes direction');
  A.send({ t: 'arcade', m: { a: 'snake:leave' } });
  B.send({ t: 'arcade', m: { a: 'snake:leave' } });
  A.clear();
  B.clear();
  A.send({ t: 'arcade', m: { a: 'caro:queue' } });
  ok(!!(await A.wait((m) => m.t === 'caro' && m.queued)), 'caro: A waits in the queue');
  B.send({ t: 'arcade', m: { a: 'caro:queue' } });
  const cg = await B.wait((m) => m.t === 'caro' && m.g && !m.g.winner);
  ok(!!cg, 'caro: B is matched with A');
  if (cg) {
    // X plays a vertical five, O plays elsewhere
    const xs = cg.g.x === `smokeA_${run}` ? A : B;
    const os = xs === A ? B : A;
    for (let k = 0; k < 5; k++) {
      xs.send({ t: 'arcade', m: { a: 'caro:move', i: 15 * (3 + k) + 3 } });
      await (xs === A ? A : B).wait((m) => m.t === 'caro' && m.g?.moves === k * 2 + 1);
      if (k < 4) {
        os.send({ t: 'arcade', m: { a: 'caro:move', i: 15 * (3 + k) + 9 } });
        await os.wait((m) => m.t === 'caro' && m.g?.moves === k * 2 + 2);
      }
    }
    const end = await os.wait((m) => m.t === 'caro' && m.g?.winner === 'x');
    ok(!!end && end.g.line?.length === 5, 'caro: five in a row wins');
  }

  // Claude Code activity: token over WS, hook payload over HTTP, broadcast to the office
  A.send({ t: 'activity:token' });
  const tok = await A.wait((m) => m.t === 'activityToken' && m.token);
  ok(!!tok, 'A gets a Claude Code hook token');
  const hook = { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/home/dev/proj/src/checkout.ts', old_string: 'SECRET' }, cwd: '/home/dev/proj' };
  const res = await fetch(`${BASE}/api/activity`, { method: 'POST', headers: { Authorization: `Bearer ${tok?.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(hook) });
  ok(res.status === 200, `hook endpoint accepts the token (${res.status})`);
  const act = await B.wait((m) => m.t === 'activity' && m.id === `smokeA_${run}`);
  ok(act?.ev?.text === 'Sửa checkout.ts' && !JSON.stringify(act).includes('SECRET'), 'B sees "Sửa checkout.ts" (no code content leaked)');
  const badHook = await fetch(`${BASE}/api/activity`, { method: 'POST', headers: { Authorization: 'Bearer nottherighttoken_123456' }, body: '{}' });
  ok(badHook.status === 401, 'wrong hook token is rejected');

  // a newcomer sees the persisted task and chat history
  const C = client(good.cookie, `smokeC_${run}`, 'Smoke C');
  const wc = await C.hello();
  ok(wc?.tasks?.some((t) => t.id === id && t.col === 'done'), 'newcomer welcome contains the task (from D1)');
  ok(wc?.chat?.some((m) => m.text.includes(run)), 'newcomer welcome contains chat history');
  ok(wc?.team?.some((t) => t.id === `smokeA_${run}` && t.today?.checkIn), 'team list includes A check-in');
  ok(wc?.cinema?.videoId === 'dQw4w9WgXcQ' && wc?.activity?.[`smokeA_${run}`]?.length >= 1, 'newcomer welcome contains cinema state and Claude activity');
  ok(wc?.jukebox?.videoId === 'kJQP7kiw5Fk', 'newcomer welcome contains the jukebox song');

  // stand up → the hook keeps posting, but nothing is shared any more
  A.send({ t: 'sit', seat: null });
  await B.wait((m) => m.t === 'upd' && m.id === `smokeA_${run}` && m.patch.seat === null);
  B.clear();
  const hook2 = { ...hook, tool_input: { file_path: '/home/dev/proj/src/payment.ts' } };
  await fetch(`${BASE}/api/activity`, { method: 'POST', headers: { Authorization: `Bearer ${tok?.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(hook2) });
  ok(!(await B.wait((m) => m.t === 'activity' && m.id === `smokeA_${run}`, 1200)), 'Claude activity is not shared once A leaves the desk');

  // duplicate tab: same cid kicks the older socket
  const A2 = client(good.cookie, `smokeA_${run}`, 'Smoke A (tab 2)');
  await A2.hello();
  ok(!!(await A.wait((m) => m.t === 'kicked')), 'old tab is kicked when the same person connects again');

  // cleanup
  A2.send({ t: 'cinema', action: 'stop' });
  await sleep(450);
  A2.send({ t: 'jukebox', action: 'stop' });
  A2.send({ t: 'activity:revoke' });
  A2.send({ t: 'task:delete', id });
  ok(!!(await B.wait((m) => m.t === 'taskDel' && m.id === id)), 'task deletion is broadcast');
  for (const c of [A, A2, B, C]) c.close();
  await sleep(300);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
