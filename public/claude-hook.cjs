#!/usr/bin/env node
// Office × Claude Code — shows what Claude Code on this machine is doing, on your own desk monitor
// in the office. That is all it does: your sessions are yours, they are not office employees (the
// office staffs itself from the on-call machines — see office-agent.cjs).
//
//   curl -fsSL https://<office>/claude-hook.cjs | node - install 'https://<office>/api/activity' <token>
//   curl -fsSL https://<office>/claude-hook.cjs | node - uninstall
//
// install: hooks in ~/.claude/settings.json that post the tool name + file name (and the prompt only
// if you asked for ?p=1) to the office. Only entries that belong to the office are touched; a backup
// of settings.json is written once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TAG = '# office-activity';
const EVENTS = { SessionStart: null, UserPromptSubmit: null, PostToolUse: '*', Notification: null, Stop: null, SessionEnd: null };
const PERM = 'mcp__office';
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const file = path.join(dir, 'settings.json');
const [action, url, token] = process.argv.slice(2).filter((a) => a !== '-');

const isOurs = (h) => typeof h?.command === 'string' && (h.command.includes(TAG) || (h.command.includes('/api/activity') && h.command.includes('Authorization: Bearer')));

function load() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    console.error(`❌ Không đọc được ${file} (JSON lỗi?): ${e.message}`);
    process.exit(1);
  }
}

function strip(settings) {
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev].map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !isOurs(h)) })).filter((m) => m.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  const allow = settings.permissions?.allow;
  if (Array.isArray(allow)) {
    settings.permissions.allow = allow.filter((p) => p !== PERM);
    if (!settings.permissions.allow.length) delete settings.permissions.allow;
    if (!Object.keys(settings.permissions).length) delete settings.permissions;
  }
}

function save(settings) {
  fs.mkdirSync(dir, { recursive: true });
  const backup = `${file}.office-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** `claude mcp …`; false when the claude command is not on PATH. */
function claude(args) {
  const r = spawnSync('claude', args, { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error) return false;
  return r.status === 0;
}

if (action === 'install') {
  if (!/^https?:\/\/[^\s']+\/api\/activity(\?p=1)?$/.test(url || '') || !/^[A-Za-z0-9_-]{16,}$/.test(token || '')) {
    console.error("Cách dùng: node - install 'https://<office>/api/activity' <mã-kết-nối>");
    process.exit(1);
  }
  const settings = load();
  strip(settings);
  // Sessions started by an office agent runner bring their own hooks (OFFICE_RUNNER is set) — skip them.
  const command = `[ -n "\${OFFICE_RUNNER:-}" ] || curl -s -m 3 -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- '${url}' >/dev/null 2>&1 || true ${TAG}`;
  settings.hooks = settings.hooks || {};
  for (const [ev, matcher] of Object.entries(EVENTS)) {
    if (ev === 'SessionEnd') continue;
    (settings.hooks[ev] = settings.hooks[ev] || []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
  }
  // an older install may have left the office MCP server behind: it is not used any more
  claude(['mcp', 'remove', '--scope', 'user', 'office']);
  save(settings);
  console.log(`✅ Màn hình Claude Code đã bật (${file}). Mở lại Claude Code là xong.`);
  console.log('   Màn hình ở bàn bạn ngồi trong Office sẽ hiện Claude đang làm gì.');
} else if (action === 'uninstall') {
  const settings = load();
  strip(settings);
  save(settings);
  claude(['mcp', 'remove', '--scope', 'user', 'office']);
  console.log(`✅ Đã gỡ Office khỏi ${file}. Các cài đặt khác giữ nguyên.`);
} else {
  console.error('Cách dùng: node - install <url> <mã>   |   node - uninstall');
  process.exit(1);
}
