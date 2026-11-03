// Karaoke room UI: now playing + queue, YouTube search, mic & effects, the score card, lyrics view.
import { useEffect, useRef, useState } from 'react';
import { FX_PRESETS, KARA_MICS, KARA_REACTS, KARA_SCORE_MS, parseLen, type MicFx, type YtHit } from '../../shared/karaoke';
import { game } from '../game';
import { loadPref } from '../profile';
import { serverNow, setState, useStore } from '../store';
import { fmtClock } from './common';

function useTick(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function KaraokePanel() {
  const zone = useStore((s) => s.me?.zone);
  const open = useStore((s) => s.karaPanel);
  const tab = useStore((s) => s.karaTab);
  const kara = useStore((s) => s.kara);
  const zoom = useStore((s) => s.karaZoom);
  if (zone !== 'karaoke') return null;
  if (!open && !zoom)
    return (
      <button className="kara-pill glass" onClick={() => setState({ karaPanel: true })}>
        🎤 {kara.now ? kara.now.song.title || 'Đang hát' : 'Karaoke · chọn bài'}
      </button>
    );
  return (
    // stays mounted (hidden) in the lyrics view, so search results survive a look at the screen
    <div className="kara-panel glass" style={zoom || !open ? { display: 'none' } : undefined} onKeyDown={(e) => e.stopPropagation()}>
      <div className="kp-head">
        <b>🎤 Karaoke</b>
        <button className="kp-x" onClick={() => setState({ karaPanel: false })} title="Thu gọn">
          —
        </button>
      </div>
      <NowPlaying />
      <div className="kp-seg">
        <button className={tab === 'queue' ? 'on' : ''} onClick={() => setState({ karaTab: 'queue' })}>
          Hàng chờ{kara.queue.length ? ` · ${kara.queue.length}` : ''}
        </button>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setState({ karaTab: 'search' })}>
          ＋ Chọn bài
        </button>
        <button className={tab === 'mic' ? 'on' : ''} onClick={() => setState({ karaTab: 'mic' })}>
          Mic & âm thanh
        </button>
      </div>
      <div className="kp-body">{tab === 'queue' ? <QueueTab /> : tab === 'search' ? <SearchTab /> : <MicTab />}</div>
    </div>
  );
}

function NowPlaying() {
  useTick(500);
  const kara = useStore((s) => s.kara);
  const me = useStore((s) => s.me?.id ?? '');
  const now = kara.now;
  const holding = kara.mics.some((m) => m.id === me);
  const free = kara.mics.length < KARA_MICS;
  if (!now)
    return (
      <div className="kp-now idle">
        <div className="kp-empty-big">🎶</div>
        <div className="kp-title">Chưa ai hát</div>
        <div className="kp-sub">Chọn một bài — video có lời sẽ hiện trên màn hình lớn cho cả phòng.</div>
        <button className="btn primary wide" onClick={() => setState({ karaTab: 'search' })}>
          ＋ Chọn bài hát
        </button>
      </div>
    );
  const lead = now.pausedAt == null ? (now.startAt - serverNow()) / 1000 : 0;
  const pos = Math.max(0, now.pausedAt ?? (serverNow() - now.startAt) / 1000);
  const dur = now.song.dur || game.karaPlayer?.duration() || 0;
  const singers = kara.mics.map((m) => m.name).join(' & ');
  return (
    <div className="kp-now">
      <div className="kp-title">{now.song.title || 'Đang tải tên bài…'}</div>
      <div className="kp-sub">
        {lead > 0 ? `Bắt đầu sau ${Math.ceil(lead)} giây · ` : now.pausedAt != null ? 'Tạm dừng · ' : ''}
        {singers ? `🎤 ${singers}` : 'Chưa ai cầm mic'}
      </div>
      <div className="kp-bar">
        <i style={{ width: dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0%' }} />
      </div>
      <div className="kp-row">
        <span className="kp-time">
          {fmtClock(pos * 1000)} / {dur ? fmtClock(dur * 1000) : '--:--'}
        </span>
        <div className="kp-ctrl">
          {now.pausedAt != null ? (
            <button onClick={() => game.kara({ a: 'resume' })} title="Hát tiếp">
              ▶
            </button>
          ) : (
            <button onClick={() => game.kara({ a: 'pause' })} title="Tạm dừng">
              ❚❚
            </button>
          )}
          <button onClick={() => game.kara({ a: 'restart' })} title="Hát lại từ đầu">
            ↺
          </button>
          <button onClick={() => game.kara({ a: 'skip' })} title="Qua bài">
            ⏭
          </button>
          <button onClick={() => game.karaZoom(true)} title="Phóng to màn hình để xem lời">
            ⛶
          </button>
        </div>
      </div>
      {holding ? (
        <div className="kp-mine">
          <PhonesLine />
          <button className="btn" onClick={() => void game.karaMic(false)}>
            Trả mic
          </button>
        </div>
      ) : (
        <button className="btn primary wide" disabled={!free} onClick={() => void game.karaMic(true)}>
          {free ? '🎤 Cầm mic hát cùng' : '🎤 Hai mic đều có người'}
        </button>
      )}
      <div className="kp-react">
        {KARA_REACTS.map((e) => (
          <button key={e} onClick={() => game.karaReact(e)} title="Gửi cho cả phòng">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** While holding a mic: how you hear yourself, one click to change. */
function PhonesLine() {
  const phones = useStore((s) => s.karaPhones);
  const monitor = useStore((s) => s.karaMonitor);
  return (
    <button className="kp-phones-line" onClick={() => setState({ karaAsk: true })} title="Đổi tai nghe / loa ngoài">
      {phones ? (monitor ? '🎧 Đang nghe giọng mình' : '🎧 Tai nghe') : '🔊 Loa ngoài'} <u>đổi</u>
    </button>
  );
}

/** Headphones or speakers? Asked the first time you get a mic (and from the mic tab). */
export function KaraPhonesAsk() {
  const ask = useStore((s) => s.karaAsk);
  const zone = useStore((s) => s.me?.zone);
  if (!ask || zone !== 'karaoke') return null;
  return (
    <div className="kara-ask-bg" onClick={() => setState({ karaAsk: false })}>
      <div className="kara-ask" onClick={(e) => e.stopPropagation()}>
        <div className="ka-title">🎤 Bạn đang nghe bằng gì?</div>
        <div className="ka-sub">Để mình chỉnh mic cho đúng: có tai nghe thì bạn nghe được giọng mình (kèm echo, vang) ngay khi hát.</div>
        <div className="ka-opts">
          <button onClick={() => game.setKaraPhones(true)}>
            <b>🎧 Tai nghe</b>
            <span>Nghe giọng mình qua hiệu ứng như hát karaoke thật. Tắt lọc tiếng vọng để giọng trong hơn.</span>
          </button>
          <button onClick={() => game.setKaraPhones(false)}>
            <b>🔊 Loa ngoài</b>
            <span>Không phát lại giọng mình (tránh hú rít). Mọi người trong phòng vẫn nghe bạn hát.</span>
          </button>
        </div>
        <div className="ka-hint">Tai nghe Bluetooth có độ trễ: nếu nghe giọng mình bị lệch, giảm “Âm lượng nghe lại” hoặc dùng tai nghe cắm dây.</div>
      </div>
    </div>
  );
}

function QueueTab() {
  const queue = useStore((s) => s.kara.queue);
  const me = useStore((s) => s.me?.id ?? '');
  const players = useStore((s) => s.players);
  return (
    <>
      {queue.length ? (
        <ol className="kp-queue">
          {queue.map((q) => (
            <li key={q.sid}>
              <div>
                <div className="q-title">{q.title || 'Đang tải tên bài…'}</div>
                <div className="q-who">
                  {q.byName}
                  {q.dur ? ` · ${fmtClock(q.dur * 1000)}` : ''}
                </div>
              </div>
              {(q.by === me || !players[q.by]) && (
                <button className="q-x" onClick={() => game.kara({ a: 'remove', sid: q.sid })} title="Xoá khỏi hàng chờ">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="kp-empty">Hàng chờ trống. Mỗi người xếp được tối đa 5 bài.</div>
      )}
    </>
  );
}

const SUGGEST = ['Nơi này có anh', 'Em của ngày hôm qua', 'Hãy trao cho anh', 'Lạc trôi', 'Bước qua đời nhau', 'Có chàng trai viết lên cây', 'Waiting for you', 'Ngày mai người ta lấy chồng', 'Một đời', 'Tình yêu màu nắng'];

function SearchTab() {
  const [q, setQ] = useState('');
  const [onlyKara, setOnlyKara] = useState(true);
  const [hits, setHits] = useState<YtHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const search = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setErr('');
    try {
      const query = onlyKara && !/karaoke|beat/i.test(t) ? `${t} karaoke` : t;
      setHits(await game.karaSearch(query));
    } catch {
      setErr('Không tìm được lúc này 😢 — thử lại, hoặc dán link YouTube bên dưới.');
      setHits(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kp-search">
      <form
        className="kp-sform"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <input ref={input} className="input" placeholder="Tên bài hát, ca sĩ…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" disabled={!q.trim() || busy}>
          {busy ? '…' : '🔎'}
        </button>
      </form>
      <label className="kp-check">
        <input type="checkbox" checked={onlyKara} onChange={(e) => setOnlyKara(e.target.checked)} /> Chỉ tìm bản karaoke (có lời trên màn hình)
      </label>
      {err && <div className="kp-err">{err}</div>}
      {!hits && !busy && (
        <div className="kp-suggest">
          {SUGGEST.map((s) => (
            <button
              key={s}
              onClick={() => {
                setQ(s);
                void search(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {busy && <div className="kp-empty">Đang tìm trên YouTube…</div>}
      {hits && !busy && (
        <ul className="kp-hits">
          {hits.length === 0 && <li className="kp-empty">Không thấy bài nào — thử từ khoá khác nhé.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <img src={`https://i.ytimg.com/vi/${h.id}/mqdefault.jpg`} alt="" loading="lazy" />
              <div className="h-info">
                <div className="h-title">{h.title}</div>
                <div className="h-sub">
                  {h.channel} · {h.len}
                </div>
              </div>
              <button
                className={`btn${added.has(h.id) ? '' : ' primary'}`}
                onClick={() => {
                  game.karaAdd(h.id, h.title, parseLen(h.len));
                  setAdded(new Set(added).add(h.id));
                }}
              >
                {added.has(h.id) ? '✓' : '+'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="kp-sform link"
        onSubmit={(e) => {
          e.preventDefault();
          if (game.karaAddLink(link)) setLink('');
        }}
      >
        <input className="input" placeholder="…hoặc dán link YouTube" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn" disabled={!link.trim()}>
          Thêm
        </button>
      </form>
    </div>
  );
}

const ROOMS = ['Phòng nhỏ', 'Phòng karaoke', 'Hội trường'];

function MicTab() {
  const fx = useStore((s) => s.myFx) ?? FX_PRESETS[0].fx;
  const monitor = useStore((s) => s.karaMonitor);
  const monVol = useStore((s) => s.karaMonitorVol);
  const phones = useStore((s) => s.karaPhones);
  const mic = useStore((s) => s.media.mic);
  const [more, setMore] = useState(false);
  const [vol, setVol] = useState(() => loadPref('karaVolume', 80));
  const set = (patch: Partial<MicFx>) => game.setMyFx({ ...fx, ...patch });
  const preset = FX_PRESETS.find((p) => JSON.stringify(p.fx) === JSON.stringify(fx))?.id;
  return (
    <div className="kp-mic-tab">
      <div className="kp-field">
        <span>Mic của bạn</span>
        <VuMeter on={mic} />
      </div>
      <div className="kp-field">
        <span>Nghe bằng</span>
        <div className="kp-seg small">
          <button className={phones === true ? 'on' : ''} onClick={() => game.setKaraPhones(true)}>
            🎧 Tai nghe
          </button>
          <button className={phones === false ? 'on' : ''} onClick={() => game.setKaraPhones(false)}>
            🔊 Loa ngoài
          </button>
        </div>
      </div>
      {phones === true && (
        <label className="kp-check">
          <input type="checkbox" checked={monitor} onChange={(e) => game.setKaraMonitor(e.target.checked)} /> Nghe giọng mình khi hát
        </label>
      )}
      <div className="kp-label">Hiệu ứng giọng</div>
      <div className="kp-presets">
        {FX_PRESETS.map((p) => (
          <button key={p.id} className={preset === p.id ? 'on' : ''} onClick={() => game.setMyFx(p.fx)}>
            {p.label}
          </button>
        ))}
      </div>
      <Slider label="🔊 Nhạc" value={vol} min={0} max={100} step={1} fmt={(v) => `${v}%`} onChange={(v) => (setVol(v), game.setKaraVolume(v))} />
      <button className="kp-more" onClick={() => setMore(!more)}>
        {more ? '▾' : '▸'} Chỉnh chi tiết
      </button>
      {more && (
        <div className="kp-adv">
          <Slider label="Âm lượng mic" value={fx.vol} min={0} max={1.5} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ vol: v })} />
          <Slider label="Echo" value={fx.echo} min={0} max={1} step={0.02} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ echo: v })} />
          <Slider label="Độ trễ echo" value={fx.delay} min={0.06} max={0.45} step={0.01} fmt={(v) => `${Math.round(v * 1000)} ms`} onChange={(v) => set({ delay: v })} />
          <Slider label="Độ vang" value={fx.reverb} min={0} max={1} step={0.02} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ reverb: v })} />
          <div className="kp-rooms">
            {ROOMS.map((r, i) => (
              <button key={r} className={fx.room === i ? 'on' : ''} onClick={() => set({ room: i })}>
                {r}
              </button>
            ))}
          </div>
          <Slider label="Bass" value={fx.bass} min={-12} max={12} step={1} fmt={(v) => `${v > 0 ? '+' : ''}${v} dB`} onChange={(v) => set({ bass: v })} />
          <Slider label="Treble" value={fx.treble} min={-12} max={12} step={1} fmt={(v) => `${v > 0 ? '+' : ''}${v} dB`} onChange={(v) => set({ treble: v })} />
          {phones === true && monitor && <Slider label="Nghe lại" value={monVol} min={0} max={1.5} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => game.setKaraMonitorVol(v)} />}
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="kp-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <em>{fmt(value)}</em>
    </label>
  );
}

function VuMeter({ on }: { on: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let peak = 0;
    const loop = () => {
      const rms = game.rtc?.micRms ?? 0;
      const lvl = Math.min(1, Math.sqrt(rms) * 2.4);
      peak = Math.max(lvl, peak - 0.015);
      if (ref.current) {
        ref.current.style.setProperty('--lvl', `${lvl * 100}%`);
        ref.current.style.setProperty('--peak', `${peak * 100}%`);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="kp-vu" ref={ref} title={on ? 'Mức âm lượng mic' : 'Mic đang tắt'}>
      <i />
      <b />
      <span>{on ? 'MIC' : 'MIC TẮT'}</span>
    </div>
  );
}

/** The score after a song, for everyone in the room. */
export function KaraScore() {
  useTick(250);
  const last = useStore((s) => s.kara.last);
  const zone = useStore((s) => s.me?.zone);
  const [shown, setShown] = useState(0);
  const age = last ? serverNow() - last.at : Infinity;
  const visible = zone === 'karaoke' && !!last && age < KARA_SCORE_MS;
  useEffect(() => {
    if (!visible || !last) return;
    setShown(0);
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0 - 1300) / 900);
      setShown(k <= 0 ? Math.floor(Math.random() * 100) : Math.round(last.score * k + (1 - k) * Math.random() * 100));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [visible, last?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible || !last) return null;
  const stars = Math.max(1, Math.round(last.score / 20));
  const done = age > 2200;
  return (
    <div className="kara-score">
      <div className="ks-label">🎤 {last.singers}</div>
      <div className="ks-num">{shown}</div>
      <div className={`ks-stars${done ? ' on' : ''}`}>{'★'.repeat(stars) + '☆'.repeat(5 - stars)}</div>
      <div className={`ks-comment${done ? ' on' : ''}`}>{last.comment}</div>
      <div className="ks-song">{last.title}</div>
    </div>
  );
}

/** Lyrics view controls (the camera is parked in front of the LED wall). */
export function KaraZoomBar() {
  const zoom = useStore((s) => s.karaZoom);
  const zone = useStore((s) => s.me?.zone);
  useEffect(() => {
    if (!zoom) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'KeyV') game.karaZoom(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [zoom]);
  if (!zoom || zone !== 'karaoke') return null;
  return (
    <div className="kara-zoombar glass">
      {KARA_REACTS.slice(0, 4).map((e) => (
        <button key={e} onClick={() => game.karaReact(e)}>
          {e}
        </button>
      ))}
      <button className="kz-x" onClick={() => game.karaZoom(false)}>
        ✕ Thoát xem lời <kbd>Esc</kbd>
      </button>
    </div>
  );
}
