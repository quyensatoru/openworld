// Floor 7, the wedding hall: the panel (roles, the programme, gift envelopes + wishes, outfits),
// the guests' quick actions (cheers, party poppers, petals), the big title when a step starts,
// and the little pop-ups for gifts and the bouquet.
import { useEffect, useState } from 'react';
import {
  ATTIRE_META,
  GIFT_AMOUNTS,
  STEP_META,
  WED_PROGRAM,
  WED_REACTS,
  WED_WISH_MAX,
  attireOf,
  inWedZone,
  money,
  nextStep,
  type WedAttire,
  type WedRole,
  type WedState,
} from '../../shared/wedding';
import { game } from '../game';
import { setState, useStore } from '../store';
import './wedding.css';

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

const onFloor = (zone: string | undefined) => inWedZone(zone);

export function WeddingPanel() {
  const s = useStore((st) => st.wed);
  const zone = useStore((st) => st.me?.zone);
  const open = useStore((st) => st.wedPanel);
  const tab = useStore((st) => st.wedTab);
  if (!onFloor(zone)) return null;
  const couple = s.groom && s.bride ? `${s.groom.name} ❤ ${s.bride.name}` : null;
  if (!open)
    return (
      <button className="wed-pill" onClick={() => setState({ wedPanel: true })}>
        💒 {couple ? `${couple} · ${STEP_META[s.step].emoji} ${STEP_META[s.step].name}` : 'Tiệc cưới · nhận vai cô dâu chú rể'}
      </button>
    );
  return (
    <div className="wed-panel">
      <div className="wed-head">
        <div className="wed-title">
          <b>💒 Tiệc cưới</b>
          <small>{couple ?? 'Chưa có cô dâu chú rể'}</small>
        </div>
        <button className="wed-x" onClick={() => setState({ wedPanel: false })} title="Thu gọn">
          —
        </button>
      </div>
      <div className="wed-tabs">
        {(
          [
            ['program', '💍 Hôn lễ'],
            ['gift', '💌 Mừng cưới'],
            ['dress', '👗 Trang phục'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setState({ wedTab: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="wed-body">{tab === 'program' ? <Program s={s} /> : tab === 'gift' ? <Gifts s={s} /> : <Dress s={s} zone={zone ?? ''} />}</div>
    </div>
  );
}

const ROLES: { role: WedRole; icon: string; name: string }[] = [
  { role: 'groom', icon: '🤵', name: 'Chú rể' },
  { role: 'bride', icon: '👰', name: 'Cô dâu' },
  { role: 'mc', icon: '🎙️', name: 'MC' },
];

function Program({ s }: { s: WedState }) {
  const me = useStore((st) => st.me?.id ?? '');
  const players = useStore((st) => st.players);
  const here = (id: string | undefined) => !!id && (id === me || onFloor(players[id]?.zone));
  const myRole = s.groom?.id === me ? 'groom' : s.bride?.id === me ? 'bride' : s.mc?.id === me ? 'mc' : null;
  const runners = [s.groom, s.bride, s.mc].filter((p) => p && here(p.id));
  const canRun = !!myRole || runners.length === 0;
  const ready = !!s.groom && !!s.bride;
  const cur = WED_PROGRAM.indexOf(s.step);
  return (
    <div className="wed-program">
      <div className="wed-roles">
        {ROLES.map((r) => {
          const p = s[r.role];
          const mine = p?.id === me;
          const free = !p || !here(p.id);
          return (
            <div key={r.role} className={`wed-role${mine ? ' mine' : ''}`}>
              <span className="wr-icon">{r.icon}</span>
              <span className="wr-text">
                <small>{r.name}</small>
                <b>{p ? p.name : '—'}</b>
              </span>
              {mine ? (
                <button className="wr-btn ghost" onClick={() => game.wed({ a: 'role', role: r.role, on: false })} disabled={s.step !== 'idle' && r.role !== 'mc'}>
                  Rời vai
                </button>
              ) : free ? (
                <button className="wr-btn" onClick={() => game.wed({ a: 'role', role: r.role, on: true })}>
                  Nhận vai
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {s.step === 'idle' ? (
        <div className="wed-start">
          {ready ? (
            canRun ? (
              <button className="wed-big" onClick={() => game.wed({ a: 'step', step: 'march' })}>
                👰🤵 Bắt đầu hôn lễ
              </button>
            ) : (
              <p className="wed-note">Đợi cô dâu, chú rể hoặc MC bắt đầu hôn lễ nhé 💐</p>
            )
          ) : (
            <p className="wed-note">Cần một chú rể và một cô dâu. Ai cũng nhận vai được (kể cả MC). Trong lúc chờ, ghé bàn mừng cưới ngoài sảnh nhé 💌</p>
          )}
        </div>
      ) : (
        <div className="wed-now">
          <div className="wn-label">Đang diễn ra</div>
          <div className="wn-step">
            {STEP_META[s.step].emoji} {STEP_META[s.step].name}
          </div>
          <div className="wn-mc">“{STEP_META[s.step].mc}”</div>
          {canRun && s.step !== 'party' && (
            <button className="wed-big" onClick={() => game.wed({ a: 'next' })}>
              Tiếp: {STEP_META[nextStep(s.step)].emoji} {STEP_META[nextStep(s.step)].name} ▶
            </button>
          )}
        </div>
      )}
      <ol className="wed-steps">
        {WED_PROGRAM.map((st, i) => (
          <li key={st} className={`${i === cur ? 'on' : ''}${i < cur ? ' done' : ''}`}>
            <button disabled={!canRun || !ready} onClick={() => game.wed({ a: 'step', step: st })} title={canRun ? 'Chuyển tới bước này' : ''}>
              <span className="ws-n">{i < cur ? '✓' : i + 1}</span>
              <span className="ws-name">
                {STEP_META[st].emoji} {STEP_META[st].name}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {s.step !== 'idle' && canRun && (
        <button className="wed-end" onClick={() => confirm('Kết thúc tiệc cưới? Sảnh sẽ trống cho cặp đôi tiếp theo.') && game.wed({ a: 'end' })}>
          🎊 Kết thúc tiệc cưới
        </button>
      )}
      <p className="wed-tip">🎙️ Ai đứng trên sân khấu thì cả sảnh tiệc đều nghe thấy (bật mic). {s.count ? `Đã có ${s.count} đám cưới ở đây 💕` : ''}</p>
    </div>
  );
}

function Gifts({ s }: { s: WedState }) {
  const [amount, setAmount] = useState<number>(500_000);
  const [wish, setWish] = useState('');
  const me = useStore((st) => st.me?.id ?? '');
  const couple = s.groom?.id === me || s.bride?.id === me;
  const send = () => {
    game.wed({ a: 'gift', amount, wish: wish.trim() });
    setWish('');
  };
  return (
    <div className="wed-gifts">
      {!couple && (
        <div className="wg-form">
          <div className="wg-label">Phong bì mừng cưới</div>
          <div className="wg-amounts">
            {GIFT_AMOUNTS.map((a) => (
              <button key={a} className={a === amount ? 'on' : ''} onClick={() => setAmount(a)}>
                {money(a)}
              </button>
            ))}
          </div>
          <textarea
            value={wish}
            maxLength={WED_WISH_MAX}
            placeholder="Lời chúc cho cô dâu chú rể (hiện lên màn hình lớn)…"
            onChange={(e) => setWish(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="wed-big" onClick={send}>
            💌 Bỏ phong bì vào thùng
          </button>
          <p className="wed-note">Tiền ảo cho vui thôi nhé 😄 — không ai bị trừ tiền thật đâu.</p>
        </div>
      )}
      <div className="wg-total">
        <span>💰 {s.givers} người mừng</span>
        <b>{money(s.total)}</b>
      </div>
      <ul className="wg-list">
        {[...s.gifts].reverse().map((g, i) => (
          <li key={`${g.at}-${i}`}>
            <div className="wgl-top">
              <b>{g.name}</b>
              <span>{money(g.amount)}</span>
            </div>
            {g.wish && <p>“{g.wish}”</p>}
          </li>
        ))}
        {!s.gifts.length && <li className="empty">Chưa có phong bì nào — hãy là người đầu tiên 💌</li>}
      </ul>
    </div>
  );
}

function Dress({ s, zone }: { s: WedState; zone: string }) {
  const me = useStore((st) => st.me?.id ?? '');
  const mine = attireOf(s, me);
  const couple = s.groom?.id === me || s.bride?.id === me;
  const inRoom = zone === 'bridal';
  return (
    <div className="wed-dress">
      {couple ? (
        <p className="wed-note">Bạn đang mặc trang phục {s.bride?.id === me ? 'cô dâu 👰' : 'chú rể 🤵'} — đi kèm vai diễn.</p>
      ) : !inRoom ? (
        <p className="wed-note">Vào 💄 Phòng cô dâu (bên phải sảnh đón khách) để thay đồ nhé.</p>
      ) : null}
      <div className="wd-grid">
        {(Object.keys(ATTIRE_META) as WedAttire[]).map((k) => (
          <button key={k} className={mine === k ? 'on' : ''} disabled={couple || !inRoom} onClick={() => game.wed({ a: 'attire', attire: mine === k ? null : k })}>
            <span className="wd-emoji">{ATTIRE_META[k].emoji}</span>
            <b>{ATTIRE_META[k].name}</b>
            <small>{ATTIRE_META[k].hint}</small>
          </button>
        ))}
      </div>
      {!couple && mine && inRoom && (
        <button className="wed-end" onClick={() => game.wed({ a: 'attire', attire: null })}>
          Thay lại đồ thường
        </button>
      )}
    </div>
  );
}

/** Quick actions for everyone on the floor. */
export function WeddingActions() {
  const zone = useStore((st) => st.me?.zone);
  const touch = useStore((st) => st.touch);
  if (!onFloor(zone)) return null;
  const reacts = touch ? (['👏', '❤️', '🎉'] as const) : WED_REACTS;
  return (
    <div className="wed-actions">
      {reacts.map((e) => (
        <button key={e} onClick={() => game.wedReact(e)} title="Thả cảm xúc">
          {e}
        </button>
      ))}
      <button className="wa-big" onClick={() => game.wed({ a: 'popper' })} title="Bắn pháo giấy">
        🎊
      </button>
      <button className="wa-big" onClick={() => game.wed({ a: 'petals' })} title="Tung cánh hoa">
        🌸
      </button>
    </div>
  );
}

/** The step's title across the screen for a few seconds. */
export function WeddingBanner() {
  const b = useStore((st) => st.wedBanner);
  const s = useStore((st) => st.wed);
  useTick(400);
  if (!b || Date.now() - b.at > 4800) return null;
  const m = STEP_META[b.step];
  const names = s.groom && s.bride ? `${s.groom.name} & ${s.bride.name}` : '';
  return (
    <div className="wed-banner" key={b.at}>
      <div className="wb-emoji">{m.emoji}</div>
      <div className="wb-name">{m.name}</div>
      {names && <div className="wb-names">{names}</div>}
      <div className="wb-mc">{m.mc}</div>
    </div>
  );
}

/** Gift envelopes and the bouquet: small pop-ups. */
export function WeddingPops() {
  const g = useStore((st) => st.wedGift);
  const c = useStore((st) => st.wedCatch);
  useTick(500);
  const now = Date.now();
  return (
    <>
      {g && now - g.at < 5000 && (
        <div className="wed-pop gift" key={`g${g.at}`}>
          <b>💌 {g.name}</b> mừng cưới <b>{money(g.amount)}</b>
          {g.wish && <p>“{g.wish}”</p>}
        </div>
      )}
      {c && now - c.at < 5500 && (
        <div className="wed-catch" key={`c${c.at}`}>
          <div className="wc-emoji">💐</div>
          {c.name ? (
            <>
              <div className="wc-name">{c.me ? 'Bạn' : c.name} đã bắt được hoa cưới!</div>
              <div className="wc-sub">{c.me ? 'Sắp tới lượt bạn lên xe hoa rồi 😉' : 'Đám cưới tiếp theo là của ai đây? 😉'}</div>
            </>
          ) : (
            <div className="wc-name">Bó hoa rơi xuống sàn… chưa ai bắt được 😅</div>
          )}
        </div>
      )}
    </>
  );
}
