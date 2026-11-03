// Nội Gián UI: the lobby panel (join, settings), your tasks / role while playing, the action buttons
// (kill, report, sabotage), alerts, the meeting + vote card, role reveal, the end screen and the
// fog of war overlay.
import { useEffect, useRef, useState } from 'react';
import { LOCKABLE_ROOMS, MOLE_MAX, MOLE_MIN, ROOM_META, STATION_BY_ID, TASK_META, VENT_BY_ID, molesFor, ventLinks, type MoleView } from '../../shared/mole';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';
import { AvatarDot } from './common';

function useTick(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
const onF5 = (zone: string | undefined) => !!zone && zone.startsWith('f5-');
const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
const mmss = (ms: number) => {
  const s = secs(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ the panel
export function MolePanel() {
  const v = useStore((s) => s.mole);
  const zone = useStore((s) => s.me?.zone);
  const open = useStore((s) => s.molePanel);
  useTick(500);
  if (!v || (!onF5(zone) && !v.me.inGame)) return null;
  if (!open)
    return (
      <button className="mole-pill" onClick={() => setState({ molePanel: true })}>
        🕵️ {v.phase === 'lobby' ? `Nội Gián · ${v.joined.length} người` : v.me.inGame ? 'Nhiệm vụ của bạn' : 'Nội Gián đang chơi'}
      </button>
    );
  return (
    <div className="mole-panel">
      <div className="mp-head">
        <b>🕵️ Nội Gián</b>
        <button className="mp-x" onClick={() => setState({ molePanel: false })} title="Thu gọn">
          —
        </button>
      </div>
      <div className="mp-body">{v.phase === 'lobby' || v.phase === 'starting' ? <Lobby v={v} /> : <InGame v={v} />}</div>
    </div>
  );
}

function Lobby({ v }: { v: MoleView }) {
  const me = useStore((s) => s.me?.id ?? '');
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  const joined = v.joined.some((j) => j.id === me);
  const isHost = v.host === me;
  const [cfg, setCfg] = useState(false);
  const [rules, setRules] = useState(false);
  const n = v.joined.length;
  return (
    <div className="mp-lobby">
      <div className="mp-count">
        <b>{n}</b>/{MOLE_MAX} người · cần ít nhất {MOLE_MIN}
      </div>
      <div className="mp-chips">
        {v.joined.map((j) => (
          <span key={j.id} className={`wp-chip${j.id === v.host ? ' host' : ''}`}>
            <AvatarDot name={j.name} avatar={j.id === me ? myAvatar : players[j.id]?.avatar} size={22} />
            {j.name}
            {j.id === v.host && <em>👑</em>}
          </span>
        ))}
        {!n && <span className="mp-dim">Chưa ai tham gia.</span>}
      </div>
      {v.phase === 'starting' ? (
        <div className="mp-starting">🕵️ Bắt đầu sau {secs(v.until - serverNow())} giây…</div>
      ) : joined ? (
        <div className="mp-row2">
          {isHost ? (
            <button className="btn mp-start" disabled={n < MOLE_MIN} onClick={() => game.mole({ a: 'start' })}>
              ▶ Bắt đầu ({n} người · {molesFor(Math.max(MOLE_MIN, n), v.settings)} nội gián)
            </button>
          ) : (
            <div className="mp-wait">Chờ {v.joined.find((j) => j.id === v.host)?.name ?? 'chủ phòng'} bắt đầu…</div>
          )}
          <button className="btn" onClick={() => game.mole({ a: 'leave' })}>
            Rời
          </button>
        </div>
      ) : (
        <button className="btn mp-start" onClick={() => game.mole({ a: 'join' })}>
          🙋 Tham gia ván
        </button>
      )}
      <div className="wp-links">
        {isHost && (
          <button className="wp-link" onClick={() => setCfg(!cfg)}>
            {cfg ? '▾' : '▸'} ⚙️ Tuỳ chỉnh
          </button>
        )}
        <button className="wp-link" onClick={() => setRules(!rules)}>
          {rules ? '▾' : '▸'} 📖 Cách chơi
        </button>
      </div>
      {cfg && isHost && <Settings v={v} />}
      {rules && <Rules />}
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onPick }: { value: T; options: [T, string][]; onPick(v: T): void }) {
  return (
    <div className="wp-seg">
      {options.map(([k, label]) => (
        <button key={String(k)} className={value === k ? 'on' : ''} onClick={() => onPick(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Settings({ v }: { v: MoleView }) {
  const s = v.settings;
  const set = (p: Partial<typeof s>) => game.mole({ a: 'settings', s: p });
  return (
    <div className="wp-settings">
      <div className="wp-row">
        <span>🕵️ Nội gián</span>
        <Seg value={s.moles} options={[[0, 'Tự động'], [1, '1'], [2, '2'], [3, '3']]} onPick={(x) => set({ moles: x })} />
      </div>
      <div className="wp-row">
        <span>⏳ Hồi chiêu</span>
        <Seg value={s.killCd} options={[[20, '20s'], [30, '30s'], [45, '45s']]} onPick={(x) => set({ killCd: x })} />
      </div>
      <div className="wp-row">
        <span>📋 Nhiệm vụ</span>
        <Seg value={s.tasks} options={[[3, '3'], [4, '4'], [5, '5'], [6, '6']]} onPick={(x) => set({ tasks: x })} />
      </div>
      <div className="wp-row">
        <span>⏰ Deadline</span>
        <Seg value={s.minutes} options={[[0, 'Không'], [7, '7p'], [10, '10p'], [15, '15p']]} onPick={(x) => set({ minutes: x })} />
      </div>
      <div className="wp-row">
        <span>📊 Tiến độ</span>
        <Seg value={s.taskBar} options={[['live', 'Liên tục'], ['meetings', 'Chỉ khi họp']]} onPick={(x) => set({ taskBar: x })} />
      </div>
      <label className="wp-row check">
        <input type="checkbox" checked={s.reveal} onChange={(e) => set({ reveal: e.target.checked })} /> Cho biết người bị trục xuất có phải nội gián không
      </label>
    </div>
  );
}

function Rules() {
  return (
    <div className="wp-rules">
      <p>
        <b>👔 Nhân viên</b> chạy giữa các phòng làm nhiệm vụ (vòng vàng trên sàn). Thanh tiến độ đầy, hoặc lôi ra hết nội gián là thắng.
      </p>
      <p>
        <b>🕵️ Nội gián</b> giả vờ làm việc, lén giết đồng nghiệp khi đứng sát (Q), cúp điện, khoá cửa, gây quá tải server. Thắng khi số nội gián bằng số nhân viên còn lại.
      </p>
      <p>
        <b>📣 Họp</b>: thấy xác thì báo cáo (R), hoặc bấm chuông giữa Phòng Họp (mỗi người 1 lần). Cả tầng nghe nhau qua mic, rồi bỏ phiếu — phiếu hoà hoặc bỏ qua nhiều thì không ai bị loại.
      </p>
      <p>
        <b>👻 Hồn ma</b> vẫn làm nhiệm vụ giúp đội, nghe được mọi người nhưng chỉ nói chuyện được với hồn ma.
      </p>
      <p>
        <b>🚨 Sự cố server</b>: hai người phải cùng giữ hai bảng điều khiển (Phòng Server và Kho Hồ Sơ) trước khi hết giờ.
      </p>
      <p>
        <b>🩺 Khám sức khoẻ</b> hiện cột sáng xanh cho người xung quanh thấy — nội gián làm giả thì không có. Bằng chứng ngoại phạm tốt nhất!
      </p>
    </div>
  );
}

function InGame({ v }: { v: MoleView }) {
  const me = v.me;
  if (!me.inGame)
    return (
      <div className="mp-dim">
        👀 Ván đang diễn ra ({v.players.filter((p) => p.alive).length}/{v.players.length} người còn lại). Bạn có thể đứng xem — hoặc chờ ván sau.
      </div>
    );
  const mates = me.mates.map((id) => v.players.find((p) => p.id === id)?.name).filter(Boolean);
  const mole = me.role === 'mole';
  return (
    <div className="mp-game">
      <div className={`mp-role ${mole ? 'mole' : 'crew'}${me.alive ? '' : ' dead'}`}>
        <span>{mole ? '🕵️' : '👔'}</span>
        <div>
          <b>{mole ? 'Nội gián' : 'Nhân viên'}</b>
          {!me.alive && <em> · đã bị loại 👻</em>}
          <small>{mole ? (mates.length ? `Đồng bọn: ${mates.join(', ')}` : 'Bạn chỉ có một mình') : 'Làm xong việc, tìm ra nội gián'}</small>
        </div>
      </div>
      <div className="mp-label">{mole ? 'Việc giả (để trà trộn)' : 'Nhiệm vụ của bạn'}</div>
      <ul className="mp-tasks">
        {me.tasks.map((t) => {
          const st = STATION_BY_ID.get(t.st);
          if (!st || !TASK_META[t.kind]) return null;
          return (
            <li key={t.st} className={t.done ? 'done' : ''}>
              <span>{TASK_META[t.kind].emoji}</span>
              <div>
                <b>{TASK_META[t.kind].name}</b>
                <small>{ROOM_META[st.room].name}</small>
              </div>
              {t.done && <em>✓</em>}
            </li>
          );
        })}
      </ul>
      {v.host === useStore.getState().me?.id && v.phase !== 'end' && (
        <button className="wp-link danger" onClick={() => confirm('Dừng ván Nội Gián này?') && game.mole({ a: 'abort' })}>
          ⛔ Dừng ván
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ HUD while playing
export function MoleHud() {
  const v = useStore((s) => s.mole);
  useTick(250);
  if (!v || !v.me.inGame || (v.phase !== 'play' && v.phase !== 'meeting' && v.phase !== 'vote' && v.phase !== 'result')) return null;
  const now = serverNow();
  const deadline = v.settings.minutes ? (v.phase === 'play' ? v.deadlineLeft - (now - v.deadlineAt) : v.deadlineLeft) : 0;
  const lights = v.lights > now;
  const crit = v.crit > now;
  return (
    <div className="mole-hud">
      <div className="mh-bar">
        <span>📊 Tiến độ dự án</span>
        <div className="mh-track">
          <i style={{ width: `${v.progress * 100}%` }} />
        </div>
        <b>{Math.round(v.progress * 100)}%</b>
        {v.settings.minutes > 0 && <span className={`mh-dl${deadline < 60_000 ? ' hot' : ''}`}>⏰ {mmss(deadline)}</span>}
      </div>
      {v.phase === 'play' && crit && (
        <div className="mh-alert crit">
          🚨 SERVER QUÁ TẢI · {secs(v.crit - now)}s — 2 người giữ 2 bảng điều khiển ở Phòng Server & Kho Hồ Sơ!
        </div>
      )}
      {v.phase === 'play' && lights && v.me.role === 'crew' && <div className="mh-alert">💡 Mất điện — sửa hộp cầu dao ở Phòng Server</div>}
      {v.phase === 'play' && v.locks.some((l) => l.until > now) && <div className="mh-alert lock">🔒 Có cửa đang bị khoá</div>}
    </div>
  );
}

/** Big action buttons + Q / R shortcuts. */
export function MoleActions() {
  const v = useStore((s) => s.mole);
  const zone = useStore((s) => s.me?.zone);
  const [sab, setSab] = useState(false);
  useTick(200);
  const target = game.moleTarget();
  const body = game.moleBody();
  const vent = game.moleVentNear();
  const ref = useRef({ target, body });
  ref.current = { target, body };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const s = useStoreGet();
      if (!s?.me.inGame || s.phase !== 'play' || useStore.getState().moleTask) return;
      if (e.code === 'KeyQ' && ref.current.target && s.me.killReady <= serverNow()) game.mole({ a: 'kill', target: ref.current.target });
      if (e.code === 'KeyR' && ref.current.body) game.mole({ a: 'report', body: ref.current.body });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (!v || !v.me.inGame || v.phase !== 'play' || !onF5(zone)) return null;
  const now = serverNow();
  const mole = v.me.role === 'mole';
  const killIn = v.me.killReady - now;
  const sabIn = v.me.sabReady - now;
  return (
    <div className="mole-actions">
      {body && (
        <button className="ma-btn report" onClick={() => game.mole({ a: 'report', body })}>
          📣<span>Báo cáo</span>
          <kbd>R</kbd>
        </button>
      )}
      {vent && (
        <button className="ma-btn vent" onClick={() => game.mole({ a: 'vent', vent })}>
          🕳️<span>Chui ống</span>
          <kbd>E</kbd>
        </button>
      )}
      {mole && v.me.alive && !v.me.vent && (
        <button className={`ma-btn kill${target && killIn <= 0 ? ' ready' : ''}`} disabled={!target || killIn > 0} onClick={() => target && game.mole({ a: 'kill', target })}>
          🔪<span>{killIn > 0 ? `${secs(killIn)}s` : 'Giết'}</span>
          <kbd>Q</kbd>
        </button>
      )}
      {mole && (
        <div className="ma-sab">
          <button className="ma-btn sab" disabled={sabIn > 0} onClick={() => setSab(!sab)}>
            ⚡<span>{sabIn > 0 ? `${secs(sabIn)}s` : 'Phá hoại'}</span>
          </button>
          {sab && sabIn <= 0 && (
            <div className="ma-menu">
              <button onClick={() => (setSab(false), game.mole({ a: 'sabotage', kind: 'lights' }))}>💡 Cúp điện</button>
              <button onClick={() => (setSab(false), game.mole({ a: 'sabotage', kind: 'crit' }))}>🚨 Quá tải server</button>
              <div className="ma-sub">🔒 Sập cửa, nhốt cả phòng:</div>
              <div className="ma-rooms">
                {LOCKABLE_ROOMS.map((r) => (
                  <button key={r} onClick={() => (setSab(false), game.mole({ a: 'sabotage', kind: 'door', room: r }))}>
                    {ROOM_META[r].name.replace(/^Phòng /, '')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const useStoreGet = () => useStore.getState().mole;

/** Inside a duct (moles): where it leads, and the way out. */
export function MoleVent() {
  const v = useStore((s) => s.mole);
  const at = v?.phase === 'play' ? v.me.vent : null;
  const links = at ? ventLinks(at) : [];
  const ref = useRef(links);
  ref.current = links;
  useEffect(() => {
    if (!at) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'KeyE' || e.code === 'Space') {
        e.preventDefault();
        game.mole({ a: 'vent', vent: null });
      }
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (i >= 0 && ref.current[i]) game.mole({ a: 'vent', vent: ref.current[i].id });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [at]);
  if (!at) return null;
  const here = VENT_BY_ID.get(at);
  return (
    <div className="mole-vent">
      <div className="mv-head">
        🕳️ Đang trốn trong ống kỹ thuật
        <small>{here ? ROOM_META[here.room].name : ''} · không ai nhìn thấy bạn</small>
      </div>
      <div className="mv-links">
        {links.map((l, i) => (
          <button key={l.id} onClick={() => game.mole({ a: 'vent', vent: l.id })}>
            <kbd>{i + 1}</kbd> ➜ {ROOM_META[l.room].name}
          </button>
        ))}
      </div>
      <button className="mv-out" onClick={() => game.mole({ a: 'vent', vent: null })}>
        ⬆️ Chui ra <kbd>E</kbd>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ meeting + vote
export function MoleMeeting() {
  const v = useStore((s) => s.mole);
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  const myId = useStore((s) => s.me?.id);
  useTick(250);
  const splash = useStore((s) => s.moleSplash);
  // (the result is shown by MoleEject)
  if (!v || !v.me.inGame || (v.phase !== 'meeting' && v.phase !== 'vote' && v.phase !== 'result') || v.phase === ('result' as string)) return null;
  if (splash && (splash.kind === 'report' || splash.kind === 'bell') && Date.now() - splash.at < 2600) return null;
  const left = secs(v.until - serverNow());
  const voting = v.phase === 'vote' && v.me.alive && !v.me.vote;
  const tally = new Map<string, string[]>();
  if (v.votes) for (const [voter, t] of Object.entries(v.votes)) tally.set(t, [...(tally.get(t) ?? []), voter]);
  const nameOf = (id: string) => v.players.find((p) => p.id === id)?.name ?? '';
  return (
    <div className="mole-meet">
      <div className="mm-card">
        <div className="mm-head">
          <b>{v.phase === 'result' ? '🗳️ Kết quả' : v.meeting?.reason === 'report' ? '💀 Phát hiện xác!' : '🔔 Họp khẩn!'}</b>
          <span className="mm-timer">{left}s</span>
        </div>
        {v.meeting && v.phase !== 'result' && (
          <div className="mm-sub">
            {v.meeting.reason === 'report' ? `${v.meeting.byName} tìm thấy xác của ${v.meeting.body}.` : `${v.meeting.byName} bấm chuông.`}{' '}
            {v.phase === 'meeting' ? 'Bàn bạc bằng mic — sắp bỏ phiếu.' : v.me.alive ? (v.me.vote ? 'Bạn đã bỏ phiếu.' : 'Chọn người bạn nghi là nội gián.') : 'Hồn ma không được bỏ phiếu.'}
          </div>
        )}
        {v.phase === 'result' && v.result && (
          <div className={`mm-result${v.result.wasMole ? ' mole' : ''}`}>
            {v.result.out
              ? v.result.wasMole == null
                ? `${v.result.name} bị trục xuất.`
                : v.result.wasMole
                  ? `${v.result.name} bị trục xuất — ĐÚNG là nội gián! 🎯`
                  : `${v.result.name} bị trục xuất — nhưng KHÔNG phải nội gián 😱`
              : v.result.why === 'tie'
                ? '⚖️ Phiếu hoà — không ai bị loại.'
                : '🤷 Không ai bị loại.'}
          </div>
        )}
        <div className="mm-grid">
          {v.players.map((p) => {
            const got = tally.get(p.id) ?? [];
            const canVote = voting && p.alive;
            return (
              <button key={p.id} className={`mm-p${p.alive ? '' : ' dead'}${v.me.vote === p.id ? ' mine' : ''}`} disabled={!canVote} onClick={() => game.mole({ a: 'vote', target: p.id })}>
                <AvatarDot name={p.name} avatar={p.id === myId ? myAvatar : players[p.id]?.avatar} size={30} />
                <span className="mm-name">
                  {p.name}
                  {p.role === 'mole' && ' 🕵️'}
                </span>
                {!p.alive && <span className="mm-tag">{p.out === 'voted' ? '🚪' : '💀'}</span>}
                {v.phase === 'vote' && v.voted.includes(p.id) && <span className="mm-tag ok">✓</span>}
                {got.length > 0 && <span className="mm-votes" title={got.map(nameOf).join(', ')}>🗳️ {got.length}</span>}
              </button>
            );
          })}
        </div>
        {v.phase === 'vote' && v.me.alive && (
          <button className={`btn mm-skip${v.me.vote === 'skip' ? ' on' : ''}`} disabled={!!v.me.vote} onClick={() => game.mole({ a: 'vote', target: 'skip' })}>
            🤷 Bỏ qua{tally.get('skip') ? ` (${tally.get('skip')!.length})` : ''}
          </button>
        )}
        {v.phase === 'result' && tally.get('skip') && <div className="mm-sub">🤷 Bỏ qua: {tally.get('skip')!.map(nameOf).join(', ')}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the big moments
/** Full-screen moments: a body found, the bell, your own death, your kill. */
export function MoleSplash() {
  const sp = useStore((s) => s.moleSplash);
  useTick(200);
  useEffect(() => {
    if (!sp) return;
    const ms = sp.kind === 'kill' ? 900 : sp.kind === 'killed' ? 4200 : 2600;
    const t = setTimeout(() => setState({ moleSplash: null }), ms);
    return () => clearTimeout(t);
  }, [sp]);
  if (!sp) return null;
  if (sp.kind === 'kill') return <div className="ms-flash" />;
  if (sp.kind === 'killed')
    return (
      <div className="ms-splash killed">
        <div className="ms-slash" />
        <div className="ms-icon">🔪</div>
        <div className="ms-title">BẠN ĐÃ BỊ GIẾT</div>
        <div className="ms-sub">
          Kẻ ra tay: <b>{sp.by}</b>
        </div>
        <div className="ms-note">Giờ bạn là hồn ma 👻 — vẫn làm nhiệm vụ được, nhưng chỉ nói chuyện được với hồn ma. Đừng tiết lộ gì nhé!</div>
      </div>
    );
  return (
    <div className={`ms-splash ${sp.kind}`}>
      <div className="ms-rays" />
      <div className="ms-icon">{sp.kind === 'report' ? '💀' : '🔔'}</div>
      <div className="ms-title">{sp.kind === 'report' ? 'PHÁT HIỆN XÁC!' : 'HỌP KHẨN!'}</div>
      <div className="ms-sub">{sp.kind === 'report' ? `${sp.by} tìm thấy xác của ${sp.body}` : `${sp.by} bấm chuông họp khẩn`}</div>
    </div>
  );
}

/** After the vote: a dark screen and the verdict typed out letter by letter. */
export function MoleEject() {
  const v = useStore((s) => s.mole);
  const [shown, setShown] = useState(0);
  const res = v?.phase === 'result' ? v.result : null;
  const lines = res
    ? res.out
      ? [
          `${res.name} đã bị trục xuất.`,
          res.wasMole == null ? '' : res.wasMole ? `${res.name} LÀ nội gián.` : `${res.name} KHÔNG phải nội gián.`,
          res.molesLeft == null ? '' : res.molesLeft === 0 ? 'Không còn nội gián nào.' : `Còn ${res.molesLeft} nội gián.`,
        ].filter(Boolean)
      : [res.why === 'tie' ? 'Phiếu hoà.' : 'Không ai bị trục xuất.', 'Không ai rời khỏi công ty.']
    : [];
  const full = lines.join('\n');
  useEffect(() => {
    if (!res) return setShown(0);
    setShown(0);
    let i = 0;
    const t = setInterval(() => {
      i++;
      setShown(i);
      if (full[i - 1] && full[i - 1] !== ' ' && full[i - 1] !== '\n') game.typeTick();
      if (i >= full.length) clearInterval(t);
    }, 55);
    return () => clearInterval(t);
  }, [res?.out, res?.why, v?.until]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !v.me.inGame || !res) return null;
  const text = full.slice(0, shown);
  return (
    <div className={`ms-eject${res.out ? '' : ' none'}`}>
      <div className="me-stars" />
      {res.out && <div className="me-drift">🚪🧍</div>}
      <div className="me-text">
        {text.split('\n').map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        <span className="me-caret">▌</span>
      </div>
    </div>
  );
}

export function MoleReveal() {
  const v = useStore((s) => s.mole);
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.me);
  useTick(200);
  if (!v || !v.me.inGame || v.phase !== 'roles') return null;
  const elapsed = 8000 - (v.until - serverNow());
  if (elapsed < 1500)
    return (
      <div className="mole-reveal shh">
        <div className="mr-emoji">🤫</div>
        <div className="mr-title">Suỵt…</div>
        <div className="mr-sub">Có kẻ phản bội đang ở giữa chúng ta.</div>
      </div>
    );
  const mole = v.me.role === 'mole';
  const nMoles = molesFor(v.players.length, v.settings);
  // employees see everyone; a mole sees the pack
  const line = mole ? v.players.filter((p) => p.id === v.me.mates.find((m) => m === p.id) || p.id === me?.id) : v.players;
  return (
    <div className={`mole-reveal ${mole ? 'mole' : 'crew'}`}>
      <div className="mr-title">{mole ? 'NỘI GIÁN' : 'NHÂN VIÊN'}</div>
      <div className="mr-sub">{mole ? (v.me.mates.length ? 'Giết người, phá hoại, đừng để lộ.' : 'Một mình bạn chống cả công ty.') : `Có ${nMoles} nội gián trong số ${v.players.length} người.`}</div>
      <div className="mr-line">
        {line.map((p, i) => (
          <div key={p.id} className={`mr-person${p.id === me?.id ? ' me' : ''}`} style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
            <AvatarDot name={p.name} avatar={p.id === me?.id ? me.avatar : players[p.id]?.avatar} size={54} />
            <span>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MoleEnd() {
  const v = useStore((s) => s.mole);
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.me);
  if (!v || v.phase !== 'end' || !v.winner || !v.me.inGame) return null;
  const won = v.me.role === v.winner;
  const winners = v.players.filter((p) => p.role === v.winner);
  return (
    <div className={`mole-final ${won ? 'won' : 'lost'} ${v.winner}`}>
      <div className="mf-title">{won ? 'CHIẾN THẮNG' : 'THẤT BẠI'}</div>
      <div className="mf-team">{v.winner === 'crew' ? '👔 Nhân viên thắng' : '🔪 Nội gián thắng'}</div>
      <div className="mf-why">{v.why}</div>
      <div className="mr-line">
        {winners.map((p, i) => (
          <div key={p.id} className={`mr-person${p.alive ? '' : ' dead'}`} style={{ animationDelay: `${0.2 + i * 0.1}s` }}>
            <AvatarDot name={p.name} avatar={p.id === me?.id ? me.avatar : players[p.id]?.avatar} size={54} />
            <span>
              {p.name}
              {!p.alive && ' 💀'}
            </span>
          </div>
        ))}
      </div>
      <div className="we-roles">
        {v.players
          .filter((p) => p.role === 'mole')
          .map((p) => (
            <span key={p.id}>🔪 {p.name} là nội gián</span>
          ))}
      </div>
    </div>
  );
}

/** Darkness beyond your sight radius (fog of war) while playing on floor 5. */
export function MoleFog() {
  const ref = useRef<HTMLDivElement>(null);
  const v = useStore((s) => s.mole);
  const active = !!v && v.me.inGame && v.phase === 'play' && v.me.alive;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      const r = game.moleFogRadius();
      const c = r != null ? game.world?.screenCircle(r) : null;
      const el = ref.current;
      if (el) {
        if (c) {
          el.style.opacity = '1';
          el.style.background = `radial-gradient(circle at ${c.x}px ${c.y}px, transparent ${c.r * 0.82}px, rgba(4,6,14,0.9) ${c.r * 1.05}px)`;
        } else el.style.opacity = '0';
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  if (!active) return null;
  return <div className="mole-fog" ref={ref} />;
}
