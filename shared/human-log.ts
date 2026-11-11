// What a Claude Code session is doing, said the way a colleague would say it ("Đang sửa cart.ts",
// "Chuyển việc cho bên Kiểm thử: …"), for desk monitors, name tags and the screen view.
// public/office-agent.cjs keeps a copy of this (it runs on its own, without the build) — keep them alike.
import { DEPT_BY_ID, isDept } from './agents';

type Input = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const base = (p: unknown) => str(p).split(/[\\/]/).filter(Boolean).pop() ?? '';
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const deptName = (d: unknown) => (isDept(d) ? DEPT_BY_ID.get(d)!.name : 'phòng khác');

/** Claude's own words, without markdown marks, first sentence or two. */
export function humanSay(text: string, n = 160): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' (đoạn code) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*(.+)$/gm, '$1:')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return clip(plain, n);
}

export function humanTool(name: string, input: Input = {}): { icon: string; text: string } {
  const office = /^mcp__office__(.+)$/.exec(name);
  if (office) {
    const col = str(input.col);
    switch (office[1]) {
      case 'chat_send':
        return { icon: '💬', text: input.text ? `Nhắn: “${clip(str(input.text), 110)}”` : 'Nhắn cho đồng nghiệp' };
      case 'chat_read':
        return { icon: '💬', text: 'Đọc tin nhắn mới' };
      case 'chat_wait':
        return { icon: '⏳', text: 'Đang chờ đồng nghiệp trả lời' };
      case 'skill':
        return { icon: '📘', text: input.name ? `Xem lại quy trình “${clip(str(input.name), 40)}”` : 'Xem các quy trình của phòng' };
      case 'tasks':
        return { icon: '📋', text: 'Xem bảng công việc' };
      case 'task_get':
        return { icon: '📋', text: 'Đọc kỹ đầu việc' };
      case 'task_claim':
        return { icon: '🙋', text: 'Nhận việc' };
      case 'task_update':
        return col === 'review'
          ? { icon: '👀', text: 'Báo xong việc, chờ người duyệt' }
          : col === 'done'
            ? { icon: '✅', text: 'Đánh dấu việc đã hoàn thành' }
            : col === 'todo'
              ? { icon: '↩️', text: 'Trả việc lại bảng' }
              : { icon: '📝', text: 'Ghi chú tiến độ vào việc' };
      case 'handoff':
        return { icon: '📨', text: `Chuyển việc cho bên ${deptName(input.dept)}: “${clip(str(input.title), 80)}”` };
      case 'meeting_call':
        return { icon: '📅', text: `Mời họp: “${clip(str(input.topic), 80)}”` };
      case 'meeting_wait':
        return { icon: '👂', text: 'Đang nghe mọi người trong cuộc họp' };
      case 'meeting_say':
        return { icon: '🗣️', text: input.text ? `Phát biểu: “${clip(str(input.text), 110)}”` : 'Phát biểu trong cuộc họp' };
      case 'meeting_end':
        return { icon: '📅', text: 'Chốt lại cuộc họp và giao việc' };
      case 'lessons':
        return { icon: '📚', text: 'Xem sổ kinh nghiệm' };
      case 'debrief':
        return { icon: '🧾', text: 'Viết tóm tắt sau khi xong việc' };
      case 'debriefs_pending':
        return { icon: '🧾', text: 'Đọc các bản tóm tắt của mọi người' };
      case 'lesson_save':
        return { icon: '📚', text: 'Ghi thêm một bài học vào sổ' };
      case 'lesson_retire':
        return { icon: '📚', text: 'Gỡ một bài học đã cũ' };
      case 'debriefs_done':
        return { icon: '📚', text: 'Đánh dấu đã đúc rút xong' };
      case 'permission':
        return { icon: '🔐', text: 'Xin phép người duyệt' };
      default:
        return { icon: '🔌', text: 'Dùng công cụ của văn phòng' };
    }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { icon: '🔌', text: `Dùng ${mcp[1]} (${mcp[2].replace(/_/g, ' ')})` };
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✏️', text: `Đang sửa ${base(input.file_path)}` };
    case 'Write':
      return { icon: '📝', text: `Đang viết ${base(input.file_path)}` };
    case 'NotebookEdit':
      return { icon: '📓', text: `Đang sửa notebook ${base(input.notebook_path)}` };
    case 'Read':
      return { icon: '📖', text: `Đang đọc ${base(input.file_path)}` };
    case 'Bash': {
      const desc = clip(str(input.description), 90);
      if (desc) return { icon: '⚡', text: `Chạy lệnh: ${desc}` };
      // no description: first two words only (commands can contain secrets)
      const cmd = str(input.command).trim().split(/\s+/).slice(0, 2).join(' ').replace(/[A-Za-z0-9_-]{24,}/g, '•••');
      return { icon: '⚡', text: cmd ? `Chạy lệnh ${clip(cmd, 40)}` : 'Chạy một lệnh terminal' };
    }
    case 'Grep':
      return { icon: '🔎', text: `Tìm “${clip(str(input.pattern), 40)}” trong code` };
    case 'Glob':
      return { icon: '🗂️', text: `Tìm các file ${clip(str(input.pattern), 40)}` };
    case 'WebFetch': {
      let host = '';
      try {
        host = new URL(str(input.url)).hostname;
      } catch {
        /* ignore */
      }
      return { icon: '🌐', text: `Đọc trang ${host || 'web'}` };
    }
    case 'WebSearch':
      return { icon: '🌐', text: `Tra cứu “${clip(str(input.query), 50)}”` };
    case 'Task':
    case 'Agent':
      return { icon: '🤖', text: `Nhờ trợ lý làm: ${clip(str(input.description), 60) || 'một phần việc'}` };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos.length : 0;
      return { icon: '📋', text: `Lên danh sách ${todos} việc cần làm` };
    }
    default:
      return { icon: '🔧', text: `Dùng ${clip(name, 40)}` };
  }
}

/** A failed tool result, said plainly. */
export function humanError(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/permission|not allowed|denied|từ chối|không cho phép/i.test(t)) return 'Không được phép làm bước này — tìm cách khác';
  if (/chờ .* duyệt/i.test(t)) return 'Đang chờ người duyệt';
  return `Gặp lỗi: ${clip(t, 110)}`;
}
