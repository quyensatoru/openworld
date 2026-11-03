// End-to-end check in real Chrome (headless, fake camera/mic): two people join the office,
// walk up to each other, talk over WebRTC, share a task. Screenshots land in scripts/out/.
//   BASE=http://localhost:5173 node scripts/e2e.mjs
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:5173';
const PASSCODE = process.env.PASSCODE || 'bss-dev';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const OUT = new URL('./out/', import.meta.url).pathname;
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
  defaultViewport: { width: 1440, height: 860 },
});

async function join(name, shot) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('error', (e) => console.log(`[${name}] PAGE CRASH:`, String(e)));
  page.on('close', () => console.log(`[${name}] page closed`));
  // Software WebGL is slow: use the light graphics preset so movement runs at a decent frame rate.
  if (!shot) await page.evaluateOnNewDocument(() => localStorage.setItem('bss-office-quality', '"low"'));
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=password]', { timeout: 45000 });
  if (shot) await page.screenshot({ path: `${OUT}login.png` });
  await page.type('input[type=password]', PASSCODE);
  await page.click('button.btn.primary');
  try {
    await page.waitForSelector('.creator-panel input', { timeout: 45000 });
  } catch (err) {
    await page.screenshot({ path: `${OUT}fail-${name.split(' ')[0]}.png` });
    console.log('page text:', await page.evaluate(() => document.body.innerText.slice(0, 300)), errors);
    throw err;
  }
  await page.type('.creator-panel input', name);
  await sleep(2500);
  if (shot) await page.screenshot({ path: `${OUT}creator.png` });
  await page.click('.creator-panel footer .btn.primary');
  await page.waitForFunction(() => window.__office?.getState().me && window.__office.getState().connected, { timeout: 45000 });
  // close the first-visit help
  await page.evaluate(() => window.__office.setState({ helpOpen: false }));
  return { page, errors };
}

try {
  const A = await join('Alice Nguyễn', true);
  ok(true, 'Alice logged in, created a character and entered the office');
  const B = await join('Bảo Trần', false);
  ok(true, 'Bảo entered the office');
  const ids = await Promise.all([A, B].map((c) => c.page.evaluate(() => window.__office.getState().me.id)));
  const seesOther = await A.page.waitForFunction((id) => !!window.__office.getState().players[id], { timeout: 8000 }, ids[1]).then(() => true, () => false);
  ok(seesOther, 'Alice sees Bảo');

  await sleep(1500);
  await A.page.screenshot({ path: `${OUT}office-spawn.png` });

  // Walk Alice to Bảo using click-to-move pathfinding, then make sure they are close.
  const bPos = await B.page.evaluate(() => {
    const c = window.__office.game.world.controller;
    return { x: c.x, z: c.z };
  });
  await A.page.evaluate((p) => window.__office.game.goTo(p.x + 1.2, p.z), bPos);
  const arrived = await A.page
    .waitForFunction(
      (p) => {
        const c = window.__office.game.world.controller;
        return Math.hypot(c.x - p.x, c.z - p.z) < 2.2 && !c.hasPath;
      },
      { timeout: 60000 },
      bPos,
    )
    .then(() => true, () => false);
  ok(arrived, 'Alice walked (pathfinding) up to Bảo');

  // Mic on both sides → proximity WebRTC connects.
  await A.page.evaluate(() => window.__office.game.toggleMic());
  await B.page.evaluate(() => window.__office.game.toggleMic());
  const rtcA = await A.page
    .waitForFunction((id) => window.__office.getState().peers[id]?.state === 'connected', { timeout: 20000 }, ids[1])
    .then(() => true, () => false);
  ok(rtcA, 'proximity voice connected (Alice ↔ Bảo)');
  await A.page.evaluate(() => window.__office.game.toggleCam());
  const camAtB = await B.page
    .waitForFunction((id) => {
      const s = window.__office.getState();
      return s.players[id]?.media.cam && s.peers[id]?.cam?.getVideoTracks().length > 0 && document.querySelectorAll('.vtile video').length > 0;
    }, { timeout: 15000 }, ids[0])
    .then(() => true, () => false);
  ok(camAtB, 'Bảo sees Alice camera tile');

  // emotes + chat bubble
  await A.page.evaluate(() => {
    window.__office.game.emote('wave');
    window.__office.game.sendChat('Chào Bảo! Họp daily nhé 👋', 'global');
  });
  const chatAtB = await B.page
    .waitForFunction(() => window.__office.getState().chat.some((m) => m.text.includes('Họp daily')), { timeout: 8000 })
    .then(() => true, () => false);
  ok(chatAtB, 'chat message reached Bảo');
  await sleep(1200);
  await B.page.screenshot({ path: `${OUT}office-near.png` });

  // Kanban sync
  await A.page.evaluate(() => window.__office.game.createTask('Thiết kế màn hình check-in', 'doing', window.__office.getState().me.id, 'high'));
  const taskAtB = await B.page
    .waitForFunction(() => Object.values(window.__office.getState().tasks).some((t) => t.title === 'Thiết kế màn hình check-in'), { timeout: 8000 })
    .then(() => true, () => false);
  ok(taskAtB, 'task created by Alice shows up for Bảo');
  await B.page.evaluate(() => window.__office.setState({ kanbanOpen: true }));
  await sleep(500);
  await B.page.screenshot({ path: `${OUT}kanban.png` });
  await B.page.evaluate(() => window.__office.setState({ kanbanOpen: false }));

  // Walk away → connection closes (teleport: pathfinding was already checked above).
  await A.page.evaluate(() => {
    const c = window.__office.game.world.controller;
    c.cancelPath();
    c.x = 27;
    c.z = 25.5;
  });
  const closed = await A.page
    .waitForFunction((id) => !window.__office.getState().peers[id], { timeout: 60000 }, ids[1])
    .then(() => true, () => false);
  ok(closed, 'walking away closes the voice connection');

  // Sit at a desk (teleport next to it first: software WebGL in CI renders only a few FPS)
  await A.page.evaluate(() => {
    const c = window.__office.game.world.controller;
    c.cancelPath();
    c.x = 18.6;
    c.z = 2.75;
    window.__office.game.sitOnSeat('desk-05');
  });
  const sat = await B.page
    .waitForFunction((id) => window.__office.getState().players[id]?.seat === 'desk-05', { timeout: 60000 }, ids[0])
    .then(() => true, () => false);
  ok(sat, 'Alice sat at desk 5 (Bảo sees it)');
  await sleep(1500);
  await A.page.screenshot({ path: `${OUT}office-desk.png` });

  const errs = [...A.errors, ...B.errors].filter((e) => !/favicon|fonts\.g/.test(e));
  ok(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll E2E checks passed');
process.exit(failures ? 1 : 0);
