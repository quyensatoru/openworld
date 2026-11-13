// `npm run deploy` after the check and the build: note which version production runs now (to roll
// back to), `wrangler deploy`, then check production answers (scripts/verify-deploy.mjs). If a check
// fails it says how to roll back — it never rolls back by itself.
//   npm run deploy                                   # check → build → this
//   OFFICE_PASSCODE=... npm run deploy               # …and also log in and open the Office connection
//   PROD_URL=https://office.xxx.workers.dev ...      # when the URL can't be read off wrangler's output
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printResults, verifyWithRetry } from './verify-deploy.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// WRANGLER lets a test stand in a fake one
const WRANGLER = process.env.WRANGLER ? [process.env.WRANGLER] : [path.join(root, 'node_modules', '.bin', 'wrangler')];

/** The version production serves right now, from `wrangler deployments list --json` (newest deployment,
 *  its version with the most traffic). null = could not tell (first deploy, not logged in…). */
function currentVersion() {
  const r = spawnSync(WRANGLER[0], [...WRANGLER.slice(1), 'deployments', 'list', '--json'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return { id: null, why: (r.stderr || r.stdout || '').trim().split('\n').pop() };
  try {
    const raw = r.stdout.slice(r.stdout.indexOf('['));
    const list = JSON.parse(raw);
    const newest = [...list].filter((d) => Array.isArray(d?.versions)).sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    const v = newest ? [...newest.versions].sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0] : null;
    return v?.version_id ? { id: v.version_id, at: newest.created_on } : { id: null, why: 'chưa có bản deploy nào' };
  } catch {
    return { id: null, why: 'không đọc được danh sách deploy' };
  }
}

/** `wrangler deploy`, shown as it runs and kept to read the URL and the new version off. */
function deploy() {
  return new Promise((resolve) => {
    const p = spawn(WRANGLER[0], [...WRANGLER.slice(1), 'deploy'], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (b) => (process.stdout.write(b), (out += b)));
    p.stderr.on('data', (b) => (process.stderr.write(b), (out += b)));
    p.on('exit', (code) => resolve({ code: code ?? 1, out }));
    p.on('error', (e) => resolve({ code: 1, out: String(e) }));
  });
}

const rollbackCmd = (id) => `npx wrangler rollback ${id} -m "post-deploy check failed"`;

const prev = currentVersion();
console.log(prev.id ? `\n▶ Bản production trước khi deploy: ${prev.id}${prev.at ? ` (deploy lúc ${prev.at})` : ''}` : `\n⚠️  Không lấy được ID bản production hiện tại (${prev.why}) — nếu cần quay lại, xem: npx wrangler deployments list`);
if (prev.id) console.log(`  Quay lại bản này nếu cần: ${rollbackCmd(prev.id)}`);

const d = await deploy();
if (d.code !== 0) {
  console.error(`\n❌ wrangler deploy thất bại (mã ${d.code}) — production vẫn chạy bản trước${prev.id ? ` (${prev.id})` : ''}, không cần rollback.`);
  process.exit(d.code);
}
const url = process.env.PROD_URL || d.out.match(/https:\/\/[^\s"']+\.workers\.dev/)?.[0] || d.out.match(/https:\/\/[^\s"']+/)?.[0];
const next = d.out.match(/Current Version ID:\s*([0-9a-f-]{8,})/i)?.[1];
if (!url) {
  console.error('\n❌ Đã deploy nhưng không đọc được URL production từ wrangler — chạy lại kiểm tra với PROD_URL=… node scripts/verify-deploy.mjs');
  if (prev.id) console.error(`  Nếu production hỏng: ${rollbackCmd(prev.id)}`);
  process.exit(1);
}

const passcode = process.env.OFFICE_PASSCODE || '';
console.log(`\n▶ Kiểm tra sau deploy: ${url}${next ? ` (bản mới ${next})` : ''}${passcode ? '' : ' — không có OFFICE_PASSCODE nên bỏ qua đăng nhập + kết nối'}`);
const ok = printResults(await verifyWithRetry(url, passcode, Number(process.env.VERIFY_TRIES || 4)));
if (ok) {
  console.log(`\n✅ Deploy xong và production trả lời bình thường.${prev.id ? ` Bản trước: ${prev.id}` : ''}`);
  process.exit(0);
}
console.error('\n❌ Production KHÔNG đạt kiểm tra sau deploy. Không tự rollback — người deploy quyết định.');
console.error(prev.id ? `  Quay lại bản trước: ${rollbackCmd(prev.id)}` : '  Không biết bản trước — xem: npx wrangler deployments list, rồi npx wrangler rollback <version-id>');
console.error(`  Kiểm lại sau khi sửa/rollback: node scripts/verify-deploy.mjs ${url}`);
process.exit(1);
