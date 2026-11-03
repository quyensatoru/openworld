// Floor 5 protocol test: a full "Nội Gián" game with five fake players — roles, tasks, the kill
// cooldown, bodies, voice rules (ghosts, meetings), the critical sabotage, report, vote, the end.
//   BASE=http://localhost:5173 PASSCODE=bss-dev node scripts/floor5-test.mjs
import WebSocket from 'ws';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'bss-dev';
const WS_BASE = BASE.replace(/^http/, 'ws');
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(cookie, cid, name) {
  const ws = new WebSocket(`${WS_BASE}/api/ws`, { headers: { Cookie: cookie, Origin: BASE } });
  const inbox = [];
  const bins = [];
  const waiters = [];
  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      bins.push(new Uint8Array(raw));
      return;
    }
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters])
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
  });
  const api = {
    cid,
    ws,
    inbox,
    bins,
    send: (m) => ws.send(JSON.stringify(m)),
    bin: (arr) => ws.send(Uint8Array.from(arr)),
    wait: (pred, ms = 4000) =>
      new Promise((resolve) => {
        const hit = [...inbox].reverse().find(pred);
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
    /** Next message matching pred that arrives from now on. */
    next: (pred, ms = 4000) =>
      new Promise((resolve) => {
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
    clear: () => {
      inbox.splice(0);
      bins.splice(0);
    },
    hello: async () => {
      if (ws.readyState !== WebSocket.OPEN)
        await new Promise((r, j) => {
          ws.once('open', r);
          ws.once('error', j);
        });
      api.send({ t: 'hello', cid, name, avatar: { body: 'default', hair: 'short', skin: '#f6cfae', hairColor: '#3b2a20', top: '#7fa7c9', bottom: '#2d3142', shoes: '#333333', accessories: [], height: 1 } });
      return api.wait((m) => m.t === 'welcome');
    },
    move: (x, z) => api.send({ t: 'move', x, z, ry: 0, anim: 'idle' }),
    close: () => ws.close(),
  };
  return api;
}


// where you stand to use each station / console (see shared/mole.ts)
const STATIONS = {"st-reboot":[242.6,1.55],"st-bugs-s":[241.55,10.6],"st-bugs-d":[250.2,1.55],"st-code-d":[255.2,1.45],"st-code-q":[259.4,1.45],"st-files":[267.4,1.45],"st-coffee":[278.35,3.4],"st-plant-k":[271,1.65],"st-files-t":[247.5,12.5],"st-paper":[241.65,16.6],"st-plant-l":[253,19.35],"st-files-n":[256.9,10.35],"st-reboot-e":[271,10.45],"st-code-c":[278.55,11.4],"st-coffee-b":[278.35,18.6],"st-scan":[243,26.45],"st-paper-x":[259.55,8.5],"st-reboot-w":[270.45,17.3]};
const CRIT_A = [246.65, 5.6];
const CRIT_B = [272.35, 20.9];
(async () => {
  console.log(`Office: ${BASE}`);
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const run = Math.random().toString(36).slice(2, 8);
  const P = [1, 2, 3, 4, 5].map((i) => client(cookie, `smokeM${i}_${run}`, `Mole ${i}`));
  for (const c of P) await c.hello();
  for (const c of P) c.move(262, 24);
  await sleep(400);
  P[0].move(150, 20); // floor 3
  await sleep(200);
  P[0].send({ t: 'mole', m: { a: 'join' } });
  ok(!!(await P[0].wait((m) => m.t === 'err' && /tầng 5/.test(m.msg))), 'you must be on floor 5 to join');
  P[0].move(262, 24);
  await sleep(300);
  for (const c of P) c.send({ t: 'mole', m: { a: 'join' } });
  const lob = await P[4].wait((m) => m.t === 'mole' && m.v.joined.length === 5);
  ok(!!lob && lob.v.host === P[0].cid && lob.v.phase === 'lobby', 'five joined; first is host');
  P[0].send({ t: 'mole', m: { a: 'settings', s: { killCd: 20, tasks: 3 } } });
  await P[0].wait((m) => m.t === 'mole' && m.v.settings.killCd === 20);
  for (const c of P) c.clear();
  P[0].send({ t: 'mole', m: { a: 'start' } });
  const views = await Promise.all(P.map((c) => c.wait((m) => m.t === 'mole' && m.v.phase === 'roles', 9000)));
  const roles = views.map((v) => v?.v.me.role);
  ok(roles.filter((r) => r === 'mole').length === 1 && roles.filter((r) => r === 'crew').length === 4, `roles dealt: ${roles.join(', ')}`);
  ok(views.every((v, i) => v.v.players.filter((p) => p.role).length === 1), 'nobody knows anyone else (one mole)');
  ok(views.every((v, i) => v.v.me.tasks.length === 3), 'everyone has 3 tasks (moles get fake ones)');
  const mole = P[roles.indexOf('mole')];
  const crew = P.filter((c) => c !== mole);
  await P[0].wait((m) => m.t === 'mole' && m.v.phase === 'play', 10000);
  // voice in play: by distance
  for (const c of P) c.move(250 + P.indexOf(c) * 7, 24);
  await sleep(500);
  for (const c of P) c.clear();
  crew[0].bin([1, 2, 2, 2]);
  await sleep(400);
  ok(P.filter((c) => c !== crew[0] && c.bins.length).length === 0, 'play: far apart → nobody hears you');
  // a task
  const myTasks = views[P.indexOf(crew[0])].v.me.tasks;
  const st = myTasks[0].st;
  crew[0].move(...STATIONS[st]);
  await sleep(300);
  crew[0].send({ t: 'mole', m: { a: 'task', st } });
  const prog = await crew[1].wait((m) => m.t === 'mole' && m.v.progress > 0, 3000);
  ok(!!prog && Math.abs(prog.v.progress - 1 / 12) < 0.01, `a finished task moves the shared progress bar (${prog?.v.progress.toFixed(3)})`);
  // the mole can't fake progress
  const mt = views[P.indexOf(mole)].v.me.tasks[0].st;
  mole.move(...STATIONS[mt]);
  await sleep(300);
  mole.send({ t: 'mole', m: { a: 'task', st: mt } });
  await sleep(400);
  const p2 = [...crew[1].inbox].reverse().find((m) => m.t === 'mole');
  ok(Math.abs(p2.v.progress - 1 / 12) < 0.01, "a mole's fake task does not count");
  // doors: anyone playing can shut / open one they stand by; the move is shown to the whole floor
  crew[0].move(264, 20.6); // the meeting room's south door (d-hp-sh)
  await sleep(300);
  for (const c of P) c.clear();
  crew[0].send({ t: 'mole', m: { a: 'door', door: 'd-hp-sh' } });
  const shutV = await crew[2].wait((m) => m.t === 'mole' && m.v.doors.includes('d-hp-sh'), 3000);
  ok(!!shutV, 'a door is shut by hand and everyone sees it');
  ok(!!(await crew[3].wait((m) => m.t === 'moleFx' && m.fx.kind === 'door' && m.fx.shut, 2000)), 'the door noise goes out to the floor');
  crew[1].move(250, 2);
  await sleep(300);
  crew[1].send({ t: 'mole', m: { a: 'door', door: 'd-hp-sh' } });
  await sleep(400);
  ok([...crew[2].inbox].reverse().find((m) => m.t === 'mole').v.doors.includes('d-hp-sh'), "you can't work a door from across the floor");
  await sleep(700);
  crew[0].send({ t: 'mole', m: { a: 'door', door: 'd-hp-sh' } });
  ok(!!(await crew[2].wait((m) => m.t === 'mole' && !m.v.doors.includes('d-hp-sh'), 3000)), 'and opened again');
  // ducts: only the mole can use them; inside you are hidden; you crawl only along one network
  crew[0].move(242.2, 7.6);
  await sleep(300);
  crew[0].send({ t: 'mole', m: { a: 'vent', vent: 'v-server' } });
  await sleep(400);
  ok(![...crew[1].inbox].reverse().find((m) => m.t === 'mole').v.hidden.length, 'an employee cannot get into a duct');
  mole.move(242.2, 7.6);
  await sleep(300);
  mole.send({ t: 'mole', m: { a: 'vent', vent: 'v-server' } });
  const inV = await crew[1].wait((m) => m.t === 'mole' && m.v.hidden.includes(mole.cid), 3000);
  ok(!!inV, 'the mole jumps into a duct and disappears');
  ok(!!(await crew[1].wait((m) => m.t === 'moleFx' && m.fx.kind === 'vent' && m.fx.vent === 'v-server', 2000)), 'the hatch clank goes out to the floor');
  mole.send({ t: 'mole', m: { a: 'vent', vent: 'v-canteen' } });
  await sleep(400);
  ok([...mole.inbox].reverse().find((m) => m.t === 'mole').v.me.vent === 'v-server', "ducts only lead along their own network");
  mole.send({ t: 'mole', m: { a: 'vent', vent: 'v-med' } });
  ok(!!(await mole.wait((m) => m.t === 'mole' && m.v.me.vent === 'v-med', 3000)), 'crawl to a linked hatch');
  mole.move(248.4, 21.2);
  await sleep(300);
  mole.send({ t: 'mole', m: { a: 'vent', vent: null } });
  ok(!!(await crew[1].wait((m) => m.t === 'mole' && !m.v.hidden.length, 3000)), 'climbing out makes you visible again');
  // security cameras: watch from the desk in Phòng An Ninh; the count shows up for everyone
  crew[2].move(261.6, 1.6);
  await sleep(300);
  crew[2].send({ t: 'mole', m: { a: 'cams', on: true } });
  ok(!!(await crew[3].wait((m) => m.t === 'mole' && m.v.cams === 1, 3000)), 'someone watches the cameras (their lights blink for everyone)');
  crew[3].move(250, 2);
  await sleep(300);
  crew[3].send({ t: 'mole', m: { a: 'cams', on: true } });
  await sleep(400);
  ok([...crew[3].inbox].reverse().find((m) => m.t === 'mole').v.cams === 1, 'you can only watch from the security desk');
  crew[2].send({ t: 'mole', m: { a: 'cams', on: false } });
  ok(!!(await crew[3].wait((m) => m.t === 'mole' && m.v.cams === 0, 3000)), 'and stop watching');
  // kill cooldown at the start
  const victim = crew[1];
  victim.move(260, 24);
  mole.move(260.5, 24);
  await sleep(400);
  victim.clear();
  mole.send({ t: 'mole', m: { a: 'kill', target: victim.cid } });
  await sleep(500);
  ok(![...victim.inbox].some((m) => m.t === 'mole' && !m.v.me.alive), 'no lay-off before the cooldown');
  // critical sabotage (allowed ~20 s after the deal) → two people hold both consoles
  const mv = await mole.wait((m) => m.t === 'mole' && m.v.phase === 'play');
  await sleep(Math.max(0, mv.v.me.sabReady - Date.now() + 300));
  mole.send({ t: 'mole', m: { a: 'sabotage', kind: 'crit' } });
  const crit = await crew[0].wait((m) => m.t === 'mole' && m.v.crit > 0, 3000);
  ok(!!crit, 'the mole triggers a server overload');
  crew[2].move(...CRIT_A); // console A (server room)
  crew[3].move(...CRIT_B); // console B (director's office)
  await sleep(400);
  crew[2].send({ t: 'mole', m: { a: 'hold', console: 'mole-crit-a' } });
  await sleep(300);
  crew[0].clear();
  crew[3].send({ t: 'mole', m: { a: 'hold', console: 'mole-crit-b' } });
  ok(!!(await crew[0].wait((m) => m.t === 'mole' && m.v.crit === 0, 3000)), 'holding both consoles together fixes it');
  // lay-off once the cooldown is over
  const kv = await mole.wait((m) => m.t === 'mole' && m.v.phase === 'play');
  await sleep(Math.max(0, kv.v.me.killReady - Date.now() + 300));
  victim.move(260, 24);
  mole.move(260.6, 24);
  await sleep(400);
  mole.send({ t: 'mole', m: { a: 'kill', target: victim.cid } });
  const dead = await victim.wait((m) => m.t === 'mole' && !m.v.me.alive, 3000);
  ok(!!dead && dead.v.bodies.some((b) => b.id === victim.cid), 'lay-off → the victim is out and leaves a body');
  ok(!!dead && dead.v.players.every((p) => p.role), 'ghosts see every role');
  // ghosts are not heard by the living
  for (const c of P) c.clear();
  victim.bin([1, 3, 3, 3]);
  await sleep(400);
  ok(!P.some((c) => c !== victim && c.bins.length), 'a ghost is not heard by the living');
  // report → meeting: everyone alive hears each other across the floor
  crew[0].move(260.8, 25);
  await sleep(300);
  crew[0].send({ t: 'mole', m: { a: 'report', body: victim.cid } });
  const meet = await crew[3].wait((m) => m.t === 'mole' && m.v.phase === 'meeting', 3000);
  ok(!!meet && meet.v.meeting.reason === 'report' && meet.v.bodies.length === 0, 'reporting the body calls a meeting (bodies cleared)');
  crew[2].move(242, 2);
  crew[3].move(278, 26);
  await sleep(400);
  for (const c of P) c.clear();
  crew[2].bin([1, 4, 4, 4]);
  await sleep(400);
  ok(crew[3].bins.length > 0 && !victim.bins.length === false, 'meeting: the living hear each other across the floor (ghosts listen)');
  // vote the mole out
  await crew[0].wait((m) => m.t === 'mole' && m.v.phase === 'vote', 50000);
  for (const c of P) if (c !== victim) c.send({ t: 'mole', m: { a: 'vote', target: c === mole ? crew[0].cid : mole.cid } });
  const resv = await crew[0].wait((m) => m.t === 'mole' && m.v.phase === 'result', 6000);
  ok(!!resv && resv.v.result.out === mole.cid && resv.v.result.wasMole === true, 'the mole is voted out and revealed');
  const end = await crew[0].wait((m) => m.t === 'mole' && m.v.phase === 'end', 12000);
  ok(!!end && end.v.winner === 'crew', `employees win (${end?.v.why})`);
  ok(!!(await crew[0].wait((m) => m.t === 'chat' && /nhân viên thắng/.test(m.m.text))), 'the result is posted in the chat');
  for (const c of P) c.close();
  await sleep(300);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
