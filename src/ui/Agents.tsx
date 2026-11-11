// The virtual employees' head office (the library on floor 1): who is working in which department,
// the company playbook distilled from their sessions, and how to connect a machine.
import { useEffect, useMemo, useState } from 'react';
import { AGENT_MODELS, DEPTS, DEPT_BY_ID, MEET_ROOMS, isDept, type AgentModel, type DeptId, type DeptProfile, type DeptSkill, type Lesson, type Meeting } from '../../shared/agents';
import type { PlayerState, Task } from '../../shared/protocol';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';
import { AvatarDot, timeAgo } from './common';
import { ClaudeConnect, CopyRow } from './ClaudeScreen';
import './agents.css';

const STATE_LABEL = { working: 'đang làm', idle: 'đang rảnh', waiting: 'chờ duyệt' } as const;

export function AgentsPanel() {
  const open = useStore((s) => s.agentsOpen);
  const tab = useStore((s) => s.agentsTab);
  const book = useStore((s) => s.agentBook);
  const players = useStore((s) => s.players);
  const tasks = useStore((s) => s.tasks);
  useEffect(() => {
    if (open) game.agents({ a: 'lessons' });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setState({ agentsOpen: false });
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const agents = useMemo(() => Object.values(players).filter((p) => p.agent), [players]);
  if (!open) return null;
  const close = () => setState({ agentsOpen: false });
  const working = agents.filter((a) => a.agent!.state === 'working').length;
  const waiting = Object.values(tasks).filter((t) => t.dept && t.col === 'todo' && !t.assignee).length;
  const set = (agentsTab: 'depts' | 'book' | 'profiles' | 'connect') => setState({ agentsTab });

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass ag-panel" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <header className="ag-head">
          <h2>🧠 Nhân viên ảo</h2>
          <div className="ag-sum">
            <span>
              <b>{agents.length}</b> đang có mặt
            </span>
            <span>
              <b>{working}</b> đang làm
            </span>
            <span>
              <b>{waiting}</b> việc chờ nhận
            </span>
            {!!book?.pending.length && (
              <span>
                <b>{book.pending.length}</b> tóm tắt chờ đúc rút
              </span>
            )}
          </div>
          <button className="btn" onClick={close}>
            Đóng
          </button>
        </header>
        <nav className="ag-tabs">
          <button className={tab === 'depts' ? 'on' : ''} onClick={() => set('depts')}>
            🏢 Phòng ban
          </button>
          <button className={tab === 'book' ? 'on' : ''} onClick={() => set('book')}>
            📘 Sổ kinh nghiệm{book ? ` · ${book.lessons.length}` : ''}
          </button>
          <button className={tab === 'profiles' ? 'on' : ''} onClick={() => set('profiles')}>
            📋 Hồ sơ phòng ban
          </button>
          <button className={tab === 'connect' ? 'on' : ''} onClick={() => set('connect')}>
            🔌 Kết nối
          </button>
        </nav>
        <div className="ag-body scroll">
          {tab === 'depts' && <Depts agents={agents} tasks={Object.values(tasks)} />}
          {tab === 'book' && <Book />}
          {tab === 'profiles' && <Profiles />}
          {tab === 'connect' && <Connect />}
        </div>
      </div>
    </div>
  );
}

function Depts({ agents, tasks }: { agents: PlayerState[]; tasks: Task[] }) {
  const activity = useStore((s) => s.activity);
  const meetings = useStore((s) => s.meetings);
  const [calling, setCalling] = useState(false);
  const now = serverNow();
  const live = meetings.filter((m) => !m.endedAt);
  const ended = meetings.filter((m) => m.endedAt).slice(-2).reverse();
  return (
    <>
      <div className="ag-meets">
        {live.map((m) => (
          <MeetingCard key={m.id} m={m} />
        ))}
        {ended.map((m) => (
          <details key={m.id} className="ag-meet ended">
            <summary>
              📅 <b>{m.topic}</b> <small className="muted">· xong {timeAgo(m.endedAt!)}</small>
            </summary>
            <p>{m.summary}</p>
          </details>
        ))}
        {calling ? <CallMeeting onDone={() => setCalling(false)} /> : (
          <button className="btn" onClick={() => setCalling(true)} disabled={live.length >= MEET_ROOMS.length}>
            📅 Tổ chức họp
          </button>
        )}
      </div>
      <p className="ag-hint">
        Không biết giao ai? Gõ <code>@ai …</code> trong chat (hoặc thẻ Kanban bắt đầu bằng <code>@ai</code>) — Tổng quản tự phân loại và chia cho đúng phòng. Biết rồi thì gọi thẳng <code>@dev</code>, <code>@qa</code>, <code>@ops</code>, <code>@design</code>, <code>@docs</code>, <code>@biz</code>. Máy trực sẽ cử một nhân viên ảo của phòng đó ngồi vào bàn làm, bàn giao tiếp cho phòng khác khi cần, rồi nộp tóm tắt để Ban điều hành đúc rút kinh nghiệm.
      </p>
      <div className="ag-grid">
        {DEPTS.map((d) => {
          const here = agents.filter((a) => a.agent!.dept === d.id);
          const open = tasks.filter((t) => t.dept === d.id && t.col !== 'done');
          const done = tasks.filter((t) => t.dept === d.id && t.col === 'done' && t.doneAt && now - t.doneAt < 7 * 86_400_000).length;
          return (
            <section key={d.id} className="ag-dept" style={{ ['--c' as string]: d.color }}>
              <h3>
                <span className="ag-ico">{d.icon}</span>
                {d.name}
                <span className="ag-count">{here.length ? `${here.length} người` : 'trống'}</span>
              </h3>
              <div className="ag-people">
                {here.map((a) => {
                  const last = activity[a.id]?.[activity[a.id].length - 1];
                  return (
                    <button key={a.id} className={`ag-person ${a.agent!.state}`} onClick={() => setState({ screenOf: a.id })} title="Xem màn hình">
                      <AvatarDot name={a.name.replace('🤖 ', '')} avatar={a.avatar} />
                      <span className="ag-pname">
                        <b>{a.name.replace('🤖 ', '')}</b>
                        <small>
                          {a.agent!.kind === 'runner' ? 'máy trực' : 'phiên'} của {a.agent!.ownerName}
                          {a.agent!.project ? ` · ${a.agent!.project}` : ''}
                        </small>
                        {last && (
                          <small className="ag-last">
                            {last.icon} {last.text}
                          </small>
                        )}
                      </span>
                      <span className="ag-state">{STATE_LABEL[a.agent!.state]}</span>
                    </button>
                  );
                })}
                {!here.length && <div className="ag-empty">Chưa có ai ngồi — cài Claude Code vào phòng này ở tab Kết nối.</div>}
              </div>
              {(open.length > 0 || done > 0) && (
                <div className="ag-tasks">
                  {open.slice(0, 4).map((t) => (
                    <button key={t.id} className="ag-task" onClick={() => setState({ kanbanOpen: true })}>
                      <span className={`ag-col ${t.col}`}>{t.col === 'todo' ? 'chờ' : t.col === 'doing' ? 'đang làm' : t.col === 'review' ? 'chờ duyệt' : t.col}</span>
                      {t.title}
                    </button>
                  ))}
                  {open.length > 4 && <small className="muted">+{open.length - 4} việc nữa</small>}
                  {done > 0 && <small className="muted">✅ {done} việc xong trong 7 ngày</small>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function MeetingCard({ m }: { m: Meeting }) {
  const room = MEET_ROOMS.find((r) => r.id === m.room)!.name;
  return (
    <section className="ag-meet">
      <header>
        <span className="ag-live">● ĐANG HỌP</span>
        <b>{m.topic}</b>
        <small className="muted">
          {room} · {m.by} gọi · {timeAgo(m.startedAt)}
        </small>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => confirm('Kết thúc cuộc họp này?') && game.agents({ a: 'meetingEnd', id: m.id })}>
          Kết thúc
        </button>
      </header>
      <div className="ag-chips">
        {m.members.map((x) => (
          <span key={x.id} style={{ ['--c' as string]: DEPT_BY_ID.get(x.dept)?.color }}>
            {DEPT_BY_ID.get(x.dept)?.icon} {x.name.replace('🤖 ', '')}
            {m.host === x.id && ' ★'}
          </span>
        ))}
        {m.waiting.map((d) => (
          <span key={d} className="waiting">
            {DEPT_BY_ID.get(d)?.icon} chờ {DEPT_BY_ID.get(d)?.short}…
          </span>
        ))}
      </div>
      <div className="ag-lines">
        {m.lines.slice(-6).map((l, i) =>
          l.from === 'system' ? (
            <div key={i} className="sys">
              {l.text}
            </div>
          ) : (
            <div key={i}>
              <b>{l.name.replace('🤖 ', '')}:</b> {l.text}
            </div>
          ),
        )}
        {!m.lines.length && <div className="sys">Đang chờ mọi người vào phòng… Muốn góp ý thì đứng trong {room} và nhắn ở kênh 💼 Khu làm việc.</div>}
      </div>
    </section>
  );
}

function CallMeeting({ onDone }: { onDone: () => void }) {
  const [topic, setTopic] = useState('');
  const [agenda, setAgenda] = useState('');
  const [depts, setDepts] = useState<DeptId[]>(['dev', 'qa']);
  return (
    <form
      className="ag-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!topic.trim() || !depts.length) return;
        game.agents({ a: 'meeting', topic: topic.trim(), agenda: agenda.trim(), depts });
        onDone();
      }}
    >
      <b>📅 Tổ chức họp</b>
      <input className="input" autoFocus placeholder="Chủ đề (vd: Kế hoạch làm trang thanh toán mới)" maxLength={120} value={topic} onChange={(e) => setTopic(e.target.value)} />
      <textarea className="input" placeholder="Chương trình / bối cảnh (không bắt buộc)" maxLength={600} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
      <div className="ag-filter" style={{ margin: 0 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Mời:</span>
        {DEPTS.filter((d) => d.id !== 'lead').map((d) => (
          <button type="button" key={d.id} className={`chip${depts.includes(d.id) ? ' on' : ''}`} onClick={() => setDepts((x) => (x.includes(d.id) ? x.filter((y) => y !== d.id) : x.length < 4 ? [...x, d.id] : x))}>
            {d.icon} {d.short}
          </button>
        ))}
      </div>
      <small className="muted">🧠 Tổng quản (Ban điều hành) sẽ chủ trì. Máy trực cử người của mỗi phòng tới phòng họp; biên bản hiện trên TV và việc được tạo trên Kanban khi họp xong.</small>
      <div className="ag-erow">
        <button className="btn primary" type="submit">
          Gọi họp
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Huỷ
        </button>
      </div>
    </form>
  );
}

function Profiles() {
  const book = useStore((s) => s.agentBook);
  const [dept, setDept] = useState<DeptId>('dev');
  if (!book) return <div className="ag-empty">Đang tải…</div>;
  return (
    <>
      <p className="ag-hint">
        Mỗi phòng ban có hồ sơ riêng: prompt quy trình làm việc, các kỹ năng (agent mở bằng <code>skill</code> khi cần), quyền sửa file, lệnh được chạy và model. Máy trực áp hồ sơ này cho mọi phiên của phòng — nhưng chỉ cấp những lệnh mà chủ máy trực cũng cho phép (<code>--allow</code>).
      </p>
      <div className="ag-filter">
        {DEPTS.map((d) => (
          <button key={d.id} className={`chip${dept === d.id ? ' on' : ''}`} onClick={() => setDept(d.id)}>
            {d.icon} {d.name}
            {book.custom.includes(d.id) && ' •'}
          </button>
        ))}
      </div>
      <ProfileEditor key={`${dept}:${JSON.stringify(book.profiles[dept]).length}`} dept={dept} profile={book.profiles[dept]} custom={book.custom.includes(dept)} />
    </>
  );
}

function ProfileEditor({ dept, profile, custom }: { dept: DeptId; profile: DeptProfile; custom: boolean }) {
  const [p, setP] = useState<DeptProfile>(profile);
  const [open, setOpen] = useState<number | null>(null);
  const [bashText, setBashText] = useState(profile.bash.join('\n'));
  const editMode = p.edit === 'all' || p.edit === 'none' ? p.edit : 'globs';
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);
  const setSkill = (i: number, patch: Partial<DeptSkill>) => setP({ ...p, skills: p.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="ag-profile">
      <div className="ag-prow">
        <label>
          Model
          <select className="input" value={p.model} onChange={(e) => setP({ ...p, model: e.target.value as AgentModel })}>
            {AGENT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Được sửa file
          <select className="input" value={editMode} onChange={(e) => setP({ ...p, edit: e.target.value === 'globs' ? '**/*.md' : e.target.value })}>
            <option value="all">Mọi file trong dự án</option>
            <option value="globs">Chỉ một số file…</option>
            <option value="none">Không sửa file</option>
          </select>
        </label>
        {editMode === 'globs' && (
          <label style={{ flex: 2 }}>
            Mẫu file (cách nhau dấu phẩy)
            <input className="input" value={p.edit} maxLength={240} onChange={(e) => setP({ ...p, edit: e.target.value })} />
          </label>
        )}
      </div>
      <label>
        <span>
          Lệnh được chạy <span className="muted" style={{ fontWeight: 400 }}>— mỗi dòng một quy tắc Claude Code, vd Bash(npm test:*)</span>
        </span>
        <textarea
          className="input mono"
          rows={Math.min(8, Math.max(2, p.bash.length + 1))}
          value={bashText}
          onChange={(e) => {
            setBashText(e.target.value);
            setP({ ...p, bash: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) });
          }}
        />
      </label>
      <label>
        Prompt quy trình (thêm vào system prompt của mọi phiên phòng này)
        <textarea className="input" rows={10} maxLength={4000} value={p.prompt} onChange={(e) => setP({ ...p, prompt: e.target.value })} />
      </label>
      <div className="ag-skills">
        <b>Kỹ năng · {p.skills.length}</b>
        {p.skills.map((s, i) => (
          <div key={i} className="ag-skill">
            <div className="ag-skill-head" onClick={() => setOpen(open === i ? null : i)}>
              <code>{s.id}</code> <b>{s.name}</b> <small className="muted">— dùng khi {s.when}</small>
              <button
                type="button"
                title="Xoá kỹ năng"
                onClick={(e) => {
                  e.stopPropagation();
                  setP({ ...p, skills: p.skills.filter((_, j) => j !== i) });
                }}
              >
                🗑️
              </button>
            </div>
            {open === i && (
              <div className="ag-skill-body">
                <div className="ag-erow">
                  <input className="input" placeholder="mã (a-z, 0-9, -)" value={s.id} maxLength={40} onChange={(e) => setSkill(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                  <input className="input" placeholder="Tên" value={s.name} maxLength={60} onChange={(e) => setSkill(i, { name: e.target.value })} />
                </div>
                <input className="input" placeholder="Dùng khi…" value={s.when} maxLength={200} onChange={(e) => setSkill(i, { when: e.target.value })} />
                <textarea className="input" rows={7} maxLength={3000} value={s.body} onChange={(e) => setSkill(i, { body: e.target.value })} />
              </div>
            )}
          </div>
        ))}
        {p.skills.length < 8 && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setP({ ...p, skills: [...p.skills, { id: `ky-nang-${p.skills.length + 1}`, name: 'Kỹ năng mới', when: '…', body: '1. …' }] });
              setOpen(p.skills.length);
            }}
          >
            + Kỹ năng
          </button>
        )}
      </div>
      <div className="ag-erow">
        <button className="btn primary" disabled={!dirty} onClick={() => game.agents({ a: 'profile', dept, profile: p })}>
          Lưu hồ sơ {DEPT_BY_ID.get(dept)!.name}
        </button>
        {dirty && (
          <button className="btn" onClick={() => (setP(profile), setBashText(profile.bash.join('\n')))}>
            Bỏ thay đổi
          </button>
        )}
        {custom && (
          <button className="btn" onClick={() => confirm('Khôi phục hồ sơ mặc định của phòng này?') && game.agents({ a: 'profileReset', dept })}>
            Khôi phục mặc định
          </button>
        )}
      </div>
    </div>
  );
}

function Book() {
  const book = useStore((s) => s.agentBook);
  const [dept, setDept] = useState<DeptId | 'all' | ''>('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Lesson | null>(null);
  if (!book) return <div className="ag-empty">Đang mở sổ…</div>;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = book.lessons.filter((l) => (!dept || l.dept === dept) && (!q || norm(`${l.text} ${l.project}`).includes(norm(q))));
  return (
    <>
      <p className="ag-hint">
        Mỗi phiên nộp một bản tóm tắt khi xong việc; Ban điều hành (máy trực có phòng <code>lead</code>) gộp chúng thành bài học ngắn ở đây. Mỗi phiên mới đều được đọc các bài học của phòng mình ngay khi mở. Bạn cũng sửa, thêm, gỡ trực tiếp được.
      </p>
      <div className="ag-filter">
        <button className={`chip${dept === '' ? ' on' : ''}`} onClick={() => setDept('')}>
          Tất cả
        </button>
        <button className={`chip${dept === 'all' ? ' on' : ''}`} onClick={() => setDept('all')}>
          🌐 Chung
        </button>
        {DEPTS.map((d) => (
          <button key={d.id} className={`chip${dept === d.id ? ' on' : ''}`} onClick={() => setDept(d.id)}>
            {d.icon} {d.short}
          </button>
        ))}
        <input className="input" placeholder="🔎 Tìm…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setEditing({ id: '', dept: isDept(dept) ? dept : 'all', project: '', text: '', by: '', at: 0 })}>
          + Bài học
        </button>
      </div>
      {editing && <LessonEditor lesson={editing} onDone={() => setEditing(null)} />}
      <div className="ag-lessons">
        {list.map((l) => (
          <div key={l.id} className="ag-lesson" style={{ ['--c' as string]: l.dept === 'all' ? '#8a93a6' : DEPT_BY_ID.get(l.dept)!.color }}>
            <span className="ag-ltag">
              {l.dept === 'all' ? '🌐 Chung' : `${DEPT_BY_ID.get(l.dept)!.icon} ${DEPT_BY_ID.get(l.dept)!.short}`}
              {l.project && <i> · {l.project}</i>}
            </span>
            <p>{l.text}</p>
            <small className="muted">
              {l.by} · {timeAgo(l.at)}
            </small>
            <span className="ag-lact">
              <button title="Sửa" onClick={() => setEditing(l)}>
                ✏️
              </button>
              <button title="Gỡ" onClick={() => confirm('Gỡ bài học này?') && game.agents({ a: 'lessonDel', id: l.id })}>
                🗑️
              </button>
            </span>
          </div>
        ))}
        {!list.length && <div className="ag-empty">{book.lessons.length ? 'Không có bài học nào khớp.' : 'Sổ còn trống. Bài học đầu tiên sẽ có sau khi vài phiên nộp tóm tắt và Ban điều hành đúc rút.'}</div>}
      </div>
      {!!book.pending.length && (
        <details className="ag-pending">
          <summary>📥 {book.pending.length} bản tóm tắt chờ đúc rút</summary>
          {book.pending.map((d) => (
            <div key={d.id} className="ag-debrief">
              <b>
                {DEPT_BY_ID.get(d.dept)?.icon} {d.agentName}
              </b>
              <small className="muted">
                {d.project && `${d.project} · `}
                {timeAgo(d.at)}
              </small>
              <p>{d.text}</p>
              <button className="btn" onClick={() => game.agents({ a: 'dismiss', id: d.id })}>
                Bỏ qua
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

function LessonEditor({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const [dept, setDept] = useState<DeptId | 'all'>(lesson.dept);
  const [project, setProject] = useState(lesson.project);
  const [text, setText] = useState(lesson.text);
  return (
    <form
      className="ag-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        game.agents({ a: 'lesson', id: lesson.id || undefined, dept, project: project.trim(), text: text.trim() });
        onDone();
      }}
    >
      <div className="ag-erow">
        <select className="input" value={dept} onChange={(e) => setDept(e.target.value === 'all' || isDept(e.target.value) ? (e.target.value as DeptId | 'all') : 'all')}>
          <option value="all">🌐 Chung cho mọi phòng</option>
          {DEPTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon} {d.name}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Dự án (tên thư mục, bỏ trống = mọi dự án)" maxLength={40} value={project} onChange={(e) => setProject(e.target.value)} />
      </div>
      <textarea className="input" autoFocus placeholder="Bài học: 1–2 câu, cụ thể, dùng được ngay" maxLength={400} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="ag-erow">
        <button className="btn primary" type="submit">
          Lưu
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Huỷ
        </button>
      </div>
    </form>
  );
}

function Connect() {
  const token = useStore((s) => s.activityToken);
  const [depts, setDepts] = useState<DeptId[]>(DEPTS.map((d) => d.id));
  const runner = token
    ? `curl -fsSL ${location.origin}/office-agent.cjs -o office-agent.cjs && node office-agent.cjs --url ${location.origin} --token ${token} --dir ~/code/du-an${depts.length === DEPTS.length ? '' : ` --depts ${depts.join(',')}`} --max 3 --allow "Bash(npm test:*),Bash(npm run build:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*)"`
    : '';
  return (
    <div className="ag-connect">
      <section>
        <h3>1. Claude Code của bạn thành nhân viên ảo</h3>
        <p className="ag-hint">
          Làm việc như bình thường — mỗi phiên Claude Code bạn mở sẽ ngồi vào bàn phòng ban đã chọn, màn hình hiện nó đang làm gì, đầu phiên được đọc sổ kinh nghiệm, và có thêm MCP <code>office</code> để chat, bàn giao việc, nộp tóm tắt.
        </p>
        <ClaudeConnect intro={false} />
      </section>
      <section>
        <h3>2. Máy trực: nhân viên ảo tự làm việc</h3>
        <p className="ag-hint">
          Chạy trên một máy luôn bật, đã đăng nhập Claude Code (dùng gói Claude của máy đó). Cứ ~12 giây nó hỏi Office có việc gì cho các phòng nó phụ trách — việc trên Kanban gắn phòng ban, tin nhắn <code>@phòng</code> trong chat, đợt đúc rút kinh nghiệm — rồi mở một phiên <code>claude -p</code> cho từng việc. Nhân viên ảo ngồi vào bàn khi bắt đầu và rời đi khi xong.
        </p>
        <div className="ag-filter">
          {DEPTS.map((d) => (
            <button key={d.id} className={`chip${depts.includes(d.id) ? ' on' : ''}`} onClick={() => setDepts((x) => (x.includes(d.id) ? (x.length > 1 ? x.filter((y) => y !== d.id) : x) : [...x, d.id]))}>
              {d.icon} {d.short}
            </button>
          ))}
        </div>
        {token ? (
          <CopyRow text={runner} label="Copy" />
        ) : (
          <button className="btn primary" onClick={() => game.requestActivityToken()}>
            Tạo mã kết nối
          </button>
        )}
        <ul className="ag-notes">
          <li>
            Mỗi phiên dùng <b>hồ sơ của phòng</b> (tab 📋): prompt, model, được sửa file nào. Lệnh terminal chỉ được chạy khi hồ sơ phòng xin <b>và</b> bạn cho phép trong <code>--allow</code> (hoặc thêm <code>--trust-profiles</code> để tin hồ sơ).
          </li>
          <li>Mọi điều Claude nói và mọi công cụ nó dùng được stream lên màn hình bàn của agent đó; log đầy đủ nằm trên máy trực.</li>
          <li>Ai trong Office cũng giao việc được cho máy trực (qua chat/Kanban) — chỉ trỏ <code>--dir</code> vào dự án bạn chấp nhận cho agent đụng vào.</li>
          <li>
            Việc chuyền tay quá 6 lần sẽ dừng lại chờ người duyệt. Log từng phiên ở <code>~/.office-agent/logs</code>. Ctrl+C để dừng — việc dở được trả về Kanban.
          </li>
        </ul>
      </section>
    </div>
  );
}

/** 🔐 Cards for the runner's owner (or anyone, when the runner allows it): a session wants to do something. */
export function ApprovalCards() {
  const me = useStore((s) => s.me?.id);
  const all = useStore((s) => s.approvals);
  const list = all.filter((x) => x.state === 'pending' && (x.owner === me || x.anyone));
  if (!me || !list.length) return null;
  return (
    <div className="ag-approvals">
      {list.slice(0, 3).map((x) => (
        <div key={x.id} className="ag-approval glass">
          <div className="ag-ap-head">
            🔐 <b>{x.agentName.replace('🤖 ', '')}</b> <span className="muted">({DEPT_BY_ID.get(x.dept)?.name}) xin phép:</span>
          </div>
          <code className="ag-ap-what">{x.summary}</code>
          <div className="ag-ap-meta muted">
            {x.tool} · máy trực của {x.owner === me ? 'bạn' : x.ownerName} · {timeAgo(x.at)}
          </div>
          <div className="ag-erow">
            <button className="btn primary" onClick={() => game.agents({ a: 'approve', id: x.id, decision: 'once' })}>
              Cho phép
            </button>
            <button className="btn" onClick={() => game.agents({ a: 'approve', id: x.id, decision: 'session' })} title={x.tool === 'Bash' ? 'Các lệnh cùng loại trong phiên này không hỏi lại' : 'Không hỏi lại loại thao tác này trong phiên'}>
              Cho cả phiên
            </button>
            <button className="btn danger" onClick={() => game.agents({ a: 'approve', id: x.id, decision: 'deny' })}>
              Từ chối
            </button>
          </div>
        </div>
      ))}
      {list.length > 3 && <div className="ag-approval glass muted">+{list.length - 3} yêu cầu nữa</div>}
    </div>
  );
}
