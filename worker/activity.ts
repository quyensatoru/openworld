// Turns a raw Claude Code hook payload into one short, privacy-friendly line for the desk monitor.
// Only the tool name and a target (file name, command description, search pattern…) are kept;
// prompt text is shared only if the user opted in (`?p=1` in their hook URL).
import { humanTool } from '../shared/human-log';
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

export function summarizeHook(h: Hook, sharePrompts: boolean, now: number): ActivityEvent | null {
  const project = clampStr(base(h.cwd), 40) || undefined;
  switch (h.hook_event_name) {
    case 'SessionStart':
      return { ts: now, kind: 'start', icon: '🚀', text: `Bắt đầu phiên làm việc${project ? ` ở ${project}` : ''}`, project };
    case 'UserPromptSubmit':
      return { ts: now, kind: 'prompt', icon: '💬', text: sharePrompts && h.prompt ? `“${short(h.prompt, 110)}”` : 'Nhận một yêu cầu mới', project };
    case 'PostToolUse':
    case 'PreToolUse': {
      const name = typeof h.tool_name === 'string' ? h.tool_name : 'Tool';
      const { icon, text } = humanTool(name, (h.tool_input as Record<string, unknown>) ?? {});
      return { ts: now, kind: 'tool', icon, text: clampStr(text, 90), project };
    }
    case 'Notification':
      return { ts: now, kind: 'notify', icon: '🔔', text: 'Đang chờ người dùng xác nhận', project };
    case 'Stop':
      return { ts: now, kind: 'stop', icon: '✅', text: 'Xong lượt này, chờ việc tiếp', project };
    default:
      return null;
  }
}
