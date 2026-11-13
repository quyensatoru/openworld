import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_ID, DEPTS, DEPT_BY_ID } from '../../shared/agents';
import { BRAIN_ID, RATE_REASON_MAX, REPORT_PREFIX } from '../../shared/brain';
import { ZONE_BY_ID } from '../../shared/map';
import { STATUS_META, type ChatMsg } from '../../shared/protocol';
import type { ThreadFilter } from '../../shared/threads';
import { game } from '../game';
import { savePref } from '../profile';
import { getState, serverNow, setState, useStore, type SidePanel as Panel } from '../store';
import { AvatarDot, fmtClock, fmtDay, fmtDuration, fmtTime, timeAgo } from './common';

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
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** The handle typed after @ for a person: their given name (last word) if nobody else shares it. */
function handleFor(name: string, all: string[]): string {
  const last = name.trim().split(/\s+/).pop() ?? name;
  const same = all.filter((n) => norm(n.trim().split(/\s+/).pop() ?? '') === norm(last)).length;
  return same > 1 ? name.replace(/\s+/g, '') : last;
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const [fresh, setFresh] = useState(0);
  const [pick, setPick] = useState(0);
  const [caret, setCaret] = useState(0);
  const thread = useStore((s) => s.chatThread);
  const finding = useStore((s) => s.chatTab === 'ask' && !!s.threadFind);
  const zoneName = ZONE_BY_ID.get(zone)?.name ?? 'Khu vực';

  // Two channels: your own with the AI staff, and whoever is standing near you. The office's own
  // announcements (a task finished, someone put a film on) show up wherever you are.
  const all = useMemo(
    () => chat.filter((m) => (tab === 'ask' ? m.ch === `ask:${meId}` : m.ch === `zone:${zone}` || ((m.ch === 'global' || m.ch === 'work') && m.from === 'system'))),
    [chat, tab, zone, meId],
  );
  // One piece of work = one thread. The channel shows the openers; the replies live inside.
  const replies = useMemo(() => {
    const by = new Map<string, ChatMsg[]>();
    for (const m of all) if (m.root) by.set(m.root, [...(by.get(m.root) ?? []), m]);
    return by;
  }, [all]);
  const openThread = thread && tab === 'ask' ? all.find((m) => m.id === thread) ?? null : null;
  const msgs = useMemo(
    () => (openThread ? [openThread, ...(replies.get(openThread.id) ?? [])] : all.filter((m) => !m.root)),
    [all, replies, openThread],
  );
  const lastId = msgs[msgs.length - 1]?.id;
  const toBottom = (smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setFresh(0);
    stick.current = true;
  };
  // open / switch tab → the newest messages
  useEffect(() => {
    toBottom();
  }, [tab, thread]); // eslint-disable-line react-hooks/exhaustive-deps
  // a new message: follow it (unless you scrolled far up to read something — then show a button)
  useEffect(() => {
    if (!lastId) return;
    const mine = msgs[msgs.length - 1]?.from === meId;
    if (stick.current || mine) requestAnimationFrame(() => toBottom());
    else setFresh((n) => n + 1);
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setState({ unread: 0 });
  }, [chat.length]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (stick.current && fresh) setFresh(0);
  };

  // @mentions. In "Văn phòng của bạn" only who can take work is offered — Tổng quản, the departments
  // and the AI employees in the office (real people there only made the list noisy). Every other
  // channel tags people as usual.
  const officeTab = tab === 'ask';
  const people = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; online: boolean }>();
    for (const p of Object.values(players)) seen.set(p.id, { id: p.id, name: p.name, online: true });
    for (const t of Object.values(team)) if (!seen.has(t.id) && t.id !== meId) seen.set(t.id, { id: t.id, name: t.name, online: false });
    return [...seen.values()];
  }, [players, team, meId]);
  const staff = useMemo(
    () =>
      people
        .filter((p) => AGENT_ID.test(p.id))
        .sort((a, b) => Number(b.id === BRAIN_ID) - Number(a.id === BRAIN_ID) || a.name.localeCompare(b.name, 'vi')),
    [people],
  );
  const before = draft.slice(0, caret);
  const at = before.match(/(^|\s)@([\p{L}\p{N}_.-]*)$/u);
  const query = at ? norm(at[2]) : null;
  const named = (p: { name: string }) => !query || norm(p.name).split(/\s+/).some((w) => w.startsWith(query)) || norm(p.name).replace(/\s+/g, '').startsWith(query);
  const depts = (all: boolean) =>
    // with nothing typed yet, the office tab lists every department; elsewhere only one that matches
    DEPTS.filter((d) => (query ? d.alias.some((a) => a.startsWith(query)) || norm(d.name).startsWith(query) : all)).map((d) => ({
      id: `@${d.id}`,
      name: `Phòng ${d.name}`,
      icon: d.icon,
      online: true,
      handle: d.alias[0],
    }));
  const allNames = people.map((p) => p.name);
  const options =
    query == null
      ? []
      : officeTab
        ? [
            ...staff.filter(named).map((p) => ({ ...p, icon: '', handle: p.id === BRAIN_ID ? 'tongquan' : p.name.replace(/\s+/g, '') })),
            // departments: Tổng quản hands the message to whoever on that team is on call
            ...depts(true),
          ].slice(0, 8)
        : [
            ...(norm('all').startsWith(query) || norm('team').startsWith(query) || norm('ca team').startsWith(query) ? [{ id: '@all', name: 'Cả team', icon: '📣', online: true, handle: 'all' }] : []),
            ...depts(false),
            ...people
              .filter(named)
              .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'vi'))
              .map((p) => ({ ...p, icon: '', handle: handleFor(p.name, allNames) })),
          ].slice(0, 7);
  const showMentions = options.length > 0;
  const choose = (handle: string) => {
    if (!at) return;
    const start = before.length - at[2].length - 1;
    const next = `${draft.slice(0, start)}@${handle} ${draft.slice(caret)}`;
    setState({ chatDraft: next });
    const pos = start + handle.length + 2;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
    setPick(0);
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (showMentions) return choose(options[Math.min(pick, options.length - 1)].handle);
    const text = getState().chatDraft.trim();
    if (!text) return;
    game.sendChat(text, tab, openThread?.id);
    setState({ chatDraft: '' });
    setCaret(0);
  };

  // a template fills the box (nothing is sent): the first [ … ] is selected, so typing replaces it
  const fillTemplate = (text: string) => {
    setState({ chatDraft: text });
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const a = text.indexOf('[');
      const b = text.indexOf(']', a);
      if (a >= 0 && b > a) el.setSelectionRange(a, b + 1);
      else el.setSelectionRange(text.length, text.length);
      setCaret(el.selectionStart ?? text.length);
    });
  };

  const avatarOf = (id: string) => players[id]?.avatar ?? team[id]?.avatar ?? (id === meId ? getState().me?.avatar : undefined);

  return (
    <>
      <div className="chat-sub">
        <button className={`chip${tab === 'ask' ? ' on' : ''}`} onClick={() => setState({ chatTab: 'ask', chatThread: null })} title="Chỉ bạn và các nhân viên đang làm việc cho bạn thấy kênh này. Mỗi việc là một thread.">
          🏢 Văn phòng của bạn
        </button>
        <button className={`chip${tab === 'zone' ? ' on' : ''}`} onClick={() => setState({ chatTab: 'zone', chatThread: null, threadFind: null })}>
          📍 {zoneName}
        </button>
        {officeTab && (
          <button
            className={`chip tf-toggle${finding ? ' on' : ''}`}
            onClick={() => setState({ threadFind: finding ? null : { q: '', filter: 'all', hits: null }, chatThread: null })}
            title="Tìm lại việc cũ theo tên việc hoặc 📋 Kết quả"
            aria-label="Tìm việc cũ"
          >
            🔎 Tìm việc
          </button>
        )}
      </div>
      {finding && <ThreadSearch />}
      {!finding && openThread && (
        <button className="chat-thread-head" onClick={() => setState({ chatThread: null })}>
          ← Quay lại · <b>{openThread.name}</b>: {openThread.text.slice(0, 48)}
          {openThread.text.length > 48 ? '…' : ''}
        </button>
      )}
      <div className="chat-wrap" hidden={finding}>
        <div className="chat-list scroll" ref={listRef} onScroll={onScroll}>
          {!msgs.length && (
            <div className="empty">
              {tab === 'ask'
                ? 'Luồng riêng của bạn với 🧠 Tổng quản và các nhân viên đang làm việc cho bạn. Cứ nói việc bạn cần — Tổng quản tự chọn phòng ban, chia việc và trả lời bạn ngay đây. Không ai khác thấy luồng này.'
                : `Nhắn với những người đang đứng ở “${zoneName}” — đi sang khu khác là sang cuộc trò chuyện khác.`}
            </div>
          )}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            // same person, a few minutes apart → one block (no repeated avatar / name)
            const sameDay = !!prev && new Date(prev.ts).toDateString() === new Date(m.ts).toDateString();
            const cont = !!prev && sameDay && prev.from === m.from && m.from !== 'system' && m.ts - prev.ts < 3 * 60_000;
            const day = sameDay ? null : <div className="chat-day" key={`d${m.id}`}><span>{fmtDay(m.ts)}</span></div>;
            // the same system line over and over → shown once with a counter
            if (m.from === 'system' && msgs[i + 1]?.from === 'system' && msgs[i + 1].text === m.text) return null;
            let repeat = 1;
            if (m.from === 'system') for (let j = i - 1; j >= 0 && msgs[j].from === 'system' && msgs[j].text === m.text; j--) repeat++;
            const kids = openThread ? [] : replies.get(m.id) ?? [];
            return (
              <Fragment key={m.id}>
                {day}
                <Message m={m} myName={myName} avatar={avatarOf(m.from)} cont={cont} repeat={repeat} />
                {!!kids.length && (
                  <button className="chat-replies" onClick={() => setState({ chatThread: m.id })}>
                    <span className="cr-faces">
                      {[...new Map(kids.map((k) => [k.from, k])).values()].slice(0, 4).map((k) => (
                        <AvatarDot key={k.from} name={k.name} avatar={avatarOf(k.from)} size={20} />
                      ))}
                    </span>
                    {kids.length} tin trong việc này
                    <time>{timeAgo(kids[kids.length - 1].ts)}</time>
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
        {fresh > 0 && (
          <button className="chat-new" onClick={() => toBottom(true)}>
            ↓ {fresh} tin nhắn mới
          </button>
        )}
      </div>
      {officeTab && !finding && !openThread && !draft.trim() && (
        <div className="ask-templates" aria-label="Mẫu giao việc">
          {ASK_TEMPLATES.map((t) => (
            <button key={t.label} type="button" className="chip" onClick={() => fillTemplate(t.text)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <form className="chat-input" onSubmit={send} hidden={finding}>
        {showMentions && (
          <div className="mention-pop">
            <div className="mp-title">{officeTab ? 'Gọi nhân viên / phòng ban' : 'Gọi tên'}</div>
            {options.map((o, i) => (
              <button
                type="button"
                key={o.id}
                className={i === pick ? 'on' : ''}
                onMouseEnter={() => setPick(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.handle);
                }}
              >
                {o.id.startsWith('@') ? <span className="mp-all">{o.icon}</span> : <AvatarDot name={o.name} avatar={avatarOf(o.id)} size={24} />}
                <span className="mp-name">{o.name}</span>
                <span className="mp-handle">@{o.handle}</span>
                {!o.id.startsWith('@') && <span className={`mp-dot${o.online ? ' on' : ''}`} />}
              </button>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          className="input"
          maxLength={500}
          value={draft}
          placeholder={openThread ? 'Trả lời trong việc này…' : tab === 'ask' ? 'Cần gì cứ nói với Tổng quản…' : `Nhắn với người ở ${zoneName}…`}
          onChange={(e) => {
            setState({ chatDraft: e.target.value });
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setPick(0);
          }}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (showMentions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
            } else if (showMentions && e.key === 'Tab') {
              e.preventDefault();
              choose(options[Math.min(pick, options.length - 1)].handle);
            } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        <button className="btn primary chat-send" title="Gửi (Enter)">
          ➤
        </button>
      </form>
    </>
  );
}

const FIND_FILTERS: { id: ThreadFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'running', label: '⏳ Đang chạy' },
  { id: 'done', label: '✅ Đã xong' },
];

/** Finding an old piece of work in "Văn phòng của bạn": words from its request, a card's title or its
 *  📋 report, and whether it still runs. The server looks through everything the channel keeps;
 *  opening a hit loads that thread whole. */
function ThreadSearch() {
  const f = useStore((s) => s.threadFind)!;
  const [q, setQ] = useState(f.q);
  const filter = f.filter;
  // a short pause after the last keystroke, then one search (the filter chips search at once)
  useEffect(() => {
    const t = setTimeout(() => game.findThreads(q.trim(), filter), q.trim() === f.q ? 0 : 250);
    return () => clearTimeout(t);
  }, [q, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = f.hits;
  return (
    <div className="thread-find">
      <form className="tf-bar" role="search" onSubmit={(e) => (e.preventDefault(), game.findThreads(q.trim(), filter))}>
        <input className="input" type="search" enterKeyHint="search" autoFocus value={q} maxLength={80} placeholder="Tìm theo tên việc hoặc 📋 Kết quả…" onChange={(e) => setQ(e.target.value)} aria-label="Từ khoá" />
        <button type="button" className="btn" onClick={() => setState({ threadFind: null })}>
          Đóng
        </button>
      </form>
      <div className="tf-filters">
        {FIND_FILTERS.map((x) => (
          <button key={x.id} type="button" className={`chip${filter === x.id ? ' on' : ''}`} aria-pressed={filter === x.id} onClick={() => setState({ threadFind: { ...f, filter: x.id, hits: null } })}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="tf-list scroll">
        {hits === null ? (
          <div className="empty">Đang tìm…</div>
        ) : !hits.length ? (
          <div className="empty">{q.trim() ? `Không có việc nào khớp “${q.trim()}”.` : 'Chưa có việc nào ở đây.'}</div>
        ) : (
          hits.map((h) => (
            <button key={h.root} type="button" className="tf-hit" onClick={() => game.openThread(h.root)}>
              <span className="tf-top">
                <span className={`tf-state${h.running ? ' run' : ''}`}>{h.running ? '⏳ Đang chạy' : '✅ Đã xong'}</span>
                <time>{timeAgo(h.last)}</time>
              </span>
              <b className="tf-text">{h.text}</b>
              {!!h.titles.length && <small className="tf-cards">📌 {h.titles.join(' · ')}</small>}
              {h.report && <small className="tf-report">{h.report}</small>}
              <small className="muted">
                {h.name} · {fmtDay(h.ts)} · {h.replies} tin
              </small>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Ready-made requests for Tổng quản: tap one, fill in the [ … ] parts, send. */
const ASK_TEMPLATES = [
  { label: '🐞 Sửa lỗi', text: 'Sửa lỗi: [lỗi gì] — gặp khi [làm gì thì bị]. Dự án: [tên dự án]' },
  { label: '✨ Tính năng mới', text: 'Làm tính năng: [mô tả]. Xong khi: [tiêu chí]. Dự án: [tên dự án]' },
  { label: '🔎 Rà soát', text: 'Rà soát [phần nào] của [tên dự án], liệt kê vấn đề và đề xuất cải tiến theo thứ tự ưu tiên' },
  { label: '🚀 Deploy', text: 'Kiểm tra rồi deploy [tên dự án] lên production, báo lại phiên bản để quay lại nếu cần' },
];

function Message({ m, myName, avatar, cont, repeat }: { m: ChatMsg; myName: string; avatar?: Parameters<typeof AvatarDot>[0]['avatar']; cont: boolean; repeat: number }) {
  if (m.from === 'system')
    return (
      <div className="msg system">
        <span className="pill">
          {m.text}
          {repeat > 1 && <b className="rep"> ×{repeat}</b>}
        </span>
      </div>
    );
  // light formatting for messages written by Claude: `code`, **bold** marks dropped, line breaks kept
  const parts = m.text.replace(/\*\*([^*]+)\*\*/g, '$1').split(/(@[\p{L}\p{N}_.-]+|`[^`\n]+`)/u);
  return (
    <div className={`msg${cont ? ' cont' : ''}`}>
      {cont ? <span className="msg-gap" /> : <AvatarDot name={m.name} avatar={avatar} />}
      <div style={{ minWidth: 0 }}>
        {!cont && (
          <div className="msg-head">
            {m.name}
            {m.meet && <span className="msg-meet">📅 họp</span>}
            <time>{fmtTime(m.ts)}</time>
          </div>
        )}
        <div className="msg-text">
          {parts.map((p, i) =>
            p.length > 2 && p.startsWith('`') && p.endsWith('`') ? (
              <code key={i} className="msg-code">
                {p.slice(1, -1)}
              </code>
            ) : p.startsWith('@') ? (
              <span key={i} className={isMe(p, myName) ? 'mention' : 'tagged'}>
                {p}
              </span>
            ) : (
              p
            ),
          )}
        </div>
        {m.from === BRAIN_ID && m.ch.startsWith('ask:') && m.text.startsWith(REPORT_PREFIX) && <RateBar m={m} />}
      </div>
    </div>
  );
}

/** 👍 / 👎 under a 📋 report. 👎 asks for a reason (optional) — that is what Tổng quản learns from. */
function RateBar({ m }: { m: ChatMsg }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(m.rate?.reason ?? '');
  const rate = m.rate;
  const down = () => {
    setReason(rate?.reason ?? '');
    setAsking(true);
  };
  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    game.rateReport(m.id, -1, reason.trim());
    setAsking(false);
  };
  return (
    <div className="rate-bar">
      {!asking && (
        <div className="rb-row">
          <button type="button" className={`rb-btn${rate?.v === 1 ? ' on' : ''}`} title="Kết quả ổn" aria-pressed={rate?.v === 1} onClick={() => game.rateReport(m.id, 1)}>
            👍
          </button>
          <button type="button" className={`rb-btn${rate?.v === -1 ? ' on' : ''}`} title="Chưa đạt — cho Tổng quản biết vì sao" aria-pressed={rate?.v === -1} onClick={down}>
            👎
          </button>
          <span className="rb-note">
            {rate?.v === 1 ? 'Bạn thấy kết quả ổn' : rate?.v === -1 ? (rate.reason ? `Chưa đạt: ${rate.reason}` : 'Bạn thấy chưa đạt') : 'Kết quả thế nào?'}
          </span>
        </div>
      )}
      {asking && (
        <form className="rb-why" onSubmit={send}>
          <input
            autoFocus
            className="input"
            maxLength={RATE_REASON_MAX}
            placeholder="Chưa đạt ở đâu? (không bắt buộc) — Tổng quản sẽ rút kinh nghiệm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAsking(false))}
          />
          <button className="btn primary" type="submit">
            Gửi 👎
          </button>
          <button className="btn" type="button" onClick={() => setAsking(false)}>
            Huỷ
          </button>
        </form>
      )}
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
  const online = Object.values(players)
    .filter((p) => !p.agent && match(p.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const agents = Object.values(players)
    .filter((p) => p.agent && match(p.name))
    .sort((a, b) => a.agent!.dept.localeCompare(b.agent!.dept) || a.name.localeCompare(b.name, 'vi'));
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
                {STATUS_META[p.status].emoji} {p.statusText || STATUS_META[p.status].label} · {game.phMasked(p.id) ? 'Tầng 6 · đang trốn 🙈' : ZONE_BY_ID.get(p.zone)?.name}
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
        {agents.length > 0 && (
          <div className="section-title">
            🤖 Nhân viên văn phòng · {agents.length}{' '}
            <button style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }} onClick={() => setState({ agentsOpen: true, agentsTab: 'depts' })}>
              xem phòng ban
            </button>
          </div>
        )}
        {agents.map((p) => (
          <div className="person" key={p.id}>
            <AvatarDot name={p.name.replace('🤖 ', '')} avatar={p.avatar} />
            <div className="info">
              <div className="name">{p.name}</div>
              <div className="meta">
                {DEPT_BY_ID.get(p.agent!.dept)?.icon} {DEPT_BY_ID.get(p.agent!.dept)?.name} · {p.agent!.state === 'working' ? p.statusText || 'đang làm' : p.agent!.state === 'waiting' ? 'chờ duyệt' : 'đang rảnh'}
              </div>
            </div>
            <div className="actions">
              <button title="Xem màn hình" onClick={() => setState({ screenOf: p.id })}>
                🖥️
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
