// Turns a raw Claude Code hook payload into one short, privacy-friendly line for the desk monitor.
// Only the tool name and a target (file name, command description, search pattern…) are kept;
// prompt text is shared only if the user opted in (`?p=1` in their hook URL).
import { clampStr, type ActivityEvent } from '../shared/protocol';

type Hook = Record<string, unknown> & {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  prompt?: string;
  message?: string;
};

const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() ?? '' : '');
const short = (v: unknown, n: number) => clampStr(typeof v === 'string' ? v.replace(/\s+/g, ' ') : '', n);

function bashSummary(input: Record<string, unknown>): string {
  const desc = short(input.description, 70);
  if (desc) return desc;
  // no description: first two words only (commands can contain secrets)
  const cmd = typeof input.command === 'string' ? input.command.trim().split(/\s+/).slice(0, 2).join(' ') : '';
  return clampStr(cmd.replace(/[A-Za-z0-9_\-]{24,}/g, '•••'), 40) || 'lệnh terminal';
}

function toolLine(name: string, input: Record<string, unknown>): { icon: string; text: string } {
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✏️', text: `Sửa ${base(input.file_path)}` };
    case 'Write':
      return { icon: '📝', text: `Viết ${base(input.file_path)}` };
    case 'NotebookEdit':
      return { icon: '📓', text: `Sửa notebook ${base(input.notebook_path)}` };
    case 'Read':
      return { icon: '📖', text: `Đọc ${base(input.file_path)}` };
    case 'Bash':
      return { icon: '⚡', text: bashSummary(input) };
    case 'Grep':
      return { icon: '🔎', text: `Tìm “${short(input.pattern, 40)}”` };
    case 'Glob':
      return { icon: '🗂️', text: `Tìm file ${short(input.pattern, 40)}` };
    case 'WebFetch': {
      let host = '';
      try {
        host = new URL(String(input.url)).hostname;
      } catch {
        /* ignore */
      }
      return { icon: '🌐', text: `Đọc web ${host}` };
    }
    case 'WebSearch':
      return { icon: '🌐', text: `Tra cứu “${short(input.query, 50)}”` };
    case 'Task':
    case 'Agent':
      return { icon: '🤖', text: `Giao việc: ${short(input.description, 60) || 'subagent'}` };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos.length : 0;
      return { icon: '📋', text: `Cập nhật todo (${todos} việc)` };
    }
    default: {
      const m = name.match(/^mcp__(.+?)__(.+)$/);
      if (m) return { icon: '🔌', text: `${m[1]} · ${m[2]}` };
      return { icon: '🔧', text: clampStr(name, 40) };
    }
  }
}

export function summarizeHook(h: Hook, sharePrompts: boolean, now: number): ActivityEvent | null {
  const project = clampStr(base(h.cwd), 40) || undefined;
  switch (h.hook_event_name) {
    case 'SessionStart':
      return { ts: now, kind: 'start', icon: '🚀', text: `Mở Claude Code${project ? ` · ${project}` : ''}`, project };
    case 'UserPromptSubmit':
      return { ts: now, kind: 'prompt', icon: '💬', text: sharePrompts && h.prompt ? `“${short(h.prompt, 110)}”` : 'Gửi yêu cầu mới cho Claude', project };
    case 'PostToolUse':
    case 'PreToolUse': {
      const name = typeof h.tool_name === 'string' ? h.tool_name : 'Tool';
      const { icon, text } = toolLine(name, (h.tool_input as Record<string, unknown>) ?? {});
      return { ts: now, kind: 'tool', icon, text: clampStr(text, 90), project };
    }
    case 'Notification':
      return { ts: now, kind: 'notify', icon: '🔔', text: 'Claude đang chờ bạn xác nhận', project };
    case 'Stop':
      return { ts: now, kind: 'stop', icon: '✅', text: 'Claude đã xong lượt này', project };
    default:
      return null;
  }
}
