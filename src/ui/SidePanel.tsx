import { useEffect, useMemo, useRef, useState } from 'react';
import { ZONE_BY_ID } from '../../shared/map';
import { STATUS_META, type ChatMsg } from '../../shared/protocol';
import { game } from '../game';
import { savePref } from '../profile';
import { getState, serverNow, setState, useStore, type SidePanel as Panel } from '../store';
import { AvatarDot, fmtClock, fmtDuration, fmtTime, timeAgo } from './common';

export function SidePanel() {
  const panel = useStore((s) => s.panel);
  const set = (p: Panel) => {
    savePref('panel2', p);
    setState({ panel: p, ...(p === 'chat' ? { unread: 0 } : {}) });
  };
  return (
    <div className="side glass">
      <div className="side-tabs">
        <button className={panel === 'chat' ? 'on' : ''} onClick={() => set('chat')}>
          💬 Chat
        </button>
        <button className={panel === 'people' ? 'on' : ''} onClick={() => set('people')}>
          👥 Mọi người
        </button>
        <button className={panel === 'today' ? 'on' : ''} onClick={() => set('today')}>
          📊 Hôm nay
        </button>
        <button className="x" onClick={() => set(null)} title="Đóng">
          ✕
        </button>
      </div>
      <div className="side-body">
        {panel === 'chat' && <Chat />}
        {panel === 'people' && <People />}
        {panel === 'today' && <Today />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ chat
function Chat() {
  const chat = useStore((s) => s.chat);
  const tab = useStore((s) => s.chatTab);
  const zone = useStore((s) => s.me?.zone ?? '');
  const meId = useStore((s) => s.me?.id);
  const myName = useStore((s) => s.me?.name ?? '');
  const players = useStore((s) => s.players);
  const team = useStore((s) => s.team);
  const draft = useStore((s) => s.chatDraft);
  const listRef = useRef<HTMLDivElement>(null);
  const zoneName = ZONE_BY_ID.get(zone)?.name ?? 'Khu vực';

  const msgs = useMemo(() => chat.filter((m) => (tab === 'global' ? m.ch === 'global' : m.ch === `zone:${zone}`)), [chat, tab, zone]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, tab]);
  useEffect(() => {
    setState({ unread: 0 });
  }, [chat.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = getState().chatDraft.trim();
    if (!text) return;
    game.sendChat(text, tab);
    setState({ chatDraft: '' });
  };

  const avatarOf = (id: string) => players[id]?.avatar ?? team[id]?.avatar ?? (id === meId ? getState().me?.avatar : undefined);

  return (
    <>
      <div className="chat-sub">
        <button className={`chip${tab === 'global' ? ' on' : ''}`} onClick={() => setState({ chatTab: 'global' })}>
          🌏 Cả văn phòng
        </button>
        <button className={`chip${tab === 'zone' ? ' on' : ''}`} onClick={() => setState({ chatTab: 'zone' })}>
          📍 {zoneName}
        </button>
      </div>
      <div className="chat-list scroll" ref={listRef}>
        {!msgs.length && (
          <div className="empty">{tab === 'global' ? 'Chưa có tin nhắn nào. Chào cả nhà một câu đi! 👋' : `Tin nhắn ở đây chỉ những người đang ở “${zoneName}” thấy.`}</div>
        )}
        {msgs.map((m) => (
          <Message key={m.id} m={m} myName={myName} avatar={avatarOf(m.from)} />
        ))}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          className="input"
          maxLength={500}
          value={draft}
          placeholder={tab === 'global' ? 'Nhắn cả văn phòng… (@tên để gọi)' : `Nhắn trong ${zoneName}…`}
          onChange={(e) => setState({ chatDraft: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
        />
        <button className="btn primary" style={{ padding: '10px 14px' }}>
          ➤
        </button>
      </form>
    </>
  );
}

function Message({ m, myName, avatar }: { m: ChatMsg; myName: string; avatar?: Parameters<typeof AvatarDot>[0]['avatar'] }) {
  if (m.from === 'system')
    return (
      <div className="msg system">
        <span className="pill">{m.text}</span>
      </div>
    );
  const parts = m.text.split(/(@[\p{L}\p{N}_.-]+)/u);
  return (
    <div className="msg">
      <AvatarDot name={m.name} avatar={avatar} />
      <div style={{ minWidth: 0 }}>
        <div className="msg-head">
          {m.name}
          <time>{fmtTime(m.ts)}</time>
        </div>
        <div className="msg-text">
          {parts.map((p, i) =>
            p.startsWith('@') ? (
              <span key={i} className={isMe(p, myName) ? 'mention' : undefined} style={isMe(p, myName) ? undefined : { color: '#4060e0', fontWeight: 600 }}>
                {p}
              </span>
            ) : (
              p
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function isMe(tag: string, name: string) {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = n(tag.slice(1));
  const parts = n(name).split(/\s+/);
  return t === 'all' || t === 'team' || parts.includes(t) || n(name).replace(/\s+/g, '') === t;
}

// ------------------------------------------------------------------ people
function People() {
  const me = useStore((s) => s.me);
  const players = useStore((s) => s.players);
  const team = useStore((s) => s.team);
  const tasks = useStore((s) => s.tasks);
  const [q, setQ] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const match = (name: string) => !q || norm(name).includes(norm(q));
  const online = Object.values(players).filter((p) => match(p.name)).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const offline = Object.values(team)
    .filter((t) => !players[t.id] && t.id !== me?.id && match(t.name))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  return (
    <>
      <div style={{ padding: '10px 12px 0' }}>
        <input className="input" style={{ padding: '8px 12px' }} placeholder="Tìm đồng nghiệp…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="people-list scroll">
        <div className="section-title">Đang online · {online.length + (me ? 1 : 0)}</div>
        {me && match(me.name) && (
          <div className="person">
            <AvatarDot name={me.name} avatar={me.avatar} />
            <div className="info">
              <div className="name">
                {me.name} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(bạn)</span>
              </div>
              <div className="meta">
                {STATUS_META[me.status].emoji} {STATUS_META[me.status].label} · {ZONE_BY_ID.get(me.zone)?.name}
              </div>
            </div>
          </div>
        )}
        {online.map((p) => (
          <div className="person" key={p.id}>
            <AvatarDot name={p.name} avatar={p.avatar} />
            <div className="info">
              <div className="name">
                {p.name}
                {p.media.mic && <span title="Đang bật mic">🎙️</span>}
                {p.pomo && <span className="muted" style={{ fontSize: 11.5, fontWeight: 500 }}>🍅 {fmtClock(p.pomo.endsAt - serverNow())}</span>}
              </div>
              <div className="meta">
                {STATUS_META[p.status].emoji} {p.statusText || STATUS_META[p.status].label} · {ZONE_BY_ID.get(p.zone)?.name}
              </div>
              {p.taskId && tasks[p.taskId] && <div className="meta">🔨 {tasks[p.taskId].title}</div>}
            </div>
            <div className="actions">
              <button title="Vẫy tay" onClick={() => game.wave(p.id)}>
                👋
              </button>
              <button title="Đi tới" onClick={() => game.goToPlayer(p.id)}>
                🚶
              </button>
            </div>
          </div>
        ))}
        {offline.length > 0 && <div className="section-title">Offline · {offline.length}</div>}
        {offline.map((t) => (
          <div className="person offline" key={t.id}>
            <AvatarDot name={t.name} avatar={t.avatar} />
            <div className="info">
              <div className="name">{t.name}</div>
              <div className="meta">
                {t.today?.checkIn ? `Check-in ${fmtTime(t.today.checkIn)} · ` : ''}Hoạt động {timeAgo(t.lastSeen)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ today
function Today() {
  const today = useStore((s) => s.today);
  const team = useStore((s) => s.team);
  const me = useStore((s) => s.me);
  const tasks = useStore((s) => s.tasks);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const live = today ? today.workMs + (today.activeSince ? Math.max(0, serverNow() - today.activeSince) : 0) : 0;
  const myDoing = Object.values(tasks).filter((t) => t.assignee === me?.id && t.col !== 'done');
  const rows = Object.values(team)
    .map((t) => (t.id === me?.id && today ? { ...t, today } : t))
    .filter((t) => t.today && (t.today.checkIn || t.today.workMs))
    .sort((a, b) => (a.today!.checkIn ?? Infinity) - (b.today!.checkIn ?? Infinity));

  return (
    <div className="today scroll">
      <div className="stat-grid">
        <div className="stat">
          <div className="k">⏰ Check-in</div>
          <div className="v">{today?.checkIn ? fmtTime(today.checkIn) : '—'}</div>
        </div>
        <div className="stat">
          <div className="k">💻 Giờ làm {today?.activeSince ? '· đang tính' : ''}</div>
          <div className="v">{fmtDuration(live)}</div>
        </div>
        <div className="stat">
          <div className="k">🍅 Pomodoro</div>
          <div className="v">{today?.pomodoros ?? 0}</div>
        </div>
        <div className="stat">
          <div className="k">✅ Việc xong</div>
          <div className="v">{today?.tasksDone ?? 0}</div>
        </div>
      </div>
      {!today?.checkIn && (
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          Ngồi vào một bàn làm việc (hoặc góc tập trung trong Thư viện) để check-in và bắt đầu tính giờ làm.
        </p>
      )}
      <div className="section-title" style={{ padding: '18px 0 4px' }}>
        Việc của tôi · {myDoing.length}
      </div>
      {myDoing.length === 0 && <div className="muted" style={{ fontSize: 13.5 }}>Chưa có việc nào được giao cho bạn.</div>}
      {myDoing.slice(0, 8).map((t) => (
        <div key={t.id} className="person" style={{ padding: '6px 4px' }}>
          <div className="info">
            <div className="name" style={{ fontWeight: 500 }}>
              {me?.taskId === t.id ? '🔨 ' : ''}
              {t.title}
            </div>
            <div className="meta">{t.col.toUpperCase()}</div>
          </div>
          {me?.taskId !== t.id && (
            <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => game.focusTask(t.id)}>
              Làm việc này
            </button>
          )}
        </div>
      ))}
      <div className="section-title" style={{ padding: '18px 0 4px' }}>
        Team hôm nay
      </div>
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 13.5 }}>Chưa ai check-in hôm nay.</div>
      ) : (
        <table className="team-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Check-in</th>
              <th>Giờ làm</th>
              <th>🍅</th>
              <th>✅</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.today!.checkIn ? fmtTime(t.today!.checkIn) : '—'}</td>
                <td>{fmtDuration(t.id === me?.id ? live : t.today!.workMs + (t.today!.activeSince ? Math.max(0, serverNow() - t.today!.activeSince) : 0))}</td>
                <td>{t.today!.pomodoros}</td>
                <td>{t.today!.tasksDone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
