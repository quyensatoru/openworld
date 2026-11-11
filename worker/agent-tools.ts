// Tool list of the office MCP server (what Claude Code sessions see as mcp__office__*).
import { DEPTS } from '../shared/agents';

type Json = Record<string, unknown>;

const me = { me: { type: 'string', description: 'Mã agent của bạn (ag-…), có trong phần giới thiệu Office đầu phiên. Có thể bỏ trống.' } };
const deptEnum = DEPTS.map((d) => d.id);
const deptHelp = 'lead = Ban điều hành, dev = Phát triển, qa = Kiểm thử, ops = Vận hành, design = Thiết kế, docs = Tài liệu, biz = Kinh doanh & CSKH';

export const TOOLS: { name: string; description: string; inputSchema: Json }[] = [
  {
    name: 'permission',
    description: '(Dùng nội bộ: Claude Code gọi tool này để xin người duyệt một thao tác — không tự gọi.)',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
  },
  {
    name: 'chat_send',
    description:
      'Nhắn tin cho đồng nghiệp. Mặc định là kênh "Khu làm việc" (trao đổi công việc); channel="global" để nói với cả công ty. Gọi đồng nghiệp đang có mặt bằng @Tên (vd @QA-1, @Claude-An), gọi cả phòng bằng @dev / @qa / @ops / @design / @docs / @biz / @lead (máy trực sẽ cử người nếu phòng đó chưa có ai). Viết như đồng nghiệp nói chuyện: tiếng Việt tự nhiên, 1–3 câu, không markdown, không dán log hay mã việc dài; nói rõ mình cần gì từ ai.',
    inputSchema: { type: 'object', properties: { ...me, text: { type: 'string' }, channel: { type: 'string', enum: ['work', 'global'] } }, required: ['text'] },
  },
  {
    name: 'chat_read',
    description: 'Đọc tin nhắn mới (Khu làm việc + cả văn phòng) kể từ lần đọc trước.',
    inputSchema: { type: 'object', properties: { ...me, limit: { type: 'number', description: 'tối đa bao nhiêu tin (mặc định 20)' } } },
  },
  {
    name: 'chat_wait',
    description: 'Chờ tới khi có tin nhắn gọi tên bạn hoặc phòng bạn (vd câu trả lời cho câu bạn vừa hỏi). Trả về ngay khi có, hoặc sau tối đa `seconds` giây.',
    inputSchema: { type: 'object', properties: { ...me, seconds: { type: 'number', description: '5–50, mặc định 40' } } },
  },
  {
    name: 'skill',
    description: 'Kỹ năng (quy trình làm việc chuẩn) của phòng ban. Không truyền name → danh sách kỹ năng; có name → nội dung đầy đủ. Mở kỹ năng phù hợp trước khi bắt tay vào việc.',
    inputSchema: { type: 'object', properties: { ...me, name: { type: 'string' }, dept: { type: 'string', enum: deptEnum, description: 'xem kỹ năng của phòng khác' } } },
  },
  {
    name: 'tasks',
    description: 'Liệt kê việc đang mở trên Kanban của phòng bạn (hoặc phòng khác / toàn bộ).',
    inputSchema: { type: 'object', properties: { ...me, dept: { type: 'string', enum: deptEnum }, all: { type: 'boolean', description: 'mọi việc đang mở' } } },
  },
  {
    name: 'task_get',
    description: 'Xem đầy đủ một việc trên Kanban theo mã (#xxxxxxxx).',
    inputSchema: { type: 'object', properties: { ...me, id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'task_claim',
    description: 'Nhận một việc trên Kanban (chuyển sang Doing, ghi tên bạn).',
    inputSchema: { type: 'object', properties: { ...me, id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'task_update',
    description: 'Cập nhật việc: chuyển cột (todo = trả lại, doing, review = xong chờ người duyệt, done = hoàn tất) và/hoặc ghi chú tiến độ/kết quả.',
    inputSchema: {
      type: 'object',
      properties: { ...me, id: { type: 'string' }, col: { type: 'string', enum: ['todo', 'doing', 'review', 'done'] }, note: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'handoff',
    description: 'Bàn giao một phần việc cho phòng ban khác: tạo việc mới trên Kanban cho phòng đó (agent của phòng đó sẽ nhận). Ghi rõ bối cảnh, đã làm gì, cần làm gì, file liên quan.',
    inputSchema: {
      type: 'object',
      properties: {
        ...me,
        dept: { type: 'string', enum: deptEnum, description: deptHelp },
        title: { type: 'string' },
        details: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        from_task: { type: 'string', description: 'mã việc đang làm dẫn tới bàn giao này (nếu có)' },
      },
      required: ['dept', 'title', 'details'],
    },
  },
  {
    name: 'meeting_call',
    description:
      'Gọi họp với các phòng ban (mỗi phòng cử một người tới). Bạn chủ trì: meeting_say để nói, meeting_wait để nghe, meeting_end để chốt và tạo việc. Chỉ họp khi thật sự cần nhiều phòng cùng quyết.',
    inputSchema: {
      type: 'object',
      properties: {
        ...me,
        topic: { type: 'string' },
        agenda: { type: 'string', description: 'các ý cần bàn, ngắn' },
        depts: { type: 'array', items: { type: 'string', enum: deptEnum }, description: `phòng được mời (1–5). ${deptHelp}` },
      },
      required: ['topic', 'depts'],
    },
  },
  {
    name: 'meeting_wait',
    description: 'Trong cuộc họp: nghe những gì người khác vừa nói (chờ tối đa `seconds` giây nếu chưa ai nói). Trả về "ĐÃ KẾT THÚC" khi cuộc họp xong.',
    inputSchema: { type: 'object', properties: { ...me, seconds: { type: 'number', description: '5–45, mặc định 30' } } },
  },
  {
    name: 'meeting_say',
    description: 'Phát biểu trong cuộc họp, như đang nói trong phòng họp: 1–3 câu tự nhiên, không markdown, đúng trọng tâm; gọi người tiếp theo bằng @tên nếu cần.',
    inputSchema: { type: 'object', properties: { ...me, text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'meeting_end',
    description: '(Chủ trì) Kết thúc cuộc họp: ghi biên bản và tạo việc cho từng phòng trên Kanban.',
    inputSchema: {
      type: 'object',
      properties: {
        ...me,
        summary: { type: 'string', description: 'quyết định chính + lý do' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { dept: { type: 'string', enum: deptEnum }, title: { type: 'string' }, details: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } },
            required: ['dept', 'title', 'details'],
          },
        },
      },
      required: ['summary'],
    },
  },
  {
    name: 'lessons',
    description: 'Tra sổ kinh nghiệm (bài học đúc rút từ các phiên làm việc trước).',
    inputSchema: { type: 'object', properties: { ...me, dept: { type: 'string', enum: deptEnum }, query: { type: 'string' } } },
  },
  {
    name: 'debrief',
    description: 'Nộp bản tóm tắt cuối phiên để Ban điều hành đúc rút kinh nghiệm: đã làm gì, gặp lỗi gì, xử lý ra sao, bài học. Không ghi mật khẩu/token/dữ liệu khách.',
    inputSchema: {
      type: 'object',
      properties: { ...me, summary: { type: 'string' }, lessons: { type: 'array', items: { type: 'string' }, description: 'bài học ngắn, mỗi dòng một ý' }, project: { type: 'string' } },
      required: ['summary'],
    },
  },
  {
    name: 'debriefs_pending',
    description: '(Ban điều hành) Các bản tóm tắt phiên chưa được đúc rút.',
    inputSchema: { type: 'object', properties: { ...me, limit: { type: 'number' } } },
  },
  {
    name: 'lesson_save',
    description: '(Ban điều hành) Thêm hoặc sửa (replace_id) một bài học trong sổ kinh nghiệm. 1–2 câu, cụ thể, dùng được ngay.',
    inputSchema: {
      type: 'object',
      properties: { ...me, dept: { type: 'string', enum: ['all', ...deptEnum] }, text: { type: 'string' }, project: { type: 'string', description: 'tên thư mục dự án nếu chỉ áp dụng cho dự án đó' }, replace_id: { type: 'string' } },
      required: ['dept', 'text'],
    },
  },
  {
    name: 'lesson_retire',
    description: '(Ban điều hành) Gỡ một bài học sai hoặc lỗi thời.',
    inputSchema: { type: 'object', properties: { ...me, id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'debriefs_done',
    description: '(Ban điều hành) Đánh dấu các bản tóm tắt đã đúc rút xong.',
    inputSchema: { type: 'object', properties: { ...me, ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
];
