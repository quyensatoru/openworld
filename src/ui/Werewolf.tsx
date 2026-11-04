// Ma Sói UI: lobby + settings, your role card, night actions, votes, the game master's log, the
// night overlay ("you are asleep") and the end banner.
import { useEffect, useRef, useState } from 'react';
import { DAY_CHOICES, PHASE_LABEL, ROLE_META, TEAM_LABEL, WOLF_MAX, WOLF_MIN, isWolf, rolesFor, type Special, type WolfMsg, type WolfPlayer, type WolfRole, type WolfView } from '../../shared/werewolf';
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

const isNight = (v: WolfView) => v.phase === 'night' || v.phase === 'witch' || v.phase === 'reveal';

export function WolfPanel() {
  const v = useStore((s) => s.wolf);
  const zone = useStore((s) => s.me?.zone);
  const open = useStore((s) => s.wolfPanel);
  useTick(500);
  if (!v || (zone !== 'wolfroom' && !v.me.inGame)) return null;
  if (!open)
    return (
      <button className="wolf-pill" onClick={() => setState({ wolfPanel: true })}>
        🐺 {v.phase === 'lobby' ? `Ma Sói · ${v.seated.length} người quanh lửa` : `${PHASE_LABEL[v.phase]}${v.day ? ` · ngày ${v.day}` : ''}`} <small>· mở</small>
      </button>
    );
  const left = v.until ? Math.max(0, Math.ceil((v.until - serverNow()) / 1000)) : 0;
  return (
    <div className={`wolf-panel${isNight(v) ? ' night' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
      <div className="wp-head">
        <div className="wp-phase">
          <span className="wp-icon">{isNight(v) ? '🌙' : v.phase === 'end' ? '🏁' : v.phase === 'lobby' || v.phase === 'starting' ? '🔥' : '☀️'}</span>
          <div>
            <b>{PHASE_LABEL[v.phase]}</b>
            <small>{v.day ? `Ngày ${v.day}` : 'Làng Ma Sói'}</small>
          </div>
        </div>
        {left > 0 && (
          <div className={`wp-timer${left <= 10 ? ' hot' : ''}`}>
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </div>
        )}
        <button className="wp-x" onClick={() => setState({ wolfPanel: false })} title="Thu gọn">
          —
        </button>
      </div>
      <div className="wp-body">
        {v.phase === 'lobby' || v.phase === 'starting' ? <Lobby v={v} /> : <Game v={v} />}
        <Log v={v} />
      </div>
      <Footer v={v} />
    </div>
  );
}

// ------------------------------------------------------------------ lobby
function Lobby({ v }: { v: WolfView }) {
  const me = useStore((s) => s.me?.id ?? '');
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  const seated = v.seated.some((x) => x.id === me);
  const isHost = v.host === me;
  const n = v.seated.length;
  const roles = rolesFor(Math.max(WOLF_MIN, Math.min(WOLF_MAX, n)), v.settings);
  const [rules, setRules] = useState(false);
  const [cfg, setCfg] = useState(false);
  return (
    <div className="wp-lobby">
      <div className="wp-seated">
        {v.seated.length ? (
          v.seated.map((x) => (
            <span key={x.id} className={`wp-chip${x.id === v.host ? ' host' : ''}`}>
              <AvatarDot name={x.name} avatar={x.id === me ? myAvatar : players[x.id]?.avatar} size={22} />
              {x.name}
              {x.id === v.host && <em title="Chủ phòng: chỉnh luật">👑</em>}
            </span>
          ))
        ) : (
          <span className="wp-dim">Chưa ai ngồi quanh đống lửa.</span>
        )}
      </div>
      <div className="wp-need">
        <div className="wp-meter">
          <i style={{ width: `${Math.min(100, (n / WOLF_MIN) * 100)}%` }} />
        </div>
        <span>{n >= WOLF_MIN ? `🔥 Đủ người (${n}/${WOLF_MAX}) — sẵn sàng!` : `Cần ít nhất ${WOLF_MIN} người · đang có ${n}`}</span>
      </div>
      {v.phase === 'starting' ? (
        <div className="wp-starting">🔥 Ván mới bắt đầu sau {Math.max(0, Math.ceil((v.until - serverNow()) / 1000))} giây…</div>
      ) : seated ? (
        <button className="btn wp-start" disabled={n < WOLF_MIN} onClick={() => game.wolf({ a: 'start' })}>
          🐺 Bắt đầu ván ({n} người)
        </button>
      ) : (
        <div className="wp-hint">🪵 Chạm / click một gốc cây quanh đống lửa để ngồi vào bàn. Ngồi khúc gỗ ở mép phòng là xem thôi.</div>
      )}
      <div className="wp-roles">
        <span className="wp-dim">Bộ bài{n < WOLF_MIN ? ` (với ${WOLF_MIN} người)` : ''}:</span>
        {(['wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'villager', 'fool', 'killer'] as WolfRole[]).map((r) => {
          const c = roles.filter((x) => x === r).length;
          return c ? (
            <span key={r} className="wp-role-chip" style={{ borderColor: ROLE_META[r].color }} title={ROLE_META[r].desc}>
              {ROLE_META[r].emoji} {ROLE_META[r].name} ×{c}
            </span>
          ) : null;
        })}
      </div>
      <div className="wp-links">
        {isHost && v.phase === 'lobby' && (
          <button className="wp-link" onClick={() => setCfg(!cfg)}>
            {cfg ? '▾' : '▸'} ⚙️ Tuỳ chỉnh luật
          </button>
        )}
        <button className="wp-link" onClick={() => setRules(!rules)}>
          {rules ? '▾' : '▸'} 📖 Luật chơi
        </button>
      </div>
      {cfg && isHost && v.phase === 'lobby' && <Settings v={v} />}
      {rules && <Rules />}
    </div>
  );
}

function Settings({ v }: { v: WolfView }) {
  const s = v.settings;
  const set = (p: Extract<WolfMsg, { a: 'settings' }>['s']) => game.wolf({ a: 'settings', s: p });
  const group = (label: string, list: Special[]) => (
    <div className="wp-group">
      <span>{label}</span>
      <div className="wp-toggles">
        {list.map((r) => (
          <label key={r} title={ROLE_META[r].desc}>
            <input type="checkbox" checked={s.roles[r]} onChange={(e) => set({ roles: { [r]: e.target.checked } })} /> {ROLE_META[r].emoji} {ROLE_META[r].name}
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <div className="wp-settings">
      <div className="wp-row">
        <span>Bộ vai</span>
        <div className="wp-seg">
          <button className={s.mode === 'auto' ? 'on' : ''} onClick={() => set({ mode: 'auto' })}>
            Tự động
          </button>
          <button className={s.mode === 'custom' ? 'on' : ''} onClick={() => set({ mode: 'custom' })}>
            Tuỳ chỉnh
          </button>
        </div>
      </div>
      {s.mode === 'custom' && (
        <>
          <div className="wp-row">
            <span>🐺 Số sói</span>
            <div className="wp-seg">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} className={s.wolves === n ? 'on' : ''} onClick={() => set({ wolves: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {group('Phe Sói', ['alpha', 'minion'])}
          {group('Phe Dân', ['seer', 'guard', 'witch', 'hunter', 'cupid'])}
          {group('Phe thứ 3', ['fool', 'killer'])}
        </>
      )}
      <div className="wp-row">
        <span>🗣️ Thảo luận</span>
        <select value={s.dayS} onChange={(e) => set({ dayS: Number(e.target.value) })}>
          {DAY_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d >= 60 ? `${Math.floor(d / 60)} phút${d % 60 ? ` ${d % 60}s` : ''}` : `${d}s`}
            </option>
          ))}
        </select>
      </div>
      <label className="wp-row check">
        <input type="checkbox" checked={s.reveal} onChange={(e) => set({ reveal: e.target.checked })} /> Lộ vai của người chết
      </label>
      <label className="wp-row check" title="Tắt: người đã chết và người đứng xem chỉ biết vai của chính mình và vai được lộ khi chết, cho tới hết ván">
        <input type="checkbox" checked={!!s.ghostsSee} onChange={(e) => set({ ghostsSee: e.target.checked })} /> 👻 Người chết & người xem biết vai mọi người
      </label>
    </div>
  );
}

function Rules() {
  return (
    <div className="wp-rules">
      <p>
        <b>Mục tiêu.</b> Dân làng tìm và treo cổ hết Sói. Sói thắng khi số Sói còn sống bằng số người còn lại. Phe thứ 3 có cách thắng riêng: 🤡 Thằng Ngố thắng khi bị treo cổ, 🔪 Sát Nhân thắng khi còn trụ đến 1 chọi 1, 💘 cặp đôi khác phe thắng khi chỉ còn hai người họ.
      </p>
      <p>
        <b>Ban đêm.</b> Mọi người “ngủ”: mic chỉ đến được bầy sói với nhau (và cặp đôi với nhau). Sói chọn người để cắn, Sát Nhân chọn người để đâm, Bảo vệ che chắn một người, Tiên tri soi một người, rồi Phù thuỷ được biết ai bị cắn để cứu hoặc đầu độc.
      </p>
      <p>
        <b>Ban ngày.</b> Cả làng nói chuyện bằng mic, rồi bỏ phiếu. Người nhiều phiếu nhất được bào chữa 25 giây, sau đó cả làng chọn 👍 treo hay 👎 tha.
      </p>
      <p>
        <b>Người chết</b> không nói được với người sống, nhưng nghe được tất cả và nói chuyện với nhau.
      </p>
      {(['wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'villager', 'fool', 'killer'] as WolfRole[]).map((r) => (
        <p key={r}>
          {ROLE_META[r].emoji} <b>{ROLE_META[r].name}:</b> {ROLE_META[r].desc}
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ in game
function Game({ v }: { v: WolfView }) {
  const me = v.me;
  return (
    <>
      {me.inGame && me.role && <RoleCard v={v} />}
      {!me.inGame && <div className="wp-spect">👀 Bạn đang xem — nghe được cả làng, chỉ nói được với người xem khác.</div>}
      <Action v={v} />
      <Players v={v} />
    </>
  );
}

function RoleCard({ v }: { v: WolfView }) {
  const r = v.me.role!;
  const meta = ROLE_META[r];
  const [flipped, setFlipped] = useState(v.phase !== 'reveal');
  useEffect(() => {
    if (v.phase === 'reveal') {
      setFlipped(false);
      const t = setTimeout(() => setFlipped(true), 700);
      return () => clearTimeout(t);
    }
  }, [v.phase]);
  const mates = v.me.mates.map((id) => v.players.find((p) => p.id === id)?.name).filter(Boolean);
  const [info, setInfo] = useState(false);
  const showDesc = info || v.phase === 'reveal';
  return (
    <div className={`wp-card${flipped ? ' flipped' : ''}${v.me.alive ? '' : ' dead'}${showDesc ? '' : ' compact'}`} style={{ ['--role' as string]: meta.color }} onClick={() => setInfo(!info)} title="Bấm để xem / ẩn mô tả vai">
      <div className="wc-inner">
        <div className="wc-back">🐺</div>
        <div className="wc-front">
          <div className="wc-emoji">{meta.emoji}</div>
          <div>
            <div className="wc-name">
              {meta.name} {!v.me.alive && <span className="wc-dead">· đã chết 💀</span>}
            </div>
            {showDesc ? <div className="wc-desc">{meta.desc}</div> : <div className="wc-hint">bấm để xem vai làm gì</div>}
            {isWolf(r) && mates.length > 0 && <div className="wc-mates">🐺 Đồng bọn: {mates.join(', ')}</div>}
            {r === 'minion' && <div className="wc-mates">🐺 Bầy sói bạn phải bảo vệ: {mates.join(', ') || '…'}</div>}
            {v.me.lover && <div className="wc-mates love">💘 Người yêu của bạn: {name(v, v.me.lover)} — một người chết, người kia chết theo.</div>}
            {r === 'seer' && v.me.seen.length > 0 && (
              <div className="wc-seen">
                {v.me.seen.map((s) => (
                  <span key={`${s.id}${s.day}`} className={s.wolf ? 'wolf' : ''}>
                    Đêm {s.day}: {v.players.find((p) => p.id === s.id)?.name} {s.wolf ? 'là 🐺 SÓI' : 'không phải sói'}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function name(v: WolfView, id: string | null | undefined) {
  return v.players.find((p) => p.id === id)?.name ?? '';
}

function Action({ v }: { v: WolfView }) {
  const me = v.me;
  const act = me.act;
  const [poison, setPoison] = useState(false);
  useEffect(() => setPoison(false), [v.phase, v.day]);
  // night jobs, the witch, the hunter
  if (act) {
    if (act.kind === 'pair') return <PairPick v={v} />;
    const title: Record<string, string> = {
      stab: '🔪 Đêm nay ra tay với ai?',
      kill: '🐺 Bầy sói chọn con mồi',
      protect: '🛡️ Bảo vệ ai đêm nay?',
      check: '🔮 Soi ai đêm nay?',
      witch: '🧪 Phù thuỷ thức dậy',
      shoot: '🏹 Bắn ai trước khi gục xuống?',
    };
    if (act.kind === 'witch') {
      return (
        <div className="wp-act">
          <div className="wa-title">{title.witch}</div>
          {act.done ? (
            <div className="wa-done">{act.used === 'save' ? `💚 Bạn đã cứu ${name(v, act.victim)}.` : act.used === 'poison' ? `☠️ Bạn đã đầu độc ${name(v, act.chosen)}.` : '😴 Bạn không dùng bình nào đêm nay.'}</div>
          ) : (
            <>
              <div className="wa-sub">{act.victim ? `Đêm nay sói đã cắn ${name(v, act.victim)}.` : 'Đêm nay sói không cắn ai.'}</div>
              <div className="wa-btns">
                {act.save && act.victim && (
                  <button className="btn save" onClick={() => game.wolf({ a: 'act', target: act.victim!, use: 'save' })}>
                    💚 Cứu {name(v, act.victim)}
                  </button>
                )}
                {act.poison && (
                  <button className={`btn poison${poison ? ' on' : ''}`} onClick={() => setPoison(!poison)}>
                    ☠️ Đầu độc…
                  </button>
                )}
                <button className="btn" onClick={() => game.wolf({ a: 'act', target: null, use: 'pass' })}>
                  Không làm gì
                </button>
              </div>
              {!act.save && !act.poison && <div className="wa-sub">Bạn đã dùng hết cả hai bình.</div>}
              {poison && <Targets v={v} ids={act.targets} chosen={null} onPick={(id) => game.wolf({ a: 'act', target: id, use: 'poison' })} />}
            </>
          )}
        </div>
      );
    }
    return (
      <div className="wp-act">
        <div className="wa-title">{title[act.kind]}</div>
        {act.kind === 'check' && act.done ? (
          <div className="wa-done">🔮 Đã soi {name(v, act.chosen)} — xem kết quả trên lá bài của bạn.</div>
        ) : (
          <Targets v={v} ids={act.targets} chosen={act.chosen} pack={act.kind === 'kill' ? v.me.pack : undefined} onPick={(id) => game.wolf({ a: 'act', target: id })} />
        )}
        {act.kind === 'kill' && <div className="wa-sub">Cả bầy nghe được nhau qua mic. Con mồi là người được nhiều sói chọn nhất.</div>}
        {act.kind === 'protect' && <div className="wa-sub">Không được bảo vệ cùng một người hai đêm liền.</div>}
      </div>
    );
  }
  if (!me.inGame || !me.alive) return null;
  if (v.phase === 'night' || v.phase === 'witch') return <div className="wp-act sleep">😴 Bạn đang ngủ… chờ trời sáng.</div>;
  if (v.phase === 'day') {
    const alive = v.players.filter((p) => p.alive).length;
    const mine = v.skipDay.includes(useStore.getState().me?.id ?? '');
    return (
      <div className="wp-act">
        <div className="wa-title">🗣️ Thảo luận — ai là sói?</div>
        <div className="wa-sub">Bật mic và nói chuyện với cả làng. Hết giờ sẽ bỏ phiếu.</div>
        <button className={`btn${mine ? ' on' : ''}`} onClick={() => game.wolf({ a: 'skipday' })}>
          ⏩ Bỏ phiếu luôn ({v.skipDay.length}/{Math.floor(alive / 2) + 1})
        </button>
      </div>
    );
  }
  if (v.phase === 'vote') {
    const myId = useStore.getState().me?.id ?? '';
    const mine = v.votes[myId];
    const alive = v.players.filter((p) => p.alive && p.id !== myId).map((p) => p.id);
    return (
      <div className="wp-act">
        <div className="wa-title">🗳️ Treo cổ ai?</div>
        <Targets v={v} ids={alive} chosen={mine ?? null} votes={v.votes} onPick={(id) => game.wolf({ a: 'vote', target: id })} />
        <button className={`btn skip${mine === 'skip' ? ' on' : ''}`} onClick={() => game.wolf({ a: 'vote', target: 'skip' })}>
          🤷 Bỏ qua ({Object.values(v.votes).filter((x) => x === 'skip').length})
        </button>
      </div>
    );
  }
  if (v.phase === 'defense') {
    const myId = useStore.getState().me?.id ?? '';
    return <div className="wp-act">{v.accused === myId ? <div className="wa-title">⚖️ Bạn bị buộc tội — bào chữa đi! Cả làng đang nghe bạn.</div> : <div className="wa-title">⚖️ {name(v, v.accused)} đang bào chữa… (mọi người im lặng)</div>}</div>;
  }
  if (v.phase === 'verdict') {
    const myId = useStore.getState().me?.id ?? '';
    const mine = v.votes[myId];
    const yes = Object.values(v.votes).filter((x) => x === 'yes').length;
    const no = Object.values(v.votes).filter((x) => x === 'no').length;
    if (v.accused === myId) return <div className="wp-act"><div className="wa-title">⚖️ Cả làng đang quyết định số phận của bạn… 👍 {yes} · 👎 {no}</div></div>;
    return (
      <div className="wp-act">
        <div className="wa-title">⚖️ Treo cổ {name(v, v.accused)}?</div>
        <div className="wa-btns">
          <button className={`btn hang${mine === 'yes' ? ' on' : ''}`} onClick={() => game.wolf({ a: 'verdict', yes: true })}>
            👍 Treo ({yes})
          </button>
          <button className={`btn spare${mine === 'no' ? ' on' : ''}`} onClick={() => game.wolf({ a: 'verdict', yes: false })}>
            👎 Tha ({no})
          </button>
        </div>
      </div>
    );
  }
  if (v.phase === 'hunter') return <div className="wp-act">🏹 Thợ săn đang giương cung…</div>;
  return null;
}

/** Cupid, night 1: pick two people to fall in love. */
function PairPick({ v }: { v: WolfView }) {
  const act = v.me.act!;
  const [sel, setSel] = useState<string[]>([]);
  if (act.done)
    return (
      <div className="wp-act">
        <div className="wa-title">💘 Đã ghép đôi</div>
        <div className="wa-done">
          {name(v, act.pair?.[0])} 💘 {name(v, act.pair?.[1])} — từ giờ họ sống chết có nhau.
        </div>
      </div>
    );
  const toggle = (id: string) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));
  return (
    <div className="wp-act">
      <div className="wa-title">💘 Chọn hai người để ghép đôi ({sel.length}/2)</div>
      <div className="wa-targets">
        {act.targets.map((id) => (
          <button key={id} className={`wa-t${sel.includes(id) ? ' on love' : ''}`} onClick={() => toggle(id)}>
            <span>{name(v, id)}</span>
            {sel.includes(id) && <em>💘</em>}
          </button>
        ))}
      </div>
      <button className="btn" disabled={sel.length !== 2} onClick={() => game.wolf({ a: 'act', target: null, pair: sel })}>
        🏹 Bắn mũi tên tình yêu
      </button>
      <div className="wa-sub">Có thể chọn chính bạn. Nếu hai người khác phe, họ thành phe riêng.</div>
    </div>
  );
}

function Targets({ v, ids, chosen, pack, votes, onPick }: { v: WolfView; ids: string[]; chosen: string | null; pack?: Record<string, string>; votes?: Record<string, string>; onPick(id: string): void }) {
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  const myId = useStore((s) => s.me?.id);
  return (
    <div className="wa-targets">
      {ids.map((id) => {
        const p = v.players.find((x) => x.id === id);
        if (!p) return null;
        const by = Object.entries(pack ?? votes ?? {})
          .filter(([, t]) => t === id)
          .map(([who]) => name(v, who));
        return (
          <button key={id} className={`wa-t${chosen === id ? ' on' : ''}`} onClick={() => onPick(id)}>
            <AvatarDot name={p.name} avatar={id === myId ? myAvatar : players[id]?.avatar} size={24} />
            <span>{p.name}</span>
            {by.length > 0 && <em title={by.join(', ')}>{pack ? `🐺${by.length}` : `🗳️${by.length}`}</em>}
          </button>
        );
      })}
    </div>
  );
}

function Players({ v }: { v: WolfView }) {
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  const myId = useStore((s) => s.me?.id);
  const cause: Record<NonNullable<WolfPlayer['cause']>, string> = { wolf: 'bị sói cắn', poison: 'trúng độc', hang: 'bị treo cổ', shot: 'trúng tên', left: 'rời làng', stab: 'bị đâm', heart: 'chết vì tình' };
  return (
    <div className="wp-players">
      {v.players.map((p) => (
        <div key={p.id} className={`wp-p${p.alive ? '' : ' dead'}${p.id === myId ? ' me' : ''}`} title={p.alive ? '' : cause[p.cause ?? 'wolf']}>
          <AvatarDot name={p.name} avatar={p.id === myId ? myAvatar : players[p.id]?.avatar} size={26} />
          <span className="pn">{p.name}</span>
          <span className="pr">
            {p.lover && '💘'}
            {p.role ? ROLE_META[p.role].emoji : p.alive ? '' : '❔'}
          </span>
          {!p.alive && <span className="pd">💀</span>}
        </div>
      ))}
    </div>
  );
}

function Log({ v }: { v: WolfView }) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [v.log.length, all]);
  if (!v.log.length) return null;
  const lines = all ? v.log : v.log.slice(-3);
  return (
    <div className="wp-log-wrap">
      <div className="wp-log" ref={ref}>
        {lines.map((l) => (
          <div key={l.t + l.text} className={`wl ${l.kind}`}>
            {l.text}
          </div>
        ))}
      </div>
      {v.log.length > 3 && (
        <button className="wp-link" onClick={() => setAll(!all)}>
          {all ? '▾ Thu gọn diễn biến' : `▸ Xem toàn bộ diễn biến (${v.log.length})`}
        </button>
      )}
    </div>
  );
}

const VOICE: Record<WolfView['me']['voice'], string> = {
  all: '🎙️ Cả làng nghe được bạn',
  wolves: '🐺 Chỉ bầy sói nghe được bạn',
  ghosts: '👻 Chỉ hồn ma & người xem nghe được bạn',
  listen: '😴 Mic tạm tắt — không ai nghe được bạn lúc này',
  accused: '⚖️ Cả làng đang nghe bạn bào chữa',
  lovers: '💘 Chỉ người yêu của bạn nghe được bạn',
};

function Footer({ v }: { v: WolfView }) {
  const mic = useStore((s) => s.media.mic);
  const speech = useStore((s) => s.wolfSpeech);
  const me = useStore((s) => s.me?.id);
  return (
    <div className="wp-foot">
      <span className={`wp-voice ${v.me.voice}`}>{mic ? VOICE[v.me.voice] : '🔇 Mic đang tắt'}</span>
      {!mic && (
        <button className="btn tiny" onClick={() => void game.toggleMic()}>
          Bật mic
        </button>
      )}
      <button className={`wp-tog${speech ? ' on' : ''}`} onClick={() => game.setWolfSpeech(!speech)} title="Quản trò đọc to diễn biến (cần giọng tiếng Việt trên máy)">
        {speech ? '🔊' : '🔈'} Quản trò
      </button>
      {v.host === me && v.phase !== 'lobby' && v.phase !== 'end' && (
        <button className="wp-tog danger" onClick={() => confirm('Dừng ván Ma Sói này?') && game.wolf({ a: 'abort' })}>
          ⛔
        </button>
      )}
    </div>
  );
}

/** Night: the screen goes dark blue for the living (you're "asleep" unless your role wakes you). */
export function WolfNight() {
  const v = useStore((s) => s.wolf);
  const zone = useStore((s) => s.me?.zone);
  useTick(1000);
  if (!v || !v.me.inGame || !v.me.alive || zone !== 'wolfroom') return null;
  if (v.phase !== 'night' && v.phase !== 'witch') return null;
  const awake = !!v.me.act;
  return (
    <div className={`wolf-night${awake ? ' awake' : ''}`}>
      <div className="wn-moon" />
      <div className="wn-text">
        {awake ? (
          <>
            <b>{v.me.act!.kind === 'kill' ? '🐺 Bầy sói thức dậy…' : v.me.act!.kind === 'witch' ? '🧪 Phù thuỷ thức dậy…' : `${ROLE_META[v.me.role!].emoji} ${ROLE_META[v.me.role!].name} thức dậy…`}</b>
            <span>{ROLE_META[v.me.role!].night}</span>
          </>
        ) : (
          <>
            <b>🌙 Đêm {v.day} — bạn đang ngủ…</b>
            <span>Đừng nói gì nhé, mic của bạn tạm tắt. Trời sáng sẽ biết chuyện gì xảy ra.</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Big banner when a game ends. */
export function WolfEnd() {
  const v = useStore((s) => s.wolf);
  const zone = useStore((s) => s.me?.zone);
  if (!v || v.phase !== 'end' || !v.winner || (zone !== 'wolfroom' && !v.me.inGame)) return null;
  const myId = useStore.getState().me?.id ?? '';
  const won = v.winners.includes(myId);
  return (
    <div className={`wolf-end ${v.winner}`}>
      <div className="we-title">{TEAM_LABEL[v.winner]}</div>
      {v.me.inGame && <div className="we-sub">{won ? '🎉 Bạn thắng!' : '😵 Bạn thua rồi…'}</div>}
      <div className="we-roles">
        {v.players.map((p) => (
          <span key={p.id} className={`${p.alive ? '' : 'dead'}${v.winners.includes(p.id) ? ' won' : ''}`}>
            {p.lover ? '💘' : ''}
            {p.role ? ROLE_META[p.role].emoji : '❔'} {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
