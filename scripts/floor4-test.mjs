// Floor 4 protocol test: karaoke (queue, mics, effects, reactions, voice relay, score) and a full
// Ma Sói game with five fake players (roles, night actions, voice rules, votes, the end).
//   BASE=http://localhost:5173 PASSCODE=bss-dev node scripts/floor4-test.mjs
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

(async () => {
  console.log(`Office: ${BASE}`);
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  ok(res.status === 200, 'logged in');
  const run = Math.random().toString(36).slice(2, 8);

  // ------------------------------------------------------------------ YouTube search
  const s = await fetch(`${BASE}/api/yt-search?q=${encodeURIComponent('nơi này có anh karaoke')}`, { headers: { Cookie: cookie } });
  const sj = await s.json().catch(() => ({}));
  ok(s.status === 200 && sj.hits?.length > 0 && /^[\w-]{11}$/.test(sj.hits[0].id), `YouTube search works (${sj.hits?.length ?? 0} hits, e.g. “${sj.hits?.[0]?.title ?? '-'}”)`);

  // ------------------------------------------------------------------ karaoke
  const A = client(cookie, `smokeKA_${run}`, 'Kara A');
  const B = client(cookie, `smokeKB_${run}`, 'Kara B');
  const C = client(cookie, `smokeKC_${run}`, 'Kara C');
  const O = client(cookie, `smokeKO_${run}`, 'Kara Outside');
  const wa = await A.hello();
  await B.hello();
  await C.hello();
  await O.hello();
  ok(!!wa?.kara && Array.isArray(wa.kara.queue), 'welcome carries the karaoke state');
  for (const [c, x] of [[A, 189], [B, 191], [C, 192]]) c.move(x, 12);
  O.move(205, 24); // hall 4
  await A.wait((m) => m.t === 'upd' && m.id === C.cid && m.patch.zone === 'karaoke');
  A.send({ t: 'kara', m: { a: 'add', videoId: 'dQw4w9WgXcQ', title: 'Bài test', dur: 7 } });
  const k1 = await B.wait((m) => m.t === 'kara' && m.s.now?.song.title === 'Bài test');
  ok(!!k1 && k1.s.mics.length === 1 && k1.s.mics[0].id === A.cid, 'adding a song starts it; the owner gets mic 1');
  ok(!!k1 && k1.s.now.startAt > Date.now() - 500, 'song starts after a count-in');
  B.send({ t: 'kara', m: { a: 'mic', on: true } });
  const k2 = await A.wait((m) => m.t === 'kara' && m.s.mics.length === 2);
  ok(!!k2 && k2.s.mics[1].id === B.cid, 'second person takes mic 2');
  C.send({ t: 'kara', m: { a: 'mic', on: true } });
  ok(!!(await C.wait((m) => m.t === 'err' && /mic/i.test(m.msg))), 'a third mic is refused');
  A.send({ t: 'kara', m: { a: 'fx', fx: { vol: 1.2, echo: 0.7, delay: 0.3, reverb: 0.5, room: 2, bass: 4, treble: -2 } } });
  const k3 = await B.wait((m) => m.t === 'kara' && m.s.mics[0]?.fx?.echo === 0.7);
  ok(!!k3 && k3.s.mics[0].fx.room === 2 && k3.s.mics[0].fx.vol === 1.2, 'mic effects are shared with the room');
  A.send({ t: 'kara', m: { a: 'fx', fx: { vol: 99, echo: -5, delay: 3, reverb: 2, room: 9, bass: 50, treble: -50 } } });
  const k4 = await B.wait((m) => m.t === 'kara' && m.s.mics[0]?.fx?.vol === 1.5);
  ok(!!k4 && k4.s.mics[0].fx.echo === 0 && k4.s.mics[0].fx.delay === 0.45 && k4.s.mics[0].fx.room === 2 && k4.s.mics[0].fx.bass === 12, 'effect values are clamped');
  O.clear();
  C.send({ t: 'kara', m: { a: 'react', e: '👏' } });
  ok(!!(await A.wait((m) => m.t === 'karaReact' && m.id === C.cid && m.e === '👏')), 'reactions reach the room');
  ok(!(await O.wait((m) => m.t === 'karaReact', 800)), '…but not the hall');
  // voice: Opus packets go to everyone in the room, not outside
  A.clear();
  B.clear();
  O.clear();
  C.bin([4, 1, 0, 3, 9, 9, 9]);
  await sleep(500);
  ok(B.bins.some((b) => b[0] === 4) && A.bins.some((b) => b[0] === 4), 'Opus voice is relayed across the whole karaoke room');
  ok(!O.bins.length, '…and not to the hall');
  // queue + remove
  B.send({ t: 'kara', m: { a: 'add', videoId: 'kJQP7kiw5Fk', title: 'Bài B' } });
  const k5 = await A.wait((m) => m.t === 'kara' && m.s.queue.some((q) => q.title === 'Bài B'));
  const sid = k5?.s.queue.find((q) => q.title === 'Bài B')?.sid;
  A.send({ t: 'kara', m: { a: 'remove', sid } });
  ok(!!(await A.wait((m) => m.t === 'err' && /chọn bài/.test(m.msg))), "you can't remove someone else's song");
  B.send({ t: 'kara', m: { a: 'remove', sid } });
  ok(!!(await A.wait((m) => m.t === 'kara' && !m.s.queue.length)), 'the owner removes their song');
  // the song ends on its own (3 s count-in + 7 s) with a score
  A.send({ t: 'kara', m: { a: 'voice', sid: k1.s.now.song.sid, sung: 6.5, heard: 7 } });
  const k6 = await C.wait((m) => m.t === 'kara' && m.s.last?.sid === k1.s.now.song.sid, 14000);
  ok(!!k6 && k6.s.last.score >= 60 && k6.s.last.score <= 100 && !!k6.s.last.comment, `song ends by itself with a score (${k6?.s.last.score}: ${k6?.s.last.comment})`);
  ok(!!k6 && !k6.s.now && !k6.s.mics.length, 'mics go back on the stand after the song');
  // walking out frees a mic
  B.send({ t: 'kara', m: { a: 'mic', on: true } });
  await A.wait((m) => m.t === 'kara' && m.s.mics.some((x) => x.id === B.cid));
  B.move(205, 24);
  ok(!!(await A.wait((m) => m.t === 'kara' && !m.s.mics.some((x) => x.id === B.cid))), 'leaving the room gives the mic back');
  for (const c of [A, B, C, O]) c.close();
  await sleep(300);

  // ------------------------------------------------------------------ Ma Sói
  const P = [1, 2, 3, 4, 5].map((i) => client(cookie, `smokeW${i}_${run}`, `Sói ${i}`));
  const S = client(cookie, `smokeWS_${run}`, 'Người xem');
  for (const c of P) await c.hello();
  await S.hello();
  for (const c of [...P, S]) c.move(210, 16);
  await sleep(400);
  S.send({ t: 'wolf', m: { a: 'start' } });
  ok(!!(await S.wait((m) => m.t === 'err' && /gốc cây/.test(m.msg))), 'you must sit at the fire to start');
  P.forEach((c, i) => c.send({ t: 'sit', seat: `wolf-${String(i + 1).padStart(2, '0')}` }));
  const lob = await S.wait((m) => m.t === 'wolf' && m.v?.seated.length === 5);
  ok(!!lob && lob.v.phase === 'lobby' && lob.v.host === P[0].cid, 'five people round the fire; the first one is host');
  P[1].send({ t: 'wolf', m: { a: 'settings', s: { dayS: 90 } } });
  P[0].send({ t: 'wolf', m: { a: 'settings', s: { dayS: 90, reveal: true } } });
  ok(!!(await S.wait((m) => m.t === 'wolf' && m.v?.settings.dayS === 90)), 'only the host changes settings');
  P[0].send({ t: 'wolf', m: { a: 'start' } });
  ok(!!(await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'starting')), 'start → 5 s countdown');
  const views = await Promise.all(P.map((c) => c.wait((m) => m.t === 'wolf' && m.v?.phase === 'reveal', 8000)));
  const roles = views.map((v) => v?.v.me.role);
  ok(roles.every(Boolean), `roles dealt: ${roles.join(', ')}`);
  ok(roles.filter((r) => r === 'wolf').length === 1 && roles.includes('seer') && roles.includes('minion'), '5 players → 1 wolf + traitor + seer + villagers');
  ok(views.every((v, i) => v.v.players.filter((p) => p.role).length === (roles[i] === 'minion' ? 2 : 1)), "nobody sees anyone else's role (the traitor knows the wolf)");
  const minionView = views[roles.indexOf('minion')];
  ok(minionView.v.me.mates.length === 1 && minionView.v.me.mates[0] === P[roles.indexOf('wolf')].cid, 'the traitor knows who the wolf is');
  ok(!views[roles.indexOf('wolf')].v.players.some((p) => p.role === 'minion'), "…but the wolf doesn't know the traitor");
  const sv = await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'reveal');
  ok(!!sv && sv.v.players.every((p) => p.role), 'onlookers see every role');
  S.send({ t: 'sit', seat: 'wolf-06' });
  ok(!!(await S.wait((m) => m.t === 'err' && /Ma Sói đang diễn ra/.test(m.msg))), 'empty stumps are locked during a game');
  const by = (r) => P[roles.indexOf(r)];
  const wolf = by('wolf');
  const seer = by('seer');
  const guard = by('minion'); // a living bystander for the voice checks below
  const villagers = P.filter((_, i) => roles[i] === 'villager');
  // voice at "night" (reveal counts as night): a villager is not heard by the living, the onlooker hears
  for (const c of [...P, S]) c.clear();
  villagers[0].bin([1, 1, 2, 3]);
  await sleep(500);
  ok(!P.some((c) => c !== villagers[0] && c.bins.length), 'night: villagers are not heard by anyone alive');
  ok(S.bins.length > 0, 'night: onlookers still hear the village');
  // night
  await wolf.wait((m) => m.t === 'wolf' && m.v?.phase === 'night', 12000);
  const victim = villagers[0];
  wolf.send({ t: 'wolf', m: { a: 'act', target: victim.cid } });
  seer.send({ t: 'wolf', m: { a: 'act', target: wolf.cid } });
  const seen = await seer.wait((m) => m.t === 'wolf' && m.v?.me.seen?.length === 1);
  ok(!!seen && seen.v.me.seen[0].wolf === true, 'the seer learns that the wolf is a wolf');
  const dawn = await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'dawn', 25000);
  const dead = dawn?.v.players.find((p) => p.id === victim.cid);
  ok(!!dawn && dead && !dead.alive && dead.cause === 'wolf', 'dawn: the wolf’s victim is dead');
  ok(!!dawn && dawn.v.log.some((l) => l.text.includes('Kara') || l.text.includes(dead?.name ?? '???')), 'the game master announces the death');
  // dead players only reach the dead / onlookers
  for (const c of [...P, S]) c.clear();
  victim.bin([1, 5, 5, 5]);
  await sleep(500);
  ok(!P.some((c) => c !== victim && c.bins.length) && S.bins.length > 0, 'the dead only talk to the dead and onlookers');
  // day → everyone skips straight to the vote
  await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'day', 12000);
  for (const c of [...P, S]) c.clear();
  seer.bin([1, 7, 7, 7]);
  await sleep(500);
  ok(P.filter((c) => c !== seer && c.bins.length).length === 4, 'day: the living hear each other');
  const living = P.filter((c) => c !== victim);
  for (const c of living.slice(0, 3)) c.send({ t: 'wolf', m: { a: 'skipday' } });
  ok(!!(await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'vote', 6000)), 'a majority can skip the discussion');
  for (const c of living) c.send({ t: 'wolf', m: { a: 'vote', target: c === wolf ? seer.cid : wolf.cid } });
  const def = await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'defense', 8000);
  ok(!!def && def.v.accused === wolf.cid, 'the wolf gets the most votes and must defend');
  for (const c of [...P, S]) c.clear();
  seer.bin([1, 8, 8, 8]);
  wolf.bin([1, 9, 9, 9]);
  await sleep(500);
  ok(!guard.bins.some((b) => b[b.length - 1] === 8) && guard.bins.some((b) => b[b.length - 1] === 9), 'defense: only the accused is heard');
  const ver = await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'verdict', 30000);
  ok(!!ver, 'verdict vote');
  for (const c of living) if (c !== wolf) c.send({ t: 'wolf', m: { a: 'verdict', yes: true } });
  const end = await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'end', 8000);
  ok(!!end && end.v.winner === 'village', 'hanging the only wolf → the village wins');
  const endMe = await villagers[1].wait((m) => m.t === 'wolf' && m.v?.phase === 'end');
  ok(!!endMe && endMe.v.players.every((p) => p.role), 'everyone sees all roles at the end');
  ok(!!(await S.wait((m) => m.t === 'chat' && /dân làng thắng/i.test(m.m.text))), 'the result is posted in the chat');
  ok(!!endMe && endMe.v.winners.includes(seer.cid) && !endMe.v.winners.includes(by('minion').cid), 'winners: the village, not the traitor');

  // ------------------------------------------------------------------ third party: the Fool wins by being hanged
  await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'lobby', 35000);
  P[0].send({ t: 'wolf', m: { a: 'settings', s: { mode: 'custom', wolves: 1, roles: { alpha: false, minion: false, seer: false, guard: true, witch: false, hunter: false, cupid: false, fool: true, killer: false } } } });
  await S.wait((m) => m.t === 'wolf' && m.v?.settings.mode === 'custom' && m.v.settings.roles.fool && !m.v.settings.roles.seer);
  for (const c of [...P, S]) c.clear(); // drop the first game's messages (wait() also looks back)
  P[0].send({ t: 'wolf', m: { a: 'start' } });
  const v2 = await Promise.all(P.map((c) => c.wait((m) => m.t === 'wolf' && m.v?.phase === 'reveal', 9000)));
  const r2 = v2.map((v) => v?.v.me.role);
  ok(r2.includes('fool') && r2.includes('guard') && r2.filter((r) => r === 'wolf').length === 1, `custom roles: ${r2.join(', ')}`);
  const fool = P[r2.indexOf('fool')];
  const wolf2 = P[r2.indexOf('wolf')];
  const guard2 = P[r2.indexOf('guard')];
  await wolf2.wait((m) => m.t === 'wolf' && m.v?.phase === 'night', 12000);
  const gNight = await guard2.wait((m) => m.t === 'wolf' && m.v?.phase === 'night' && m.v.me.act);
  ok(!!gNight && gNight.v.me.act.targets.includes(guard2.cid), 'the guard may protect themself');
  const prey = P.find((c, i) => r2[i] === 'villager');
  wolf2.send({ t: 'wolf', m: { a: 'act', target: prey.cid } });
  guard2.send({ t: 'wolf', m: { a: 'act', target: guard2.cid } });
  await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'day', 40000);
  const alive2 = P.filter((c) => c !== prey);
  for (const c of alive2) c.send({ t: 'wolf', m: { a: 'skipday' } });
  await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'vote', 6000);
  for (const c of alive2) if (c !== fool) c.send({ t: 'wolf', m: { a: 'vote', target: fool.cid } });
  fool.send({ t: 'wolf', m: { a: 'vote', target: wolf2.cid } });
  await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'verdict', 35000);
  for (const c of alive2) if (c !== fool) c.send({ t: 'wolf', m: { a: 'verdict', yes: true } });
  const end2 = await S.wait((m) => m.t === 'wolf' && m.v?.phase === 'end' && m.v.winner === 'fool', 8000);
  ok(!!end2 && end2.v.winners.length === 1 && end2.v.winners[0] === fool.cid, 'the Fool wins alone by getting hanged');
  // night 2 rule: the guard can't pick the same person again (checked on the next night of a new game is long; check the view instead)
  P[0].send({ t: 'wolf', m: { a: 'abort' } });
  for (const c of [...P, S]) c.close();
  await sleep(300);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
