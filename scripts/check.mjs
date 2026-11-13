// Gate before every deploy: typecheck, then the protocol smoke test, the agents test and the runner
// test against a dev server of its own (free port, throwaway D1/DO state — never the office someone
// is using on 5173). Exits non-zero at the first failure, so `npm run deploy` stops there.
//   npm run check
//   CHECK_ONLY=typecheck,smoke npm run check    # a subset while working on something
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.env.CHECK_ONLY ? new Set(process.env.CHECK_ONLY.split(',').map((s) => s.trim())) : null;
const want = (step) => !only || only.has(step);
const started = Date.now();

function run(label, cmd, args, env = {}) {
  console.log(`\n▶ ${label}`);
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code, sig) => resolve(code === 0 ? 0 : (code ?? (sig ? 1 : 1))));
    p.on('error', () => resolve(1));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let server = null;
let stateDir = null;
function cleanup() {
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, 'SIGTERM'); // the whole group: vite + workerd
    } catch {
      server.kill('SIGTERM');
    }
  }
  if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function fail(step) {
  cleanup();
  console.error(`\n❌ check FAILED at "${step}" — nothing deployed.`);
  process.exit(1);
}

if (want('typecheck') && (await run('typecheck', 'npm', ['run', '--silent', 'typecheck']))) fail('typecheck');

const serverSteps = [
  ['smoke', 'scripts/smoke-test.mjs'],
  ['agents', 'scripts/agents-test.mjs'],
  ['runner', 'scripts/runner-test.mjs'],
  // 🧠 Tổng quản's edge cases (QA's regression checks): last, it changes the brain's settings
  ['brain', 'scripts/qa-brain-regress-test.mjs'],
].filter(([s]) => want(s));

if (serverSteps.length) {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-check-'));
  console.log(`\n▶ dev server on ${BASE} (state in ${stateDir})`);
  const log = fs.createWriteStream(path.join(stateDir, 'server.log'));
  server = spawn(path.join(root, 'node_modules', '.bin', 'vite'), ['--port', String(port), '--strictPort'], {
    cwd: root,
    detached: true,
    env: { ...process.env, OFFICE_STATE: path.join(stateDir, 'state') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  let up = false;
  for (let i = 0; i < 120 && !up && server.exitCode === null; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${BASE}/`).then((r) => r.ok, () => false);
  }
  if (!up) {
    console.error(fs.existsSync(path.join(stateDir, 'server.log')) ? fs.readFileSync(path.join(stateDir, 'server.log'), 'utf8').slice(-2000) : '');
    fail('dev server');
  }
  for (const [step, file] of serverSteps) if (await run(step, 'node', [file], { BASE, PASSCODE: process.env.PASSCODE || 'office-dev' })) fail(step);
}

cleanup();
console.log(`\n✅ check passed in ${Math.round((Date.now() - started) / 1000)}s`);
