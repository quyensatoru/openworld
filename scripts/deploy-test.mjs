// V2-3: what `npm run deploy` does after `wrangler deploy` — with a fake wrangler, against the check's
// own dev server standing in for production.
//   BASE=http://localhost:5231 PASSCODE=office-dev node scripts/deploy-test.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE || 'http://localhost:5173').replace(/\/$/, '');
const PASSCODE = process.env.PASSCODE || 'office-dev';
const dir = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};
const PREV = 'bbbbbbbb-0000-0000-0000-000000000002';
const deploy = (env) => {
  const r = spawnSync('node', [path.join(dir, 'deploy.mjs')], { encoding: 'utf8', env: { ...process.env, WRANGLER: path.join(dir, 'fake-wrangler.cjs'), VERIFY_TRIES: '1', OFFICE_PASSCODE: '', ...env } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const verify = (url, env = {}) => {
  const r = spawnSync('node', [path.join(dir, 'verify-deploy.mjs'), url], { encoding: 'utf8', env: { ...process.env, OFFICE_PASSCODE: '', PASSCODE: '', ...env } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

// ---- verify alone: page, its script, the API, and with the passcode the Office connection
let r = verify(BASE, { OFFICE_PASSCODE: PASSCODE });
ok(r.code === 0 && /Trang chính.*200/.test(r.out) && /Office API.*200/.test(r.out) && /Kết nối Office.*101/.test(r.out), 'a healthy office passes every check, the Office connection included');
r = verify(BASE, { OFFICE_PASSCODE: 'sai-ma' });
ok(r.code === 1 && /❌ Đăng nhập/.test(r.out), 'a wrong passcode fails the login check');

// ---- the deploy went fine and production answers
r = deploy({ PROD_URL: BASE });
ok(r.code === 0, `deploy + check passes (exit ${r.code})`);
ok(r.out.includes(`Bản production trước khi deploy: ${PREV}`), 'it prints the version production ran before (newest deployment)');
ok(r.out.includes(`npx wrangler rollback ${PREV}`), '…and the command to go back to it');
ok(/bản mới cccccccc/.test(r.out), 'and the new version');

// ---- production does not answer: say how to roll back, do not roll back
r = deploy({ PROD_URL: 'http://127.0.0.1:9' });
ok(r.code === 1 && /KHÔNG đạt/.test(r.out) && r.out.includes(`Quay lại bản trước: npx wrangler rollback ${PREV}`), 'a failing check exits 1 and prints the rollback command');
ok(!/wrangler: unknown command rollback/.test(r.out), 'it never runs a rollback itself');

// ---- wrangler deploy itself fails: nothing to roll back
r = deploy({ PROD_URL: BASE, FAKE_DEPLOY: 'fail' });
ok(r.code !== 0 && /không cần rollback/.test(r.out) && !/Kiểm tra sau deploy/.test(r.out), 'a failed upload says production still runs the old version, and checks nothing');

// ---- the previous version can't be read: still deploys, says where to look
r = deploy({ PROD_URL: BASE, FAKE_LIST: 'fail' });
ok(r.code === 0 && /Không lấy được ID bản production hiện tại/.test(r.out), 'no deployment list: a warning, the deploy and the check still run');

// ---- the URL comes off wrangler's output when PROD_URL is not set
r = deploy({ PROD_URL: '', VERIFY_TRIES: '1' });
ok(/Kiểm tra sau deploy: https:\/\/office\.fake\.invalid/.test(r.out), "without PROD_URL the URL is read off wrangler's output");

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
