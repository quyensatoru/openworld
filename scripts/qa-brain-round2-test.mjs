// QA round 2 (after 7d5673b went to production): more 🧠 Tổng quản edge cases.
// ✅ = the office behaves as it should, ❌ = the bug is there.
//   BASE=http://localhost:5231 PASSCODE=office-dev node scripts/qa-brain-round2-test.mjs
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
  const A = client(cookie, `qa1R2_${run}`, 'QA Round2');
  const aId = (await A.hello())?.you?.id;
  const tokP = A.next((m) => m.t === 'activityToken' && m.token);
  A.send({ t: 'activity:token' });
  const token = (await tokP)?.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
  await api('/api/agents/jobs?depts=lead');
  A.send({ t: 'agents', m: { a: 'brainConfig', config: { model: 'sonnet', maxSessionsHour: 200, maxPerPersonHour: 100, meetings: false, approvals: 'ask' } } });
  await sleep(500);
  // empty the queue
  for (let i = 0; i < 30; i++) {
    const s = (await api('/api/agents/brain')).job;
    if (!s) break;
    await api('/api/agents/brain', { id: s.id, raw: s.kind === 'report' ? JSON.stringify({ status: 'done', reply: 'x', lesson: '' }) : JSON.stringify({ action: 'drop', reply: '' }) });
  }
  const askCh = `ask:${aId}`;
  const ask = async (text, root) => {
    const p = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from === aId && m.m.text === text);
    A.send({ t: 'chat', ch: 'ask', text, ...(root ? { root } : {}) });
    return (await p)?.m.id;
  };
  const brainJob = async (w = 3) => (await api(`/api/agents/brain?wait=${w}`)).job;
  const view = async () => {
    const vP = A.next((m) => m.t === 'brain', 3000);
    A.send({ t: 'agents', m: { a: 'lessons' } });
    return (await vP)?.v;
  };
  const brainSaid = (root, text) => A.inbox.filter((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from !== aId && m.m.root === root && (!text || m.m.text.includes(text)));

  // ---- R2-1. a runner long-polling for work hears at once when the person answers Tổng quản's question
  {
    const root = await ask(`QA2 wake ${run}`);
    const job = await brainJob();
    const q = `Bạn muốn sửa ở dự án nào? (${run}-wake)`;
    await api('/api/agents/brain', { id: job?.id, raw: JSON.stringify({ action: 'ask', question: q, reply: '' }) });
    await sleep(500);
    const t0 = Date.now();
    const poll = api('/api/agents/brain?wait=15');
    await sleep(800);
    await ask(`virtual-office ${run}`, root);
    const j = (await poll).job;
    const took = Date.now() - t0;
    ok(j?.id === job?.id && took < 5000, `the answer reaches a long-polling runner right away (took ${(took / 1000).toFixed(1)}s, got ${j?.id === job?.id ? 'the request' : j ? 'something else' : 'nothing'})`);
    const jj = j ?? (await brainJob());
    if (jj) await api('/api/agents/brain', { id: jj.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
  }

  // ---- R2-2. the same "ask" decision delivered twice (runner retried after a timeout) after the person
  //            already answered must not ask the question again or swallow the answer
  {
    const root = await ask(`QA2 ask twice ${run}`);
    const job = await brainJob();
    const q = `Câu hỏi QA2 ${run}-dup?`;
    const raw = JSON.stringify({ action: 'ask', question: q, reply: '' });
    await api('/api/agents/brain', { id: job?.id, raw });
    await sleep(500);
    await ask(`Trả lời QA2 ${run}`, root);
    await sleep(300);
    const r2 = await api('/api/agents/brain', { id: job?.id, raw }); // the retry of the first POST
    await sleep(600);
    const asked = brainSaid(root, `${run}-dup`).length;
    const it = (await view())?.queue?.find((i) => i.id === job?.id);
    ok(asked === 1 && it?.state === 'pending', `a retried "ask" after the answer is ignored (question said ${asked}×, state ${it?.state}, retry ok=${r2.ok})`);
    for (let i = 0; i < 3; i++) {
      const j = await brainJob(1);
      if (!j) break;
      await api('/api/agents/brain', { id: j.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
    }
  }

  // ---- R2-3. one unreadable answer delivered twice (runner retry) costs one try, not two
  {
    await ask(`QA2 garbage retry ${run}`);
    const job = await brainJob();
    await api('/api/agents/brain', { id: job?.id, raw: 'không phải JSON' });
    await api('/api/agents/brain', { id: job?.id, raw: 'không phải JSON' });
    const it = (await view())?.queue?.find((i) => i.id === job?.id);
    ok(it?.tries === 1, `a retried unreadable answer counts one try (tries=${it?.tries})`);
    for (let i = 0; i < 4; i++) {
      const j = await brainJob(1);
      if (!j) break;
      await api('/api/agents/brain', { id: j.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
    }
  }

  // ---- R2-4. a decision from a runner that never claimed the request (it was never leased) is refused
  {
    await ask(`QA2 unclaimed ${run}`);
    await sleep(300);
    const it0 = (await view())?.queue?.find((i) => i.text === `QA2 unclaimed ${run}`);
    const r = await api('/api/agents/brain', { id: it0?.id, raw: JSON.stringify({ action: 'answer', reply: `trả lời không ai nhận ${run}` }) });
    const it = (await view())?.queue?.find((i) => i.id === it0?.id);
    ok(!r.ok || it?.state === 'pending', `a decision for a request nobody claimed is not applied (ok=${r.ok}, state ${it?.state ?? 'gone'})`);
    for (let i = 0; i < 3; i++) {
      const j = await brainJob(1);
      if (!j) break;
      await api('/api/agents/brain', { id: j.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
    }
  }

  // ---- R2-5. cancelling a request while it is thinking takes Tổng quản off "thinking" in the 3D office
  {
    await ask(`QA2 cancel brain ${run}`);
    const job = await brainJob();
    A.send({ t: 'agents', m: { a: 'brainCancel', id: job?.id } });
    await sleep(600);
    const v = await view();
    const it = v?.queue?.find((i) => i.id === job?.id);
    ok(!it || it.state === 'done', `cancel removes it from the queue (state ${it?.state ?? 'gone'})`);
    if (job) await api('/api/agents/brain', { id: job.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
  }

  A.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
