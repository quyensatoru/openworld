#!/usr/bin/env node
// Office × Claude Code — connects (or disconnects) Claude Code on this machine to the office.
//
//   curl -fsSL https://<office>/claude-hook.cjs | node - install 'https://<office>/api/activity?v=2' <token> [dept]
//   curl -fsSL https://<office>/claude-hook.cjs | node - uninstall
//
// install: hooks in ~/.claude/settings.json (your sessions appear in the office as virtual employees,
// their monitor shows what they do, they get the office playbook as context) + the "office" MCP
// server (real chat, Kanban handoffs, debriefs) + permission to use it without asking.
// Only entries that belong to the office are touched; a backup of settings.json is written once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TAG = '# office-activity';
const EVENTS = { SessionStart: null, UserPromptSubmit: null, PostToolUse: '*', Notification: null, Stop: null, SessionEnd: null };
const DEPTS = ['lead', 'dev', 'qa', 'ops', 'design', 'docs', 'biz'];
const PERM = 'mcp__office';
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const file = path.join(dir, 'settings.json');
const [action, url, token, deptArg] = process.argv.slice(2).filter((a) => a !== '-');

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
  if (!/^https?:\/\/[^\s']+\/api\/activity(\?(p=1|v=2|v=2&p=1|p=1&v=2))?$/.test(url || '') || !/^[A-Za-z0-9_-]{16,}$/.test(token || '')) {
    console.error("Cách dùng: node - install 'https://<office>/api/activity?v=2' <mã-kết-nối> [phòng ban]");
    process.exit(1);
  }
  const dept = DEPTS.includes(deptArg) ? deptArg : 'dev';
  const v2 = /[?&]v=2/.test(url);
  const settings = load();
  strip(settings);
  // v2: the office answers with context for Claude (hook JSON), so the answer is printed, not discarded.
  // Sessions started by an office agent runner bring their own hooks (OFFICE_RUNNER is set) — skip them.
  const command = v2
    ? `[ -n "\${OFFICE_RUNNER:-}" ] || curl -sf -m 4 -X POST -H 'Authorization: Bearer ${token}' -H "X-Office-Dept: \${OFFICE_DEPT:-${dept}}" -H 'Content-Type: application/json' --data-binary @- '${url}' 2>/dev/null || true ${TAG}`
    : `curl -s -m 3 -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- '${url}' >/dev/null 2>&1 || true ${TAG}`;
  settings.hooks = settings.hooks || {};
  for (const [ev, matcher] of Object.entries(EVENTS)) {
    if (!v2 && ev === 'SessionEnd') continue;
    (settings.hooks[ev] = settings.hooks[ev] || []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
  }
  if (v2) {
    settings.permissions = settings.permissions || {};
    settings.permissions.allow = [...new Set([...(settings.permissions.allow || []), PERM])];
  }
  save(settings);
  console.log(`✅ Đã nối Claude Code với Office (${file}).`);
  if (v2) {
    const mcpUrl = url.replace(/\/api\/activity.*$/, '/api/mcp');
    claude(['mcp', 'remove', '--scope', 'user', 'office']);
    const ok = claude(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'office', mcpUrl, '--header', `Authorization: Bearer ${token}`]);
    if (ok) console.log('✅ Đã thêm MCP "office" (chat, bàn giao việc, sổ kinh nghiệm).');
    else {
      console.log('⚠️  Không chạy được lệnh "claude" để thêm MCP. Tự chạy lệnh này:');
      console.log(`   claude mcp add --scope user --transport http office ${mcpUrl} --header "Authorization: Bearer ${token}"`);
    }
    console.log(`   Phiên Claude Code của bạn sẽ ngồi ở phòng "${dept}" (đổi riêng một phiên: OFFICE_DEPT=qa claude).`);
  }
  console.log('   Mở lại Claude Code là xong.');
} else if (action === 'uninstall') {
  const settings = load();
  strip(settings);
  save(settings);
  claude(['mcp', 'remove', '--scope', 'user', 'office']);
  console.log(`✅ Đã gỡ Office khỏi ${file} và MCP "office". Các cài đặt khác giữ nguyên.`);
} else {
  console.error('Cách dùng: node - install <url> <mã> [phòng ban]   |   node - uninstall');
  process.exit(1);
}
