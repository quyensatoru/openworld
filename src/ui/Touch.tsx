// Phone / tablet controls: a thumb stick (bottom-left), a "use" button that does whatever E would
// do (bottom-right, with what it does written above it), jump, a hint to turn the phone sideways and,
// once it is sideways, full screen (the browser's bars eat half of a landscape phone).
import { useEffect, useRef, useState } from 'react';
import { game } from '../game';
import { setState, useStore } from '../store';
import { canFullscreen, enterFullscreen, isFullscreen, isInstalled, isIos, isLandscape, onFullscreenChange } from './fullscreen';


const R = 52; // how far the knob travels (px)

function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const finger = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, on: false });
  const move = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    setKnob({ x: dx, y: dy, on: true });
    game.touchStick(dx / R, -dy / R);
  };
  const end = () => {
    finger.current = null;
    setKnob({ x: 0, y: 0, on: false });
    game.touchStick(0, 0);
  };
  useEffect(() => () => game.touchStick(0, 0), []);
  return (
    <div
      ref={base}
      className={`t-stick${knob.on ? ' on' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        finger.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => finger.current === e.pointerId && move(e)}
      onPointerUp={(e) => finger.current === e.pointerId && end()}
      onPointerCancel={end}
    >
      <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

export function TouchControls() {
  const touch = useStore((s) => s.touch);
  const prompt = useStore((s) => s.prompt);
  const task = useStore((s) => s.moleTask);
  const vent = useStore((s) => !!s.mole?.me.vent && s.mole.phase === 'play');
  const lift = useStore((s) => s.liftPanel != null);
  const cctv = useStore((s) => s.cctv);
  // a full-screen side panel (chat…) on a small screen: the thumbs belong to it
  const sheet = useStore((s) => !!s.panel) && window.innerWidth < 720;
  const busy = useStore((s) => s.kanbanOpen || s.creatorOpen || s.settingsOpen || s.arcadeOpen);
  // Nội Gián: the meeting / vote / role screens cover everything and you can't walk anyway
  const meeting = useStore((s) => !!s.mole?.me.inGame && ['roles', 'meeting', 'vote', 'result'].includes(s.mole.phase));
  useAutoFullscreen(touch);
  if (!touch || task || sheet || busy || cctv || meeting) return null;
  const sitting = !!prompt?.startsWith('Đang ngồi');
  // the lift panel already shows the choices — no bubble on top of it
  const showLabel = !!prompt && !lift;
  return (
    <>
      {!vent && <Stick />}
      <div className="t-right">
        {showLabel && (
          <button className="t-label" onClick={() => game.touchUse()}>
            {prompt}
          </button>
        )}
        <div className="t-btns">
          <button className="t-btn t-jump" onPointerDown={(e) => (e.preventDefault(), game.touchJump())} aria-label="Nhảy">
            ⤴
          </button>
          <button className={`t-btn t-use${prompt ? ' ready' : ''}`} disabled={!prompt} onPointerDown={(e) => (e.preventDefault(), game.touchUse())} aria-label="Dùng">
            {sitting ? '🧍' : '✋'}
          </button>
        </div>
      </div>
      <ScreenHint />
    </>
  );
}

function readFlag(store: () => Storage, key: string): boolean {
  try {
    return store().getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(store: () => Storage, key: string) {
  try {
    store().setItem(key, '1');
  } catch {
    /* private mode */
  }
}

const session = () => sessionStorage;
const local = () => localStorage;

/** Android / iPad: the first tap after turning the phone sideways goes full screen (the API only
 *  works inside a tap). Leave full screen yourself and it stays that way until you turn it again. */
function useAutoFullscreen(on: boolean) {
  useEffect(() => {
    if (!on || !canFullscreen() || isInstalled()) return;
    let wasLandscape = isLandscape();
    let armed = wasLandscape; // already sideways when the office opens
    const onTurn = () => {
      const l = isLandscape();
      if (l !== wasLandscape) armed = l;
      wasLandscape = l;
    };
    const onTap = (e: PointerEvent) => {
      if (!armed) return;
      armed = false;
      // the full-screen button handles itself; its ✕ means "no thanks"
      if ((e.target as Element | null)?.closest?.('.t-fs')) return;
      if (isLandscape() && !isFullscreen()) void enterFullscreen();
    };
    window.addEventListener('resize', onTurn);
    screen.orientation?.addEventListener('change', onTurn);
    window.addEventListener('pointerup', onTap, true);
    return () => {
      window.removeEventListener('resize', onTurn);
      screen.orientation?.removeEventListener('change', onTurn);
      window.removeEventListener('pointerup', onTap, true);
    };
  }, [on]);
}

/** Upright: suggest turning sideways. Sideways in a browser tab: a "full screen" button (on an iPhone
 *  it explains adding the office to the home screen — Safari can't hide its bars for a page). */
function ScreenHint() {
  const [, redraw] = useState(0);
  const [portraitGone, setPortraitGone] = useState(() => readFlag(session, 'office-portrait-hint'));
  // iPhone: once dismissed it stays dismissed (installing is a bigger ask than a tap)
  const fsStore = canFullscreen() ? session : local;
  const [fsGone, setFsGone] = useState(() => readFlag(fsStore, 'office-fs-hint'));
  const panel = useStore((s) => !!s.panel);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    window.addEventListener('resize', f);
    screen.orientation?.addEventListener('change', f);
    const off = onFullscreenChange(f);
    return () => {
      window.removeEventListener('resize', f);
      screen.orientation?.removeEventListener('change', f);
      off();
    };
  }, []);
  if (window.innerHeight > window.innerWidth * 1.15) {
    if (portraitGone) return null;
    const close = () => {
      setFlag(session, 'office-portrait-hint');
      setPortraitGone(true);
    };
    return (
      <button className="t-hint glass" onClick={close}>
        📱↻ Xoay ngang để chơi dễ hơn <b>✕</b>
      </button>
    );
  }
  const api = canFullscreen();
  if (fsGone || panel || !isLandscape() || isFullscreen() || isInstalled() || (!api && !isIos())) return null;
  return (
    <div className="t-fs glass">
      <button onClick={() => (api ? void enterFullscreen() : setState({ installHelp: true }))}>⛶ Toàn màn hình</button>
      <button
        className="x"
        aria-label="Ẩn"
        onClick={() => {
          setFlag(fsStore, 'office-fs-hint');
          setFsGone(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}

/** Toggle the touch controls by hand (Settings): a tablet with a keyboard, or a touch laptop. */
export function setTouchUi(on: boolean) {
  try {
    localStorage.setItem('office-touch-ui', on ? '1' : '0');
  } catch {
    /* private mode */
  }
  setState({ touch: on });
}
