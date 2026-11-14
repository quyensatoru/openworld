// What a session is allowed to do, and what nobody may wave through.
//
// These rules decide whether an action goes straight through, is judged by 🧠 Tổng quản against the
// work it is doing, needs a person, or is refused outright. They are pure functions on purpose: the
// office's one safety boundary should be readable and testable on its own (scripts/unit-test.mjs),
// not tangled with the Durable Object that calls it.

export type Risk = 'safe' | 'review' | 'danger';

/** Hard to undo, or leaves the machine: never waved through without a look. */
const DANGER_CMD =
  /\bgit\s+(push|reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|branch\s+-D|rebase|filter-(branch|repo)|commit\s+--amend|tag\s+-d|stash\s+(drop|clear))|\brm\s+(-\w*\s+)*-\w*[rRf]|\bsudo\b|\bsu\s|\bdeploy\b|\bwrangler\s+(deploy|publish|secret|delete|kv|r2|d1\s+(execute|migrations\s+apply)[^|;&]*--remote)|\b(npm|pnpm|yarn)\s+publish|\bdocker\b|\bkubectl\b|\bhelm\b|\bterraform\s+(apply|destroy)|\bssh\b|\bscp\b|\brsync\b|\bcurl\b[^|;&]*(\s-X\s*(POST|PUT|DELETE|PATCH)|\s--data|\s-d\s|\s-F\s|\s--form|\s-T\s)|\bwget\b[^|;&]*--post|\bdd\s+if=|\bmkfs|\bchmod\s+-R|\bchown\b|\b(drop|truncate)\s+(table|database)\b|\bdelete\s+from\b|\b(kill|killall|pkill)\b|\bshutdown\b|\breboot\b|\bcrontab\b|\bgh\s+(pr\s+(create|merge|close)|release|repo\s+(create|delete)|issue\s+(create|close)|api\b)|\bvercel\b|\bnetlify\s+deploy|\bheroku\b|\bpsql\b|\bmysql\b|\bredis-cli\b|\bmongo(sh)?\b|>\s*\/(etc|usr|bin|boot|var)\//i;

/** Never, by anyone. Not the orchestrator, not a 🔐 card, not auto mode.
 *  Everything else dangerous is a judgement call about this piece of work; these are not judgement
 *  calls — they destroy the machine, hand it to a stranger, or throw away history that cannot be
 *  got back. A person who really wants one of them types it in their own terminal. */
const FORBIDDEN_CMD =
  /\brm\s+(-\w*\s+)*-\w*[rRf]\w*\s+(\/|~\/?\s*$|\/\*|\$HOME\/?\s*$|\.\s*$)|\bmkfs|\bdd\s+[^|;&]*of=\/dev\/|:\(\)\s*\{.*\}\s*;?\s*:|\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b|\bchmod\s+-R\s+777\s+\/|\bchown\s+-R\s+[^/]*\s+\/\s*$|\bgit\s+push\b[^|;&]*(--force(?!-with-lease)|\s-f\b)|\bgit\s+(filter-branch|filter-repo)\b|\bhistory\s+-c|>\s*\/dev\/(sd|nvme|hd)|\bshred\b|\buserdel\b|\bpasswd\b/i;

/** Reading these and sending them somewhere is how a repo loses its keys. A command that touches a
 *  secret AND talks to the network is refused outright, whichever order it is written in. */
const SECRET_OUT = /(\.env|\.dev\.vars|id_rsa|id_ed25519|\.ssh\/|\.aws\/|\.npmrc|\.netrc|credentials|secret)/i;
const NETWORK_CMD = /\b(curl|wget|nc|ncat|netcat|ssh|scp|rsync|ftp|telnet)\b/i;

/** Commands that only read, or build and test inside the project. */
const SAFE_SEG = [
  /^(ls|pwd|cat|head|tail|wc|echo|printf|grep|egrep|rg|ag|tree|stat|file|du|df|date|which|type|whoami|uname|basename|dirname|realpath|readlink|sort|uniq|cut|tr|diff|cmp|jq|true|cd|nl|less|more)(\s|$)/,
  /^find\b(?!.*\s-(delete|exec|execdir|ok|fprint)\b)/,
  /^sed\s+-n\b/,
  /^awk\b(?!.*system)/,
  /^git\s+(status|diff|log|show|rev-parse|ls-files|ls-tree|blame|grep|fetch|describe|shortlog|merge-base|cat-file)\b/,
  /^git\s+(branch|remote|tag|stash)(\s+(-a|-r|-v|-vv|--list|--show-current|-l|list))*\s*$/,
  /^git\s+config\s+--get\b/,
  /^(npm|pnpm|yarn|bun)\s+(test|t|run\s+(test|build|typecheck|type-check|lint|check|tsc|format:check)[\w:-]*|ls|outdated|view|why)\b/,
  /^npx\s+(--no-install\s+)?(tsc|vitest|jest|eslint|prettier\s+--check|playwright\s+test)\b/,
  /^(tsc|vitest|jest|eslint|pytest|mypy|flake8)\b/,
  /^ruff\s+check\b/,
  /^python3?\s+-m\s+(pytest|mypy|unittest|py_compile)\b/,
  /^node\s+(--check|-c|-v|--version)\b/,
  /^(go\s+(test|build|vet|list|version)|cargo\s+(test|build|check|clippy|tree)|make\s+(test|check|build|lint)|php\s+-l|composer\s+(validate|show))\b/,
];

function bashRisk(cmd: string): Risk {
  const c = cmd.trim();
  if (!c) return 'review';
  if (DANGER_CMD.test(c)) return 'danger';
  if (/`|\$\(/.test(c)) return 'review'; // what it runs is decided at run time
  if (/>(?!\s*\/dev\/null|&)/.test(c.replace(/2>&1/g, ''))) return 'review'; // writes a file
  const segs = c.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  const bare = (s: string) => s.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '');
  return segs.every((seg) => SAFE_SEG.some((r) => r.test(bare(seg)))) ? 'safe' : 'review';
}

const SENSITIVE_PATH = /(^|\/)(\.env(\.|$)|\.dev\.vars|\.git\/|id_rsa|id_ed25519|\.ssh\/|\.aws\/|\.npmrc|\.netrc|credentials|secrets?\.)/i;

/** How careful to be with what a session asks for, before anyone thinks about it. */
export function riskOf(tool: string, input: Record<string, unknown>, dir: string | undefined, edit: string): Risk {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (tool) {
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'LS':
    case 'NotebookRead':
    case 'TodoWrite':
    case 'WebSearch':
    case 'WebFetch':
      return 'safe';
    case 'Bash':
      return bashRisk(str(input.command));
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': {
      const p = str(input.file_path) || str(input.notebook_path);
      if (SENSITIVE_PATH.test(p)) return 'danger';
      if (p.startsWith('/') && dir && !p.startsWith(`${dir.replace(/\/$/, '')}/`)) return 'danger'; // outside the project
      if (p.startsWith('/') && !dir) return 'review';
      // inside the project but outside what the department may edit: a lane question, Tổng quản's call
      return String(edit || 'all').trim() === 'all' ? 'safe' : 'review';
    }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) {
    const op = mcp[2].toLowerCase();
    if (/(create|update|delete|remove|send|post|write|execute|run|deploy|publish|merge|transition|add|set|upload|invite|cancel|close|reply)/.test(op)) return 'danger';
    if (/(get|list|search|read|find|fetch|query|describe|count|explore|view|show|status|schema|docs)/.test(op)) return 'safe';
    return 'review';
  }
  return 'review';
}

/** Refused for everyone, with the reason a person would give. '' = not on the hard list. */
export function forbidden(tool: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (tool === 'Bash') {
    const c = str(input.command);
    if (FORBIDDEN_CMD.test(c)) return 'lệnh phá huỷ hoặc không thể hoàn tác (xoá gốc, format, push --force, chạy script tải từ mạng…)';
    if (SECRET_OUT.test(c) && NETWORK_CMD.test(c)) return 'lệnh vừa đụng vào file bí mật vừa gọi ra mạng';
  }
  return '';
}

/** Things no model may wave through — not even in "tự động hoàn toàn". They still happen, but a
 *  person says yes to them: a model has no way to know whether this particular secret, this
 *  particular machine, is the one that matters. */
export function humanOnly(tool: string, input: Record<string, unknown>): boolean {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') return SENSITIVE_PATH.test(str(input.file_path) || str(input.notebook_path));
  if (tool === 'Bash') return /\bwrangler\s+secret\b|\bgh\s+secret\b|\b(npm|pnpm|yarn)\s+publish\b/i.test(str(input.command));
  return false;
}
