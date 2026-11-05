import { useEffect, useRef, useState } from 'react';
import { CARO_N, type CaroGame } from '../../shared/arcade';
import { FLOOR_NAMES, SEAT_BY_ID, type Floor } from '../../shared/map';
import { drawSnake } from '../arcade/draw';
import { game } from '../game';
import { getState, serverNow, setState, useStore } from '../store';

const KEY_DIR: Record<string, number> = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

/** The PC screen in Office Net: pick a game, play with whoever is in the room. */
export function ArcadeWindow() {
  const open = useStore((s) => s.arcadeOpen);
  const tab = useStore((s) => s.arcadeTab);
  const seat = useStore((s) => (s.me?.seat ? SEAT_BY_ID.get(s.me.seat) : null));
  if (!open) return null;
  return (
    <div className="arcade-bg">
      <div className="arcade">
        <header>
          <b>🎮 Office Net</b>
          <span className="muted">{seat?.kind === 'pc' ? seat.label : ''}</span>
          <div className="arcade-tabs">
            <button className={tab === 'snake' ? 'on' : ''} onClick={() => setState({ arcadeTab: 'snake' })}>
              🐍 Rắn săn mồi
            </button>
            <button className={tab === 'caro' ? 'on' : ''} onClick={() => setState({ arcadeTab: 'caro' })}>
              ⭕ Cờ caro
            </button>
          </div>
          <button className="arcade-x" onClick={() => setState({ arcadeOpen: false })} title="Thu nhỏ (vẫn ngồi ở máy)">
            —
          </button>
        </header>
        {tab === 'snake' ? <SnakeTab /> : <CaroTab />}
      </div>
    </div>
  );
}

/** Pill to bring the game window back while seated at a PC. */
export function ArcadePill() {
  const open = useStore((s) => s.arcadeOpen);
  const atPc = useStore((s) => !!s.me?.seat?.startsWith('pc-'));
  if (open || !atPc) return null;
  return (
    <button className="cinema-pill glass arcade-pill" onClick={() => setState({ arcadeOpen: true })}>
      🎮 Mở game <small>· Office Net</small>
    </button>
  );
}

function SnakeTab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const me = useStore((s) => s.me?.id ?? '');
  const f = useStore((s) => s.snake);
  const joined = !!f && (f.queue.some((q) => q.id === me) || f.players.some((p) => p.id === me && f.phase === 'play'));
  const mine = f?.players.find((p) => p.id === me);

  useEffect(() => {
    let raf = 0;
    const g = ref.current!.getContext('2d')!;
    const loop = () => {
      drawSnake(g, getState().snake, serverNow(), { me });
      raf = requestAnimationFrame(loop);
    };
    loop();
    const key = (e: KeyboardEvent) => {
      const d = KEY_DIR[e.code];
      if (d === undefined) return;
      e.preventDefault();
      game.arcade({ a: 'snake:dir', d });
    };
    window.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key);
    };
  }, [me]);

  return (
    <div className="arcade-body">
      <canvas ref={ref} width={800} height={520} className="snake-canvas" />
      <div className="arcade-side">
        {joined ? (
          <button className="btn" onClick={() => game.arcade({ a: 'snake:leave' })}>
            🚪 Rời trận
          </button>
        ) : (
          <button className="btn primary" onClick={() => game.arcade({ a: 'snake:join' })}>
            ▶ Tham gia
          </button>
        )}
        <div className="muted small">
          {f?.phase === 'play' && mine && !mine.alive
            ? '💀 Bạn bị loại — chờ ván sau nhé!'
            : f?.phase === 'play' && !mine && joined
              ? 'Bạn sẽ vào từ ván sau.'
              : 'Mọi người trong phòng cùng vào một đấu trường. Ăn chấm sáng để dài ra, đâm vào tường hoặc rắn khác là thua. Người sống sót cuối cùng thắng!'}
        </div>
        <div className="keys">
          <kbd>↑</kbd>
          <div>
            <kbd>←</kbd>
            <kbd>↓</kbd>
            <kbd>→</kbd>
          </div>
          <span className="muted small">hoặc W A S D</span>
        </div>
        <div className="dpad">
          {(['↑', '→', '↓', '←'] as const).map((a, d) => (
            <button key={a} className={`d${d}`} onClick={() => game.arcade({ a: 'snake:dir', d })}>
              {a}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CaroTab() {
  const me = useStore((s) => s.me?.id ?? '');
  const g = useStore((s) => s.caro);
  const queued = useStore((s) => s.caroQueued);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const myMark = g ? (g.x === me ? 'x' : g.o === me ? 'o' : null) : null;
  const myTurn = !!g && !g.winner && g.turn === myMark;
  const left = g ? Math.max(0, Math.ceil((g.turnEnds - serverNow()) / 1000)) : 0;

  return (
    <div className="arcade-body caro">
      <Board g={g} myTurn={myTurn} />
      <div className="arcade-side">
        {g ? (
          <>
            <div className="caro-vs">
              <span className={`mark x${g.turn === 'x' && !g.winner ? ' turn' : ''}`}>✕ {g.xName}</span>
              <span className="muted">vs</span>
              <span className={`mark o${g.turn === 'o' && !g.winner ? ' turn' : ''}`}>◯ {g.oName}</span>
            </div>
            <div className="caro-status">{status(g, myMark, left)}</div>
            {!g.winner ? (
              <button className="btn" onClick={() => game.arcade({ a: 'caro:resign' })}>
                🏳️ Chịu thua
              </button>
            ) : (
              <>
                <button className="btn primary" onClick={() => game.arcade({ a: 'caro:queue' })}>
                  🔎 Tìm ván mới
                </button>
                <button className="btn" onClick={() => game.arcade({ a: 'caro:bot' })}>
                  🤖 Đấu với máy
                </button>
              </>
            )}
          </>
        ) : queued ? (
          <>
            <div className="caro-status">🔎 Đang chờ đối thủ… rủ ai đó ngồi máy bên cạnh bấm "Tìm đối thủ" nhé!</div>
            <button className="btn" onClick={() => game.arcade({ a: 'caro:cancel' })}>
              Huỷ
            </button>
            <button className="btn" onClick={() => game.arcade({ a: 'caro:bot' })}>
              🤖 Chơi với máy trong lúc chờ
            </button>
          </>
        ) : (
          <>
            <div className="muted small">Cờ caro 15×15: ai có 5 quân liền nhau (ngang, dọc hoặc chéo) trước là thắng. Mỗi lượt 30 giây.</div>
            <button className="btn primary" onClick={() => game.arcade({ a: 'caro:queue' })}>
              🔎 Tìm đối thủ
            </button>
            <button className="btn" onClick={() => game.arcade({ a: 'caro:bot' })}>
              🤖 Chơi với máy
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function status(g: CaroGame, mine: 'x' | 'o' | null, left: number): string {
  if (g.winner === 'draw') return '🤝 Hoà!';
  if (g.winner) {
    const why = g.reason === 'timeout' ? ' (hết giờ)' : g.reason === 'resign' ? ' (chịu thua)' : g.reason === 'left' ? ' (đối thủ rời đi)' : '';
    return g.winner === mine ? `🏆 Bạn thắng${why}!` : `😵 Bạn thua${why}`;
  }
  return g.turn === mine ? `👉 Lượt của bạn · ${left}s` : `⏳ Đối thủ đang nghĩ · ${left}s`;
}

function Board({ g, myTurn }: { g: CaroGame | null; myTurn: boolean }) {
  const board = g?.board ?? '.'.repeat(CARO_N * CARO_N);
  const line = new Set(g?.line ?? []);
  return (
    <div className={`caro-board${myTurn ? ' my-turn' : ''}`} style={{ gridTemplateColumns: `repeat(${CARO_N}, 1fr)` }}>
      {[...board].map((c, i) => (
        <button
          key={i}
          className={`cell${c !== '.' ? ` ${c}` : ''}${g?.last === i ? ' last' : ''}${line.has(i) ? ' win' : ''}`}
          disabled={!myTurn || c !== '.'}
          onClick={() => game.arcade({ a: 'caro:move', i })}
        >
          {c === 'x' ? '✕' : c === 'o' ? '◯' : ''}
        </button>
      ))}
    </div>
  );
}

/** Floor buttons, shown while you stand in a lift car. */
export function LiftPanel() {
  const at = useStore((s) => s.liftPanel);
  if (at == null) return null;
  return (
    <div className="lift-panel glass">
      <div className="lp-title">🛗 Thang máy · bạn đang ở tầng {at + 1}</div>
      {FLOOR_NAMES.map((name, f) => (
        <button key={f} className={`btn${f === at ? '' : ' primary'}`} disabled={f === at} onClick={() => game.world?.rideTo(f as Floor)}>
          {f === at ? '● ' : f > at ? '▲ ' : '▼ '}
          {name}
        </button>
      ))}
    </div>
  );
}
