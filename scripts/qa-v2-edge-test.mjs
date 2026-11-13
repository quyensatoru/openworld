// QA (#b1b0e11e): edge cases of V2-2 "Vòng cải tiến mới" and V2-4 "🔎 Tìm việc" that the dev tests
// do not cover. Run against a FRESH dev server (it counts machines/projects on the server).
//   BASE=http://localhost:5249 PASSCODE=office-dev node scripts/qa-v2-edge-test.mjs
import WebSocket from 'ws';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'office-dev';
const run = Math.random().toString(36).slice(2, 8);
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AV = { body: 'default', hair: 'parted', skin: '#f6cfae', hairColor: '#3b2a20', top: '#7fa7c9', bottom: '#2d3142', shoes: '#333333', accessories: [], height: 1 };

function client(cookie, cid, name) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/ws`, { headers: { Cookie: cookie, Origin: BASE } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw, bin) => {
    if (bin) return;
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  const next = (pred, ms = 4000) =>
    new Promise((resolve) => {
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) (waiters.splice(i, 1), resolve(null));
      }, ms);
    });
  return {
    inbox,
    next,
    send: (m) => ws.send(JSON.stringify(m)),
    hello: async () => {
      if (ws.readyState !== WebSocket.OPEN) await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
      const p = next((m) => m.t === 'welcome');
      ws.send(JSON.stringify({ t: 'hello', cid, name, avatar: AV }));
      return p;
    },
    close: () => ws.close(),
  };
}

(async () => {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const A = client(cookie, `qaA_${run}`, 'QA A');
  await A.hello();
  const B = client(cookie, `qaB_${run}`, 'QA B');
  await B.hello();
  const tokP = A.next((m) => m.t === 'activityToken' && m.token);
  A.send({ t: 'activity:token' });
  const token = (await tokP)?.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
  const view = async (C = A) => {
    const p = C.next((m) => m.t === 'brain', 3000);
    C.send({ t: 'agents', m: { a: 'lessons' } });
    return (await p)?.v;
  };
  const roundTasks = (C, since) => C.inbox.slice(since).filter((m) => m.t === 'task' && /^Vòng cải tiến/.test(m.task.title)).map((m) => m.task);
  const uniq = (ts) => [...new Map(ts.map((t) => [t.id, t])).values()];

  const P1 = `dự-án-đẹp-${run}`;
  const P2 = `zeta-${run}`;
  await api('/api/agents/jobs', { depts: 'dev,qa,biz', machine: { id: `r-${run}-1`, label: `qa1·${run.slice(0, 4)}`, project: P1 }, running: [], waiting: [] });
  await api('/api/agents/jobs', { depts: 'dev,qa,biz', machine: { id: `r-${run}-2`, label: `qa2·${run.slice(0, 4)}`, project: P2 }, running: [], waiting: [] });
  await sleep(300);

  // ---- V2-2: several projects on call, none chosen → refused, nothing made
  let since = A.inbox.length;
  let errP = A.next((m) => m.t === 'err' && /nhiều dự án/.test(m.msg));
  A.send({ t: 'agents', m: { a: 'improve' } });
  ok(!!(await errP), 'several projects on call and none chosen: asked to choose');
  await sleep(800);
  ok(roundTasks(A, since).length === 0, '…and no card is made');

  // ---- V2-2: someone no machine takes work from → refused
  since = B.inbox.length;
  errP = B.next((m) => m.t === 'err', 3000);
  B.send({ t: 'agents', m: { a: 'improve', project: P1 } });
  const e = await errP;
  ok(!!e, `a person without the right to assign is refused (${e?.msg ?? 'no err'})`);
  await sleep(800);
  ok(roundTasks(B, since).length === 0, '…and no card is made');

  // ---- V2-2: a double click (two presses at once) makes one round, not two
  since = A.inbox.length;
  A.send({ t: 'agents', m: { a: 'improve', project: P1 } });
  A.send({ t: 'agents', m: { a: 'improve', project: P1 } });
  await sleep(2500);
  let made = uniq(roundTasks(A, since)).filter((t) => t.project === P1);
  ok(made.length === 3, `two presses at once make exactly 3 cards (${made.length})`);
  let v = await view();
  ok((v?.rounds ?? []).filter((r) => r.project === P1).length === 1, 'and one round is listed');

  // ---- V2-2: another project can run its own round at the same time
  since = A.inbox.length;
  A.send({ t: 'agents', m: { a: 'improve', project: P2 } });
  await sleep(2000);
  const made2 = uniq(roundTasks(A, since)).filter((t) => t.project === P2);
  ok(made2.length === 3, `a round in another project is allowed while P1's runs (${made2.length})`);

  // ---- V2-4: search without marks finds the round thread (project name with đ / ẹ), running filter
  const find = async (C, q, filter = 'all') => {
    const p = C.next((m) => m.t === 'chatFound' && m.q === q && m.filter === filter);
    C.send({ t: 'chat:find', q, filter });
    return (await p)?.hits ?? null;
  };
  let hits = await find(A, `du an dep ${run}`);
  ok(hits && hits.length === 1 && hits[0].running && hits[0].titles.length === 3, `"du an dep" (no marks) finds the round thread with đ/ẹ, running, 3 cards (${hits?.length})`);
  const root = hits?.[0]?.root;
  hits = await find(A, `DỰ ÁN ĐẸP ${run}`.toUpperCase());
  ok(hits && hits.length === 1, 'upper case with marks finds it too');
  hits = await find(A, `ra loi ${run}`, 'done');
  ok(hits && hits.length === 0, 'it is not under ✅ Đã xong while it runs');
  hits = await find(A, ``);
  ok(Array.isArray(hits), 'an empty query answers (lists everything)');
  hits = await find(B, `du an dep ${run}`);
  ok(hits && hits.length === 0, "B's search does not see A's round thread");
  const thP = B.next((m) => m.t === 'chatThread', 2000);
  B.send({ t: 'chat:thread', root });
  const th = await thP;
  ok(!th || th.msgs.length === 0, "B opening A's thread by id gets nothing");
  const bad = B.next((m) => m.t === 'chatThread', 1200);
  B.send({ t: 'chat:thread', root: "x' OR 1=1 --" });
  ok(!(await bad), 'a malformed thread id is ignored');

  // ---- V2-2: cards deleted while the round still runs: the round closes, keeps what was noted
  const qa = made.find((t) => t.dept === 'qa');
  A.send({ t: 'task:update', id: qa.id, patch: { desc: `${qa.desc}\n\n— QA (13/11 11:00): Ghi-chú-${run} lỗi A` } });
  await sleep(600);
  for (const t of made) A.send({ t: 'task:delete', id: t.id });
  await sleep(800);
  v = await view();
  let r = (v?.rounds ?? []).find((x) => x.project === P1);
  ok(r?.closed === true, `deleting all of a running round's cards closes it without anyone pressing (closed=${r?.closed})`);
  ok(!!r?.summary?.includes(`Ghi-chú-${run}`), "the closed round keeps the note written before the cards were deleted");
  since = A.inbox.length;
  A.send({ t: 'agents', m: { a: 'improve', project: P1 } });
  await sleep(2500);
  const made3 = uniq(roundTasks(A, since)).filter((t) => t.project === P1);
  ok(made3.length === 3, `after the cards are deleted a new round can open (${made3.length})`);
  const qa3 = made3.find((t) => t.dept === 'qa');
  ok(!!qa3 && qa3.desc.includes(`Ghi-chú-${run}`), "the deleted round's note is carried into the next round's cards");
  v = await view();
  r = (v?.rounds ?? []).filter((x) => x.project === P1);
  ok(r.length === 2 && r.some((x) => x.closed && x.summary.includes(`Ghi-chú-${run}`)), 'the first round is kept, closed, with its note');

  // ---- V2-2: deleting only some of a round's cards leaves it running (P2), all of them closes it
  A.send({ t: 'task:delete', id: made2[0].id });
  A.send({ t: 'task:delete', id: made2[1].id });
  await sleep(800);
  v = await view();
  r = (v?.rounds ?? []).find((x) => x.project === P2);
  ok(r && r.closed === false, `2 of 3 cards deleted: P2's round still runs (closed=${r?.closed})`);
  since = A.inbox.length;
  errP = A.next((m) => m.t === 'err', 2500);
  A.send({ t: 'agents', m: { a: 'improve', project: P2 } });
  const e2 = await errP;
  ok(!!e2 && /đang chạy/.test(e2.msg) && uniq(roundTasks(A, since)).length === 0, 'and a new P2 round is still refused while its last card is on the board');
  A.send({ t: 'task:delete', id: made2[2].id });
  await sleep(800);
  v = await view();
  r = (v?.rounds ?? []).find((x) => x.project === P2);
  ok(r && r.closed === true, `the last P2 card deleted: P2's round closes (closed=${r?.closed})`);
  ok((v?.rounds ?? []).some((x) => x.project === P1 && !x.closed), "and P1's newer round is untouched (still running)");

  // ---- V2-2: a person drags every card of a running round to Done by hand → the round should close
  since = A.inbox.length;
  A.send({ t: 'agents', m: { a: 'improve', project: P2 } });
  await sleep(2500);
  const made4 = uniq(roundTasks(A, since)).filter((t) => t.project === P2);
  ok(made4.length === 3, `P2 opens a new round once its old one closed (${made4.length})`);
  for (const [i, t] of made4.entries()) A.send({ t: 'task:move', id: t.id, col: 'done', ord: i });
  await sleep(1500);
  v = await view();
  r = (v?.rounds ?? []).filter((x) => x.project === P2).sort((a, b) => b.at - a.at)[0];
  console.log(`   (info) all cards dragged to Done by hand, 1.5s later: closed=${r?.closed}`);
  for (const t of made4) A.send({ t: 'task:delete', id: t.id });

  for (const t of made3) A.send({ t: 'task:delete', id: t.id });
  await sleep(800);
  v = await view();
  ok((v?.rounds ?? []).every((x) => x.closed), 'all cards gone: no round is left running');
  A.close();
  B.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
