import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { DEPTS, DEPT_BY_ID, canAssign, isDept, mentionedDepts, type DeptId } from '../../shared/agents';
import { COLUMNS, PRIORITY_META, type Priority, type Task, type TaskColumn } from '../../shared/protocol';
import { game } from '../game';
import { getState, nameOf, setState, useStore } from '../store';
import { AvatarDot, fmtTime, timeAgo } from './common';

const COL_COLOR: Record<TaskColumn, string> = { todo: '#9aa3ad', doing: '#6b8cff', review: '#f0a35e', done: '#3fb27f' };

export function Kanban() {
  const tasks = useStore((s) => s.tasks);
  const me = useStore((s) => s.me);
  const players = useStore((s) => s.players);
  const team = useStore((s) => s.team);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: TaskColumn; index: number } | null>(null);
  const listRefs = useRef<Partial<Record<TaskColumn, HTMLDivElement | null>>>({});
  const close = () => setState({ kanbanOpen: false });

  const stopped = useStore((s) => s.stopped);
  const working = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of [...Object.values(players), ...(me ? [me] : [])]) if (p.taskId) m.set(p.taskId, [...(m.get(p.taskId) ?? []), p.name]);
    return m;
  }, [players, me]);
  // a session on the card that is waiting (Claude out of quota until some time, an approval…): say what for
  const waits = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of Object.values(players)) if (p.taskId && p.agent?.state === 'waiting' && p.statusText) m.set(p.taskId, p.statusText);
    return m;
  }, [players]);

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const byCol = useMemo(() => {
    const out: Record<TaskColumn, Task[]> = { todo: [], doing: [], review: [], done: [] };
    for (const t of Object.values(tasks)) {
      if (filter === 'mine' && t.assignee !== me?.id) continue;
      if (q && !norm(`${t.title} ${t.desc} ${nameOf(t.assignee)}`).includes(norm(q))) continue;
      out[t.col]?.push(t);
    }
    for (const c of Object.values(out)) c.sort((a, b) => a.ord - b.ord);
    out.done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    return out;
  }, [tasks, filter, q, me?.id]);

  const dropIndex = (col: TaskColumn, y: number) => {
    const el = listRefs.current[col];
    if (!el) return 0;
    const cards = [...el.querySelectorAll<HTMLElement>('[data-id]')].filter((c) => c.dataset.id !== dragId);
    let i = 0;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y > r.top + r.height / 2) i++;
    }
    return i;
  };

  const drop = (col: TaskColumn, index: number) => {
    if (!dragId) return;
    const list = byCol[col].filter((t) => t.id !== dragId);
    const before = list[index - 1]?.ord;
    const after = list[index]?.ord;
    const ord = before == null && after == null ? 1 : before == null ? after! - 1 : after == null ? before + 1 : (before + after) / 2;
    const t = tasks[dragId];
    if (t && (t.col !== col || t.ord !== ord)) game.moveTask(dragId, col, ord);
    setDragId(null);
    setOver(null);
  };

  const editingTask = editing ? tasks[editing] : null;
  useEffect(() => {
    if (editing && !tasks[editing]) setEditing(null);
  }, [tasks, editing]);

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass kanban" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <header>
          <h2>📋 Bảng công việc</h2>
          <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            Tất cả
          </button>
          <button className={`chip${filter === 'mine' ? ' on' : ''}`} onClick={() => setFilter('mine')}>
            Việc của tôi
          </button>
          <input className="input" placeholder="🔎 Tìm việc…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={close}>
            Đóng
          </button>
        </header>
        <div className="kb-cols">
          {COLUMNS.map((col) => {
            const list = byCol[col.id];
            const isOver = over?.col === col.id;
            const visible = list.filter((t) => t.id !== dragId);
            return (
              <div
                key={col.id}
                className={`kb-col${isOver ? ' over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  const index = dropIndex(col.id, e.clientY);
                  if (!over || over.col !== col.id || over.index !== index) setOver({ col: col.id, index });
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(col.id, dropIndex(col.id, e.clientY));
                }}
              >
                <h3>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: COL_COLOR[col.id] }} />
                  {col.label}
                  <span className="count">{list.length}</span>
                </h3>
                <div className="kb-list scroll" ref={(el) => void (listRefs.current[col.id] = el)}>
                  {(() => {
                    let k = 0;
                    return list.map((t) => {
                      const dragged = t.id === dragId;
                      const showDrop = isOver && !dragged && over!.index === k;
                      if (!dragged) k++;
                      return (
                        <Fragment key={t.id}>
                          {showDrop && <div className="kb-drop" />}
                          <Card task={t} working={working.get(t.id)} waiting={waits.get(t.id)} stopped={t.col === 'review' && stopped.includes(t.id)} dragging={dragged} onDrag={setDragId} onOpen={() => setEditing(t.id)} avatar={players[t.assignee ?? '']?.avatar ?? team[t.assignee ?? '']?.avatar ?? (t.assignee === me?.id ? me?.avatar : undefined)} />
                        </Fragment>
                      );
                    });
                  })()}
                  {isOver && over!.index >= visible.length && <div className="kb-drop" />}
                  {!list.length && !isOver && <div className="empty" style={{ padding: 12, fontSize: 13 }}>Kéo thả việc vào đây</div>}
                </div>
                {col.id !== 'done' && <AddTask col={col.id} assignToMe={filter === 'mine' || col.id === 'doing'} />}
              </div>
            );
          })}
        </div>
        {editingTask && <TaskEditor key={editingTask.id} task={editingTask} onClose={() => setEditing(null)} />}
      </div>
    </div>
  );
}

function Card({ task, working, waiting, stopped, dragging, onDrag, onOpen, avatar }: { task: Task; working?: string[]; waiting?: string; stopped?: boolean; dragging: boolean; onDrag: (id: string | null) => void; onOpen: () => void; avatar?: Parameters<typeof AvatarDot>[0]['avatar'] }) {
  const assignee = task.assignee ? nameOf(task.assignee) : null;
  return (
    <div
      data-id={task.id}
      className={`kb-card${dragging ? ' dragging' : ''}`}
      style={{ ['--prio' as string]: PRIORITY_META[task.priority].color }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        setTimeout(() => onDrag(task.id), 0);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={onOpen}
    >
      <div className="t">
        {task.dept && (
          <span className="kb-dept" style={{ ['--c' as string]: DEPT_BY_ID.get(task.dept)?.color }} title={`Giao cho phòng ${DEPT_BY_ID.get(task.dept)?.name}`}>
            {DEPT_BY_ID.get(task.dept)?.icon} {DEPT_BY_ID.get(task.dept)?.short}
          </span>
        )}
        {task.title}
      </div>
      <div className="m">
        {assignee ? (
          <>
            <AvatarDot name={assignee} avatar={avatar} />
            <span>{assignee}</span>
          </>
        ) : (
          <span>Chưa giao</span>
        )}
        {task.priority !== 'normal' && <span style={{ color: PRIORITY_META[task.priority].color, fontWeight: 600 }}>· {PRIORITY_META[task.priority].label}</span>}
        {working && !waiting && <span className="live" title={working.join(', ')}>🔨 đang làm</span>}
        {waiting && (
          <span className="live wait" title={`${working?.join(', ') ?? ''}: ${waiting}`}>
            {waiting}
          </span>
        )}
        {stopped && (
          <button
            className="btn tiny kb-revive"
            title="Việc đã hỏng giữa chừng nhiều lần nên dừng lại. Bấm để đưa về To do và cho chạy lại (giống nhắn “làm tiếp” trong thread)."
            onClick={(e) => {
              e.stopPropagation();
              game.agents({ a: 'revive', id: task.id });
            }}
          >
            ▶ Làm tiếp
          </button>
        )}
        {task.col === 'done' && task.doneAt && <span style={{ marginLeft: 'auto' }}>{timeAgo(task.doneAt)}</span>}
      </div>
    </div>
  );
}

function AddTask({ col, assignToMe }: { col: TaskColumn; assignToMe: boolean }) {
  const [v, setV] = useState('');
  const meId = useStore((s) => s.me?.id ?? null);
  return (
    <form
      className="kb-add"
      onSubmit={(e) => {
        e.preventDefault();
        let t = v.trim();
        // "@qa kiểm tra form đăng nhập" → handed to that department (its agents pick it up)
        const lead = /^@(\S+)\s+/.exec(t);
        const dept: DeptId | null = lead ? (mentionedDepts(lead[0])[0] ?? null) : null;
        if (dept) t = t.slice(lead![0].length).trim();
        if (!t) return;
        game.createTask(t, col, assignToMe && !dept ? meId : null, 'normal', '', dept);
        setV('');
      }}
    >
      <input className="input" placeholder="+ Thêm việc · @dev @qa… để giao phòng ban" title="Gõ @dev, @qa, @ops, @design, @docs, @biz hoặc @lead ở đầu để giao cho nhân viên văn phòng của phòng đó" maxLength={160} value={v} onChange={(e) => setV(e.target.value)} />
    </form>
  );
}

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const me = useStore((s) => s.me);
  const team = useStore((s) => s.team);
  const players = useStore((s) => s.players);
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.desc);
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of Object.values(team)) m.set(t.id, t.name);
    for (const p of Object.values(players)) m.set(p.id, p.name);
    if (me) m.set(me.id, `${me.name} (tôi)`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  }, [team, players, me]);
  const isMine = task.assignee === me?.id;
  const focused = me?.taskId === task.id;

  return (
    <div className="drawer">
      <button className="close-x" onClick={onClose}>
        ✕
      </button>
      <div className="muted" style={{ fontSize: 12.5 }}>
        Tạo bởi {nameOf(task.createdBy)} · {fmtTime(task.createdAt)} {new Date(task.createdAt).toLocaleDateString('vi-VN')}
      </div>
      <input
        className="input"
        style={{ fontSize: 17, fontWeight: 700 }}
        value={title}
        maxLength={140}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && game.updateTask(task.id, { title: title.trim() })}
      />
      <textarea className="input" placeholder="Mô tả, link PR, ghi chú…" value={desc} maxLength={2000} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== task.desc && game.updateTask(task.id, { desc })} />
      <div className="row2">
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Người làm
          <select className="input" style={{ marginTop: 6 }} value={task.assignee ?? ''} onChange={(e) => game.updateTask(task.id, { assignee: e.target.value || null })}>
            <option value="">— Chưa giao —</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Độ ưu tiên
          <select className="input" style={{ marginTop: 6 }} value={task.priority} onChange={(e) => game.updateTask(task.id, { priority: e.target.value as Priority })}>
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Giao cho phòng ban <span className="muted" style={{ fontWeight: 400 }}>(nhân viên văn phòng của phòng sẽ tự nhận)</span>
        <select className="input" style={{ marginTop: 6 }} value={task.dept ?? ''} onChange={(e) => game.updateTask(task.id, { dept: isDept(e.target.value) ? e.target.value : null })}>
          <option value="">— Không —</option>
          {DEPTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon} {d.name}
            </option>
          ))}
        </select>
        {!canAssign(getState().agentAccess, getState().me?.id ?? '') && (
          <span className="muted" style={{ display: 'block', marginTop: 4, fontWeight: 400, fontSize: 12 }}>
            ⛔ Bạn chưa được giao việc cho nhân viên AI — việc vẫn lên bảng nhưng máy trực không tự nhận. Xem 🧠 → Quyền giao việc.
          </span>
        )}
      </label>
      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Cột
        <div className="chips" style={{ marginTop: 6 }}>
          {COLUMNS.map((c) => (
            <button key={c.id} className={`chip${task.col === c.id ? ' on' : ''}`} onClick={() => c.id !== task.col && game.moveTask(task.id, c.id, Math.max(0, ...Object.values(getState().tasks).filter((x) => x.col === c.id).map((x) => x.ord)) + 1)}>
              {c.label}
            </button>
          ))}
        </div>
      </label>
      <div style={{ display: 'grid', gap: 8, marginTop: 'auto' }}>
        {!isMine && (
          <button className="btn" onClick={() => me && game.updateTask(task.id, { assignee: me.id })}>
            🙋 Nhận việc này
          </button>
        )}
        <button className="btn primary" onClick={() => game.focusTask(focused ? null : task.id)}>
          {focused ? '⏸️ Bỏ đánh dấu đang làm' : '🔨 Đặt làm việc tôi đang làm'}
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Xoá việc “${task.title}”?`)) {
              game.deleteTask(task.id);
              onClose();
            }
          }}
        >
          🗑️ Xoá
        </button>
      </div>
    </div>
  );
}
