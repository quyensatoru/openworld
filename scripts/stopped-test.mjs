// V2-1: people can see what the on-call machines are doing (working / waiting for Claude until when /
// offline), and a card that stopped after breaking down has a "Làm tiếp" button.
//   BASE=http://localhost:5231 PASSCODE=office-dev node scripts/stopped-test.mjs
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
  const A = client(cookie, `stopA_${run}`, 'Stop A');
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

  const M = `r-${run}-stop-mach`;
  const P = `stop-${run}`;
  let running = [];
  const hb = (extra = {}) => api('/api/agents/jobs', { depts: 'dev', machine: { id: M, label: `stop·${run.slice(0, 4)}`, project: P }, running, waiting: [], ...extra });
  await hb();
  A.send({ t: 'agents', m: { a: 'brainConfig', config: { model: 'sonnet', maxSessionsHour: 200, maxPerPersonHour: 100, meetings: false, approvals: 'lead' } } });
  await sleep(300);

  // ---- the 🧠 panel: an idle machine
  let m0 = (await view())?.machines?.find((m) => m.id === M);
  ok(m0 && m0.busy === 0 && m0.offline === false, `the panel lists the machine as on and idle (busy=${m0?.busy}, offline=${m0?.offline})`);

  // ---- a card, taken by the machine: the panel says it is working on one thing
  const cardP = A.next((m) => m.t === 'task' && m.task.title === `Việc sẽ dừng ${run}`);
  A.send({ t: 'task:create', title: `Việc sẽ dừng ${run}`, col: 'todo', dept: 'dev' });
  const card = (await cardP)?.task;
  let cl = await api('/api/agents/claim', { kind: 'task', id: card?.id, machine: M, dir: `/tmp/${P}` });
  running = [cl.agent?.id];
  await hb();
  m0 = (await view())?.machines?.find((m) => m.id === M);
  ok(cl.ok && m0?.busy === 1, `…and as working on one card once it took one (busy=${m0?.busy})`);

  // ---- out of quota: the machine waits until a time, the card's employee says until when
  const until = Date.now() + 45 * 60_000;
  const why = "You've hit your 5-hour limit";
  const waitUpd = A.next((m) => m.t === 'upd' && m.id === cl.agent?.id && /thử lại lúc/.test(m.patch.statusText ?? ''));
  await hb({ running: [], waiting: [{ agent: cl.agent?.id, until, why }], outage: { until, why } });
  const wu = await waitUpd;
  m0 = (await view())?.machines?.find((m) => m.id === M);
  ok(!!wu && m0?.outage?.until === until, `a machine out of quota shows when it goes on, and so does the card's employee (${wu?.patch.statusText ?? 'no update'})`);
  await hb({ running: [cl.agent?.id] });

  // ---- three breakdowns: the card stops, every browser is told it can be run again
  let stoppedMsg = null;
  for (let i = 1; i <= 3; i++) {
    if (i > 1) {
      cl = await api('/api/agents/claim', { kind: 'task', id: card?.id, machine: M, dir: `/tmp/${P}` });
      running = [cl.agent?.id];
    }
    const moved = A.next((m) => m.t === 'task' && m.task.id === card?.id && m.task.col !== 'doing');
    const st = A.next((m) => m.t === 'stopped' && m.ids.includes(card?.id), 3000);
    await api('/api/agents/exit', { agent: cl.agent?.id, code: 1, why: 'hết quota' });
    await moved;
    if (i === 3) stoppedMsg = await st;
  }
  ok(!!stoppedMsg, 'after the third breakdown the card is announced as stopped');
  const late = client(cookie, `stopL_${run}`, 'Stop Late');
  const lw = await late.hello();
  ok(lw?.stopped?.includes(card?.id), 'someone opening the office later sees it as stopped too');
  late.close();

  // ---- "Làm tiếp": back to To do, a fresh set of tries, no longer stopped
  const backP = A.next((m) => m.t === 'task' && m.task.id === card?.id && m.task.col === 'todo' && /bấm Làm tiếp/.test(m.task.desc));
  const clearP = A.next((m) => m.t === 'stopped' && !m.ids.includes(card?.id));
  A.send({ t: 'agents', m: { a: 'revive', id: card?.id } });
  ok(!!(await backP) && !!(await clearP), '"Làm tiếp" puts the card back in To do and clears the stopped mark');
  const again = await api('/api/agents/claim', { kind: 'task', id: card?.id, machine: M, dir: `/tmp/${P}` });
  ok(!!again.agent, 'and a machine can take it again');
  if (again.agent) await api('/api/agents/exit', { agent: again.agent.id, code: 130 });

  // ---- "Làm tiếp" on a card that did not stop does nothing
  const noMove = A.next((m) => m.t === 'task' && m.task.id === card?.id && /bấm Làm tiếp/.test(m.task.desc) && m.task.desc.split('bấm Làm tiếp').length > 2, 1500);
  A.send({ t: 'agents', m: { a: 'revive', id: card?.id } });
  ok(!(await noMove), 'pressing it on a card that is not stopped changes nothing');

  if (card) A.send({ t: 'task:delete', id: card.id });
  await sleep(200);
  A.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
