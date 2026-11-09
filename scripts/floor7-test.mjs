// Floor 7 protocol test: the wedding hall with four fake players — roles (groom, bride, MC), who
// may run the programme, the steps, gift envelopes (amounts, throttle), reactions, poppers, outfits,
// the bouquet toss (the server picks the catcher), ending the party, roles freed when you leave.
//   BASE=http://localhost:5174 PASSCODE=office-dev npx tsx scripts/floor7-test.mjs
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




const F7 = 360;
const wed = (m) => ({ t: 'wed', m });
const state = (pred) => (m) => m.t === 'wed' && pred(m.s);

(async () => {
  console.log(`Office: ${BASE}`);
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const names = ['Chú Rể', 'Cô Dâu', 'MC Vui', 'Khách Mời'];
  const P = [];
  for (let i = 0; i < 4; i++) {
    const c = client(cookie, `wedtest_${i}_1234567`, names[i]);
    const w = await c.hello();
    if (i === 0) ok(!!w?.wed, 'the welcome carries the wedding state');
    P.push(c);
  }
  const [G, B, M, X] = P;
  // make sure the hall is free (a previous run may have left a party going)
  for (const c of P) c.move(F7 + 20, 10);
  await sleep(400);
  M.send(wed({ a: 'role', role: 'mc', on: true }));
  await sleep(300);
  M.send(wed({ a: 'end' }));
  await sleep(300);
  for (const c of P) for (const role of ['groom', 'bride', 'mc']) c.send(wed({ a: 'role', role, on: false }));
  await sleep(400);

  // roles need floor 7
  G.move(20, 21);
  await sleep(300);
  G.send(wed({ a: 'role', role: 'groom', on: true }));
  ok(!!(await G.wait((m) => m.t === 'err' && /tầng 7/.test(m.msg))), 'you must be on floor 7 to take a role');
  G.move(F7 + 18, 12);
  B.move(F7 + 22, 12);
  M.move(F7 + 24.4, 3.2);
  X.move(F7 + 10, 15);
  await sleep(400);
  for (const c of P) c.clear();
  G.send(wed({ a: 'role', role: 'groom', on: true }));
  ok(!!(await G.wait(state((s) => s.groom?.id === G.cid))), 'groom taken');
  B.send(wed({ a: 'role', role: 'bride', on: true }));
  ok(!!(await G.wait(state((s) => s.bride?.id === B.cid))), 'bride taken');
  ok(!!(await X.wait((m) => m.t === 'chat' && /sắp làm đám cưới/.test(m.m.text), 3000)), 'everyone hears the couple is getting married');
  M.send(wed({ a: 'role', role: 'mc', on: true }));
  ok(!!(await G.wait(state((s) => s.mc?.id === M.cid))), 'MC taken');
  X.send(wed({ a: 'role', role: 'groom', on: true }));
  ok(!!(await X.wait((m) => m.t === 'err' && /Đã có chú rể/.test(m.msg))), 'a role someone holds cannot be taken');

  // only the couple / MC run the show
  X.send(wed({ a: 'next' }));
  ok(!!(await X.wait((m) => m.t === 'err' && /Chỉ cô dâu/.test(m.msg))), 'a guest cannot run the programme');
  X.clear();
  G.send(wed({ a: 'step', step: 'march' }));
  const march = await X.wait(state((s) => s.step === 'march'));
  ok(!!march && march.s.startedAt && Math.abs(march.s.stepAt - Date.now()) < 5000, 'the ceremony starts with the walk down the aisle');
  ok(!!(await X.wait((m) => m.t === 'chat' && /đang bắt đầu ở tầng 7/.test(m.m.text), 3000)), 'the office is invited up');
  await sleep(1000);
  M.send(wed({ a: 'next' }));
  ok(!!(await X.wait(state((s) => s.step === 'vows'))), 'the MC moves on to the vows');
  await sleep(1000);
  B.send(wed({ a: 'step', step: 'nope' }));
  B.send(wed({ a: 'step', step: 'rings' }));
  ok(!!(await X.wait(state((s) => s.step === 'rings'))), 'the bride jumps to the rings (bad step names are ignored)');

  // gifts
  X.clear();
  X.send(wed({ a: 'gift', amount: 123, wish: 'sai số tiền' }));
  X.send(wed({ a: 'gift', amount: 500000, wish: 'Chúc hai bạn trăm năm hạnh phúc!' }));
  const fx = await G.wait((m) => m.t === 'wedFx' && m.fx.k === 'gift');
  ok(!!fx && fx.fx.amount === 500000 && fx.fx.name === 'Khách Mời', 'a gift flies into the box for everyone to see');
  const after = await G.wait(state((s) => s.total === 500000 && s.givers === 1 && s.gifts.length === 1));
  ok(!!after && after.s.gifts[0].wish.startsWith('Chúc hai bạn'), 'gift + wish recorded (an odd amount is refused)');
  X.send(wed({ a: 'gift', amount: 300000 }));
  ok(!!(await X.wait((m) => m.t === 'err' && /phong bì/.test(m.msg))), 'gifts are throttled');

  // reactions, poppers, petals, outfits
  X.send(wed({ a: 'react', e: '💩' }));
  X.send(wed({ a: 'react', e: '👏' }));
  const r = await G.wait((m) => m.t === 'wedFx' && m.fx.k === 'react');
  ok(!!r && r.fx.e === '👏', 'reactions go round (only the allowed ones)');
  X.send(wed({ a: 'popper' }));
  ok(!!(await G.wait((m) => m.t === 'wedFx' && m.fx.k === 'popper' && m.fx.id === X.cid)), 'party popper');
  X.send(wed({ a: 'petals' }));
  ok(!!(await G.wait((m) => m.t === 'wedFx' && m.fx.k === 'petals' && m.fx.id === X.cid)), 'petals');
  X.send(wed({ a: 'attire', attire: 'tuxedo' }));
  X.send(wed({ a: 'attire', attire: 'bridesmaid' }));
  ok(!!(await G.wait(state((s) => s.attire[X.cid] === 'bridesmaid'))), 'a guest dresses as a bridesmaid');

  // the house lights: during the ceremony only the couple / MC switch them
  X.send(wed({ a: 'lights', lights: 'on' }));
  ok(!!(await X.wait((m) => m.t === 'err' && /đổi đèn/.test(m.msg))), 'a guest cannot switch the lights during the ceremony');
  M.send(wed({ a: 'lights', lights: 'disco' }));
  M.send(wed({ a: 'lights', lights: 'off' }));
  const lf = await X.wait((m) => m.t === 'wedFx' && m.fx.k === 'lights');
  ok(!!lf && lf.fx.lights === 'off' && lf.fx.name === 'MC Vui', 'the MC turns the lights off (everyone is told; nonsense modes ignored)');
  ok(!!(await X.wait(state((s) => s.lights === 'off'))), 'lights off in the state');

  // bouquet: the guest on the dance floor catches it
  X.move(F7 + 20, 6.6);
  await sleep(1000);
  M.send(wed({ a: 'step', step: 'bouquet' }));
  const bq = await X.wait(state((s) => s.step === 'bouquet'));
  ok(!!bq && !bq.s.bouquet, 'bouquet step: countdown first');
  const caught = await X.wait(state((s) => !!s.bouquet), 10000);
  ok(!!caught && caught.s.bouquet.id === X.cid, `the guest on the dance floor catches it (${caught?.s.bouquet?.name})`);
  ok(!!caught && caught.s.bouquet.at - (caught.s.stepAt + 7000) >= 1000, 'it lands after its flight');
  ok(!!(await X.wait((m) => m.t === 'chat' && /bắt được hoa cưới/.test(m.m.text), 4000)), 'the catch is announced');

  // party, then the end
  G.send(wed({ a: 'next' }));
  ok(!!(await X.wait(state((s) => s.step === 'dance'))), 'first dance');
  await sleep(1000);
  B.send(wed({ a: 'next' }));
  ok(!!(await X.wait(state((s) => s.step === 'party'))), 'party');
  X.send(wed({ a: 'end' }));
  ok(!!(await X.wait((m) => m.t === 'err' && /kết thúc/.test(m.msg))), 'a guest cannot end it');
  X.clear();
  M.send(wed({ a: 'end' }));
  const done = await X.wait(state((s) => s.step === 'idle' && s.count >= 1));
  ok(!!done && !done.s.groom && !done.s.bride && done.s.mc?.id === M.cid && done.s.total === 0, 'the hall is free again (the MC stays)');
  ok(!!(await X.wait((m) => m.t === 'chat' && /kết thúc tốt đẹp/.test(m.m.text), 3000)), 'thanks everyone in the chat');
  ok(done?.s.lights === 'off', 'the lights stay as they were after the party');
  X.send(wed({ a: 'lights', lights: 'auto' }));
  ok(!!(await G.wait(state((s) => s.lights === 'auto'))), 'with no ceremony on, any guest can work the switch');

  // a role is freed when you leave the floor while the hall is quiet; outfits go when you leave the office
  G.send(wed({ a: 'role', role: 'groom', on: true }));
  ok(!!(await X.wait(state((s) => s.groom?.id === G.cid))), 'groom again');
  G.move(20, 21);
  ok(!!(await X.wait(state((s) => !s.groom), 3000)), 'leaving floor 7 frees the role');
  X.close();
  ok(!!(await G.wait(state((s) => !s.attire['wedtest_3_1234567']), 3000)), 'leaving the office takes the outfit off');

  for (const c of [G, B, M]) c.close();
  console.log(failures ? `\n${failures} failed` : '\nall good');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
