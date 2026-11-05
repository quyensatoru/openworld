// Floor 6 protocol test: "Trốn tìm biến hình" with four fake players — joining, settings, teams,
// starting spots, turning into furniture (range, health by size), locking, taunts, the hunt (hits,
// shots at real furniture, finding), ghost voice, the round result, teams rotating, abort.
//   BASE=http://localhost:5173 PASSCODE=bss-dev npx tsx scripts/floor6-test.mjs
import WebSocket from 'ws';
import { FURNITURE } from '../shared/map.ts';

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



const piece = (kind, lx, z) => FURNITURE.find((f) => f.kind === kind && Math.abs(f.x - (300 + lx)) < 0.05 && Math.abs(f.z - z) < 0.05);
const ph = (m) => ({ t: 'prop', m });
const view = (pred) => (m) => m.t === 'prop' && pred(m.v);

(async () => {
  console.log(`Office: ${BASE}`);
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const P = [];
  for (let i = 0; i < 4; i++) {
    const c = client(cookie, `phtest_${i}_1234567`, `Trốn ${i}`);
    await c.hello();
    P.push(c);
  }
  const pallet = piece('pallet', 19.0, 13.8);
  const carton = piece('carton', 16.7, 11.4);
  const bin = piece('trashBin', 39.5, 8.5);
  ok(!!pallet && !!carton && !!bin, 'floor 6 furniture is where the test expects it');

  // joining needs floor 6
  P[0].move(262, 24);
  await sleep(300);
  P[0].send(ph({ a: 'join' }));
  ok(!!(await P[0].wait((m) => m.t === 'err' && /tầng 6/.test(m.msg))), 'you must be on floor 6 to join');
  P.forEach((c, i) => c.move(305 + i * 2, 22));
  await sleep(400);
  for (const c of P) c.send(ph({ a: 'join' }));
  const lobby = await P[0].wait(view((v) => v.joined.length === 4));
  ok(!!lobby && lobby.v.host === P[0].cid, 'four joined; the first is host');
  P[1].send(ph({ a: 'settings', s: { rounds: 4 } }));
  P[0].send(ph({ a: 'settings', s: { hideS: 20, roundMin: 3, rounds: 2, tauntS: 30, seekers: 1, infect: false } }));
  const set = await P[0].wait(view((v) => v.settings.hideS === 20 && v.settings.rounds === 2), 3000);
  ok(!!set && set.v.settings.seekers === 1, 'only the host changes the settings');
  P[0].send(ph({ a: 'start' }));
  const roles = await Promise.all(P.map((c) => c.wait(view((v) => v.phase === 'roles'), 9000)));
  const teams = roles.map((r) => r?.v.me.team);
  ok(teams.filter((t) => t === 'seeker').length === 1 && teams.filter((t) => t === 'hider').length === 3, `teams dealt: ${teams.join(', ')}`);
  ok(roles.every((r) => r?.v.me.spawn && r.v.me.spawn.x > 300), 'everyone gets a starting spot on floor 6');
  const S = P[teams.indexOf('seeker')];
  const [A, B, C] = P.filter((c) => c !== S);
  ok(roles[teams.indexOf('seeker')].v.me.spawn.x > 328, 'the seeker starts in the waiting room');
  roles.forEach((r, i) => P[i].move(r.v.me.spawn.x, r.v.me.spawn.z));

  // ---- hiding
  ok(!!(await S.wait(view((v) => v.phase === 'hide'), 8000)), 'hide phase');
  A.move(pallet.x, pallet.z - 1.3);
  B.move(carton.x, carton.z + 0.9);
  await sleep(300);
  for (const c of [A, B, C]) c.clear();
  C.send(ph({ a: 'prop', fid: pallet.id }));
  ok(!!(await C.wait((m) => m.t === 'err' && /Lại gần/.test(m.msg))), "can't turn into something across the room");
  A.send(ph({ a: 'prop', fid: pallet.id }));
  B.send(ph({ a: 'prop', fid: carton.id }));
  const props = await S.wait(view((v) => v.props[A.cid]?.fid === pallet.id && v.props[B.cid]?.fid === carton.id), 3000);
  ok(!!props, 'hiders turn into the pallet and the carton (everyone sees it)');
  const hpA = (await A.wait(view((v) => v.me.maxHp === 100 && v.props[A.cid])))?.v.me;
  const hpB = (await B.wait(view((v) => v.me.maxHp === 50 && v.props[B.cid])))?.v.me;
  ok(!!hpA && !!hpB, 'health follows the size (pallet 100, carton 50)');
  ok(!!props && props.v.players.find((p) => p.id === A.cid)?.hp === null, "seekers don't see the hiders' health");
  A.send(ph({ a: 'lock', ry: 1.2 }));
  ok(!!(await S.wait(view((v) => v.props[A.cid]?.ry === 1.2))), 'a hider locks the angle');
  S.clear();
  B.send(ph({ a: 'taunt' }));
  ok(!!(await S.wait((m) => m.t === 'propFx' && m.fx.kind === 'taunt' && m.fx.id === B.cid)), 'a taunt is heard on the floor');
  S.send(ph({ a: 'shoot', hit: B.cid, fid: null, tx: 0, ty: 0, tz: 0 }));
  await sleep(300);
  ok(!(await B.wait((m) => m.t === 'propFx' && m.fx.kind === 'hit', 300)), 'no shooting while the hiders hide');

  // ---- the hunt
  ok(!!(await S.wait(view((v) => v.phase === 'seek'), 26000)), 'seek phase: the shutter opens');
  S.move(320, 16);
  await sleep(300);
  S.clear();
  S.send(ph({ a: 'shoot', hit: null, fid: bin.id, tx: bin.x, ty: 0.3, tz: bin.z }));
  const miss = await S.wait((m) => m.t === 'propFx' && m.fx.kind === 'miss');
  ok(!!miss && miss.fx.hp === 95, 'shooting real furniture costs the seeker 5 health');
  await sleep(350);
  S.send(ph({ a: 'shoot', hit: B.cid, fid: null, tx: carton.x, ty: 0.3, tz: carton.z }));
  const hit = await B.wait((m) => m.t === 'propFx' && m.fx.kind === 'hit');
  ok(!!hit && hit.fx.hp === 25, 'a hit takes 25 health off the hider');
  await sleep(350);
  A.clear();
  S.send(ph({ a: 'shoot', hit: B.cid, fid: null, tx: carton.x, ty: 0.3, tz: carton.z }));
  const found = await A.wait((m) => m.t === 'propFx' && m.fx.kind === 'found' && m.fx.id === B.cid);
  ok(!!found && /carton/.test(found.fx.prop), 'two hits and the carton is found');
  const after = await S.wait(view((v) => v.hidersLeft === 2 && !v.props[B.cid]));
  ok(!!after, 'two hiders left; the found one is furniture no more');
  // a found hider is a ghost: the living don't hear them
  for (const c of P) c.clear();
  B.bin([1, 5, 5, 5]);
  await sleep(400);
  ok(!A.bins.length && !C.bins.length, "a found hider isn't heard by the players still in the round");
  // finish the round: the pallet (100) and the hider who never hid (100)
  for (const [who, n] of [[A, 4], [C, 4]]) {
    for (let i = 0; i < n; i++) {
      await sleep(350);
      S.send(ph({ a: 'shoot', hit: who.cid, fid: null, tx: 0, ty: 0, tz: 0 }));
    }
  }
  const end = await S.wait(view((v) => v.phase === 'roundEnd'), 4000);
  ok(!!end && end.v.winner === 'seeker', `round 1 to the seekers (${end?.v.why})`);
  const sc = end?.v.players.find((p) => p.id === S.cid)?.score ?? 0;
  ok(sc >= 3 * 3, `the seeker scored (${sc} points)`);

  // ---- round 2: teams rotate
  const r2 = await S.wait(view((v) => v.phase === 'roles' && v.round === 2), 12000);
  ok(!!r2, 'round 2 starts');
  const seeker2 = r2?.v.players.find((p) => p.team === 'seeker')?.id;
  ok(!!seeker2 && seeker2 !== S.cid, 'a different seeker in round 2');
  ok(!!r2 && Object.keys(r2.v.props).length === 0, 'everyone is themselves again');
  P[0].send(ph({ a: 'abort' }));
  ok(!!(await P[1].wait(view((v) => v.phase === 'lobby'), 3000)), 'the host can stop the game');

  for (const c of P) c.close();
  await sleep(300);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
