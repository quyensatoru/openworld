// V2-4: finding an old piece of work again in "Văn phòng của bạn" — by words of the request, a card's
// title or its 📋 report (with or without Vietnamese marks), filtered by running / finished, and
// opening it loads the whole thread. Nobody finds or opens someone else's.
//   BASE=http://localhost:5231 PASSCODE=office-dev node scripts/threads-test.mjs
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
  const A = client(cookie, `thrA_${run}`, 'Thr A');
  const aId = (await A.hello())?.you?.id;
  const B = client(cookie, `thrB_${run}`, 'Thr B');
  await B.hello();
  const tokP = A.next((m) => m.t === 'activityToken' && m.token);
  A.send({ t: 'activity:token' });
  const token = (await tokP)?.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
  const P = `thr-${run}`;
  await api('/api/agents/jobs', { depts: 'dev,lead', machine: { id: `r-${run}-thr`, label: `thr·${run.slice(0, 4)}`, project: P }, running: [], waiting: [] });
  A.send({ t: 'agents', m: { a: 'brainConfig', config: { model: 'sonnet', maxSessionsHour: 200, maxPerPersonHour: 100, meetings: false, approvals: 'lead' } } });
  await sleep(300);
  const askCh = `ask:${aId}`;
  /** The next thought for this test's request; anything left over from other tests is let go. */
  const jobFor = async (kind, needle) => {
    for (let i = 0; i < 40; i++) {
      const j = (await api('/api/agents/brain?wait=3')).job;
      if (!j) continue;
      if (j.kind === kind && j.prompt.includes(needle)) return j;
      await api('/api/agents/brain', { id: j.id, lease: j.lease, raw: j.kind === 'report' ? JSON.stringify({ status: 'done', reply: 'x', lesson: '' }) : j.kind === 'approve' ? JSON.stringify({ decision: 'deny', reason: 'test' }) : JSON.stringify({ action: 'drop', reply: '' }) });
    }
    return null;
  };
  const find = async (who, q, filter = 'all') => {
    const p = who.next((m) => m.t === 'chatFound' && m.q === q && m.filter === filter);
    who.send({ t: 'chat:find', q, filter });
    return (await p)?.hits ?? null;
  };

  // ---- a request becomes a card in its thread
  const ask = `Thêm nút xuất CSV đơn hàng ${run}`;
  const openerP = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from === aId && m.m.text === ask);
  A.send({ t: 'chat', ch: 'ask', text: ask });
  const root = (await openerP)?.m.id;
  const dj = await jobFor('decide', ask);
  const cardP = A.next((m) => m.t === 'task' && m.task.thread === root);
  await api('/api/agents/brain', { id: dj?.id, lease: dj?.lease, raw: JSON.stringify({ action: 'route', reply: 'Mình giao cho Phát triển.', project: P, plan: [{ dept: 'dev', title: `Xuất CSV đơn hàng ${run}`, desc: 'Nút xuất CSV ở trang đơn hàng.', priority: 'normal', after: [] }] }) });
  const card = (await cardP)?.task;
  ok(!!root && !!card, 'the request is a thread with a card in it');

  // ---- running: found by the request, by the card's title without marks, only under "Đang chạy"
  let hits = await find(A, `csv ${run}`, 'running');
  ok(hits?.length === 1 && hits[0].root === root && hits[0].running && hits[0].titles.includes(`Xuất CSV đơn hàng ${run}`), 'a running piece of work is found under "Đang chạy", with its card');
  hits = await find(A, `xuat csv don hang ${run}`);
  ok(hits?.some((h) => h.root === root), 'words without Vietnamese marks find the card title');
  hits = await find(A, `csv ${run}`, 'done');
  ok(hits && !hits.some((h) => h.root === root), '…and not under "Đã xong"');
  hits = await find(A, `khong-co-gi-${run}`);
  ok(Array.isArray(hits) && hits.length === 0, 'a word nowhere finds nothing');

  // ---- the card finishes, the report comes: found by a word only the report has, under "Đã xong"
  A.send({ t: 'task:move', id: card?.id, col: 'review', ord: 1 });
  await sleep(150);
  A.send({ t: 'task:update', id: card?.id, patch: { desc: `${card?.desc}\n\n— Dev (13/11 10:00): xong` } });
  const rj = await jobFor('report', ask);
  const repP = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.text.startsWith('📋 Kết quả'));
  await api('/api/agents/brain', { id: rj?.id, lease: rj?.lease, raw: JSON.stringify({ status: 'done', reply: `Nút đã có ở trang Báo-cáo-${run}.`, lesson: '' }) });
  const rep = await repP;
  ok(rep?.m.root === root, 'the 📋 report lands in the thread');
  hits = await find(A, `bao-cao-${run}`, 'done');
  ok(hits?.length === 1 && hits[0].root === root && !hits[0].running && hits[0].report?.includes(`Báo-cáo-${run}`), 'a word only in the 📋 report finds it under "Đã xong", with the report');
  hits = await find(A, '', 'running');
  ok(hits && !hits.some((h) => h.root === root), 'with no words, "Đang chạy" lists only work still out');

  // ---- opening it brings the whole thread
  const thP = A.next((m) => m.t === 'chatThread' && m.root === root);
  A.send({ t: 'chat:thread', root });
  const th = await thP;
  const ids = th?.msgs?.map((m) => m.id) ?? [];
  ok(ids[0] === root && ids.includes(rep?.m.id) && th.msgs.length >= 3 && th.msgs.every((m) => m.id === root || m.root === root), `opening it returns the opener and every line in it (${th?.msgs?.length ?? 0})`);

  // ---- someone else finds nothing of it and opens nothing
  hits = await find(B, `csv ${run}`);
  ok(Array.isArray(hits) && hits.length === 0, "someone else's search does not see this thread");
  const bThP = B.next((m) => m.t === 'chatThread' && m.root === root);
  B.send({ t: 'chat:thread', root });
  ok(((await bThP)?.msgs ?? ['x']).length === 0, "…and opening it by id gives them nothing");

  if (card) A.send({ t: 'task:delete', id: card.id });
  await sleep(200);
  A.close();
  B.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
