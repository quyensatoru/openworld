import { useEffect, useRef, useState } from 'react';
import { EMOTE_EMOJI, PICKER_EMOTES, STATUS_META, type Status } from '../../shared/protocol';
import { game } from '../game';
import { savePref } from '../profile';
import { serverNow, setState, useStore, type SidePanel } from '../store';
import { FpLookControls } from './FpLook';
import { Icon, fmtClock } from './common';

type Pop = 'status' | 'pomo' | 'emote' | 'more' | null;

const EMOTE_LABEL: Record<string, string> = {
  wave: 'Vẫy tay',
  clap: 'Vỗ tay',
  cheer: 'Ăn mừng',
  dance: 'Nhảy',
  think: 'Suy nghĩ',
  heart: 'Thả tim',
  coffee: 'Cà phê',
  laugh: 'Cười',
  toast: 'Cạn ly (đứng cạnh ai đó cùng bấm)',
};

export function Toolbar() {
  const media = useStore((s) => s.media);
  const meSpeaking = useStore((s) => s.meSpeaking);
  const me = useStore((s) => s.me);
  const panel = useStore((s) => s.panel);
  const unread = useStore((s) => s.unread);
  const viewMode = useStore((s) => s.viewMode);
  const ambience = useStore((s) => s.ambience);
  const [pop, setPop] = useState<Pop>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => me?.pomo && tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [me?.pomo]);
  useEffect(() => {
    if (!pop) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPop(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [pop]);

  const togglePanel = (p: SidePanel) => {
    const next = panel === p ? null : p;
    savePref('panel2', next);
    setState({ panel: next, ...(next === 'chat' ? { unread: 0 } : {}) });
  };

  const status = me?.status ?? 'online';
  const pomoLeft = me?.pomo ? me.pomo.endsAt - serverNow() : 0;

  return (
    <div ref={ref} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 0 }}>
      {pop === 'status' && (
        <div className="popover glass" style={{ left: 'calc(50% + 120px)' }}>
          <div className="menu-title">Trạng thái</div>
          <button className={`menu-item${!me?.statusManual ? ' on' : ''}`} onClick={() => (game.setStatus('auto'), setPop(null))}>
            ✨ Tự động theo vị trí <small>khuyên dùng</small>
          </button>
          {(Object.keys(STATUS_META) as Status[]).map((s) => (
            <button key={s} className={`menu-item${me?.statusManual && status === s ? ' on' : ''}`} onClick={() => (game.setStatus(s), setPop(null))}>
              {STATUS_META[s].emoji} {STATUS_META[s].label}
            </button>
          ))}
          <StatusText />
        </div>
      )}
      {pop === 'pomo' && (
        <div className="popover glass" style={{ left: 'calc(50% + 120px)' }}>
          <div className="menu-title">Pomodoro</div>
          {me?.pomo ? (
            <button className="menu-item" onClick={() => (game.stopPomodoro(), setPop(null))}>
              ⏹️ Dừng phiên {me.pomo.mode === 'focus' ? 'tập trung' : 'nghỉ'} <small>còn {fmtClock(pomoLeft)}</small>
            </button>
          ) : null}
          {(
            [
              ['focus', 25, '🍅 Tập trung 25 phút'],
              ['focus', 50, '🎧 Tập trung sâu 50 phút'],
              ['break', 5, '☕ Nghỉ ngắn 5 phút'],
              ['break', 15, '🌿 Nghỉ dài 15 phút'],
            ] as const
          ).map(([mode, min, label]) => (
            <button key={label} className="menu-item" onClick={() => (game.startPomodoro(mode, min), setPop(null))}>
              {label}
            </button>
          ))}
          <div className="muted" style={{ fontSize: 12.5, padding: '6px 12px 4px', lineHeight: 1.4 }}>
            Khi tập trung, bạn ở trạng thái 🎧 và không bị nối voice khi người khác đi ngang.
          </div>
        </div>
      )}
      {pop === 'emote' && (
        <div className="popover glass" style={{ left: '50%', minWidth: 260 }}>
          <div className="emote-grid">
            {PICKER_EMOTES.map((e, i) => (
              <button key={e} title={EMOTE_LABEL[e]} onClick={() => (game.emote(e), setPop(null))}>
                {EMOTE_EMOJI[e]}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
      )}

      {pop === 'more' && (
        <div className="popover glass more-menu" style={{ left: 'calc(50% + 120px)' }}>
          <button className="menu-item" onClick={() => setPop('status')}>
            <span className="dot" style={{ background: STATUS_META[status].color }} />
            {STATUS_META[status].label}
            <small>{me?.statusManual ? 'tự chọn' : 'tự động'} ›</small>
          </button>
          <button className="menu-item" onClick={() => setPop('pomo')}>
            🍅 Pomodoro <small>{me?.pomo ? fmtClock(pomoLeft) : 'tập trung 25 phút'} ›</small>
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => (setPop(null), void game.takePhoto())}>
            📸 Chụp ảnh khung cảnh
          </button>
          <button className="menu-item" onClick={() => (setPop(null), game.toggleView())}>
            {viewMode === 'first' ? '🎥 Về góc nhìn thứ ba' : '👁️ Góc nhìn thứ nhất'} <small>V</small>
          </button>
          {viewMode === 'first' && (
            <div className="menu-fp">
              <small>Độ nhạy xoay (giảm nếu chóng mặt)</small>
              <FpLookControls compact />
            </div>
          )}
          <button className="menu-item" onClick={() => game.setAmbience(!ambience.on, ambience.volume)}>
            {ambience.on ? '🔊' : '🔈'} Âm thanh văn phòng <small>{ambience.on ? 'đang bật' : 'đang tắt'}</small>
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => (setPop(null), setState({ kanbanOpen: true }))}>
            📋 Bảng công việc <small>K</small>
          </button>
          <button className="menu-item" onClick={() => (setPop(null), togglePanel('people'))}>
            👥 Mọi người
          </button>
          <button className="menu-item" onClick={() => (setPop(null), togglePanel('today'))}>
            📊 Hôm nay của tôi
          </button>
          <button className="menu-item" onClick={() => (setPop(null), setState({ settingsOpen: true }))}>
            ⚙️ Cài đặt
          </button>
        </div>
      )}

      <div className="toolbar glass">
        <button className={`tb ${media.mic ? 'media-on' : 'media-off'}${meSpeaking ? ' speaking' : ''}`} title={media.mic ? 'Tắt mic' : 'Bật mic'} onClick={() => game.toggleMic()}>
          {Icon.mic(media.mic)}
        </button>
        <button className={`tb opt ${media.cam ? 'media-on' : 'media-off'}`} title={media.cam ? 'Tắt camera' : 'Bật camera'} onClick={() => game.toggleCam()}>
          {Icon.cam(media.cam)}
        </button>
        <button className={`tb opt${media.screen ? ' media-on' : ''}`} title={media.screen ? 'Dừng chia sẻ' : 'Chia sẻ màn hình'} onClick={() => game.toggleScreen()}>
          {Icon.screen}
        </button>
        <div className="tb-sep" />
        <button className={`tb${pop === 'emote' ? ' on' : ''}`} onClick={() => setPop(pop === 'emote' ? null : 'emote')} title="Biểu cảm (phím 1-9)">
          😄
        </button>
        <button className={`tb${panel === 'chat' ? ' on' : ''}`} onClick={() => togglePanel('chat')} title="Chat (Enter)">
          💬{unread > 0 && panel !== 'chat' && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        {me?.pomo && (
          <button className="tb opt media-on" onClick={() => setPop(pop === 'pomo' ? null : 'pomo')} title="Pomodoro">
            🍅<span className="lbl">{fmtClock(pomoLeft)}</span>
          </button>
        )}
        <button className={`tb more${pop === 'more' || pop === 'status' || pop === 'pomo' ? ' on' : ''}`} onClick={() => setPop(pop ? null : 'more')} title="Thêm">
          <span className="dot" style={{ background: STATUS_META[status].color }} />
          ⋯
        </button>
      </div>
    </div>
  );
}

function StatusText() {
  const me = useStore((s) => s.me);
  const [text, setText] = useState(me?.statusText ?? '');
  return (
    <form
      style={{ padding: '6px 6px 2px', display: 'flex', gap: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (me) game.setStatus(me.status, text.trim());
      }}
    >
      <input className="input" style={{ padding: '7px 10px', fontSize: 13.5 }} maxLength={60} placeholder="Ghi chú: Đang deploy 🚀" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" style={{ padding: '7px 10px' }}>
        Lưu
      </button>
    </form>
  );
}
