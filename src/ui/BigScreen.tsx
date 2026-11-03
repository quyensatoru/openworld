import { useEffect, useRef, useState } from 'react';
import { nameOf, setState, useStore } from '../store';

/** Enlarged shared screen with wheel zoom + drag to pan — for reading code on someone's screen. */
export function BigScreen() {
  const big = useStore((s) => s.bigScreen);
  const stream = useStore((s) => (s.bigScreen === 'me' ? s.localScreen : null));
  const frame = useStore((s) => (s.bigScreen && s.bigScreen !== 'me' ? s.peers[s.bigScreen]?.screen ?? null : null));
  const ref = useRef<HTMLVideoElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [big]);
  if (!big || (!stream && !frame)) return null;
  const close = () => setState({ bigScreen: null });
  return (
    <div
      className="bigscreen"
      onWheel={(e) => setZoom((z) => Math.max(1, Math.min(5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
      onPointerDown={(e) => (drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y })}
      onPointerMove={(e) => drag.current && zoom > 1 && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => (setZoom(1), setPan({ x: 0, y: 0 }))}
    >
      {stream ? (
        <video ref={ref} autoPlay playsInline muted style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in' }} />
      ) : (
        <img src={frame!} alt="" draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in' }} />
      )}
      <div className="bs-bar glass" onPointerDown={(e) => e.stopPropagation()}>
        <span>🖥️ {big === 'me' ? 'Màn hình của bạn' : `Màn hình của ${nameOf(big)}`}</span>
        <button className="btn" onClick={() => setZoom((z) => Math.max(1, z / 1.3))}>−</button>
        <span style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={() => setZoom((z) => Math.min(5, z * 1.3))}>+</button>
        <button className="btn" onClick={close}>✕ Đóng</button>
      </div>
    </div>
  );
}
