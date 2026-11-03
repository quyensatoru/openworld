// First-person view comfort controls (Settings + the toolbar's ⋯ menu).
import { game } from '../game';
import { useStore } from '../store';

/** First-person view comfort: how fast the view turns, easing, head bob. */
export function FpLookControls({ compact }: { compact?: boolean }) {
  const fp = useStore((s) => s.fpLook);
  return (
    <div className={`fp-look${compact ? ' compact' : ''}`}>
      <div className="fp-row">
        <span>🐢</span>
        <input type="range" min={0.15} max={2} step={0.05} value={fp.sens} onChange={(e) => game.setFpLook({ sens: Number(e.target.value) })} aria-label="Độ nhạy xoay góc nhìn" />
        <span>🐇</span>
        <b>{Math.round(fp.sens * 100)}%</b>
      </div>
      <div className="chips">
        <button className={`chip${fp.smooth ? ' on' : ''}`} onClick={() => game.setFpLook({ smooth: !fp.smooth })}>
          🌊 Làm mượt {fp.smooth ? 'bật' : 'tắt'}
        </button>
        <button className={`chip${fp.bob ? ' on' : ''}`} onClick={() => game.setFpLook({ bob: !fp.bob })}>
          🚶 Rung khi đi {fp.bob ? 'bật' : 'tắt'}
        </button>
      </div>
    </div>
  );
}
