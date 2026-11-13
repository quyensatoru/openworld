// The virtual employees' head office (the library on floor 1): 🧠 Tổng quản and what it decided,
// who is working in which department, the company playbook distilled from their sessions, and how
// to connect an on-call machine.
import { useEffect, useMemo, useState } from 'react';
import { AGENT_MODELS, DEPTS, DEPT_BY_ID, MEET_ROOMS, canAssign, isDept, type AgentModel, type DeptId, type DeptProfile, type DeptSkill, type Lesson, type Meeting } from '../../shared/agents';
import type { BrainAction } from '../../shared/brain';
import type { PlayerState, Task } from '../../shared/protocol';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';
import { AvatarDot, timeAgo } from './common';
import { ClaudeConnect, CopyRow } from './ClaudeScreen';
import './agents.css';

const STATE_LABEL = { working: 'đang làm', idle: 'đang rảnh', waiting: 'chờ trả lời', thinking: 'đang nghĩ' } as const;

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
  const set = (agentsTab: 'brain' | 'depts' | 'book' | 'profiles' | 'access' | 'connect') => setState({ agentsTab });

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass ag-panel" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <header className="ag-head">
          <h2>🧠 Nhân viên văn phòng</h2>
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
          <button className={tab === 'brain' ? 'on' : ''} onClick={() => set('brain')}>
            🧠 Tổng quản
          </button>
          <button className={tab === 'depts' ? 'on' : ''} onClick={() => set('depts')}>
            🏢 Phòng ban
          </button>
          <button className={tab === 'book' ? 'on' : ''} onClick={() => set('book')}>
            📘 Sổ kinh nghiệm{book ? ` · ${book.lessons.length}` : ''}
          </button>
          <button className={tab === 'profiles' ? 'on' : ''} onClick={() => set('profiles')}>
            📋 Hồ sơ phòng ban
          </button>
          <button className={tab === 'access' ? 'on' : ''} onClick={() => set('access')}>
            🔑 Quyền giao việc
          </button>
          <button className={tab === 'connect' ? 'on' : ''} onClick={() => set('connect')}>
            🔌 Kết nối
          </button>
        </nav>
        <div className="ag-body scroll">
          {tab === 'brain' && <BrainTab />}
          {tab === 'depts' && <Depts agents={agents} tasks={Object.values(tasks)} />}
          {tab === 'book' && <Book />}
          {tab === 'profiles' && <Profiles />}
          {tab === 'access' && <Access />}
          {tab === 'connect' && <Connect />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 🧠 Tổng quản
const ACTION_META: Record<BrainAction, { icon: string; label: string }> = {
  answer: { icon: '💬', label: 'trả lời thẳng' },
  route: { icon: '📨', label: 'giao việc' },
  ask: { icon: '❓', label: 'hỏi lại' },
  merge: { icon: '🧵', label: 'gộp vào việc đang chạy' },
  drop: { icon: '🤫', label: 'bỏ qua' },
};
const QUEUE_META: Record<string, string> = { pending: 'đang chờ nghĩ', thinking: 'đang nghĩ', asked: 'đang chờ bạn trả lời', done: 'xong' };

function BrainTab() {
  const brain = useStore((s) => s.brain);
  const acc = useStore((s) => s.agentAccess);
  const meId = useStore((s) => s.me?.id ?? '');
  const isOwner = !!acc?.owners.some((o) => o.id === meId);
  if (!brain) return <p className="ag-hint">Đang tải…</p>;
  const { config: cfg, budget, queue, recent, online } = brain;
  const pct = Math.min(100, Math.round((budget.sessionsHour / Math.max(1, cfg.maxSessionsHour)) * 100));
  const set = (patch: Partial<typeof cfg>) => game.agents({ a: 'brainConfig', config: { ...cfg, ...patch } });
  return (
    <div className="ag-brain">
      <section className={`br-head${online ? ' on' : ''}`}>
        <div className="br-dot" />
        <div>
          <b>{online ? 'Tổng quản đang trực' : 'Chưa có máy nào phục vụ Tổng quản'}</b>
          <small>
            {online
              ? 'Mọi yêu cầu đi qua đây: nó chọn phòng ban, chia việc chạy song song, trả lời thẳng những gì trả lời được và chỉ hỏi lại khi đoán sai là hỏng việc.'
              : 'Chạy máy trực ở tab 🔌 Kết nối. Yêu cầu của mọi người vẫn được ghi lại và sẽ xử lý khi có máy lên.'}
          </small>
        </div>
      </section>

      <section className="br-budget">
        <h3>Chi tiêu giờ này</h3>
        <div className="br-bar">
          <i style={{ width: `${pct}%` }} className={pct > 85 ? 'hot' : ''} />
        </div>
        <p className="ag-hint">
          <b>{budget.sessionsHour}</b>/{cfg.maxSessionsHour} phiên làm việc (thứ tốn tiền) · <b>{budget.thoughtsHour}</b> lượt suy nghĩ (rẻ, không đụng vào dự án)
          {budget.throttled.length ? ` · ${budget.throttled.length} người đang chạm trần riêng` : ''}
        </p>
      </section>

      {isOwner && (
        <section className="br-cfg">
          <h3>Cách Tổng quản làm việc</h3>
          <label>
            Model quyết định
            <select className="input" value={cfg.model} onChange={(e) => set({ model: e.target.value as typeof cfg.model })}>
              <option value="haiku">Haiku — nhanh và rẻ nhất</option>
              <option value="sonnet">Sonnet — cân bằng (khuyên dùng)</option>
              <option value="opus">Opus — quyết định khó nhất</option>
            </select>
          </label>
          <label>
            Trần phiên/giờ cho cả văn phòng
            <input className="input" type="number" min={1} max={200} value={cfg.maxSessionsHour} onChange={(e) => set({ maxSessionsHour: Number(e.target.value) })} />
          </label>
          <label>
            Trần phiên/giờ cho mỗi người
            <input className="input" type="number" min={1} max={100} value={cfg.maxPerPersonHour} onChange={(e) => set({ maxPerPersonHour: Number(e.target.value) })} />
          </label>
          <label>
            Duyệt quyền cho nhân viên
            <select className="input" value={cfg.approvals} onChange={(e) => set({ approvals: e.target.value as typeof cfg.approvals })}>
              <option value="lead">🧠 Tổng quản tự duyệt — chỉ hỏi bạn việc khó đảo ngược (khuyên dùng)</option>
              <option value="auto">🚀 Tự động hoàn toàn — không hỏi ai, việc chưa chắc thì từ chối</option>
              <option value="ask">🙋 Hỏi chủ máy mọi thứ (như cũ)</option>
            </select>
          </label>
          <p className="ag-hint">
            {cfg.approvals === 'ask'
              ? 'Mỗi thao tác ngoài hồ sơ phòng ban hiện một thẻ 🔐 cho chủ máy trực.'
              : cfg.approvals === 'lead'
                ? 'Đọc file, chạy test/build, sửa file trong dự án: cho luôn. Thao tác khác Tổng quản xét theo đúng việc đang làm. Push, deploy, xoá dữ liệu, gửi ra ngoài: chỉ cho khi việc ghi rõ yêu cầu — không rõ thì mới hỏi bạn.'
                : 'Phiên làm việc chạy ở chế độ auto của Claude Code; thứ gì còn phải xin thì Tổng quản quyết, không chắc thì từ chối và ghi vào việc. Bạn chỉ nhận kết quả cuối.'}
          </p>
          <label className="br-check">
            <input type="checkbox" checked={cfg.meetings} onChange={(e) => set({ meetings: e.target.checked })} />
            Cho phép họp tự động giữa các nhân viên văn phòng
          </label>
          <p className="ag-hint">
            Họp là thứ tốn kém nhất: mỗi ghế là một phiên chạy song song tới 25 phút. Tắt thì Tổng quản tự ra kế hoạch “ai làm gì” bằng một lượt nghĩ rồi giao việc song song. Phòng họp vẫn dùng bình thường cho người thật.
          </p>
        </section>
      )}

      <Machines />
      <Rounds />
      <AutoApprovals />

      <section>
        <h3>Đang trên bàn Tổng quản{queue.length ? ` · ${queue.length}` : ''}</h3>
        {!queue.length && <p className="ag-hint">Không có yêu cầu nào đang chờ.</p>}
        {queue.map((it) => (
          <div key={it.id} className={`br-item ${it.state}`}>
            <div className="br-row">
              <b>{it.whoName || 'Ai đó'}</b>
              <span className="br-tag">
                {it.state === 'done' ? (it.report === 'wait' ? 'các phòng đang làm · sẽ báo kết quả' : 'đang viết báo cáo kết quả') : QUEUE_META[it.state] ?? it.state}
                {it.fails && it.state === 'pending' ? ' · 📶 chờ kết nối Claude' : ''}
              </span>
              <time>{timeAgo(it.at)}</time>
              {it.who === meId && it.state !== 'done' && (
                <button className="btn tiny" onClick={() => game.agents({ a: 'brainCancel', id: it.id })}>
                  Huỷ
                </button>
              )}
            </div>
            <p className="br-text">{it.text}</p>
            {it.followUps.filter((f) => f.q).map((f, i) => (
              <p key={i} className="br-ask">
                ❓ {f.q}
                {f.a ? ` → “${f.a}”` : ''}
              </p>
            ))}
          </div>
        ))}
      </section>

      <section>
        <h3>Đã quyết</h3>
        {!recent.length && <p className="ag-hint">Chưa có quyết định nào.</p>}
        {[...recent].reverse().map((l) => {
          const meta = ACTION_META[l.action];
          return (
            <div key={`${l.id}-${l.at}`} className="br-log">
              <div className="br-row">
                <span className="br-act">
                  {meta.icon} {meta.label}
                </span>
                <b>{l.whoName}</b>
                <time>{timeAgo(l.at)}</time>
              </div>
              <p className="br-text">{l.text}</p>
              {l.reply && <p className="br-reply">↳ {l.reply}</p>}
              {!!l.depts.length && (
                <div className="br-depts">
                  {l.depts.map((d, i) => (
                    <span key={i} style={{ ['--c' as string]: DEPT_BY_ID.get(d)?.color }}>
                      {DEPT_BY_ID.get(d)?.icon} {DEPT_BY_ID.get(d)?.short}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** The on-call machines: which project each works in, and whether it is working, waiting for Claude
 *  (a quota ran out, say — until when) or offline. */
function Machines() {
  const machines = useStore((s) => s.brain?.machines ?? []);
  if (!machines.length) return null;
  const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return (
    <section>
      <h3>Máy trực · {machines.length}</h3>
      {machines.map((m) => {
        const off = !!m.offline;
        const down = !off && !!m.outage && m.outage.until > Date.now();
        const icons = m.depts.map((d) => DEPT_BY_ID.get(d)?.icon).join(' ');
        const status = off
          ? `📴 offline từ ${hhmm(m.at)} — máy tắt, ngủ hoặc mất mạng; việc đang dở về lại bảng sau 20 phút`
          : down
            ? `⏳ chờ Claude (${m.outage!.why}) — tự làm tiếp lúc ${hhmm(m.outage!.until)}, việc đang dở được giữ nguyên`
            : m.busy
              ? `🔨 đang làm ${m.busy} việc · ${icons}`
              : `✅ rảnh, sẵn sàng nhận việc · ${icons}`;
        return (
          <div key={m.id} className={`br-machine${down ? ' down' : ''}${off ? ' off' : ''}`}>
            <span className="br-dot" />
            <div>
              <b>{m.project || 'chưa rõ dự án'}</b> <span className="muted">· {m.label} · của {m.ownerName || '…'}</span>
              <small>{status}</small>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** "Vòng cải tiến mới": QA looks for bugs and Biz ranks improvements side by side, Dev does the top
 *  of both after — one press. Earlier rounds are listed so everyone sees what was already done. */
function Rounds() {
  const rounds = useStore((s) => s.brain?.rounds ?? []);
  const machines = useStore((s) => s.brain?.machines ?? []);
  const projects = useMemo(() => [...new Set(machines.filter((m) => !m.offline && m.project).map((m) => m.project))].sort(), [machines]);
  const [project, setProject] = useState('');
  const [sure, setSure] = useState(false);
  const pick = projects.includes(project) ? project : (projects[0] ?? '');
  const running = rounds.find((r) => !r.closed && (!pick || r.project === pick));
  const day = (ms: number) => new Date(ms).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const start = () => {
    game.agents({ a: 'improve', project: pick });
    setSure(false);
  };
  return (
    <section className="br-rounds">
      <h3>🔁 Vòng cải tiến{rounds.length ? ` · ${rounds.length}` : ''}</h3>
      <p className="ag-hint">Một nút tạo ba việc: 🧪 Kiểm thử rà lỗi và 🤝 Kinh doanh xếp ưu tiên cải tiến chạy song song, 💻 Phát triển làm các mục ưu tiên nối sau. Mỗi việc đọc được các vòng trước đã làm gì nên không đề xuất trùng; xong hết Tổng quản báo kết quả trong luồng của bạn.</p>
      <div className="br-round-go">
        {projects.length > 1 && (
          <select className="input" value={pick} onChange={(e) => setProject(e.target.value)} aria-label="Dự án">
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        {sure ? (
          <>
            <button className="btn primary" onClick={start}>
              Tạo 3 việc{pick ? ` cho ${pick}` : ''}
            </button>
            <button className="btn" onClick={() => setSure(false)}>
              Thôi
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setSure(true)} disabled={!!running} title={running ? 'Vòng trước của dự án này vẫn đang chạy' : undefined}>
            🔁 Vòng cải tiến mới
          </button>
        )}
      </div>
      {running && <p className="ag-hint">Vòng ngày {day(running.at)}{running.project ? ` của ${running.project}` : ''} đang chạy — xong vòng đó mới mở được vòng mới.</p>}
      {rounds.map((r) => (
        <details key={r.id} className="br-round">
          <summary>
            {r.closed ? '✅' : '⏳'} Vòng {day(r.at)}
            {r.project ? ` · ${r.project}` : ''} <small className="muted">· {r.byName}</small>
          </summary>
          <p className="br-text">{r.summary || 'Các phòng chưa ghi kết quả.'}</p>
        </details>
      ))}
    </section>
  );
}

/** What Tổng quản approved or refused on its own lately — so nobody has to wonder. */
function AutoApprovals() {
  const list = useStore((s) => s.approvals);
  const mine = list.filter((x) => x.state !== 'pending' && x.by?.startsWith('🧠')).slice(-6).reverse();
  if (!mine.length) return null;
  return (
    <section>
      <h3>Tổng quản vừa tự duyệt</h3>
      {mine.map((x) => (
        <div key={x.id} className={`br-log ${x.state}`}>
          <div className="br-row">
            <span className="br-act">{x.state === 'allow' ? '🔓 cho phép' : '🚫 không cho'}</span>
            <b>{x.agentName.replace('🤖 ', '')}</b>
            <time>{timeAgo(x.at)}</time>
          </div>
          <p className="br-text">
            <code>{x.summary}</code>
          </p>
          {x.reason && <p className="br-reply">↳ {x.reason}</p>}
        </div>
      ))}
    </section>
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
        Bạn không cần biết giao cho ai. Cứ nói việc cần làm ở tab chat <b>🏢 Văn phòng của bạn</b> — 🧠 Tổng quản chọn phòng ban, chia việc chạy song song và trả lời bạn ngay trong luồng đó. Máy trực cử nhân viên văn phòng của phòng tương ứng ngồi vào bàn làm, rồi nộp tóm tắt để đúc rút kinh nghiệm.
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
                          {a.agent!.kind === 'brain' ? 'điều phối cả văn phòng' : `máy trực của ${a.agent!.ownerName}`}
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
                {!here.length && <div className="ag-empty">Chưa có ai ngồi — phòng này sẽ có người khi Tổng quản giao việc tới.</div>}
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
  const [project, setProject] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lesson | null>(null);
  if (!book) return <div className="ag-empty">Đang mở sổ…</div>;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const projects = [...new Set(book.lessons.map((l) => l.project).filter(Boolean))].sort();
  const list = book.lessons.filter((l) => (!dept || l.dept === dept) && (project === null || l.project === project) && (!q || norm(`${l.text} ${l.project} ${l.machine ?? ''}`).includes(norm(q))));
  return (
    <>
      <p className="ag-hint">
        Mỗi phiên nộp một bản tóm tắt khi xong việc; Ban điều hành của <b>từng dự án</b> gộp chúng thành bài học ngắn ở đây. Mỗi phiên chỉ đọc bài học chung, bài của dự án nó đang làm và bài riêng của máy nó đang chạy — kinh nghiệm dự án này không lẫn sang dự án khác. Bạn cũng sửa, thêm, gỡ trực tiếp được.
      </p>
      {!!projects.length && (
        <div className="ag-filter">
          <button className={`chip${project === null ? ' on' : ''}`} onClick={() => setProject(null)}>
            Mọi phạm vi
          </button>
          <button className={`chip${project === '' ? ' on' : ''}`} onClick={() => setProject('')}>
            🌐 Mọi dự án
          </button>
          {projects.map((p) => (
            <button key={p} className={`chip${project === p ? ' on' : ''}`} onClick={() => setProject(p)}>
              📁 {p}
            </button>
          ))}
        </div>
      )}
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
        <button className="btn primary" onClick={() => setEditing({ id: '', dept: isDept(dept) ? dept : 'all', project: project ?? '', machine: '', text: '', by: '', at: 0 })}>
          + Bài học
        </button>
      </div>
      {editing && <LessonEditor lesson={editing} onDone={() => setEditing(null)} />}
      <div className="ag-lessons">
        {list.map((l) => (
          <div key={l.id} className="ag-lesson" style={{ ['--c' as string]: l.dept === 'all' ? '#8a93a6' : DEPT_BY_ID.get(l.dept)!.color }}>
            <span className="ag-ltag">
              {l.dept === 'all' ? '🌐 Chung' : `${DEPT_BY_ID.get(l.dept)!.icon} ${DEPT_BY_ID.get(l.dept)!.short}`}
              <i> · {l.project ? `📁 ${l.project}` : 'mọi dự án'}</i>
              {l.machine && <i> · 💻 {l.machine}</i>}
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
                {d.project && `📁 ${d.project} · `}
                {d.machine && `💻 ${d.machine} · `}
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
  const [machine, setMachine] = useState(lesson.machine ?? '');
  const [text, setText] = useState(lesson.text);
  return (
    <form
      className="ag-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        game.agents({ a: 'lesson', id: lesson.id || undefined, dept, project: project.trim(), machine: machine.trim(), text: text.trim() });
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
        <input className="input" placeholder="Dự án (tên repo, bỏ trống = mọi dự án)" maxLength={60} value={project} onChange={(e) => setProject(e.target.value)} />
        <input className="input" placeholder="Máy (bỏ trống = mọi máy)" maxLength={60} value={machine} onChange={(e) => setMachine(e.target.value)} />
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
        <h3>Máy trực: văn phòng tự làm việc</h3>
        <p className="ag-hint">
          Chạy trên một máy luôn bật, đã đăng nhập Claude Code (dùng gói Claude của máy đó). Máy này làm hai việc: phục vụ các <b>quyết định điều phối</b> của 🧠 Tổng quản (lệnh ngắn, không đụng vào dự án), và mở phiên <code>claude -p</code> trong dự án cho những việc Tổng quản đã đưa lên bảng. Nhân viên văn phòng ngồi vào bàn khi bắt đầu và rời đi khi xong.
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
            Mỗi phiên làm việc dùng <b>hồ sơ của phòng</b> (tab 📋): prompt, model, được sửa file nào. Lệnh terminal chỉ được chạy khi hồ sơ phòng xin <b>và</b> bạn cho phép trong <code>--allow</code> (hoặc thêm <code>--trust-profiles</code> để tin hồ sơ).
          </li>
          <li>
            Quyết định của Tổng quản chạy trong thư mục trống, <b>không</b> đọc được dự án và không có công cụ nào — nên rẻ và nhanh. Trần chi tiêu đặt ở tab 🧠. Thêm <code>--no-brain</code> nếu máy khác đã lo phần này.
          </li>
          <li>Mọi điều Claude nói và mọi công cụ nó dùng được stream lên màn hình bàn của nhân viên văn phòng đó; log đầy đủ nằm ở <code>~/.office-agent/logs</code>.</li>
          <li>
            Mặc định máy trực <b>chỉ nhận việc từ bạn</b>. Muốn đồng nghiệp giao việc được thì chọn họ ở tab 🔑 Quyền giao việc. Chỉ trỏ <code>--dir</code> vào dự án bạn chấp nhận cho agent đụng vào.
          </li>
          <li>
            <b>Mất mạng hay Claude sập không làm hỏng việc:</b> nhân viên ngồi chờ ở bàn, máy trực tự thử lại (30 giây → tối đa 10 phút) rồi <b>làm tiếp đúng phiên đang dở</b>, không làm lại từ đầu. Phiên im lặng quá 12 phút bị coi là treo và được khởi động lại theo cách đó. Mất liên lạc với Office thì phiên vẫn chạy, kết quả gửi lên khi có mạng. Máy trực khởi động lại cũng tự nhận lại phiên cũ.
          </li>
          <li>
            Mỗi máy trực làm trong <b>một dự án</b> (tên repo trên git remote, hoặc <code>--project tên</code>). Tổng quản chỉ giao việc của dự án nào cho máy của dự án đó, và sổ kinh nghiệm cũng tách theo dự án.
          </li>
          <li>Ctrl+C để dừng — việc dở được trả về Kanban.</li>
        </ul>
      </section>
      <section>
        <h3>Màn hình Claude Code của bạn</h3>
        <p className="ag-hint">
          Việc riêng của bạn vẫn là của bạn: Claude Code trên máy bạn <b>không</b> thành nhân viên văn phòng. Bật cái này thì màn hình ở bàn bạn ngồi sẽ hiện Claude đang làm gì (chỉ tên công cụ + tên file), để đồng nghiệp đi ngang thấy bạn đang bận.
        </p>
        <ClaudeConnect intro={false} />
      </section>
    </div>
  );
}
type AccessMode = 'me' | 'some' | 'all';

function Access() {
  const me = useStore((s) => s.me?.id ?? '');
  const acc = useStore((s) => s.agentAccess);
  const team = useStore((s) => s.team);
  const mine = acc?.owners.find((o) => o.id === me);
  const others = acc?.owners.filter((o) => o.id !== me) ?? [];
  const [mode, setMode] = useState<AccessMode>(mine ? (mine.all ? 'all' : mine.users.length ? 'some' : 'me') : 'me');
  const [q, setQ] = useState('');
  const people = useMemo(
    () =>
      Object.values(team)
        .filter((m) => m.id !== me && !m.id.startsWith('ag-'))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [team, me],
  );
  const nameOf = (id: string) => team[id]?.name ?? 'một người đã rời';
  const save = (all: boolean, users: string[]) => game.agents({ a: 'access', all, users });
  const pick = (m: AccessMode) => {
    setMode(m);
    if (!mine) return;
    if (m === 'all') save(true, mine.users);
    else if (m === 'me') save(false, []);
    else save(false, mine.users);
  };
  const toggle = (id: string) => {
    if (!mine) return;
    save(false, mine.users.includes(id) ? mine.users.filter((u) => u !== id) : [...mine.users, id]);
  };
  const ok = canAssign(acc, me);
  const via = acc?.owners.filter((o) => o.id === me || o.all || o.users.includes(me)) ?? [];
  const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const policy = (o: { id: string; name: string; all: boolean; users: string[] }) =>
    o.all ? 'mọi người trong văn phòng' : o.users.length ? `${o.name || 'chủ máy'} và ${o.users.length} người được chọn` : `chỉ ${o.name || 'chủ máy'}`;

  return (
    <div className="ag-access">
      <section className={`ag-me ${ok ? 'yes' : 'no'}`}>
        {ok ? (
          <>
            ✅ Bạn giao việc được cho nhân viên AI — qua máy trực của <b>{via.map((o) => (o.id === me ? 'bạn' : o.name)).join(', ')}</b>.
          </>
        ) : acc?.owners.length ? (
          <>
            ⛔ Bạn chưa giao việc được cho nhân viên AI. Nhờ <b>{acc.owners.map((o) => o.name).join(' hoặc ')}</b> chọn bạn ở tab này.
          </>
        ) : (
          <>⛔ Văn phòng chưa có máy trực nào chạy, nên chưa ai giao việc cho nhân viên AI được.</>
        )}
      </section>

      {mine ? (
        <section>
          <h3>Ai được giao việc cho máy trực của bạn</h3>
          <p className="ag-hint">
            Tính cả tin <code>@phòng</code> / <code>@ai</code> trong chat, việc gắn phòng ban trên Kanban, lời mời họp, và tin nhắn gọi tên nhân viên đang chạy trên máy bạn. Người không có quyền nhắn thì máy bạn bỏ qua và họ nhận được thông báo.
          </p>
          <div className="ag-modes">
            <label>
              <input type="radio" checked={mode === 'me'} onChange={() => pick('me')} /> Chỉ mình tôi
            </label>
            <label>
              <input type="radio" checked={mode === 'some'} onChange={() => pick('some')} /> Những người tôi chọn
            </label>
            <label>
              <input type="radio" checked={mode === 'all'} onChange={() => pick('all')} /> Mọi người trong văn phòng
            </label>
          </div>
          {mode === 'some' && (
            <>
              <input className="input" placeholder="Tìm người…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="ag-people">
                {shown.map((p) => (
                  <label key={p.id} className={mine.users.includes(p.id) ? 'on' : ''}>
                    <input type="checkbox" checked={mine.users.includes(p.id)} onChange={() => toggle(p.id)} />
                    <AvatarDot name={p.name} avatar={p.avatar} size={22} />
                    {p.name}
                  </label>
                ))}
                {!shown.length && <p className="muted">Không có ai khớp.</p>}
              </div>
              {mine.users.some((u) => !team[u]) && <p className="muted">Và {mine.users.filter((u) => !team[u]).length} người không còn trong danh sách.</p>}
            </>
          )}
          <ul className="ag-notes">
            <li>Người được quyền chỉ giao được việc — lệnh ngoài <code>--allow</code> (xuất dữ liệu, gửi file ra ngoài, xoá…) vẫn hiện thẻ 🔐 để <b>bạn</b> duyệt.</li>
            <li>Sổ kinh nghiệm và hồ sơ phòng ban chỉ người chạy máy trực mới sửa được, vì chúng điều khiển cách các máy làm việc.</li>
          </ul>
        </section>
      ) : (
        <section>
          <h3>Máy trực của bạn</h3>
          <p className="ag-hint">Bạn chưa chạy máy trực nào. Khi chạy (tab 🔌 Kết nối), máy của bạn mặc định chỉ nhận việc từ bạn, và bạn chọn thêm người ở đây.</p>
        </section>
      )}

      {!!others.length && (
        <section>
          <h3>Các máy trực khác</h3>
          <ul className="ag-owners">
            {others.map((o) => (
              <li key={o.id}>
                🖥️ <b>{o.name || nameOf(o.id)}</b> — nhận việc từ {policy(o)}
                {!o.all && o.users.includes(me) ? ' (có bạn)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
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
