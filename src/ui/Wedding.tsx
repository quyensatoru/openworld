// Floor 7, the wedding hall: the panel (roles, the programme, the band, gift envelopes + wishes,
// outfits), the guests' quick actions (cheers, party poppers, petals), the big contextual button
// (throw petals for the march, "Hôn đi!" for the kiss, "Dô!" at your table, a phone torch for the
// first dance, dance in the party), the bouquet grab, the big title when a step starts, and the
// little pop-ups for gifts and the bouquet.
import { useEffect, useRef, useState } from 'react';
import type { YtHit } from '../../shared/karaoke';
import {
  ATTIRE_META,
  BOUQUET_OPEN,
  GIFT_AMOUNTS,
  LIGHTS_META,
  LIGHTS_ORDER,
  SET_NAME,
  STEP_META,
  STEP_SET,
  WED_PROGRAM,
  WED_REACT_ROW,
  WED_SONGS,
  WED_T,
  WED_WISH_MAX,
  WED_MAX_PHOTOS,
  attireOf,
  canEditPhotos,
  coverPhoto,
  wedPhotoUrl,
  inWedZone,
  money,
  nextStep,
  parseLen,
  type WedAttire,
  type WedRole,
  type WedSet,
  type WedState,
} from '../../shared/wedding';
import { parseYouTube } from '../../shared/protocol';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';
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
      <LightSwitch s={s} />
      <div className="wed-tabs">
        {(
          [
            ['program', '💍 Hôn lễ'],
            ['music', '🎵 Nhạc'],
            ['gift', '💌 Mừng'],
            ['dress', '👗 Đồ'],
            ['photos', s.photos.length ? `📷 ${s.photos.length}` : '📷 Ảnh'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setState({ wedTab: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="wed-body">
        {tab === 'program' ? <Program s={s} /> : tab === 'music' ? <Music s={s} /> : tab === 'gift' ? <Gifts s={s} /> : tab === 'photos' ? <Photos s={s} /> : <Dress s={s} zone={zone ?? ''} />}
      </div>
    </div>
  );
}

/** The ballroom's house lights: everyone on the floor sees the same thing. */
function LightSwitch({ s }: { s: WedState }) {
  const me = useStore((st) => st.me?.id ?? '');
  const players = useStore((st) => st.players);
  const here = (id: string | undefined) => !!id && (id === me || onFloor(players[id]?.zone));
  const runner = [s.groom, s.bride, s.mc].some((p) => p?.id === me);
  const locked = s.step !== 'idle' && !runner && [s.groom, s.bride, s.mc].some((p) => p && here(p.id));
  return (
    <div className="wed-lights" title={locked ? 'Đang làm lễ — cô dâu, chú rể hoặc MC giữ công tắc đèn' : 'Đèn sảnh tiệc (mọi người cùng thấy)'}>
      <span className="wl-label">Đèn sảnh</span>
      {LIGHTS_ORDER.map((l) => (
        <button key={l} className={s.lights === l ? 'on' : ''} disabled={locked} onClick={() => game.wedLights(l)}>
          {LIGHTS_META[l].emoji} {LIGHTS_META[l].name}
        </button>
      ))}
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

/** Steps where anyone may change the music (during the ceremony it belongs to whoever runs it). */
const OPEN_MIC = new Set(['idle', 'feast', 'party']);
const SET_ORDER: WedSet[] = ['lounge', 'march', 'vows', 'toast', 'feast', 'bouquet', 'waltz', 'party'];

function Music({ s }: { s: WedState }) {
  const me = useStore((st) => st.me?.id ?? '');
  const players = useStore((st) => st.players);
  const vol = useStore((st) => st.wedVolume);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<YtHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const here = (id: string | undefined) => !!id && (id === me || onFloor(players[id]?.zone));
  const runner = [s.groom, s.bride, s.mc].some((p) => p?.id === me);
  const nobodyRuns = ![s.groom, s.bride, s.mc].some((p) => p && here(p.id));
  const can = OPEN_MIC.has(s.step) || runner || nobodyRuns;
  const m = s.music;
  const set = STEP_SET[s.step];
  const search = async () => {
    const text = q.trim();
    if (!text) return;
    if (parseYouTube(text)) {
      if (game.wedSongLink(text)) setQ('');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      setHits(await game.karaSearch(`${text}`));
    } catch {
      setErr('Không tìm được — thử lại hoặc dán link YouTube nhé');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wed-music">
      <div className="wm-now">
        <span className="wm-disc">🎵</span>
        <span className="wm-text">
          <small>{m.by ? `${m.by} chọn` : `Theo chương trình · ${SET_NAME[m.set]}`}</small>
          <b>{m.title}</b>
        </span>
        <button className="wr-btn" disabled={!can} onClick={() => game.wedSkip()} title="Chuyển sang bài khác">
          ⏭
        </button>
      </div>
      <label className="wm-vol">
        <span>{vol ? '🔊' : '🔇'}</span>
        <input type="range" min={0} max={100} value={vol} onChange={(e) => game.setWedVolume(Number(e.target.value))} />
        <b>{vol}</b>
      </label>
      {!can && <p className="wed-note">Đang làm lễ — chỉ cô dâu, chú rể hoặc MC mới đổi nhạc được 🎵</p>}
      <div className="wm-search">
        <input
          value={q}
          placeholder="Tìm bài trên YouTube hoặc dán link…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void search();
          }}
        />
        <button className="wr-btn" disabled={busy || !q.trim()} onClick={() => void search()}>
          {busy ? '…' : 'Tìm'}
        </button>
      </div>
      {err && <p className="wed-note">{err}</p>}
      {hits && (
        <ul className="wm-list">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id}>
              <span className="wml-t">
                <b>{h.title}</b>
                <small>
                  {h.channel} · {h.len}
                </small>
              </span>
              <button className="wr-btn" disabled={!can} onClick={() => game.wedSong(h.id, h.title, parseLen(h.len))}>
                ▶
              </button>
            </li>
          ))}
          {!hits.length && <li className="empty">Không thấy bài nào 😅</li>}
        </ul>
      )}
      <div className="wm-label">Nhạc cưới gợi ý</div>
      {SET_ORDER.map((k) => (
        <div key={k} className={`wm-set${k === set ? ' cur' : ''}`}>
          <div className="wms-name">
            {SET_NAME[k]}
            {k === set && <em> · đang tới phần này</em>}
          </div>
          <ul className="wm-list">
            {WED_SONGS[k].map((song) => (
              <li key={`${k}-${song.id}`} className={m.id === song.id ? 'on' : ''}>
                <span className="wml-t">
                  <b>{song.title}</b>
                </span>
                <button className="wr-btn" disabled={!can || m.id === song.id} onClick={() => game.wedSong(song.id, song.title, song.dur)}>
                  {m.id === song.id ? '♪' : '▶'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="wed-tip">Nhạc phát từ YouTube, cả sảnh nghe cùng một lúc. Chuyển phần lễ là ban nhạc tự đổi bài; trong lúc làm lễ chỉ cô dâu, chú rể, MC đổi được.</p>
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

/** The couple's album: the couple and the MC upload, pick the cover, order and remove; everyone looks. */
function Photos({ s }: { s: WedState }) {
  const me = useStore((st) => st.me?.id ?? '');
  const uploading = useStore((st) => st.wedUploading);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const can = canEditPhotos(s, me);
  const cover = coverPhoto(s)?.id;
  const room = WED_MAX_PHOTOS - s.photos.length;
  const pick = (files: FileList | null) => {
    if (files?.length) void game.wedUpload([...files]);
  };
  return (
    <div className="wed-photos">
      {can ? (
        <div
          className={`wp-drop${drag ? ' drag' : ''}${room <= 0 ? ' full' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files);
          }}
        >
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
          <button className="wed-big" disabled={room <= 0 || uploading > 0} onClick={() => input.current?.click()}>
            {uploading ? `⏳ Đang đăng ${uploading} ảnh…` : room <= 0 ? `Album đầy (${WED_MAX_PHOTOS} ảnh)` : '📷 Đăng ảnh cô dâu chú rể'}
          </button>
          <small>
            Chọn nhiều ảnh một lúc (hoặc kéo thả vào đây) · còn chỗ cho {Math.max(0, room)} ảnh. Ảnh được thu nhỏ trước khi gửi.
          </small>
        </div>
      ) : (
        <p className="wed-note">
          {s.groom && s.bride
            ? `Album của ${s.groom.name} & ${s.bride.name} — chỉ cô dâu, chú rể và MC đăng được ảnh.`
            : 'Khi có cô dâu và chú rể, họ (hoặc MC) đăng ảnh cưới ở đây 💕'}
        </p>
      )}
      {s.photos.length ? (
        <ul className="wp-grid">
          {s.photos.map((p, i) => (
            <li key={p.id} className={p.id === cover ? 'cover' : ''}>
              <button className="wp-thumb" onClick={() => setState({ wedView: i })} title="Xem lớn">
                <img src={wedPhotoUrl(p.id)} alt={`Ảnh cưới ${i + 1}`} loading="lazy" decoding="async" />
                {p.id === cover && <span className="wp-badge">Ảnh bìa</span>}
              </button>
              {can && (
                <div className="wp-tools">
                  <button title="Đưa lên biển cưới (ảnh bìa)" disabled={p.id === cover} onClick={() => game.wedPhoto(p.id, 'cover')}>
                    ⭐
                  </button>
                  <button title="Lên trước" disabled={i === 0} onClick={() => game.wedPhoto(p.id, 'left')}>
                    ◀
                  </button>
                  <button title="Xuống sau" disabled={i === s.photos.length - 1} onClick={() => game.wedPhoto(p.id, 'right')}>
                    ▶
                  </button>
                  <button title="Xoá ảnh" className="del" onClick={() => confirm('Xoá ảnh này khỏi album?') && game.wedPhoto(p.id, 'del')}>
                    🗑
                  </button>
                </div>
              )}
            </li>
          ))}
          {can && uploading > 0 && Array.from({ length: Math.min(uploading, room) }, (_, i) => <li key={`up${i}`} className="wp-ghost" />)}
        </ul>
      ) : (
        !uploading && <div className="wp-empty">Chưa có ảnh nào 🌸</div>
      )}
      <p className="wed-tip">
        🖼️ Ảnh bìa (⭐) hiện trên biển cưới ngoài sảnh; cả album chạy trên màn hình sân khấu lúc đón khách và treo trên tường ảnh cạnh bàn mừng cưới. Cặp đôi mới nhận vai sẽ bắt đầu album mới.
      </p>
    </div>
  );
}

/** One photo full screen (← → to flip through, Esc to close). */
export function WeddingLightbox() {
  const view = useStore((st) => st.wedView);
  const photos = useStore((st) => st.wed.photos);
  const s = useStore((st) => st.wed);
  const n = photos.length;
  const i = view === null || !n ? -1 : Math.min(n - 1, Math.max(0, view));
  useEffect(() => {
    if (i < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const go = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (e.key === 'Escape') setState({ wedView: null });
      else if (go) setState({ wedView: (i + go + n) % n });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, n]);
  if (i < 0) return null;
  const p = photos[i];
  const names = s.groom && s.bride ? `${s.groom.name} & ${s.bride.name}` : 'Album ảnh cưới';
  return (
    <div className="wed-lightbox" onClick={() => setState({ wedView: null })}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img key={p.id} src={wedPhotoUrl(p.id)} alt={`Ảnh cưới ${i + 1}`} />
        <figcaption>
          <b>{names}</b>
          <span>
            {i + 1} / {n} · {p.by} đăng
          </span>
        </figcaption>
      </figure>
      {n > 1 && (
        <>
          <button
            className="wl-nav prev"
            onClick={(e) => {
              e.stopPropagation();
              setState({ wedView: (i - 1 + n) % n });
            }}
            aria-label="Ảnh trước"
          >
            ‹
          </button>
          <button
            className="wl-nav next"
            onClick={(e) => {
              e.stopPropagation();
              setState({ wedView: (i + 1) % n });
            }}
            aria-label="Ảnh sau"
          >
            ›
          </button>
        </>
      )}
      <button className="wl-close" onClick={() => setState({ wedView: null })} aria-label="Đóng">
        ✕
      </button>
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
  const reacts = touch ? (['👏', '❤️', '🎉'] as const) : WED_REACT_ROW;
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

interface Hero {
  icon: string;
  label: string;
  sub?: string;
  go?: () => void;
  /** 0..1: a progress bar under the label. */
  meter?: number;
  hot?: boolean;
}

/** The one thing to do right now, big, in the middle (it changes with the programme and where you stand). */
export function WeddingHero() {
  const zone = useStore((st) => st.me?.zone);
  const s = useStore((st) => st.wed);
  const me = useStore((st) => st.me?.id ?? '');
  const chant = useStore((st) => st.wedChant);
  const dzo = useStore((st) => st.wedDzo);
  useTick(250);
  if (zone !== 'wedding') return null;
  const where = game.wedWhere();
  const now = serverNow();
  const el = now - s.stepAt;
  const couple = s.groom?.id === me || s.bride?.id === me;
  let h: Hero | null = null;
  const chanting = s.step === 'kiss' && !!s.kiss && s.kiss.at === null && s.kiss.goal > 0;
  if (chanting && s.kiss) {
    const k = Math.min(1, (chant && chant.stepAt === s.stepAt ? chant.n : s.kiss.n) / s.kiss.goal);
    h = couple
      ? { icon: '💋', label: 'Khách đang hô “Hôn đi!”', sub: 'Đầy thanh là… hôn thôi 😘', meter: k }
      : { icon: '💋', label: 'Hôn đi! Hôn đi!', sub: 'Bấm liên tục cho đầy thanh!', meter: k, go: () => game.wedChant(), hot: true };
  } else if (s.step === 'bouquet' && !couple && el > WED_T.bouquetCount - 2500 && !s.bouquet) {
    return null; // the bouquet grab takes the stage
  } else if (couple && s.step !== 'idle' && s.step !== 'party') {
    const nx = nextStep(s.step);
    h = { icon: STEP_META[nx].emoji, label: `Tiếp: ${STEP_META[nx].name}`, sub: 'Bấm khi sẵn sàng ▶', go: () => game.wed({ a: 'next' }) };
  } else if (where.table >= 0 && !couple) {
    const d = dzo[where.table];
    const counting = !!d && d.at > now;
    const joined = counting && d.ids.includes(me);
    h = counting
      ? joined
        ? { icon: '🍻', label: `Chờ cả bàn… ${Math.max(1, Math.ceil((d.at - now) / 1000))}`, sub: `${d.ids.length} ly đang nâng` }
        : { icon: '🍻', label: `Cùng dô! (${d.ids.length})`, sub: 'Bàn bạn đang nâng ly — nhanh lên!', go: () => game.wedDzo(), hot: true }
      : { icon: '🍻', label: 'Một, hai, ba — Dô!', sub: 'Rủ cả bàn cùng cụng ly', go: () => game.wedDzo() };
  } else if (!couple) {
    switch (s.step) {
      case 'march':
        h = { icon: '🌸', label: 'Tung hoa', sub: 'khi cô dâu chú rể đi qua', go: () => game.wed({ a: 'petals' }), hot: el > WED_T.marchGo };
        break;
      case 'vows':
      case 'rings':
        h = {
          icon: '👏',
          label: 'Vỗ tay chúc phúc',
          go: () => {
            game.wedReact('👏');
            game.emote('clap');
          },
        };
        break;
      case 'kiss':
        h = { icon: '🎊', label: 'Bắn pháo giấy', go: () => game.wed({ a: 'popper' }) };
        break;
      case 'cake':
        h = {
          icon: '🎉',
          label: 'Hò reo',
          go: () => {
            game.wedReact('🎉');
            game.emote('cheer');
          },
        };
        break;
      case 'champagne':
      case 'toast':
        h = {
          icon: '🥂',
          label: 'Nâng ly chúc mừng',
          go: () => {
            game.wedReact('🥂');
            game.emote('toast');
          },
        };
        break;
      case 'feast':
        h = { icon: '🍽️', label: 'Vào bàn tiệc', sub: 'ngồi vào ghế rồi bấm “Dô!” cùng cả bàn' };
        break;
      case 'dance':
        h = { icon: '📱', label: 'Bật đèn điện thoại', sub: 'lung linh cho điệu nhảy đầu tiên', go: () => game.wedGlow() };
        break;
      case 'party':
        h = where.onDance
          ? { icon: '💃', label: 'Quẩy lên!', sub: 'đứng trên sàn là tự nhảy theo nhạc', go: () => game.wedDance() }
          : { icon: '🕺', label: 'Nhảy!', sub: 'ra sàn nhảy giữa sảnh cho máu', go: () => game.wedDance() };
        break;
      case 'idle':
        if (s.groom && s.bride) h = { icon: '💌', label: 'Mừng cưới', sub: 'bỏ phong bì + lời chúc', go: () => setState({ wedPanel: true, wedTab: 'gift' }) };
        break;
    }
  }
  if (!h) return null;
  const Tag = h.go ? 'button' : 'div';
  return (
    <Tag className={`wed-hero${h.hot ? ' hot' : ''}${h.go ? '' : ' info'}`} onClick={h.go} {...(h.go ? { type: 'button' as const } : {})}>
      <span className="wh-icon">{h.icon}</span>
      <span className="wh-text">
        <b>{h.label}</b>
        {h.sub && <small>{h.sub}</small>}
        {h.meter !== undefined && (
          <span className="wh-meter">
            <i style={{ width: `${Math.round(h.meter * 100)}%` }} />
          </span>
        )}
      </span>
    </Tag>
  );
}

/** The bouquet toss: a big "CHỘP!" button with a ring that closes on the best moment to grab. */
export function WeddingGrab() {
  const zone = useStore((st) => st.me?.zone);
  const s = useStore((st) => st.wed);
  const me = useStore((st) => st.me?.id ?? '');
  const grab = useStore((st) => st.wedGrab);
  useTick(40);
  if (zone !== 'wedding' || s.step !== 'bouquet' || s.bouquet) return null;
  if (s.groom?.id === me || s.bride?.id === me) return null;
  const el = serverNow() - s.stepAt;
  if (el < WED_T.bouquetCount - 2500 || el > WED_T.bouquetResolve + 300) return null;
  const where = game.wedWhere();
  const open = el >= BOUQUET_OPEN;
  const mine = !!grab && grab.stepAt === s.stepAt;
  // the ring closes from 2.4× onto the button at the perfect moment, then opens again (too late)
  const k = (WED_T.bouquetPerfect - el) / (WED_T.bouquetPerfect - BOUQUET_OPEN);
  const ring = open ? 1 + 1.4 * Math.abs(k) : 2.4;
  const late = open && k < 0;
  const off = mine && grab ? (grab.el - WED_T.bouquetPerfect) / 1000 : 0;
  let hint = '';
  if (!where.catchZone) hint = '💐 Ra trước sân khấu (quanh sàn nhảy) mới giành được hoa cưới!';
  else if (!open) hint = el < WED_T.bouquetThrow ? `Cô dâu sắp tung hoa… bấm CHỘP! đúng lúc vòng tròn khép lại` : 'Chuẩn bị…';
  return (
    <div className="wed-grab">
      {hint && <div className="wgr-hint">{hint}</div>}
      <button
        type="button"
        className={`wgr-btn${mine ? ' done' : ''}${open && !mine && where.catchZone ? ' live' : ''}`}
        disabled={!open || mine || !where.catchZone}
        onPointerDown={(e) => {
          e.preventDefault();
          game.wedGrab();
        }}
      >
        {open && !mine && <span className={`wgr-ring${late ? ' late' : ''}`} style={{ transform: `scale(${ring.toFixed(3)})` }} />}
        <span className="wgr-label">{mine ? (Math.abs(off) < 0.08 ? '✨ Chuẩn từng li!' : `${off < 0 ? 'Sớm' : 'Trễ'} ${Math.abs(off).toFixed(2)} giây`) : '🙌 CHỘP!'}</span>
      </button>
      {mine && <div className="wgr-hint">Đã vươn tay — chờ xem hoa rơi vào ai… 🤞</div>}
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
              {c.off !== null && (
                <div className="wc-how">{c.tries > 1 ? `Nhanh tay nhất trong ${c.tries} người · lệch ${(c.off / 1000).toFixed(2)} giây` : `Chộp gọn — lệch ${(c.off / 1000).toFixed(2)} giây`}</div>
              )}
              {c.off === null && <div className="wc-how">Không ai kịp vươn tay — hoa rơi trúng người gần nhất 🍀</div>}
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
