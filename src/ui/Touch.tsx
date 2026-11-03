// Phone / tablet controls: a thumb stick (bottom-left), a "use" button that does whatever E would
// do (bottom-right, with what it does written above it), jump, and a hint to turn the phone sideways.
import { useEffect, useRef, useState } from 'react';
import { game } from '../game';
import { setState, useStore } from '../store';


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
  // a full-screen side panel (chat…) on a small screen: the thumbs belong to it
  const sheet = useStore((s) => !!s.panel) && window.innerWidth < 720;
  const busy = useStore((s) => s.kanbanOpen || s.creatorOpen || s.settingsOpen || s.arcadeOpen);
  if (!touch || task || sheet || busy) return null;
  const sitting = !!prompt?.startsWith('Đang ngồi');
  return (
    <>
      {!vent && <Stick />}
      <div className="t-right">
        {prompt && (
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
      <PortraitHint />
    </>
  );
}

/** Portrait phones: suggest turning sideways (once, dismissible). */
function PortraitHint() {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth * 1.15);
  const [gone, setGone] = useState(() => sessionStorage.getItem('bss-portrait-hint') === '1');
  useEffect(() => {
    const f = () => setPortrait(window.innerHeight > window.innerWidth * 1.15);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  if (!portrait || gone) return null;
  const close = () => {
    sessionStorage.setItem('bss-portrait-hint', '1');
    setGone(true);
  };
  return (
    <button className="t-hint glass" onClick={close}>
      📱↻ Xoay ngang để chơi dễ hơn <b>✕</b>
    </button>
  );
}

/** Toggle the touch controls by hand (Settings): a tablet with a keyboard, or a touch laptop. */
export function setTouchUi(on: boolean) {
  try {
    localStorage.setItem('bss-touch-ui', on ? '1' : '0');
  } catch {
    /* private mode */
  }
  setState({ touch: on });
}
