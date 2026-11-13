// V2-2: "Vòng cải tiến mới" in the 🧠 panel — one press makes QA (bugs) and Biz (priorities) side by
// side and Dev chained after both; a second press while it runs makes nothing; what a round did is
// kept (D1) and written into the next round's cards so nothing is proposed twice.
//   BASE=http://localhost:5231 PASSCODE=office-dev node scripts/improve-test.mjs
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
      ws.send(JSON.stringify({ t: 'hello', cid, name, avatar: { body: 'default', hair: 'parted', skin: '#f6cfae', hairColor: '#3b2a20', top: '#7fa7c9', bottom: '#2d3142', shoes: '#333333', accessories: [], height: 1 } }));
      return p;
    },
    close: () => ws.close(),
  };
}


(async () => {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const A = client(cookie, `imprA_${run}`, 'Impr A');
  await A.hello();
  const tokP = A.next((m) => m.t === 'activityToken' && m.token);
  A.send({ t: 'activity:token' });
  const token = (await tokP)?.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
  const view = async () => {
    const p = A.next((m) => m.t === 'brain', 3000);
    A.send({ t: 'agents', m: { a: 'lessons' } });
    return (await p)?.v;
  };
  const short = (id) => id.replace(/-/g, '').slice(0, 8);
  const P = `impr-${run}`;
  // a machine of A's own in project P (other tests' machines may still be listed: P is named explicitly)
  await api('/api/agents/jobs', { depts: 'dev,qa,biz', machine: { id: `r-${run}-impr`, label: `impr·${run.slice(0, 4)}`, project: P }, running: [], waiting: [] });
  await sleep(300);

  const roundCards = async (n = 3) => {
    const got = [];
    for (let i = 0; i < n; i++) {
      const m = await A.next((m) => m.t === 'task' && m.task.project === P && /^Vòng cải tiến/.test(m.task.title) && !got.some((t) => t.id === m.task.id), 4000);
      if (!m) break;
      got.push(m.task);
    }
    return got;
  };

  // ---- one press: three cards, QA and Biz at once, Dev after both
  const opener = A.next((m) => m.t === 'chat' && m.m?.ch?.startsWith('ask:') && /mở vòng cải tiến mới/.test(m.m.text));
  let cardsP = roundCards();
  A.send({ t: 'agents', m: { a: 'improve', project: P } });
  let cards = await cardsP;
  const op = await opener;
  const byDept = (cs, d) => cs.filter((t) => t.dept === d).pop();
  let qa = byDept(cards, 'qa'), biz = byDept(cards, 'biz'), dev = byDept(cards, 'dev');
  ok(cards.length >= 3 && qa && biz && dev, `one press makes a QA, a Biz and a Dev card (${cards.map((t) => t.dept).join(', ')})`);
  ok(qa && biz && !(qa.after ?? []).length && !(biz.after ?? []).length, 'QA and Biz start at once (nothing before them)');
  ok(dev && qa && biz && (dev.after ?? []).includes(qa.id) && (dev.after ?? []).includes(biz.id), 'Dev waits for both');
  await sleep(300);
  const devNow = A.inbox.filter((m) => m.t === 'task' && m.task.id === dev?.id).pop()?.task ?? dev;
  ok(devNow && devNow.desc.includes(`#${short(qa.id)}`) && devNow.desc.includes(`#${short(biz.id)}`), "Dev's card names the two cards it reads");
  ok(!!op && cards.every((t) => t.thread === op.m.id), 'the round opens a thread in "Văn phòng của bạn" and its cards hang off it');
  ok(/chưa có vòng nào/.test(biz?.desc ?? ''), 'the first round says there was no round before it');
  let v = await view();
  let r1 = v?.rounds?.find((r) => r.project === P);
  ok(r1 && !r1.closed && r1.tasks.length === 3, 'the 🧠 panel lists the round as running');

  // ---- a second press while it runs makes nothing
  const errP = A.next((m) => m.t === 'err' && /vẫn đang chạy/.test(m.msg));
  const extra = A.next((m) => m.t === 'task' && m.task.project === P && !cards.some((t) => t.id === m.task.id), 1500);
  A.send({ t: 'agents', m: { a: 'improve', project: P } });
  ok(!!(await errP) && !(await extra), 'pressing again while the round runs only says so');

  // ---- a project nobody works in is refused
  const errQ = A.next((m) => m.t === 'err' && /Không có máy trực/.test(m.msg));
  A.send({ t: 'agents', m: { a: 'improve', project: `khong-co-${run}` } });
  ok(!!(await errQ), 'a project with no machine on call is refused');

  // ---- the departments finish: their last notes become what the round did
  const notes = { [qa.id]: `Lỗi-${run}: nút lưu không phản hồi`, [biz.id]: `Mục-${run}: tìm việc cũ theo từ khoá`, [dev.id]: `Đã làm Mục-${run}, nhánh review/x` };
  for (const t of [qa, biz, dev]) {
    A.send({ t: 'task:move', id: t.id, col: 'review', ord: 1 });
    await sleep(150);
    A.send({ t: 'task:update', id: t.id, patch: { desc: `${t.desc}\n\n— Ai đó (13/11 10:00): ${notes[t.id]}` } });
    await sleep(300);
  }
  await sleep(500);
  v = await view();
  r1 = v?.rounds?.find((r) => r.id === r1?.id);
  ok(r1?.closed && r1.summary.includes(`Lỗi-${run}`) && r1.summary.includes(`Mục-${run}`) && r1.summary.includes('nhánh review/x'), `a finished round keeps what each card did (${(r1?.summary ?? '').slice(0, 120)}…)`);
  ok(!/\(13\/11 10:00\)/.test(r1?.summary ?? ''), 'without who/when noise');

  // ---- the cards go; the round's record stays, and the next round's cards carry it
  for (const t of [qa, biz, dev]) A.send({ t: 'task:delete', id: t.id });
  await sleep(300);
  cardsP = roundCards();
  A.send({ t: 'agents', m: { a: 'improve', project: P } });
  cards = await cardsP;
  biz = byDept(cards, 'biz');
  dev = byDept(cards, 'dev');
  qa = byDept(cards, 'qa');
  ok(cards.length >= 3 && biz?.desc.includes(`Mục-${run}`) && dev?.desc.includes(`Mục-${run}`) && qa?.desc.includes(`Lỗi-${run}`), "the next round's cards say what the round before did");
  v = await view();
  ok(v?.rounds?.filter((r) => r.project === P).length === 2 && v.rounds.find((r) => r.id === r1?.id)?.summary.includes(`Mục-${run}`), 'both rounds are listed, the first one still with its results');

  // ---- the cards of a round still running are deleted: it closes by itself, so the button frees up
  const r2 = v?.rounds?.find((r) => r.project === P && r.id !== r1?.id);
  ok(r2 && !r2.closed, 'the second round runs');
  A.send({ t: 'task:delete', id: qa.id });
  await sleep(400);
  v = await view();
  ok(v?.rounds?.find((r) => r.id === r2?.id)?.closed === false, 'one card deleted: the round still runs on the others');
  for (const t of cards) if (t.id !== qa.id) A.send({ t: 'task:delete', id: t.id });
  await sleep(600);
  v = await view();
  const r2now = v?.rounds?.find((r) => r.id === r2?.id);
  ok(r2now?.closed === true, `all its cards deleted: the round closes without anyone pressing (closed=${r2now?.closed})`);
  ok(!(v?.queue ?? []).some((i) => i.round === r2?.id), 'Tổng quản stops waiting to report on it');
  ok(v?.rounds?.find((r) => r.id === r1?.id)?.summary.includes(`Mục-${run}`), 'the earlier round keeps its results');
  A.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
