#!/usr/bin/env node
// A stand-in for the `claude` CLI, for scripts/runner-test.mjs: speaks just enough stream-json for
// the runner, and misbehaves on cue. The task title in the prompt picks the misbehaviour:
//   "MAT-MANG"  — the API is unreachable: retries, then an error result (as Claude Code does)
//   "TREO"      — says one thing, then hangs forever (the runner gets killed meanwhile)
// A resumed session (--resume <id>) always finishes cleanly. Every call is logged to $FAKE_DIR/calls.jsonl.
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const at = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const sid = at('--session-id') || at('--resume') || 'none';
const resumed = !!at('--resume');
let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(process.env.FAKE_DIR, 'calls.jsonl'), `${JSON.stringify({ pid: process.pid, sid, resumed, mode: at('--permission-mode'), prompt: prompt.slice(0, 400) })}\n`);
  const out = (o) => process.stdout.write(`${JSON.stringify({ session_id: sid, ...o })}\n`);
  out({ type: 'system', subtype: 'init' });
  if (!resumed && prompt.includes('MAT-MANG')) {
    for (let i = 1; i <= 3; i++) out({ type: 'system', subtype: 'api_retry', attempt: i, max_retries: 3, retry_delay_ms: 10, error_status: null, error: 'unknown' });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: Connection error.', num_turns: 0 });
    process.exit(1);
  }
  if (!resumed && prompt.includes('TREO')) {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Mình bắt đầu làm đây.' }] } });
    setInterval(() => {}, 1 << 30);
    return;
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: resumed ? 'Mình làm tiếp phần đang dở.' : 'Làm xong rồi.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 2 });
  process.exit(0);
});
