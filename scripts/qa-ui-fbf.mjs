// QA (task #3f90ab89): lazy chunks, first-visit tour, ask templates, 👍/👎 bar — one short browser run.
//   BASE=http://localhost:5247 node scripts/qa-ui-fbf.mjs   (dev server: module URLs are /src/...)
import puppeteer from 'puppeteer-core';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'office-dev';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  defaultViewport: { width: 1440, height: 860 },
});
const timer = setTimeout(() => {
  console.log('❌ timed out');
  process.exit(1);
}, 150_000);
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  const reqs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => reqs.push({ url: r.url(), t: Date.now() }));
  await page.evaluateOnNewDocument(() => localStorage.setItem('office-quality', '"low"'));
  const loaded = (re) => reqs.some((r) => re.test(r.url));

  // ---- A: the login screen comes up without the office code
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=password]', { timeout: 45000 });
  const shownAt = Date.now();
  const before = reqs.filter((r) => r.t <= shownAt);
  // (dev only: main.tsx's __office test hook imports ./game at once, which pulls three.js and the avatar
  // manifest — so those are not checked here; the production index chunk imports neither, see the QA note)
  const early = before.filter((r) => /\/src\/ui\/Office\.tsx/.test(r.url));
  ok(!early.length, 'login screen is up before the Office chunk is requested ' + early.map((r) => r.url.replace(BASE, '')).join(' ').slice(0, 300));
  await sleep(2500);
  ok(loaded(/\/src\/ui\/Office\.tsx/), 'the office chunk is fetched in the background while on the login screen');
  ok(!loaded(/\/src\/ui\/(Cinema|Werewolf|Mole|MoleTasks|PropHunt|Wedding)\.tsx/), 'no floor game UI is fetched on the login screen');

  await page.type('input[type=password]', PASSCODE);
  await page.click('button.btn.primary');
  await page.waitForSelector('.creator-panel input', { timeout: 45000 });
  await page.type('.creator-panel input', 'QA Tour');
  await sleep(1500);
  await page.click('.creator-panel footer .btn.primary');
  await page.waitForFunction(() => window.__office?.getState().me && window.__office.getState().connected, { timeout: 60000 });

  // ---- C: first visit → the five-step tour
  const tour = await page.waitForSelector('.tour', { timeout: 8000 }).catch(() => null);
  ok(!!tour, 'first visit: the tour opens by itself');
  ok((await page.$$eval('.tour-dots button', (b) => b.length).catch(() => 0)) === 5, 'it has five steps');
  const titles = [];
  for (let i = 0; i < 5; i++) {
    titles.push(await page.$eval('.tour h2', (e) => e.textContent).catch(() => ''));
    if (i < 4) await page.click('.tour .btn.primary');
  }
  ok(new Set(titles).size === 5, `"Tiếp →" walks the five steps (${titles.join(' / ')})`);
  ok((await page.$eval('.tour .btn.primary', (e) => e.textContent).catch(() => '')).includes('Bắt đầu'), 'last step: "Bắt đầu thôi!"');
  await page.keyboard.press('Escape');
  await sleep(300);
  ok(!(await page.$('.tour')), 'Esc closes the tour');
  ok((await page.evaluate(() => localStorage.getItem('office-tourSeen'))) === 'true', 'tourSeen is saved');
  ok(!(await page.$('.modal-bg .help, .help-modal')), 'the old full Help did not open on first visit');

  await page.click('.help-pill');
  ok(!!(await page.waitForSelector('.tour', { timeout: 3000 }).catch(() => null)), 'the "?" button opens it again');
  await page.click('.tour .close-x');
  await sleep(300);
  ok(!(await page.$('.tour')), '✕ closes it');
  await page.click('.help-pill');
  await page.waitForSelector('.tour', { timeout: 3000 });
  await page.evaluate(() => [...document.querySelectorAll('.tour .btn')].find((b) => b.textContent.includes('Bỏ qua'))?.click());
  await sleep(300);
  ok(!(await page.$('.tour')), '"Bỏ qua" closes it');

  // ---- C: templates in "Văn phòng của bạn" (empty box only)
  await page.evaluate(() => window.__office.setState({ panel: 'chat', chatTab: 'ask', chatThread: null, chatDraft: '' }));
  const tabBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Chat')));
  if (!(await page.$('.ask-templates'))) await tabBtn.asElement()?.click().catch(() => {});
  await page.waitForSelector('.ask-templates', { timeout: 5000 }).catch(() => null);
  const tpl = await page.$$eval('.ask-templates button', (b) => b.map((x) => x.textContent.trim())).catch(() => []);
  ok(tpl.length === 4 && ['Sửa lỗi', 'Tính năng mới', 'Rà soát', 'Deploy'].every((w) => tpl.some((t) => t.includes(w))), `four templates: ${tpl.join(' | ')}`);
  if (tpl.length) {
    await page.click('.ask-templates button');
    // focus happens on the next animation frame; software WebGL makes frames slow here
    await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT', { timeout: 3000 }).catch(() => {});
    const st = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, v: el?.value ?? '', sel: el?.value?.slice(el.selectionStart, el.selectionEnd) ?? '' };
    });
    ok(st.v.startsWith('Sửa lỗi:'), `a template fills the box (${st.tag}: "${st.v.slice(0, 40)}")`);
    ok(st.sel === '[lỗi gì]', `the first [ … ] is selected so typing replaces it (sel="${st.sel}")`);
    await page.keyboard.type('nút lưu');
    ok((await page.evaluate(() => document.activeElement?.value ?? '')).startsWith('Sửa lỗi: nút lưu —'), 'typing replaces the selected [ … ]');
    ok(!(await page.$('.ask-templates')), 'templates hide once the box has text');
    ok(!(await page.evaluate(() => window.__office.getState().chat.some((m) => m.text.startsWith('Sửa lỗi: [lỗi gì]')))), 'nothing was sent');
    await page.evaluate(() => window.__office.setState({ chatDraft: '' }));
  }

  // ---- B: 👍 / 👎 bar under a 📋 report in my own thread (rendering; the server side has its own test)
  await page.evaluate(() => {
    const s = window.__office.getState();
    window.__office.setState({ chat: [...s.chat, { id: 'qa-fake-report-1', ch: `ask:${s.me.id}`, from: 'ag-brain000000', name: '🧠 Tổng quản', text: '📋 Kết quả: QA hiển thị', ts: Date.now() }] });
  });
  await sleep(500);
  const bar = await page.$('.rate-bar');
  ok(!!bar, 'a 📋 report in my thread shows the 👍 / 👎 bar');
  if (bar) {
    await page.click('.rate-bar .rb-btn:nth-of-type(2)');
    ok(!!(await page.waitForSelector('.rb-why input', { timeout: 2000 }).catch(() => null)), '👎 opens the reason box');
    const ph = await page.$eval('.rb-why input', (e) => e.placeholder).catch(() => '');
    ok(/không bắt buộc/.test(ph), 'the reason is optional');
    await page.evaluate(() => [...document.querySelectorAll('.rb-why .btn')].find((b) => b.textContent.includes('Huỷ'))?.click());
    await sleep(200);
    ok(!(await page.$('.rb-why')), '"Huỷ" closes the reason box');
  }

  // ---- A: floors' game UI loads when needed, with a pill and no errors
  const errBefore = errors.length;
  const zones = [
    ['cinema', /\/src\/ui\/Cinema\.tsx/],
    ['wolfroom', /\/src\/ui\/Werewolf\.tsx/],
    ['f5-cafe', /\/src\/ui\/Mole\.tsx/],
    ['f6-lobby', /\/src\/ui\/PropHunt\.tsx/],
    ['wedding', /\/src\/ui\/Wedding\.tsx/],
  ];
  // the mole/prop zone ids: pick real ones from the map
  const ids = await page.evaluate(async () => {
    const m = await import('/shared/map.ts');
    const all = [...m.ZONE_BY_ID.keys()];
    return { f5: all.find((z) => z.startsWith('f5-')), f6: all.find((z) => z.startsWith('f6-')) };
  });
  zones[2][0] = ids.f5 ?? 'f5-x';
  zones[3][0] = ids.f6 ?? 'f6-x';
  for (const [zone, re] of zones) {
    ok(!loaded(re), `${zone}: chunk not loaded before`);
    let pill = false;
    const watch = page.waitForSelector('.area-loading', { timeout: 1500 }).then(() => (pill = true)).catch(() => {});
    await page.evaluate((z) => {
      const s = window.__office.getState();
      window.__office.setState({ me: { ...s.me, zone: z } });
    }, zone);
    await watch;
    await sleep(1500);
    ok(loaded(re), `${zone}: chunk loaded on entering${pill ? ' (pill "Đang tải …" seen)' : ' (pill too quick to catch)'}`);
  }
  ok(errors.length === errBefore, `no console errors while loading floors (${errors.slice(errBefore).join(' | ').slice(0, 300)})`);

  // ---- reload: no tour again; a helpSeen-only person does not get it either
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__office?.getState().me && window.__office.getState().connected, { timeout: 60000 });
  await sleep(1500);
  ok(!(await page.$('.tour')), 'after a reload the tour does not come back');
  await page.evaluate(() => {
    localStorage.removeItem('office-tourSeen');
    localStorage.setItem('office-helpSeen', 'true');
  });
  let reloadAt = reqs.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__office?.getState().me && window.__office.getState().connected, { timeout: 60000 });
  await sleep(1500);
  ok(!(await page.$('.tour')), 'someone who saw the old Help does not get the tour');
  // edge (after #2dec1188): fresh page in the office — the empty welcome views must not pull the game UIs in
  const fresh = (re) => reqs.slice(reloadAt).some((r) => re.test(r.url));
  ok(!fresh(/\/src\/ui\/Werewolf\.tsx/) && !fresh(/\/src\/ui\/Mole\.tsx/) && !fresh(/\/src\/ui\/PropHunt\.tsx/), 'fresh page in the office: Werewolf/Mole/PropHunt not loaded from the welcome views');
  ok(await page.evaluate(() => { const s = window.__office.getState(); return !!s.wolf && !!s.mole && !!s.ph; }), 'the welcome views wolf/mole/ph are present (so the gate is really tested)');
  // signed up for prop hunt from another floor → PropHunt UI loads
  await page.evaluate(() => { const s = window.__office.getState(); window.__office.setState({ ph: { ...s.ph, joined: [...s.ph.joined, { id: s.me.id, name: s.me.name }] } }); });
  await sleep(1500);
  ok(fresh(/\/src\/ui\/PropHunt\.tsx/), 'signed up for Trốn tìm (joined) while in the office loads the PropHunt UI');
  ok(!fresh(/\/src\/ui\/Werewolf\.tsx/) && !fresh(/\/src\/ui\/Mole\.tsx/), '…and only that one');
  // in a werewolf game while elsewhere → Werewolf UI loads
  await page.evaluate(() => { const s = window.__office.getState(); window.__office.setState({ wolf: { ...s.wolf, me: { ...s.wolf.me, inGame: true } } }); });
  await sleep(1500);
  ok(fresh(/\/src\/ui\/Werewolf\.tsx/), 'wolf.me.inGame while in the office loads the Werewolf UI');
  // signed up for Nội Gián from another floor → Mole UI loads
  await page.evaluate(() => { const s = window.__office.getState(); window.__office.setState({ mole: { ...s.mole, joined: [...s.mole.joined, { id: s.me.id, name: s.me.name }] } }); });
  await sleep(1500);
  ok(fresh(/\/src\/ui\/Mole\.tsx/), 'signed up for Nội Gián (joined) while in the office loads the Mole UI');
  ok(errors.length === errBefore, `no console errors with fake game states (${errors.slice(errBefore).join(' | ').slice(0, 300)})`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  reloadAt = reqs.length;
  await page.waitForFunction(() => window.__office?.getState().me && window.__office.getState().connected, { timeout: 60000 });
  await sleep(1500);
  // edge: game state arrives while standing elsewhere (here: 📹 cctv of Nội Gián, fresh page)
  const reqStart = reqs.length;
  await page.evaluate(() => window.__office.setState({ cctv: true }));
  await sleep(1500);
  ok(reqs.slice(reqStart).some((r) => /\/src\/ui\/Mole\.tsx/.test(r.url)), 'mole state while in the office (not on f5) loads the Nội Gián UI');
  await page.evaluate(() => window.__office.setState({ cctv: false }));
  console.log('other console errors:', errors.slice(0, 5).join(' | ').slice(0, 400) || 'none');
} catch (err) {
  console.log('❌ crashed:', err);
  failures++;
} finally {
  clearTimeout(timer);
  await browser.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
