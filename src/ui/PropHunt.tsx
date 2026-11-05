// Trốn tìm biến hình UI: the lobby panel (join, settings, rules), the in-game HUD (clock, team,
// health, hiders left, kill feed), the action buttons (turn into · lock · taunt / fire), the
// crosshair, the seekers' blindfold, the team card at the start of a round and the score screens.
import { useEffect, useState } from 'react';
import { FURNITURE } from '../../shared/map';
import { PH_CHOICES, PH_MAX, PH_MIN, PH_PROPS, PH_TAUNTS, seekersFor, type PhPlayer, type PhView } from '../../shared/prophunt';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';
import { AvatarDot } from './common';
import './prophunt.css';

function useTick(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
const onF6 = (zone: string | undefined) => !!zone && zone.startsWith('f6-');
const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
const mmss = (ms: number) => {
  const s = secs(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const live = (v: PhView | null) => !!v && (v.phase === 'roles' || v.phase === 'hide' || v.phase === 'seek' || v.phase === 'roundEnd');
const TEAM = {
  hider: { name: 'Người trốn', emoji: '🪑', cls: 'hider' },
  seeker: { name: 'Người tìm', emoji: '🔫', cls: 'seeker' },
} as const;

function Seg<T extends string | number>({ value, options, onPick }: { value: T; options: [T, string][]; onPick(v: T): void }) {
  return (
    <div className="ph-seg">
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the panel (lobby / scores)
export function PropPanel() {
  const v = useStore((s) => s.ph);
  const zone = useStore((s) => s.me?.zone);
  const open = useStore((s) => s.phPanel);
  useTick(500);
  if (!v || (!onF6(zone) && !v.me.inGame)) return null;
  const playing = v.phase !== 'lobby' && v.phase !== 'starting';
  if (!open)
    return (
      <button className="ph-pill" onClick={() => setState({ phPanel: true })}>
        🪑 {v.phase === 'lobby' ? `Trốn tìm · ${v.joined.length} người` : playing ? `Bảng điểm · vòng ${v.round}` : 'Trốn tìm sắp bắt đầu'}
      </button>
    );
  return (
    <div className="ph-panel">
      <div className="ph-head">
        <b>🪑 Trốn tìm biến hình</b>
        <button className="ph-x" onClick={() => setState({ phPanel: false })} title="Thu gọn">
          —
        </button>
      </div>
      <div className="ph-body">{playing ? <Scores v={v} /> : <Lobby v={v} />}</div>
    </div>
  );
}

function Lobby({ v }: { v: PhView }) {
  const me = useStore((s) => s.me?.id ?? '');
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  const joined = v.joined.some((j) => j.id === me);
  const isHost = v.host === me;
  const [cfg, setCfg] = useState(false);
  const [rules, setRules] = useState(!joined);
  const n = v.joined.length;
  const k = seekersFor(Math.max(PH_MIN, n), v.settings);
  return (
    <div className="ph-lobby">
      <div className="ph-count">
        <b>{n}</b>/{PH_MAX} người · cần ít nhất {PH_MIN}
      </div>
      <div className="ph-chips">
        {v.joined.map((j) => (
          <span key={j.id} className={`ph-chip${j.id === v.host ? ' host' : ''}`}>
            <AvatarDot name={j.name} avatar={j.id === me ? myAvatar : players[j.id]?.avatar} size={22} />
            {j.name}
            {j.id === v.host && <em>👑</em>}
          </span>
        ))}
        {!n && <span className="ph-dim">Chưa ai tham gia — rủ đồng nghiệp lên tầng 6 nhé!</span>}
      </div>
      {v.phase === 'starting' ? (
        <div className="ph-starting">🪑 Chia phe sau {secs(v.until - serverNow())} giây…</div>
      ) : joined ? (
        <div className="ph-row">
          {isHost ? (
            <button className="btn ph-go" disabled={n < PH_MIN} onClick={() => game.prop({ a: 'start' })}>
              ▶ Bắt đầu · {v.settings.rounds} vòng · {k} người tìm
            </button>
          ) : (
            <div className="ph-wait">Chờ {v.joined.find((j) => j.id === v.host)?.name ?? 'chủ phòng'} bắt đầu…</div>
          )}
          <button className="btn" onClick={() => game.prop({ a: 'leave' })}>
            Rời
          </button>
        </div>
      ) : (
        <button className="btn ph-go" onClick={() => game.prop({ a: 'join' })}>
          🙋 Tham gia ván
        </button>
      )}
      <div className="ph-links">
        {isHost && (
          <button className="ph-link" onClick={() => setCfg(!cfg)}>
            {cfg ? '▾' : '▸'} ⚙️ Tuỳ chỉnh
          </button>
        )}
        <button className="ph-link" onClick={() => setRules(!rules)}>
          {rules ? '▾' : '▸'} 📖 Cách chơi
        </button>
      </div>
      {cfg && isHost && <Settings v={v} />}
      {rules && <Rules />}
    </div>
  );
}

function Settings({ v }: { v: PhView }) {
  const s = v.settings;
  const set = (p: Partial<typeof s>) => game.prop({ a: 'settings', s: p });
  return (
    <div className="ph-settings">
      <div className="ph-set">
        <span>🔫 Người tìm</span>
        <Seg value={s.seekers} options={PH_CHOICES.seekers.map((n) => [n, n ? String(n) : 'Tự động'])} onPick={(x) => set({ seekers: x })} />
      </div>
      <div className="ph-set">
        <span>🙈 Thời gian trốn</span>
        <Seg value={s.hideS} options={PH_CHOICES.hideS.map((n) => [n, `${n}s`])} onPick={(x) => set({ hideS: x })} />
      </div>
      <div className="ph-set">
        <span>⏱️ Mỗi vòng</span>
        <Seg value={s.roundMin} options={PH_CHOICES.roundMin.map((n) => [n, `${n}p`])} onPick={(x) => set({ roundMin: x })} />
      </div>
      <div className="ph-set">
        <span>🔁 Số vòng</span>
        <Seg value={s.rounds} options={PH_CHOICES.rounds.map((n) => [n, String(n)])} onPick={(x) => set({ rounds: x })} />
      </div>
      <div className="ph-set">
        <span>📢 Tự trêu</span>
        <Seg value={s.tauntS} options={PH_CHOICES.tauntS.map((n) => [n, n ? `${n}s` : 'Tắt'])} onPick={(x) => set({ tauntS: x })} />
      </div>
      <label className="ph-check" title="Bị tìm thấy thì cầm súng sang phe tìm luôn">
        <input type="checkbox" checked={s.infect} onChange={(e) => set({ infect: e.target.checked })} /> 🧟 Lây nhiễm: bị tìm thấy thì thành người tìm
      </label>
    </div>
  );
}

function Rules() {
  return (
    <div className="ph-rules">
      <p>
        <b>🪑 Người trốn</b> nhắm vào một món đồ (nó sáng viền vàng) rồi <b>Biến hình</b> thành đúng món đó. Đồ càng nhỏ càng khó thấy nhưng càng ít máu. <b>Khoá góc</b> để món đồ đứng yên khi bạn xoay
        camera. <b>Trêu</b> để kiếm điểm — nhưng cứ một lúc bạn lại tự kêu một tiếng!
      </p>
      <p>
        <b>🔫 Người tìm</b> bị nhốt trong phòng chờ lúc phe kia đi trốn, sau đó cầm súng bóng đi săn. Bắn trúng người trốn là họ mất máu — <b>bắn nhầm đồ thật thì chính bạn mất máu</b>.
      </p>
      <p>Hết giờ mà còn người trốn thì phe trốn thắng. Đổi phe mỗi vòng, cộng điểm cả trận.</p>
    </div>
  );
}

function Scores({ v }: { v: PhView }) {
  const me = useStore((s) => s.me?.id ?? '');
  const isHost = v.host === me;
  const sorted = [...v.players].sort((a, b) => b.score - a.score);
  return (
    <div className="ph-scores">
      <div className="ph-count">
        Vòng <b>{v.round}</b>/{v.settings.rounds} · còn <b>{v.hidersLeft}</b> người trốn
      </div>
      <ol>
        {sorted.map((p) => (
          <li key={p.id} className={`${p.id === me ? 'me' : ''}${p.alive ? '' : ' out'}`}>
            <span className={`ph-team ${p.team}`}>{TEAM[p.team].emoji}</span>
            <span className="ph-name">{p.name}</span>
            <span className="ph-pts">{p.score}</span>
          </li>
        ))}
      </ol>
      {isHost && v.phase !== 'end' && (
        <button className="ph-link danger" onClick={() => confirm('Dừng ván Trốn tìm này?') && game.prop({ a: 'abort' })}>
          ⛔ Dừng ván
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ in-game HUD
export function PropHud() {
  const v = useStore((s) => s.ph);
  const hpOver = useStore((s) => s.phHp);
  useTick(250);
  if (!v || !live(v) || !v.me.inGame) return null;
  const left = v.until - serverNow();
  const team = v.me.team ? TEAM[v.me.team] : null;
  const hp = Math.max(0, Math.min(hpOver ?? v.me.hp, v.me.hp));
  const label = v.phase === 'roles' ? '🎬 Chia phe' : v.phase === 'hide' ? '🙈 Đang trốn' : v.phase === 'seek' ? '🔫 Đang săn' : '🏁 Hết vòng';
  return (
    <div className="ph-hud">
      <div className={`ph-clock ${v.phase}${v.phase === 'seek' && left < 30_000 ? ' hurry' : ''}`}>
        <span className="ph-phase">{label}</span>
        <b>{v.phase === 'roundEnd' ? `Vòng ${v.round}` : mmss(left)}</b>
        <span className="ph-round">
          Vòng {v.round}/{v.settings.rounds}
        </span>
      </div>
      <div className="ph-stats">
        {team && (
          <span className={`ph-me ${team.cls}${v.me.alive ? '' : ' out'}`}>
            {team.emoji} {v.me.alive ? team.name : 'Đã bị loại 👻'}
          </span>
        )}
        <span className="ph-left">🪑 Còn {v.hidersLeft}</span>
      </div>
      {v.me.alive && (
        <div className={`ph-hp ${v.me.team ?? ''}`} title={`${hp}/${v.me.maxHp} máu`}>
          <i style={{ width: `${(100 * hp) / Math.max(1, v.me.maxHp)}%` }} />
          <span>
            ❤️ {hp}/{v.me.maxHp}
          </span>
        </div>
      )}
      <Feed v={v} />
    </div>
  );
}

function Feed({ v }: { v: PhView }) {
  const now = Date.now();
  const lines = v.feed.filter((l) => now - l.t < 9000).slice(-4);
  if (!lines.length) return null;
  return (
    <div className="ph-feed">
      {lines.map((l) => (
        <div key={l.t + l.text} style={{ opacity: Math.min(1, (9000 - (now - l.t)) / 1500) }}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ action buttons + keys
export function PropActions() {
  const v = useStore((s) => s.ph);
  const cand = useStore((s) => s.phCand);
  const touch = useStore((s) => s.touch);
  const me = useStore((s) => s.me?.id ?? '');
  const typing = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable);
  };
  const hider = !!v && v.me.inGame && v.me.alive && v.me.team === 'hider' && (v.phase === 'hide' || v.phase === 'seek');
  const seeker = !!v && v.me.inGame && v.me.alive && v.me.team === 'seeker' && v.phase === 'seek';
  useTick(hider ? 300 : 1000);
  useEffect(() => {
    if (!hider) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing() || e.repeat || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') game.phTransform();
      else if (k === 'r') game.phLock();
      else if (k === 't') game.phTaunt();
      else if (k === 'g' && getPhase() === 'hide') game.phUnprop();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hider]);
  if (!v || (!hider && !seeker)) return null;
  if (seeker)
    return touch ? (
      <div className="ph-actions">
        <button className="ph-fire" onPointerDown={(e) => (e.preventDefault(), game.phShoot())} aria-label="Bắn">
          🔫
        </button>
      </div>
    ) : (
      <div className="ph-tip">🖱️ Click để bắn · rê chuột để ngắm · V đổi góc nhìn · Esc nhả chuột</div>
    );
  const mine = v.props[me];
  const now = serverNow();
  const swapWait = v.phase === 'seek' ? secs(v.me.swapAt - now) : 0;
  const tauntWait = secs(v.me.tauntAt - now);
  const wearing = mine ? PROP_NAME.get(mine.fid) : null;
  return (
    <div className="ph-actions">
      {cand ? <div className="ph-cand">✨ {cand.name}</div> : wearing && <div className="ph-wearing">🪑 Bạn đang là: {wearing}</div>}
      <div className="ph-btns">
        <button className={`ph-act main${cand ? ' ready' : ''}`} disabled={!cand || swapWait > 0} onClick={() => game.phTransform()}>
          <span className="ic">🪄</span>
          <span>{swapWait > 0 ? `${swapWait}s` : 'Biến hình'}</span>
          <kbd>F</kbd>
        </button>
        <button className={`ph-act${mine?.ry != null ? ' on' : ''}`} disabled={!mine} onClick={() => game.phLock()}>
          <span className="ic">{mine?.ry != null ? '🔒' : '🔓'}</span>
          <span>{mine?.ry != null ? 'Đã khoá' : 'Khoá góc'}</span>
          <kbd>R</kbd>
        </button>
        <button className="ph-act" disabled={tauntWait > 0} onClick={() => game.phTaunt()} title={`Trêu để được điểm (tối đa ${PH_TAUNTS} lần mỗi vòng)`}>
          <span className="ic">📢</span>
          <span>{tauntWait > 0 ? `${tauntWait}s` : 'Trêu'}</span>
          <kbd>T</kbd>
        </button>
        {v.phase === 'hide' && mine && (
          <button className="ph-act" onClick={() => game.phUnprop()}>
            <span className="ic">🧍</span>
            <span>Về người</span>
            <kbd>G</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
const getPhase = () => useStore.getState().ph?.phase;
const PROP_NAME = new Map(FURNITURE.filter((f) => PH_PROPS[f.kind]).map((f) => [f.id, PH_PROPS[f.kind]!.name]));

// ------------------------------------------------------------------ crosshair, blindfold, flashes
export function PropCrosshair() {
  const aim = useStore((s) => !!s.ph && s.ph.phase === 'seek' && s.ph.me.alive && s.ph.me.team === 'seeker');
  const mark = useStore((s) => s.phMark);
  useTick(120);
  if (!aim) return null;
  const fresh = mark && Date.now() - mark.at < 350 ? mark.kind : null;
  return (
    <div className={`ph-cross${fresh ? ` ${fresh}` : ''}`}>
      <i />
      <i />
      <i />
      <i />
      <b />
    </div>
  );
}

export function PropBlind() {
  const v = useStore((s) => s.ph);
  useTick(250);
  if (!v || !v.me.inGame || v.me.team !== 'seeker' || (v.phase !== 'hide' && v.phase !== 'roles')) return null;
  const left = v.phase === 'hide' ? v.until - serverNow() : v.until - serverNow() + v.settings.hideS * 1000;
  return (
    <div className="ph-blind">
      {/* (during the team card only the dark) */}
      <div className="ph-blind-card" style={{ visibility: v.phase === 'hide' ? 'visible' : 'hidden' }}>
        <div className="ph-blind-ic">🙈</div>
        <div className="ph-blind-t">Bạn đang bị nhốt trong phòng chờ</div>
        <div className="ph-blind-n">{secs(left)}</div>
        <div className="ph-blind-s">Phe trốn đang biến thành đồ vật… Nghe ngóng đi — cửa sắt sẽ mở khi hết giờ.</div>
      </div>
    </div>
  );
}

export function PropHurt() {
  const mark = useStore((s) => s.phMark);
  useTick(150);
  if (!mark || (mark.kind !== 'hurt' && mark.kind !== 'miss') || Date.now() - mark.at > 500) return null;
  return <div key={mark.at} className={`ph-flash ${mark.kind}`} />;
}

// ------------------------------------------------------------------ team card + score screens
export function PropSplash() {
  const v = useStore((s) => s.ph);
  useTick(500);
  if (!v || !v.me.inGame || v.phase !== 'roles' || !v.me.team) return null;
  const t = TEAM[v.me.team];
  const mates = v.players.filter((p) => p.team === v.me.team && p.id !== useStore.getState().me?.id).map((p) => p.name);
  return (
    <div className={`ph-splash ${t.cls}`}>
      <div className="ph-splash-round">Vòng {v.round}/{v.settings.rounds}</div>
      <div className="ph-splash-ic">{t.emoji}</div>
      <div className="ph-splash-t">Bạn là {t.name.toUpperCase()}</div>
      <div className="ph-splash-s">
        {v.me.team === 'hider'
          ? `Bạn có ${v.settings.hideS} giây: nhắm vào một món đồ rồi bấm Biến hình, tìm chỗ trà trộn và khoá góc cho thật tự nhiên.`
          : 'Chờ trong phòng chờ. Khi cửa mở: soi kỹ, đồ nào "lạ" thì đưa tâm ngắm vào rồi bắn (góc nhìn nào cũng bắn được, V để đổi) — nhưng bắn nhầm đồ thật là mất máu!'}
      </div>
      {mates.length > 0 && <div className="ph-splash-m">Cùng phe: {mates.join(', ')}</div>}
    </div>
  );
}

export function PropResult() {
  const v = useStore((s) => s.ph);
  const me = useStore((s) => s.me?.id ?? '');
  if (!v || !v.me.inGame || (v.phase !== 'roundEnd' && v.phase !== 'end')) return null;
  const sorted = [...v.players].sort((a, b) => b.score - a.score);
  const end = v.phase === 'end';
  const won = v.winner && v.me.team === v.winner;
  return (
    <div className={`ph-result${end ? ' final' : ''}`}>
      <div className="ph-result-card">
        {end ? (
          <>
            <div className="ph-result-ic">🏆</div>
            <div className="ph-result-t">Kết thúc!</div>
            <div className="ph-result-s">{v.why}</div>
          </>
        ) : (
          <>
            <div className="ph-result-ic">{v.winner === 'hider' ? '🪑' : '🔫'}</div>
            <div className={`ph-result-t ${v.winner ?? ''}`}>{v.winner === 'hider' ? 'Phe trốn thắng!' : 'Phe tìm thắng!'}</div>
            <div className="ph-result-s">
              {v.why} {won ? '🎉' : ''}
            </div>
          </>
        )}
        <ol className="ph-board">
          {sorted.map((p, i) => (
            <Row key={p.id} p={p} rank={i} me={p.id === me} />
          ))}
        </ol>
        {!end && v.round < v.settings.rounds && <div className="ph-result-next">Vòng {v.round + 1} — đổi phe! Bắt đầu sau vài giây…</div>}
      </div>
    </div>
  );
}

function Row({ p, rank, me }: { p: PhPlayer; rank: number; me: boolean }) {
  const players = useStore((s) => s.players);
  const myAvatar = useStore((s) => s.me?.avatar);
  return (
    <li className={me ? 'me' : ''}>
      <span className="ph-rank">{['🥇', '🥈', '🥉'][rank] ?? rank + 1}</span>
      <AvatarDot name={p.name} avatar={me ? myAvatar : players[p.id]?.avatar} size={24} />
      <span className="ph-name">{p.name}</span>
      <span className={`ph-team ${p.team}`}>{TEAM[p.team].emoji}</span>
      <span className="ph-how">{p.out?.how === 'found' ? `bị ${p.out.by} tìm ra · ${p.out.prop}` : p.out?.how === 'spent' ? 'hết máu' : p.out?.how === 'left' ? 'rời ván' : p.alive ? 'sống sót' : ''}</span>
      <span className="ph-pts">{p.score}</span>
    </li>
  );
}
