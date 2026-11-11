import { useEffect, useRef, useState } from 'react';
import { ZONE_BY_ID } from '../../shared/map';
import { STATUS_META } from '../../shared/protocol';
import { daylight, localHour, weatherText } from '../../shared/weather';
import { game } from '../game';
import { loadPref, loadProfile, savePref } from '../profile';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../push';
import { getState, setState, useStore } from '../store';
import { TouchControls, setTouchUi } from './Touch';
import { Safe } from './Safe';
import { FpLookControls } from './FpLook';
import { CharacterCreator } from './CharacterCreator';
import { BigScreen } from './BigScreen';
import { BarPanel, CinemaPanel } from './Cinema';
import { ArcadePill, ArcadeWindow, LiftPanel } from './Arcade';
import { KaraPhonesAsk, KaraScore, KaraZoomBar, KaraokePanel } from './Karaoke';
import { WolfEnd, WolfNight, WolfPanel } from './Werewolf';
import { MOLE_ROOMS } from '../../shared/mole';
import { MoleActions, MoleCams, MoleEject, MoleEnd, MoleFog, MoleHud, MoleMeeting, MolePanel, MoleReveal, MoleSplash, MoleVent } from './Mole';
import { MoleTaskModal } from './MoleTasks';
import { PropActions, PropBlind, PropCrosshair, PropHud, PropHurt, PropPanel, PropResult, PropSplash } from './PropHunt';
import { PH_ROOM_IDS, phZone } from '../../shared/prophunt';
import { WeddingActions, WeddingBanner, WeddingGrab, WeddingHero, WeddingLightbox, WeddingPanel, WeddingPops } from './Wedding';
import { ClaudeConnect, ClaudeScreenModal } from './ClaudeScreen';
import { MeetingTvButton } from './MeetingTv';
import { VoiceStatus } from './VoiceStatus';
import { AvatarDot } from './common';
import { Kanban } from './Kanban';
import { AgentsPanel, ApprovalCards } from './Agents';
import { Minimap } from './Minimap';
import { SidePanel } from './SidePanel';
import { Toolbar } from './Toolbar';
import { VideoStrip } from './VideoStrip';

export function Office() {
  const ref = useRef<HTMLDivElement>(null);
  const kanbanOpen = useStore((s) => s.kanbanOpen);
  const creatorOpen = useStore((s) => s.creatorOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const helpOpen = useStore((s) => s.helpOpen);
  const installHelp = useStore((s) => s.installHelp);
  const panel = useStore((s) => s.panel);
  // theater mode: seated in the cinema while a film plays → hide almost everything, fade the rest when idle
  const inBar = useStore((s) => s.me?.zone === 'bar');
  const inKara = useStore((s) => s.me?.zone === 'karaoke');
  const inWolf = useStore((s) => s.me?.zone === 'wolfroom');
  const inMole = useStore((s) => !!s.me?.zone.startsWith('f5-'));
  const phRound = useStore((s) => !!s.ph?.me.inGame && ['roles', 'hide', 'seek', 'roundEnd'].includes(s.ph.phase));
  const theater = useStore((s) => s.me?.zone === 'cinema' && !!s.me.seat?.startsWith('cine-') && !!s.cinema && s.cinema.pausedAt == null) || inBar || inKara;
  const idle = useIdle(2500, theater);

  useEffect(() => {
    game.start(ref.current!);
    if (!loadPref('helpSeen', false)) {
      setState({ helpOpen: true });
      savePref('helpSeen', true);
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        setState({ panel: 'chat' });
        setTimeout(() => document.querySelector<HTMLInputElement>('.chat-input input')?.focus(), 30);
      } else if (e.key === 'Escape') {
        setState({ kanbanOpen: false, settingsOpen: false, helpOpen: false, installHelp: false, bigScreen: null, screenOf: null, arcadeOpen: false });
        if (getState().karaZoom) game.karaZoom(false);
      } else if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
        setState((s) => ({ kanbanOpen: !s.kanbanOpen }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      game.stop();
    };
  }, []);

  const glError = useStore((s) => s.glError);
  const touch = useStore((s) => s.touch);
  const cctv = useStore((s) => s.cctv);
  return (
    <div className={`office${touch ? ' touch' : ''}${cctv ? ' cctv-on' : ''}`} ref={ref}>
      {glError && <GraphicsHelp />}
      <div className={`hud${theater ? ' theater' : ''}${inBar || inKara ? ' bar-mode' : ''}${inKara ? ' kara-mode' : ''}${inWolf ? ' wolf-mode' : ''}${inMole ? ' mole-mode' : ''}${phRound ? ' ph-mode' : ''}${theater && idle ? ' idle' : ''}`}>
        <Safe><TopBar /></Safe>
        <Safe><VideoStrip /></Safe>
        <Safe><PlayerCard /></Safe>
        <Safe><Minimap /></Safe>
        {panel && <Safe><SidePanel /></Safe>}
        <Safe><CinemaPanel /></Safe>
        <Safe><BarPanel /></Safe>
        <Safe><ArcadePill /></Safe>
        <Safe><KaraokePanel /></Safe>
        <Safe><KaraZoomBar /></Safe>
        <Safe><WolfPanel /></Safe>
        <Safe><MolePanel /></Safe>
        <Safe><MoleHud /></Safe>
        <Safe><MoleActions /></Safe>
        <Safe><MoleVent /></Safe>
        <Safe><PropPanel /></Safe>
        <Safe><PropHud /></Safe>
        <Safe><PropActions /></Safe>
        <Safe><WeddingPanel /></Safe>
        <Safe><WeddingActions /></Safe>
        <Safe><WeddingHero /></Safe>
        <Safe><WeddingGrab /></Safe>
        <Safe><LiftPanel /></Safe>
        <Safe><Prompt /></Safe>
        <Safe><VoiceStatus /></Safe>
        <Safe><MeetingTvButton /></Safe>
        <Safe><TouchControls /></Safe>
        <Safe><Toolbar /></Safe>
        <Safe><Banners /></Safe>
      </div>
      <Safe><WolfNight /></Safe>
      <Safe><MoleFog /></Safe>
      <Safe><MoleCams /></Safe>
      <Safe><MoleMeeting /></Safe>
      <Safe><MoleEject /></Safe>
      <Safe><MoleSplash /></Safe>
      <Safe><MoleReveal /></Safe>
      <Safe><MoleEnd /></Safe>
      <Safe><MoleTaskModal /></Safe>
      <Safe><PropBlind /></Safe>
      <Safe><PropCrosshair /></Safe>
      <Safe><PropHurt /></Safe>
      <Safe><PropSplash /></Safe>
      <Safe><PropResult /></Safe>
      <Safe><WeddingBanner /></Safe>
      <Safe><WeddingPops /></Safe>
      <Safe><WeddingLightbox /></Safe>
      <Safe><KaraScore /></Safe>
      <Safe><KaraPhonesAsk /></Safe>
      <Safe><WolfEnd /></Safe>
      <Safe><ClaudeScreenModal /></Safe>
      <Safe><ArcadeWindow /></Safe>
      {kanbanOpen && <Kanban />}
      <Safe><AgentsPanel /></Safe>
      <Safe><ApprovalCards /></Safe>
      {creatorOpen && <CharacterCreator mode="edit" onDone={() => setState({ creatorOpen: false })} />}
      {settingsOpen && <Settings />}
      {helpOpen && <Help />}
      {installHelp && <InstallHelp />}
    </div>
  );
}

/** true after `ms` without mouse/keyboard activity (only tracked while `on`). */
function useIdle(ms: number, on: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!on) {
      setIdle(false);
      return;
    }
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [ms, on]);
  return idle;
}

const PLACES = [
  { id: 'office', floor: 0, icon: '🏢', name: 'Văn phòng', hint: 'Bàn làm việc · phòng họp · pantry', zones: ['workspace', 'library', 'lounge', 'meetA', 'meetB', 'pantry', 'lobby'] },
  { id: 'cinema', floor: 1, icon: '🎬', name: 'Rạp phim', hint: 'Xem YouTube cùng nhau', zones: ['cinema'] },
  { id: 'bar', floor: 1, icon: '🍸', name: 'Office Bar', hint: 'Nhạc · đồ uống · vòng quay', zones: ['bar'] },
  { id: 'netcafe', floor: 2, icon: '🎮', name: 'Phòng game', hint: 'Rắn săn mồi · cờ caro', zones: ['netcafe'] },
  { id: 'karaoke', floor: 3, icon: '🎤', name: 'Karaoke', hint: 'Hát cùng cả team', zones: ['karaoke'] },
  { id: 'wolfroom', floor: 3, icon: '🐺', name: 'Ma Sói', hint: '5–12 người · cần mic', zones: ['wolfroom'] },
  { id: 'mole', floor: 4, icon: '🕵️', name: 'Nội Gián', hint: '4–12 người · làm nhiệm vụ, tìm kẻ phá', zones: MOLE_ROOMS.map((r) => `f5-${r}`) },
  { id: 'prophunt', floor: 5, icon: '🪑', name: 'Trốn tìm biến hình', hint: '3–16 người · biến thành đồ vật để trốn', zones: PH_ROOM_IDS.map((r) => phZone(r)) },
  { id: 'wedding', floor: 6, icon: '💒', name: 'Tiệc cưới', hint: 'Làm cô dâu chú rể · mừng cưới · tung hoa', zones: ['wedding', 'hall7', 'bridal'] },
] as const;

/** Top-left: where you are + how many people are online; click to go somewhere else. */
function TopBar() {
  const zone = useStore((s) => s.me?.zone);
  const floor = useStore((s) => s.floor);
  const online = useStore((s) => Object.values(s.players).filter((p) => !p.agent).length + (s.me ? 1 : 0));
  const connected = useStore((s) => s.connected);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const zoneName = (zone ? ZONE_BY_ID.get(zone)?.name ?? '' : '…').replace(/\s*\(tầng \d\)/, '').replace(/ — .*/, '');
  return (
    <div className="topbar" ref={ref}>
      <div className="topbar-row">
      <button className={`loc-pill glass${open ? ' on' : ''}`} onClick={() => setOpen(!open)} title="Đi tới nơi khác">
        <span className="loc-floor">T{floor + 1}</span>
        <span className="loc-zone">{zoneName}</span>
        <span className="loc-online" title="Đang online">
          <span className={`conn${connected ? '' : ' off'}`} />
          {online}
        </span>
        <span className="loc-caret">▾</span>
      </button>
      <Safe><WeatherChip /></Safe>
      </div>
      {open && <PlacesMenu zone={zone ?? ''} onPick={() => setOpen(false)} />}
    </div>
  );
}

/** Hanoi's weather and local time — the same sky everyone in the office is looking at. */
function WeatherChip() {
  const w = useStore((s) => s.weather);
  const tz = useStore((s) => s.tzOffsetMinutes);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const hour = localHour(Date.now(), tz);
  const day = daylight(hour, w.sunrise, w.sunset);
  const { emoji, label } = weatherText(w, day < 0.35);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return (
    <div className="wx-pill glass" title={`${label} ở Hà Nội · ${w.tempC}° · mặt trời mọc ${fmtHour(w.sunrise)}, lặn ${fmtHour(w.sunset)}`}>
      <span className="wx-emoji">{emoji}</span>
      <span className="wx-temp">{w.tempC}°</span>
      <span className="wx-time">{`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`}</span>
    </div>
  );
}

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function PlacesMenu({ zone, onPick }: { zone: string; onPick(): void }) {
  const players = useStore((s) => s.players);
  const meZone = useStore((s) => s.me?.zone);
  const kara = useStore((s) => s.kara.now);
  const wed = useStore((s) => s.wed);
  const count = (zones: readonly string[]) => Object.values(players).filter((p) => zones.includes(p.zone)).length + (meZone && zones.includes(meZone) ? 1 : 0);
  const floors = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="places glass">
      <div className="places-title">Đi tới</div>
      {floors.map((f) => (
        <div key={f} className="places-floor">
          <div className="pf-label">Tầng {f + 1}</div>
          <div className="pf-items">
            {PLACES.filter((p) => p.floor === f).map((p) => {
              const here = (p.zones as readonly string[]).includes(zone);
              const n = count(p.zones);
              const live =
                p.id === 'karaoke' && kara
                  ? `🎶 ${kara.song.title || 'đang hát'}`
                  : p.id === 'wedding' && wed.groom && wed.bride
                    ? `💍 ${wed.groom.name} & ${wed.bride.name}${wed.step === 'idle' ? ' sắp cưới' : ' đang làm đám cưới'}`
                    : p.hint;
              return (
                <button
                  key={p.id}
                  className={`place${here ? ' here' : ''}`}
                  disabled={here}
                  onClick={() => {
                    game.travel(p.id);
                    onPick();
                  }}
                >
                  <span className="pl-icon">{p.icon}</span>
                  <span className="pl-text">
                    <b>{p.name}</b>
                    <small>{here ? 'Bạn đang ở đây' : live}</small>
                  </span>
                  {n > 0 && <span className="pl-count">👥 {n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Prompt() {
  const prompt = useStore((s) => s.prompt);
  if (!prompt) return null;
  const sitting = prompt.startsWith('Đang ngồi');
  return (
    <div className="prompt glass">
      {!sitting && <kbd>E</kbd>}
      <span>{prompt}</span>
    </div>
  );
}

function PlayerCard() {
  const id = useStore((s) => s.selected);
  const p = useStore((s) => (s.selected ? s.players[s.selected] : null));
  const task = useStore((s) => (p?.taskId ? s.tasks[p.taskId] : null));
  const hasScreen = useStore((s) => !!(s.selected && s.activity[s.selected]?.length && s.players[s.selected]?.seat));
  if (!id || !p) return null;
  const meta = STATUS_META[p.status];
  return (
    <div className="pcard glass">
      <button className="close-x" onClick={() => setState({ selected: null })}>
        ✕
      </button>
      <div className="row">
        <AvatarDot name={p.name} avatar={p.avatar} />
        <div>
          <div className="nm">{p.name}</div>
          <div className="st">
            {meta.emoji} {meta.label} · {game.phMasked(p.id) ? 'Tầng 6 · đang trốn 🙈' : ZONE_BY_ID.get(p.zone)?.name}
          </div>
        </div>
      </div>
      {(task || p.statusText) && <div className="task">{task ? `🔨 ${task.title}` : p.statusText}</div>}
      {hasScreen && (
        <button className="btn" style={{ width: '100%', marginTop: 10, background: '#2a2826', color: '#f5f5f4' }} onClick={() => setState({ screenOf: p.id })}>
          <span style={{ color: '#d97757' }}>✻</span> Xem màn hình Claude Code
        </button>
      )}
      <div className="acts">
        <button className="btn" onClick={() => game.wave(p.id)}>
          👋 Vẫy tay
        </button>
        <button className="btn" onClick={() => game.goToPlayer(p.id)}>
          🚶 Đi tới
        </button>
        <button
          className="btn"
          onClick={() => {
            setState({ panel: 'chat', chatTab: 'global', chatDraft: `@${p.name.split(/\s+/).pop()} ` });
            setTimeout(() => document.querySelector<HTMLInputElement>('.chat-input input')?.focus(), 40);
          }}
        >
          💬
        </button>
      </div>
    </div>
  );
}

/** 3D can't start: the browser has WebGL / graphics acceleration off. Explain how to fix it. */
function GraphicsHelp() {
  const isChrome = /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  const isEdge = /Edg\//.test(navigator.userAgent);
  const settings = isEdge ? 'edge://settings/system' : 'chrome://settings/system';
  const gpu = isEdge ? 'edge://gpu' : 'chrome://gpu';
  const copy = (t: string) => void navigator.clipboard?.writeText(t).catch(() => {});
  return (
    <div className="gl-help">
      <div className="gl-card">
        <div className="gl-icon">🖥️</div>
        <h2>Trình duyệt đang tắt đồ hoạ 3D</h2>
        <p className="muted">
          Văn phòng cần WebGL (đồ hoạ 3D) nhưng trình duyệt trên máy này đang chặn nó — thường do trình duyệt vừa cập nhật mà chưa khởi động lại, hoặc đã tắt “tăng tốc phần cứng”.
        </p>
        <ol>
          <li>
            <b>Khởi động lại trình duyệt</b> (nếu góc trên có nút “Finish update / Cập nhật” thì bấm vào nó). Hay gặp nhất, làm cái này trước.
          </li>
          {(isChrome || isEdge) && (
            <li>
              Mở <code onClick={() => copy(settings)}>{settings}</code> → bật <b>“Use graphics acceleration when available / Sử dụng tính năng tăng tốc phần cứng”</b> → bấm Relaunch.
            </li>
          )}
          {(isChrome || isEdge) && (
            <li>
              Vẫn lỗi? Mở <code onClick={() => copy(gpu)}>{gpu}</code>: nếu dòng WebGL ghi “Disabled” thì cập nhật driver card màn hình, hoặc thử trình duyệt khác (Edge / Firefox).
            </li>
          )}
          <li>Tắt bớt tab nặng (Figma, game, video…) rồi tải lại trang.</li>
        </ol>
        <p className="muted small">Bấm vào đường dẫn để copy, rồi dán vào thanh địa chỉ (trang web không tự mở được các trang cài đặt này).</p>
        <button className="btn primary" onClick={() => location.reload()}>
          🔄 Thử lại
        </button>
      </div>
    </div>
  );
}

function Banners() {
  const connected = useStore((s) => s.connected);
  const glLost = useStore((s) => s.glLost);
  const me = useStore((s) => s.me);
  const kicked = useStore((s) => s.kicked);
  const updateReady = useStore((s) => s.updateReady);
  const serverStale = useStore((s) => s.serverStale);

  if (kicked)
    return (
      <div className="modal-bg">
        <div className="modal glass" style={{ textAlign: 'center' }}>
          <h2>Bạn đã vào từ nơi khác</h2>
          <p className="muted">{kicked}</p>
          <button className="btn primary" onClick={() => location.reload()}>
            Dùng tab này
          </button>
        </div>
      </div>
    );
  return (
    <>
      {glLost && (
        <button className="banner glass update-banner" onClick={() => location.reload()}>
          ⚠️ Đồ hoạ 3D bị gián đoạn (card màn hình vừa khởi động lại) — đang khôi phục… bấm để tải lại trang
        </button>
      )}
      {updateReady && (
        <button className="banner glass update-banner" onClick={() => location.reload()}>
          🔄 Văn phòng vừa được nâng cấp — bấm để tải lại
        </button>
      )}
      {serverStale && (
        <button className="banner glass update-banner" onClick={() => location.reload()}>
          ⏳ Máy chủ đang chuyển sang bản mới — đợi một lát rồi bấm để tải lại (đừng bắt đầu ván lúc này)
        </button>
      )}
      {!connected && (
        <div className="banner glass">
          <div className="spinner" style={{ width: 18, height: 18, borderWidth: 3 }} />
          {me ? 'Mất kết nối — đang kết nối lại…' : 'Đang vào văn phòng…'}
        </div>
      )}
      <BigScreen />
    </>
  );
}

/** Opt-in to being told when the office gets busy — the only way to reach someone who left. */
function PushToggle() {
  const [state, setState_] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<boolean | null>(null);
  useEffect(() => {
    void pushState().then(setState_);
  }, []);
  if (state === null) return null;
  if (state === 'unsupported') return null;

  const toggle = async () => {
    setBusy(true);
    try {
      setSent(null);
      setState_(state === 'on' ? await disablePush() : await enablePush(loadProfile().cid));
    } finally {
      setBusy(false);
    }
  };
  const sendTest = async () => {
    setBusy(true);
    try {
      setSent(await testPush(loadProfile().cid));
    } finally {
      setBusy(false);
    }
  };
  const note =
    state === 'on'
      ? 'Khi có từ 3 người trở lên đang ở Office, bạn sẽ nhận được một thông báo. Nhiều nhất một lần mỗi 6 tiếng, và không bao giờ sau 22h.'
      : state === 'denied'
        ? 'Trình duyệt đang chặn thông báo của trang này. Mở phần cài đặt quyền của trình duyệt để bật lại.'
        : state === 'needs-install'
          ? 'Trên iPhone, thông báo chỉ hoạt động khi đã thêm Office vào màn hình chính. Bấm nút Chia sẻ → "Thêm vào MH chính", rồi mở lại từ đó.'
          : 'Đóng tab là hết biết khi nào có người. Bật cái này để được báo khi Office đông vui.';
  return (
    <div className="field">
      <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>Báo khi có người ở Office</label>
      <div className="chips">
        <button className={`chip${state === 'on' ? ' on' : ''}`} onClick={() => void toggle()} disabled={busy || state === 'denied' || state === 'needs-install'}>
          {state === 'on' ? '🔔 Đang bật' : '🔕 Đang tắt'}
        </button>
        {state === 'on' && (
          <button className="chip" disabled={busy} onClick={() => void sendTest()}>
            {sent === null ? '📨 Gửi thử' : sent ? '✅ Đã gửi' : '⚠️ Không gửi được'}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        {note}
      </p>
    </div>
  );
}

function Settings() {
  const quality = useStore((s) => s.quality);
  const fpsCap = useStore((s) => s.fpsCap);
  const touch = useStore((s) => s.touch);
  const ambience = useStore((s) => s.ambience);
  const close = () => setState({ settingsOpen: false });
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={close}>
          ✕
        </button>
        <h2>Cài đặt</h2>
        <Safe><PushToggle /></Safe>
        <div className="field">
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>Chất lượng đồ hoạ</label>
          <div className="chips">
            <button className={`chip${quality === 'high' ? ' on' : ''}`} onClick={() => game.setQuality('high')}>
              ✨ Đẹp
            </button>
            <button className={`chip${quality === 'low' ? ' on' : ''}`} onClick={() => game.setQuality('low')}>
              ⚡ Nhẹ (máy yếu)
            </button>
            <button className={`chip${quality === 'eco' ? ' on' : ''}`} onClick={() => game.setQuality('eco')}>
              🔋 Tiết kiệm pin
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {quality === 'high'
              ? 'Nét nhất, bóng đổ thật. Máy giật thì tự hạ độ phân giải một chút, mượt lại thì tự nâng lên.'
              : quality === 'low'
                ? 'Vẫn có bóng đổ, độ phân giải thường — hợp máy yếu, màn hình 4K.'
                : 'Không bóng đổ thật (vệt bóng mềm dưới chân), độ phân giải thường — đỡ nóng máy, đỡ tốn pin điện thoại.'}
          </p>
        </div>
        <div className="field">
          <label style={{ fontWeight: 600, display: 'block', margin: '18px 0 8px' }}>Khung hình / giây</label>
          <div className="chips">
            <button className={`chip${fpsCap === 60 ? ' on' : ''}`} onClick={() => game.setFpsCap(60)}>
              60
            </button>
            <button className={`chip${fpsCap === 0 ? ' on' : ''}`} onClick={() => game.setFpsCap(0)}>
              🚀 Tối đa
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {fpsCap === 60
              ? 'Đủ mượt cho mọi màn hình, máy mát hơn.'
              : 'Theo tần số màn hình (120/144 Hz): xoay camera mượt hơn, nhưng máy làm gấp đôi — nóng và tốn pin hơn. Màn 60 Hz thì không khác gì.'}
          </p>
        </div>
        <div className="field">
          <label style={{ fontWeight: 600, display: 'block', margin: '18px 0 8px' }}>Nút điều khiển cảm ứng (điện thoại, máy tính bảng)</label>
          <div className="chips">
            <button className={`chip${touch ? ' on' : ''}`} onClick={() => setTouchUi(!touch)}>
              {touch ? '📱 Đang hiện' : '📱 Đang ẩn'}
            </button>
          </div>
        </div>
        <div className="field">
          <label style={{ fontWeight: 600, display: 'block', margin: '18px 0 8px' }}>Góc nhìn thứ nhất — độ nhạy khi xoay (giảm xuống nếu thấy chóng mặt)</label>
          <FpLookControls />
        </div>
        <div className="field">
          <label style={{ fontWeight: 600, display: 'block', margin: '18px 0 8px' }}>Âm thanh không gian (gõ phím, điều hoà, bước chân, nhạc ở bar)</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className={`chip${ambience.on ? ' on' : ''}`} onClick={() => game.setAmbience(!ambience.on, ambience.volume)}>
              {ambience.on ? '🔊 Đang bật' : '🔈 Đang tắt'}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={ambience.volume} onChange={(e) => game.setAmbience(true, Number(e.target.value))} />
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <ClaudeConnect />
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 22 }}>
          <button className="btn" onClick={() => setState({ settingsOpen: false, creatorOpen: true })}>
            🧑‍🎨 Chỉnh nhân vật & tên
          </button>
          <button
            className="btn"
            onClick={() => {
              if ('Notification' in window) Notification.requestPermission();
            }}
          >
            🔔 Bật thông báo trên máy
          </button>
          <button className="btn" onClick={() => setState({ settingsOpen: false, helpOpen: true })}>
            ⌨️ Phím tắt & hướng dẫn
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST' });
              location.reload();
            }}
          >
            Đăng xuất khỏi văn phòng
          </button>
        </div>
      </div>
    </div>
  );
}

/** iPhone: Safari can't hide its bars for a page, but opened from the home screen the office has none. */
function InstallHelp() {
  const close = () => setState({ installHelp: false });
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass install-help" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={close}>
          ✕
        </button>
        <h2>Toàn màn hình trên iPhone 📱</h2>
        <p className="muted">Safari không cho trang web tự ẩn thanh địa chỉ. Thêm văn phòng ra màn hình chính là mở được như một app, không còn thanh nào:</p>
        <ol>
          <li>
            Bấm nút <b>Chia sẻ</b>{' '}
            <svg className="share-ico" viewBox="0 0 20 24" aria-hidden="true">
              <path d="M10 15V2M5.5 6.5 10 2l4.5 4.5M6.5 10H4v12h12V10h-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>{' '}
            của Safari (trên thanh địa chỉ, hoặc trong menu <b>⋯</b>)
          </li>
          <li>
            Chọn <b>Thêm vào MH chính</b> → <b>Thêm</b>
          </li>
          <li>
            Mở <b>Office</b> từ biểu tượng mới trên màn hình chính
          </li>
        </ol>
        <p className="muted" style={{ fontSize: 13 }}>
          Nhân vật của bạn đi theo sang app; lần đầu mở chỉ cần nhập lại mã văn phòng.
        </p>
        <button className="btn primary" style={{ width: '100%', marginTop: 6 }} onClick={close}>
          Đã hiểu
        </button>
      </div>
    </div>
  );
}

function Help() {
  const close = () => setState({ helpOpen: false });
  const touch = useStore((s) => s.touch);
  const touchRows: [string, string][] = [
    ['🕹️ Cần gạt (trái)', 'Kéo để đi — kéo hết cỡ để chạy'],
    ['✋ (phải)', 'Làm việc của phím E: ngồi, mở bảng, làm nhiệm vụ, đóng mở cửa…'],
    ['⤴', 'Nhảy — nhảy lên được bàn, ghế sofa, quầy, thùng hàng…'],
    ['Chạm', 'Chạm ghế để ngồi · chạm người để xem thông tin · chạm sàn để đi tới đó'],
    ['Vuốt / chụm 2 ngón', 'Xoay camera / phóng to thu nhỏ'],
    ['⋯', 'Góc nhìn thứ nhất, toàn màn hình, chụp ảnh, bảng công việc, cài đặt'],
    ['😄', 'Biểu cảm: vẫy tay, vỗ tay, ăn mừng, 🥂 cạn ly…'],
  ];
  const keyRows: [string, string][] = [
    ['W A S D / ← ↑ → ↓', 'Đi lại (giữ Shift để chạy)'],
    ['Click chuột trái', 'Đi tới chỗ đó · click ghế để ngồi · click người để tương tác'],
    ['Kéo chuột / cuộn', 'Xoay camera / phóng to thu nhỏ'],
    ['V', 'Góc nhìn thứ nhất ↔ thứ ba (ở góc thứ nhất: A/D để quay người)'],
    ['Cầu thang / thang máy', 'Tầng 2 (rạp phim, bar), tầng 3 (phòng game), tầng 4 (karaoke, ma sói): đi cầu thang ở sảnh, hoặc vào thang máy kính rồi bấm chọn tầng'],
    ['Space', 'Nhảy — nhảy lên được bàn, ghế sofa, quầy, thùng hàng… đi ra khỏi mép là rơi xuống'],
    ['E', 'Tương tác: ngồi xuống, mở Kanban, pha cà phê…'],
    ['1 – 9', 'Biểu cảm: vẫy tay, vỗ tay, ăn mừng, nhảy… · 9 = 🥂 cạn ly (đứng cạnh ai đó cùng bấm)'],
    ['📸', 'Chụp ảnh khung cảnh hiện tại, tải về máy'],
    ['🎮 Office Net', 'Phòng game tầng 3: ngồi vào máy để chơi Rắn săn mồi (cả phòng) hoặc Cờ caro với đồng nghiệp'],
    ['🎤 Karaoke', 'Tầng 4: tìm bài trên YouTube, cầm mic lên sân khấu, chỉnh echo/vang; cả phòng nghe và thả 👏🌹 — hết bài có chấm điểm'],
    ['🐺 Ma sói', 'Tầng 4: ngồi gốc cây quanh đống lửa (5–12 người), bật mic. Ban đêm chỉ bầy sói nghe được nhau, người chết chỉ nói với người chết'],
    ['🕵️ Nội Gián', 'Tầng 5: tham gia ở bảng trong sảnh (4–12 người). Nhân viên làm nhiệm vụ, nội gián loại người (Q), báo cáo (R), họp và bỏ phiếu'],
    ['🪑 Trốn tìm biến hình', 'Tầng 6 (3–16 người): người trốn biến thành đồ vật (F), khoá góc (R), trêu (T); người tìm bắn bóng — bắn nhầm đồ thật là mất máu'],
    ['💒 Tiệc cưới', 'Tầng 7: nhận vai cô dâu / chú rể / MC ở bảng ngoài sảnh rồi chạy chương trình — rước dâu, trao nhẫn, hôn, cắt bánh, rót tháp ly, nâng ly, tung hoa, nhảy. Khách mừng phong bì (tiền ảo) kèm lời chúc, bắn pháo giấy, tung hoa; thay đồ ở phòng cô dâu'],
    ['Enter', 'Mở chat'],
    ['K', 'Mở bảng Kanban'],
    ['Esc', 'Đóng cửa sổ / huỷ đi tới'],
  ];
  // phones: touch controls instead of the keyboard rows (the rest — floors, rooms — stays)
  const rows = touch ? [...touchRows, ...keyRows.filter(([k]) => !/^(W A S D|Click|Kéo chuột|V$|Space|E$|1 – 9)/.test(k))] : keyRows;
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={close}>
          ✕
        </button>
        <h2>Chào mừng đến văn phòng ảo 👋</h2>
        <div className="help-grid">
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <div>
                <kbd>{k}</kbd>
              </div>
              <div>{v}</div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 18 }}>
          🎙️ Bật mic rồi đi vào vòng tròn xanh của đồng nghiệp là nói chuyện được (càng xa càng nhỏ). Trong phòng họp ai cũng nghe thấy nhau, còn Thư viện là vùng yên tĩnh. Ngồi vào bàn để check-in giờ làm. Tầng 2 có 🎬 rạp phim (ngồi ghế đỏ, dán link YouTube là cả rạp cùng xem) và 🍸 Office Bar (đứng trên sàn LED là tự nhảy).
        </p>
        <button className="btn primary" style={{ width: '100%', marginTop: 6 }} onClick={close}>
          Bắt đầu thôi!
        </button>
      </div>
    </div>
  );
}
