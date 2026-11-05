#!/usr/bin/env node
// Office × Claude Code — adds or removes the office activity hooks in ~/.claude/settings.json.
//
//   curl -fsSL https://<office>/claude-hook.cjs | node - install https://<office>/api/activity <token>
//   curl -fsSL https://<office>/claude-hook.cjs | node - uninstall
//
// Only touches hook entries that post to /api/activity; everything else in settings.json is kept.
// A backup of the original file is written once to settings.json.office-backup.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAG = '# office-activity';
const EVENTS = { SessionStart: null, UserPromptSubmit: null, PostToolUse: '*', Notification: null, Stop: null };
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
}

function save(settings) {
  fs.mkdirSync(dir, { recursive: true });
  const backup = `${file}.office-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

if (action === 'install') {
  if (!/^https?:\/\/[^\s']+\/api\/activity(\?p=1)?$/.test(url || '') || !/^[A-Za-z0-9_-]{16,}$/.test(token || '')) {
    console.error('Cách dùng: node - install https://<office>/api/activity <mã-kết-nối>');
    process.exit(1);
  }
  const settings = load();
  strip(settings);
  const command = `curl -s -m 3 -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- '${url}' >/dev/null 2>&1 || true ${TAG}`;
  settings.hooks = settings.hooks || {};
  for (const [ev, matcher] of Object.entries(EVENTS)) {
    (settings.hooks[ev] = settings.hooks[ev] || []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
  }
  save(settings);
  console.log(`✅ Đã nối Claude Code với Office (${file}).`);
  console.log('   Mở lại Claude Code là xong. Màn hình chỉ hiện khi bạn đang ngồi ở bàn trong văn phòng ảo.');
} else if (action === 'uninstall') {
  const settings = load();
  strip(settings);
  save(settings);
  console.log(`✅ Đã gỡ hook Office khỏi ${file}. Các cài đặt khác giữ nguyên.`);
} else {
  console.error('Cách dùng: node - install <url> <mã>   |   node - uninstall');
  process.exit(1);
}
