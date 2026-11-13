// Tool list of the office MCP server (what Claude Code sessions see as mcp__office__*).
import { DEPTS } from '../shared/agents';

type Json = Record<string, unknown>;

const me = { me: { type: 'string', description: 'Mã agent của bạn (ag-…), có trong phần giới thiệu Office đầu phiên. Có thể bỏ trống.' } };
const deptEnum = DEPTS.map((d) => d.id);
const deptHelp = 'lead = Ban điều hành, dev = Phát triển, qa = Kiểm thử, ops = Vận hành, design = Thiết kế, docs = Tài liệu, biz = Kinh doanh & CSKH';

/** Tools only offered when the office allows agents to meet (they cost one session per seat). */
export const MEETING_TOOLS = ['meeting_call', 'meeting_wait', 'meeting_say', 'meeting_end'];

export const TOOLS: { name: string; description: string; inputSchema: Json }[] = [
  {
    name: 'permission',
    description: '(Dùng nội bộ: Claude Code gọi tool này để xin người duyệt một thao tác — không tự gọi.)',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
  },
  {
    name: 'chat_send',
    description:
      'Nhắn cho người đã giao việc này, trong luồng riêng của họ (mỗi người một luồng, không lẫn vào nhau). Dùng để báo tiến độ, báo kết quả, nói rõ bạn đã làm gì. Viết như đồng nghiệp nói chuyện: tiếng Việt tự nhiên, 1–3 câu, không markdown, không dán log.',
    inputSchema: { type: 'object', properties: { ...me, text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'chat_read',
    description: 'Đọc tin nhắn mới trong luồng của người giao việc (và các tin chung của văn phòng), kể từ lần đọc trước.',
    inputSchema: { type: 'object', properties: { ...me, limit: { type: 'number', description: 'tối đa bao nhiêu tin (mặc định 20)' } } },
  },
  {
    name: 'ask_human',
    description:
      'Hỏi người đã giao việc MỘT câu rồi chờ trả lời. Chỉ hỏi thứ đáng hỏi: nếu đoán sai thì cả việc thành vô ích hoặc phải làm lại. Chi tiết nhỏ thì tự quyết và ghi giả định vào note của việc, đừng hỏi. Không ai trả lời trong `seconds` giây thì trả về rỗng — khi đó cứ chọn phương án hợp lý nhất và ghi rõ bạn đã chọn gì.',
    inputSchema: { type: 'object', properties: { ...me, question: { type: 'string' }, seconds: { type: 'number', description: '10–120, mặc định 90' } }, required: ['question'] },
  },
  {
    name: 'chat_wait',
    description: 'Chờ tới khi có tin nhắn mới gửi cho bạn. Trả về ngay khi có, hoặc sau tối đa `seconds` giây.',
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
    description:
      'Bàn giao phần việc KHÔNG thuộc phòng bạn cho phòng ban khác: tạo việc mới trên Kanban cho phòng đó. Ghi rõ bối cảnh, đã làm gì, cần làm gì, file liên quan. Thường gặp: dev làm xong phần dễ hồi quy → qa; qa thấy lỗi → dev (kèm wait=true rồi trả việc về todo); đã kiểm đạt mà cần lên production → ops; cần README/changelog → docs; cần quyết giao diện → design; yêu cầu còn mơ hồ phải hỏi khách → biz. Đừng bàn giao phần bạn tự làm được — mỗi lần bàn giao là một phiên mới, tốn thời gian và chi phí của văn phòng.',
    inputSchema: {
      type: 'object',
      properties: {
        ...me,
        dept: { type: 'string', enum: deptEnum, description: deptHelp },
        title: { type: 'string' },
        details: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        from_task: { type: 'string', description: 'mã việc đang làm dẫn tới bàn giao này (nếu có)' },
        wait: {
          type: 'boolean',
          description: 'việc đang làm phải chờ kết quả việc này (ví dụ QA trả lỗi về Phát triển rồi kiểm lại). Việc của bạn sẽ nằm yên trên bảng tới khi bên kia xong, rồi tự chạy tiếp — nhờ vậy không ai nhận lại nó để làm lại đúng việc cũ.',
        },
      },
      required: ['dept', 'title', 'details'],
    },
  },
  {
    name: 'meeting_call',
    description:
      'Gọi họp với các phòng ban (mỗi phòng cử một người tới). Rất tốn kém — mỗi ghế là một phiên chạy song song. Chỉ dùng khi nhiều phòng phải cùng quyết một việc mà bàn giao qua Kanban không giải quyết được. Tổng quản thường đã chia việc sẵn, nên hầu như không cần họp.',
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
    description:
      '(Ban điều hành) Thêm hoặc sửa (replace_id) một bài học trong sổ kinh nghiệm. 1–2 câu, cụ thể, dùng được ngay. scope: "project" = chỉ đúng với dự án bạn đang đúc rút (lệnh, file, quy ước của repo này — mặc định cho hầu hết bài học); "machine" = chỉ đúng với một máy (shell, công cụ cài trên máy đó — ghi machine như trong bản tóm tắt); "all" = đúng ở MỌI dự án và mọi máy (cách làm việc chung). Bài trùng ý bài cũ sẽ bị từ chối kèm mã bài cũ để bạn gộp bằng replace_id.',
    inputSchema: {
      type: 'object',
      properties: {
        ...me,
        dept: { type: 'string', enum: ['all', ...deptEnum] },
        text: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'machine', 'all'] },
        machine: { type: 'string', description: 'scope "machine": tên máy như trong bản tóm tắt (vd. "may-a·1f2e")' },
        replace_id: { type: 'string' },
      },
      required: ['dept', 'text', 'scope'],
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
