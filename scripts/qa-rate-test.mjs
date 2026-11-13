// QA edge cases for 👍 / 👎 on Tổng quản's 📋 reports (task #3f90ab89).
//   BASE=http://localhost:5174 PASSCODE=office-dev node scripts/qa-rate-test.mjs
// Run against a throwaway dev server (OFFICE_STATE=/tmp/...): it changes the brain's settings.
import WebSocket from 'ws';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'office-dev';
const WS_BASE = BASE.replace(/^http/, 'ws');
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 8);

function client(cookie, cid, name) {
  const ws = new WebSocket(`${WS_BASE}/api/ws`, { headers: { Cookie: cookie, Origin: BASE } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters])
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
  });
  const mk = (fromInbox) => (pred, ms = 4000) =>
    new Promise((resolve) => {
      if (fromInbox) {
        const hit = [...inbox].reverse().find(pred);
        if (hit) return resolve(hit);
      }
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) {
          waiters.splice(i, 1);
          resolve(null);
        }
      }, ms);
    });
  const api = {
    send: (m) => ws.send(JSON.stringify(m)),
    wait: mk(true),
    next: mk(false),
    hello: async () => {
      if (ws.readyState !== WebSocket.OPEN)
        await new Promise((r, j) => {
          ws.once('open', r);
          ws.once('error', j);
        });
      api.send({ t: 'hello', cid, name, avatar: { body: 'default', hair: 'parted', skin: '#f6cfae', hairColor: '#3b2a20', top: '#7fa7c9', bottom: '#2d3142', shoes: '#333333', accessories: [], height: 1 } });
      return api.wait((m) => m.t === 'welcome');
    },
    close: () => ws.close(),
  };
  return api;
}

(async () => {
  console.log(`Office: ${BASE}`);
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const A = client(cookie, `qarateA_${run}`, 'An QA');
  const B = client(cookie, `qarateB_${run}`, 'Bình QA');
  const aId = (await A.hello())?.you?.id;
  await B.hello();
  A.send({ t: 'activity:token' });
  const token = (await A.wait((m) => m.t === 'activityToken' && m.token))?.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
  await api('/api/agents/jobs?depts=lead');
  A.send({ t: 'agents', m: { a: 'brainConfig', config: { model: 'sonnet', maxSessionsHour: 200, maxPerPersonHour: 100, meetings: false, approvals: 'lead' } } });
  await A.wait((m) => m.t === 'brain' && m.v.config.approvals === 'lead');
  for (let i = 0; i < 30; i++) {
    const stale = (await api('/api/agents/brain')).job;
    if (!stale) break;
    await api('/api/agents/brain', { id: stale.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
  }
  A.send({ t: 'agents', m: { a: 'lessons' } }); // watch the playbook
  await A.wait((m) => m.t === 'agentBook');

  // ---- a request, one card, the card finished by hand → a 📋 report in A's thread
  const askCh = `ask:${aId}`;
  const askP = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from === aId);
  A.send({ t: 'chat', ch: 'ask', text: `QA chấm báo cáo ${run}` });
  const ask = (await askP)?.m;
  const dj = (await api('/api/agents/brain?wait=8')).job;
  await api('/api/agents/brain', { id: dj?.id, raw: JSON.stringify({ action: 'route', reply: 'Phát triển làm nhé.', plan: [{ dept: 'dev', title: `QA rate ${run}`, desc: 'x', priority: 'normal', after: [] }] }) });
  const card = (await A.wait((m) => m.t === 'task' && m.task.title === `QA rate ${run}`))?.task;
  ok(!!card, 'setup: a card for the request');
  A.send({ t: 'task:move', id: card?.id, col: 'done', ord: 1 });
  await A.wait((m) => m.t === 'task' && m.task.id === card?.id && m.task.col === 'done');
  // a person's move alone waits for the sweep; touching the card wakes Tổng quản's progress now
  A.send({ t: 'task:update', id: card?.id, patch: { desc: 'xong' } });
  const rj = (await api('/api/agents/brain?wait=8')).job;
  ok(rj?.kind === 'report', 'setup: Tổng quản is asked for the report');
  const repP = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.text.startsWith('📋 Kết quả'));
  await api('/api/agents/brain', { id: rj?.id, raw: JSON.stringify({ status: 'done', reply: `Xong ${run}.` }) });
  const rep = (await repP)?.m;
  ok(!!rep, 'setup: the 📋 report arrives');
  const repId = rep?.id;
  const marker = `QA-${run}`;
  const mine = (book) => book.lessons.filter((l) => l.text.includes(marker));

  // ---- not mine / not a report / garbage
  const e1 = B.next((m) => m.t === 'err');
  B.send({ t: 'agents', m: { a: 'rate', id: repId, v: 1 } });
  ok(/Chỉ người nhận/.test((await e1)?.msg ?? ''), "B rating A's report (👍) is refused");
  const e2 = A.next((m) => m.t === 'err');
  A.send({ t: 'agents', m: { a: 'rate', id: ask?.id, v: -1, reason: 'x' } });
  ok(/Chỉ chấm được/.test((await e2)?.msg ?? ''), "a message that isn't a 📋 report can't be rated (A's own request)");
  const e3 = A.next((m) => m.t === 'err');
  A.send({ t: 'agents', m: { a: 'rate', id: "x' OR 1=1 --", v: -1, reason: 'x' } });
  ok(!!(await e3), 'a junk id is refused');
  const e4 = A.next((m) => m.t === 'err');
  A.send({ t: 'agents', m: { a: 'rate', id: crypto.randomUUID(), v: 1 } });
  ok(!!(await e4), 'an unknown id is refused');
  const odd = A.next((m) => m.t === 'chatRate' && m.id === repId);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: 'abc', reason: { evil: 1 } } });
  const oddR = await odd;
  ok(!!oddR, `odd payload (v:'abc', reason:object) does not break the server → saved as ${JSON.stringify(oddR?.rate)}`);

  // ---- 👎 without reason: counted, no lesson
  const noBook = A.next((m) => m.t === 'agentBook' && mine(m.book).length, 1500);
  const r0 = A.next((m) => m.t === 'chatRate' && m.id === repId);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1 } });
  ok((await r0)?.rate?.v === -1 && !(await r0)?.rate?.reason, '👎 without a reason is saved');
  ok(!(await noBook), '👎 without a reason writes no lesson');
  const blank = A.next((m) => m.t === 'agentBook' && m.book.lessons.some((l) => /chưa hài lòng/.test(l.text) && l.text.includes(run)), 1500);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1, reason: '   \n\t ' } });
  ok(!(await blank), '👎 with only whitespace as reason writes no lesson');

  // ---- 👎 with reason → lesson; again with another reason → same lesson updated
  const b1 = A.next((m) => m.t === 'agentBook' && mine(m.book).length);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1, reason: `${marker} lần 1` } });
  const l1 = mine((await b1)?.book ?? { lessons: [] });
  ok(l1.length === 1 && l1[0].dept === 'lead', '👎 with a reason → one lead lesson');
  const b2 = A.next((m) => m.t === 'agentBook' && mine(m.book).some((l) => l.text.includes('lần 2')));
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1, reason: `${marker} lần 2` } });
  const l2 = mine((await b2)?.book ?? { lessons: [] });
  ok(l2.length === 1 && l2[0].id === l1[0]?.id, 'changing the reason updates the same lesson (no duplicate)');
  const long = `${marker} ` + 'a'.repeat(1000);
  const b3 = A.next((m) => m.t === 'agentBook' && mine(m.book).some((l) => l.text.includes('aaaa')));
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1, reason: long } });
  const r3 = await b3;
  ok((mine(r3?.book ?? { lessons: [] })[0]?.text.length ?? 9999) < 600, 'a very long reason is clamped');

  // ---- 👎 → 👍 takes the lesson back
  const b4 = A.next((m) => m.t === 'agentBook' && !mine(m.book).length);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: 1 } });
  ok(!!(await b4), '👎 → 👍 removes the lesson');

  // ---- lesson deleted by hand, then rating changes: no crash, no resurrection on 👍
  const b5 = A.next((m) => m.t === 'agentBook' && mine(m.book).length);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1, reason: `${marker} lần 3` } });
  const l5 = mine((await b5)?.book ?? { lessons: [] })[0];
  const b6 = A.next((m) => m.t === 'agentBook' && !mine(m.book).length);
  A.send({ t: 'agents', m: { a: 'lessonDel', id: l5?.id } });
  await b6;
  const r6 = A.next((m) => m.t === 'chatRate' && m.id === repId);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: 1 } });
  ok((await r6)?.rate?.v === 1, '👍 after the lesson was deleted by hand still works');
  const b7 = A.next((m) => m.t === 'agentBook' && mine(m.book).length);
  A.send({ t: 'agents', m: { a: 'rate', id: repId, v: -1, reason: `${marker} lần 4` } });
  const l7 = mine((await b7)?.book ?? { lessons: [] });
  ok(l7.length === 1, '👎 again after that writes the lesson again');

  // ---- B still can't 👎 (and doesn't wipe A's lesson)
  const e8 = B.next((m) => m.t === 'err');
  const noWipe = A.next((m) => m.t === 'agentBook' && !mine(m.book).length, 1500);
  B.send({ t: 'agents', m: { a: 'rate', id: repId, v: 1 } });
  ok(/Chỉ người nhận/.test((await e8)?.msg ?? '') && !(await noWipe), "B's 👍 neither changes A's rating nor removes A's lesson");

  // ---- reload: rating comes back; B's welcome carries no rating of A's
  const A2 = client(cookie, `qarateA_${run}`, 'An QA');
  const w2 = await A2.hello();
  const back = w2?.chat?.find((m) => m.id === repId);
  ok(back?.rate?.v === -1 && back.rate.reason === `${marker} lần 4`, 'after a reload the 👎 and its reason come back');
  A2.close();

  // cleanup
  if (l7[0]) A.send({ t: 'agents', m: { a: 'lessonDel', id: l7[0].id } });
  if (card) A.send({ t: 'task:delete', id: card.id });
  A.send({ t: 'activity:revoke' });
  await sleep(400);
  A.close();
  B.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall good');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
