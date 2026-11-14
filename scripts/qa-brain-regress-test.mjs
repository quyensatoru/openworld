// QA regression checks for 🧠 Tổng quản's edge cases (written by QA while auditing the office).
// Each check prints ✅ when the office behaves as it should, ❌ when the bug is still there.
//   BASE=http://localhost:5199 PASSCODE=office-dev node scripts/qa-brain-regress-test.mjs
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
async function until(fn, ms, every = 300) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(every);
  }
}

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
  const A = client(cookie, `qa1A_${run}`, 'QA Tester');
  const aId = (await A.hello())?.you?.id;
  const tokP = A.next((m) => m.t === 'activityToken' && m.token);
  A.send({ t: 'activity:token' });
  const token = (await tokP)?.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
  let rpc = 1;
  const call = async (name, args, extra = {}) => {
    const r = await (await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }) })).json();
    return { text: r.result?.content?.[0]?.text ?? '', err: !!r.result?.isError };
  };
  await api('/api/agents/jobs?depts=lead'); // A becomes a runner owner
  A.send({ t: 'agents', m: { a: 'brainConfig', config: { model: 'sonnet', maxSessionsHour: 200, maxPerPersonHour: 100, meetings: false, approvals: 'ask' } } });
  await sleep(500);
  for (let i = 0; i < 30; i++) {
    const s = (await api('/api/agents/brain')).job;
    if (!s) break;
    await api('/api/agents/brain', { id: s.id, raw: s.kind === 'report' ? JSON.stringify({ status: 'done', reply: 'x', lesson: '' }) : JSON.stringify({ action: 'drop', reply: '' }) });
  }
  const askCh = `ask:${aId}`;
  const ask = async (text) => {
    const p = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from === aId && m.m.text === text);
    A.send({ t: 'chat', ch: 'ask', text });
    return (await p)?.m.id;
  };
  const brainJob = async () => (await api('/api/agents/brain?wait=3')).job;
  const tasksTitled = async (title) => (await api('/api/agents/jobs?depts=dev,qa,ops,docs')).tasks.filter((t) => t.title === title);

  // ---- 1. the same decision posted twice (runner retry after a network blip) must not make the work twice
  {
    await ask(`QA1 double ${run}`);
    const job = await brainJob();
    const title = `Việc trùng ${run}`;
    const raw = JSON.stringify({ action: 'route', reply: 'Dev làm nhé.', plan: [{ dept: 'dev', title, desc: 'x', priority: 'normal', after: [] }] });
    const r1 = await api('/api/agents/brain', { id: job?.id, raw });
    const r2 = await api('/api/agents/brain', { id: job?.id, raw });
    await sleep(500);
    const cards = await tasksTitled(title);
    ok(r1.ok && cards.length === 1, `a decision posted twice makes one card (got ${cards.length}, second post ok=${r2.ok})`);
  }

  // ---- 2. an error posted after the decision already landed must not put the request back in the queue
  {
    await ask(`QA1 late error ${run}`);
    const job = await brainJob();
    await api('/api/agents/brain', { id: job?.id, raw: JSON.stringify({ action: 'answer', reply: `Trả lời ${run}` }) });
    await api('/api/agents/brain', { id: job?.id, raw: '', error: 'API Error: Connection error' });
    // the retry wait is 30 s; the bug shows as the item being 'pending' again in the 🧠 panel
    const vP = A.next((m) => m.t === 'brain', 3000);
    A.send({ t: 'agents', m: { a: 'lessons' } });
    const v = (await vP)?.v;
    const again = v?.queue?.find((i) => i.id === job?.id);
    ok(!again || again.state === 'done', `an error posted after the answer leaves the request answered (state now: ${again?.state ?? 'gone'})`);
    if (again && again.state === 'pending') {
      // clean up so later checks are not handed this one
      await sleep(31_000);
      const j2 = await brainJob();
      ok(j2?.id !== job?.id, 'and it is not decided a second time');
      if (j2) await api('/api/agents/brain', { id: j2.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
    }
  }

  // ---- 3. a cancelled request must not be applied when its decision comes back late
  {
    await ask(`QA1 cancel ${run}`);
    const job = await brainJob();
    A.send({ t: 'agents', m: { a: 'brainCancel', id: job?.id } });
    await sleep(500);
    const title = `Việc đã huỷ ${run}`;
    await api('/api/agents/brain', { id: job?.id, raw: JSON.stringify({ action: 'route', reply: 'ok', plan: [{ dept: 'dev', title, desc: 'x', priority: 'normal', after: [] }] }) });
    await sleep(500);
    ok((await tasksTitled(title)).length === 0, 'a request the person cancelled while it was being decided makes no card');
  }

  // ---- 4. a request the model never answered in shape: the person hears something
  {
    const root = await ask(`QA1 garbage ${run}`);
    for (let i = 0; i < 3; i++) {
      const j = await brainJob();
      await api('/api/agents/brain', { id: j?.id, raw: 'xin lỗi tôi không hiểu' });
    }
    const heard = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from !== aId && m.m.root === root, 4000);
    const j4 = await brainJob(); // the 4th look gives up on it
    ok(!!(await heard), 'after 3 unreadable decisions the person is told to rephrase (not silently dropped)');
    if (j4) await api('/api/agents/brain', { id: j4.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
  }

  // ---- 5. the final report covers the cards handed over during the work (QA's verdict)
  {
    await ask(`QA1 report ${run}`);
    const job = await brainJob();
    const devTitle = `Dev part ${run}`;
    await api('/api/agents/brain', { id: job?.id, raw: JSON.stringify({ action: 'route', reply: 'ok', plan: [{ dept: 'dev', title: devTitle, desc: 'x', priority: 'normal', after: [] }] }) });
    await sleep(400);
    const devCard = (await tasksTitled(devTitle))[0];
    const dev = (await api('/api/agents/claim', { kind: 'task', id: devCard?.id })).agent;
    const DH = { 'X-Office-Agent': dev?.id };
    const qaTitle = `QA verdict ${run}`;
    const ho = await call('handoff', { dept: 'qa', title: qaTitle, details: 'kiểm lại bản sửa' }, DH);
    ok(!ho.err, 'dev hands a QA part over');
    await call('task_update', { id: devCard.id.replace(/-/g, '').slice(0, 8), col: 'done', note: 'Dev xong' }, DH);
    await sleep(300);
    const qaCard = (await tasksTitled(qaTitle))[0];
    const qa = (await api('/api/agents/claim', { kind: 'task', id: qaCard?.id })).agent;
    await call('task_update', { id: qaCard.id.replace(/-/g, '').slice(0, 8), col: 'done', note: `QA-DAT-${run}` }, { 'X-Office-Agent': qa?.id });
    await sleep(500);
    let rj = null;
    for (let i = 0; i < 4 && !rj; i++) {
      const j = await brainJob();
      if (j?.kind === 'report') rj = j;
      else if (j) await api('/api/agents/brain', { id: j.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
    }
    ok(!!rj, 'a final report is asked for once every part is finished');
    ok((rj?.prompt ?? '').includes(qaTitle) && (rj?.prompt ?? '').includes(`QA-DAT-${run}`), "the report prompt includes the handed-over QA card and its verdict");
    if (rj) await api('/api/agents/brain', { id: rj.id, raw: JSON.stringify({ status: 'done', reply: 'xong', lesson: '' }) });
    await api('/api/agents/exit', { agent: dev?.id, code: 0 });
    await api('/api/agents/exit', { agent: qa?.id, code: 0 });
  }

  // ---- 6. a long answer reaches the person whole (it used to be cut at 400 chars, mid-word)
  {
    const root = await ask(`QA1 dài ${run}`);
    const job = await brainJob();
    const long = `Ưu điểm ${run}: ${'việc chạy song song và có bảng việc, '.repeat(16)}\n\nNhược điểm: ${'tốn phiên, '.repeat(12)}HẾT-${run}`;
    const heard = A.next((m) => m.t === 'chat' && m.m.ch === askCh && m.m.from !== aId && m.m.root === root, 5000);
    await api('/api/agents/brain', { id: job?.id, raw: JSON.stringify({ action: 'answer', reply: long }) });
    const said = (await heard)?.m.text ?? '';
    ok(said.endsWith(`HẾT-${run}`), `a long answer of Tổng quản is not cut (${said.length}/${long.length} chars)`);
    ok(said.includes('\n'), 'and its line breaks survive into the chat');
  }

  // ---- 7. the project's "definition of done" is appended by the office, not left to the model
  {
    const cfg = { model: 'sonnet', maxSessionsHour: 200, maxPerPersonHour: 100, meetings: false, approvals: 'ask', flow: { '': ['qa', 'ops'] } };
    A.send({ t: 'agents', m: { a: 'brainConfig', config: cfg } });
    await sleep(400);
    const root = await ask(`QA1 flow ${run}`);
    const job = await brainJob();
    const title = `Sửa nút giỏ hàng ${run}`;
    // the model plans ONE dev parcel, exactly as it is told to for a small fix
    const cards = [];
    const collect = (n) =>
      new Promise((resolve) => {
        const seen = [];
        const t = setInterval(() => {
          for (const m of A.inbox) if (m.t === 'task' && m.task.thread === root && !seen.some((x) => x.id === m.task.id)) seen.push(m.task);
          if (seen.length >= n) (clearInterval(t), resolve(seen));
        }, 150);
        setTimeout(() => (clearInterval(t), resolve(seen)), 5000);
      });
    const got = collect(3);
    await api('/api/agents/brain', { id: job?.id, raw: JSON.stringify({ action: 'route', reply: 'Dev sửa nhé.', plan: [{ dept: 'dev', title, desc: 'x', priority: 'normal', after: [] }] }) });
    cards.push(...(await got));
    const dev = cards.find((t) => t.dept === 'dev');
    const qa = cards.find((t) => t.dept === 'qa');
    const ops = cards.find((t) => t.dept === 'ops');
    ok(!!dev && !!qa && !!ops, `a one-parcel plan still gets the project's next stages (${cards.map((t) => t.dept).join(', ') || 'none'})`);
    ok(qa?.after?.includes(dev?.id) && ops?.after?.includes(qa?.id), 'and they are chained: QA waits for Dev, Ops waits for QA');
    const open = (await api('/api/agents/jobs?depts=dev,qa,ops')).tasks.map((t) => t.id);
    ok(open.includes(dev?.id) && !open.includes(qa?.id) && !open.includes(ops?.id), 'only the first stage is offered to a machine; the rest wait their turn');
    // dev hands over in review → QA starts by itself, nobody drags a card
    const claim = await api('/api/agents/claim', { kind: 'task', id: dev?.id });
    const DH2 = { ...H, 'X-Office-Agent': claim.agent?.id };
    await call('task_update', { id: dev.id.replace(/-/g, '').slice(0, 8), col: 'review', note: 'xong' }, DH2);
    await sleep(400);
    const after = (await api('/api/agents/jobs?depts=qa,ops')).tasks.map((t) => t.id);
    ok(after.includes(qa?.id) && !after.includes(ops?.id), 'Dev moving to Chờ duyệt releases QA on its own (and only QA)');
    await api('/api/agents/exit', { agent: claim.agent?.id, code: 0 });
    A.send({ t: 'agents', m: { a: 'brainConfig', config: { ...cfg, flow: {} } } });
    await sleep(300);
  }

  // ---- 8. small cards share one session (a session's cost is mostly fixed)
  {
    const root = await ask(`QA1 gộp ${run}`);
    const job = await brainJob();
    const t1 = `Đổi chữ nút lưu ${run}`;
    const t2 = `Sửa màu viền ô tìm kiếm ${run}`;
    const t3 = `Viết lại phần cài đặt ${run}`;
    await api('/api/agents/brain', {
      id: job?.id,
      raw: JSON.stringify({
        action: 'route',
        reply: 'Mấy việc nhỏ này một lượt là xong.',
        plan: [
          { dept: 'dev', title: t1, desc: 'x', priority: 'normal', after: [], mode: 'quick' },
          { dept: 'dev', title: t2, desc: 'x', priority: 'normal', after: [], mode: 'quick' },
          { dept: 'docs', title: t3, desc: 'x', priority: 'normal', after: [], mode: 'quick' },
        ],
      }),
    });
    const mine = await until(async () => {
      const list = (await api('/api/agents/jobs?depts=dev,docs')).tasks;
      return list.find((t) => t.title === t1) ? list : null;
    }, 6000);
    const first = mine?.find((t) => t.title === t1);
    const claim = await api('/api/agents/claim', { kind: 'task', id: first?.id });
    const extra = claim.extra ?? [];
    ok(extra.length === 1 && extra[0].title === t2, `one session takes the other small card of its department (${extra.map((x) => x.title).join(', ') || 'none'})`);
    ok(!extra.some((x) => x.title === t3), "and not another department's card");
    const board = (await api('/api/agents/jobs?depts=dev')).tasks.map((t) => t.title);
    ok(!board.includes(t2), 'the card it took is off the board, so no second session starts on it');
    await api('/api/agents/exit', { agent: claim.agent?.id, code: 0 });
  }

  // ---- 9. Tổng quản decides with the repo in front of it (it has no repo of its own)
  {
    const mapText = `120 file. Thư mục: worker (20), src (60)\nnpm scripts: test, build, deploy-${run}`;
    await api('/api/agents/jobs', {
      depts: 'lead,dev',
      machine: { id: `m-map-${run}`, label: `map-${run}`, project: `shop-${run}`, repo: `github.com/acme/shop-${run}`, named: 'remote', dir: '/tmp/x', map: mapText },
      running: [],
      waiting: [],
    });
    await ask(`QA1 map ${run}`);
    const job = await until(async () => {
      const j = await brainJob();
      if (!j) return null;
      if (j.kind === 'report' || !String(j.prompt ?? '').includes(`QA1 map ${run}`)) {
        await api('/api/agents/brain', { id: j.id, raw: j.kind === 'report' ? JSON.stringify({ status: 'done', reply: 'x', lesson: '' }) : JSON.stringify({ action: 'drop', reply: '' }) });
        return null;
      }
      return j;
    }, 15_000, 500);
    const prompt = String(job?.prompt ?? '');
    ok(prompt.includes('## Dự án đang có máy trực'), 'the decision prompt carries the projects on call');
    ok(prompt.includes(`deploy-${run}`), "and that project's map, so it can size the work and name real commands");
    if (job) await api('/api/agents/brain', { id: job.id, raw: JSON.stringify({ action: 'drop', reply: '' }) });
  }

  A.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
