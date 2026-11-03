// Nội Gián mini-games: one per task kind, plus the fuse box (blackout) and the overload console.
// Each calls `done()` when finished; the modal closes and the server is told.
import { useEffect, useRef, useState } from 'react';
import { MOLE_CRIT_MS, STATION_BY_ID, TASK_META, type MoleTaskKind } from '../../shared/mole';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function MoleTaskModal() {
  const t = useStore((s) => s.moleTask);
  useEffect(() => {
    if (!t) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setState({ moleTask: null });
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [t]);
  if (!t) return null;
  const done = () => game.moleTaskDone();
  const close = () => setState({ moleTask: null });
  let title = '';
  let how = '';
  let body: React.ReactNode = null;
  if (t.id === 'fuse') {
    title = '🔌 Hộp cầu dao';
    how = 'Bật tất cả cầu dao sang màu xanh để có điện lại.';
    body = <Fuse done={done} />;
  } else if (t.id.startsWith('mole-crit')) {
    title = '🚨 Sự cố quá tải server';
    how = 'Giữ nút cùng lúc với một người ở bảng điều khiển còn lại.';
    body = <CritHold id={t.id} />;
  } else {
    const st = STATION_BY_ID.get(t.id);
    if (!st) return null;
    const meta = TASK_META[st.kind];
    title = `${meta.emoji} ${meta.name}`;
    how = meta.how;
    body = <Game kind={st.kind} done={done} />;
  }
  return (
    <div className="mt-bg" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mt-card">
        <div className="mt-head">
          <b>{title}</b>
          <button className="mt-x" onClick={close} title="Đóng (Esc)">
            ✕
          </button>
        </div>
        <div className="mt-how">{how}</div>
        <div className="mt-body">{body}</div>
      </div>
    </div>
  );
}

function Game({ kind, done }: { kind: MoleTaskKind; done(): void }) {
  switch (kind) {
    case 'coffee':
      return <Coffee done={done} />;
    case 'bugs':
      return <Bugs done={done} />;
    case 'files':
      return <Files done={done} />;
    case 'plant':
      return <Plants done={done} />;
    case 'paper':
      return <Paper done={done} />;
    case 'code':
      return <Code done={done} />;
    case 'reboot':
      return <Hold done={done} secs={3.5} label="🔄 Giữ để khởi động lại" />;
    case 'scan':
      return <Hold done={done} secs={4} label="🩺 Giữ nút, đứng yên…" />;
  }
}

/** Little "✅ Xong!" pause before closing. */
function useFinish(done: () => void) {
  const [ok, setOk] = useState(false);
  const finish = () => {
    if (ok) return;
    setOk(true);
    setTimeout(done, 650);
  };
  return [ok, finish] as const;
}

function Coffee({ done }: { done(): void }) {
  const [band] = useState(() => {
    const lo = rnd(0.55, 0.72);
    return [lo, lo + 0.12] as const;
  });
  const [level, setLevel] = useState(0);
  const [pour, setPour] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, finish] = useFinish(done);
  useEffect(() => {
    if (!pour) return;
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setLevel((l) => {
        const n = l + dt * 0.32;
        if (n >= 1) {
          setPour(false);
          setMsg('☕ Tràn rồi! Rót lại nhé.');
          return 0;
        }
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pour]);
  const release = () => {
    if (!pour) return;
    setPour(false);
    if (level >= band[0] && level <= band[1]) finish();
    else {
      setMsg(level < band[0] ? 'Ít quá — rót lại nhé.' : 'Hơi quá vạch — rót lại nhé.');
      setLevel(0);
    }
  };
  return (
    <div className="mg-coffee">
      <div className="cup">
        <div className="band" style={{ bottom: `${band[0] * 100}%`, height: `${(band[1] - band[0]) * 100}%` }} />
        <div className="fill" style={{ height: `${level * 100}%` }} />
      </div>
      <button className={`mg-big${pour ? ' on' : ''}`} onPointerDown={() => (setMsg(''), setPour(true))} onPointerUp={release} onPointerLeave={release} disabled={ok}>
        {ok ? '✅ Xong!' : pour ? 'Đang rót…' : 'Giữ để rót'}
      </button>
      <div className="mg-msg">{msg}</div>
    </div>
  );
}

function Bugs({ done }: { done(): void }) {
  const NEED = 6;
  const [caught, setCaught] = useState(0);
  const [bug, setBug] = useState<{ x: number; y: number; k: number } | null>(null);
  const [ok, finish] = useFinish(done);
  useEffect(() => {
    if (ok) return;
    const spawn = () => setBug({ x: rnd(8, 88), y: rnd(10, 82), k: Math.random() });
    spawn();
    const t = setInterval(spawn, 1300);
    return () => clearInterval(t);
  }, [ok, caught]);
  return (
    <div className="mg-bugs">
      <div className="code">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="ln" style={{ width: `${30 + ((i * 37) % 60)}%` }} />
        ))}
        {bug && !ok && (
          <button
            className="bug"
            style={{ left: `${bug.x}%`, top: `${bug.y}%`, transform: `rotate(${bug.k * 360}deg)` }}
            onPointerDown={() => {
              setBug(null);
              const n = caught + 1;
              setCaught(n);
              if (n >= NEED) finish();
            }}
          >
            🐛
          </button>
        )}
      </div>
      <div className="mg-msg">{ok ? '✅ Sạch bug!' : `Đã bắt ${caught}/${NEED}`}</div>
    </div>
  );
}

function Files({ done }: { done(): void }) {
  const [order] = useState(() => [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5));
  const [next, setNext] = useState(1);
  const [shake, setShake] = useState(false);
  const [ok, finish] = useFinish(done);
  return (
    <div className="mg-files">
      <div className={`grid${shake ? ' shake' : ''}`}>
        {order.map((n) => (
          <button
            key={n}
            className={n < next ? 'got' : ''}
            disabled={n < next || ok}
            onClick={() => {
              if (n === next) {
                if (n === 9) finish();
                setNext(n + 1);
              } else {
                setShake(true);
                setTimeout(() => setShake(false), 350);
                setNext(1);
              }
            }}
          >
            📁<b>{n}</b>
          </button>
        ))}
      </div>
      <div className="mg-msg">{ok ? '✅ Gọn gàng!' : `Tiếp theo: ${next}`}</div>
    </div>
  );
}

function Plants({ done }: { done(): void }) {
  const LO = 0.6;
  const HI = 0.8;
  const [pots, setPots] = useState(() => [rnd(0.05, 0.3), rnd(0.05, 0.3), rnd(0.05, 0.3)]);
  const [msg, setMsg] = useState('');
  const [ok, finish] = useFinish(done);
  const water = (i: number) => {
    const n = [...pots];
    n[i] += rnd(0.12, 0.2);
    if (n[i] > 1) {
      n[i] = 0.3;
      setMsg('🌊 Úng mất rồi — đất được thay mới, tưới lại từ từ nhé.');
    } else setMsg('');
    setPots(n);
    if (n.every((v) => v >= LO && v <= HI)) finish();
  };
  return (
    <div className="mg-plants">
      {pots.map((v, i) => (
        <div key={i} className="pot">
          <div className="meter">
            <div className="zone" style={{ bottom: `${LO * 100}%`, height: `${(HI - LO) * 100}%` }} />
            <div className="lvl" style={{ height: `${v * 100}%` }} />
          </div>
          <div className="pl">{v >= LO && v <= HI ? '🌷' : v > HI ? '🥀' : '🌱'}</div>
          <button disabled={ok} onClick={() => water(i)}>
            💧 Tưới
          </button>
        </div>
      ))}
      <div className="mg-msg wide">{ok ? '✅ Cây tươi tốt!' : msg}</div>
    </div>
  );
}

function Paper({ done }: { done(): void }) {
  const [hp, setHp] = useState(() => [3, 3, 3, 3].map(() => 2 + Math.floor(Math.random() * 3)));
  const [ok, finish] = useFinish(done);
  return (
    <div className="mg-paper">
      <div className="printer">
        <div className="slot" />
        {hp.map((h, i) =>
          h > 0 ? (
            <button
              key={i}
              className="sheet"
              style={{ left: `${12 + i * 20}%`, transform: `translateY(${(5 - h) * 8}px) rotate(${(i - 1.5) * 6}deg)` }}
              onClick={() => {
                const n = [...hp];
                n[i]--;
                setHp(n);
                if (n.every((x) => x <= 0)) finish();
              }}
            >
              📄
            </button>
          ) : null,
        )}
      </div>
      <div className="mg-msg">{ok ? '✅ Máy in chạy lại rồi!' : `Còn ${hp.filter((x) => x > 0).length} tờ kẹt`}</div>
    </div>
  );
}

function Code({ done }: { done(): void }) {
  const make = () => String(Math.floor(10000 + Math.random() * 89999));
  const [code, setCode] = useState(make);
  const [show, setShow] = useState(true);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, finish] = useFinish(done);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 2000);
    return () => clearTimeout(t);
  }, [show]);
  const press = (d: string) => {
    if (show || ok) return;
    const n = (typed + d).slice(0, 5);
    setTyped(n);
    if (n.length === 5) {
      if (n === code) finish();
      else {
        setMsg('❌ Sai mã — xem lại nhé.');
        setTyped('');
        setCode(make());
        setShow(true);
      }
    }
  };
  return (
    <div className="mg-code">
      <div className="screen">{show ? code : typed.padEnd(5, '•')}</div>
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ' '].map((d) =>
          d === ' ' ? (
            <span key="sp" />
          ) : (
            <button key={d} disabled={show || ok} onClick={() => (d === '⌫' ? setTyped(typed.slice(0, -1)) : press(d))}>
              {d}
            </button>
          ),
        )}
      </div>
      <div className="mg-msg">{ok ? '✅ Đã đổi mật khẩu!' : show ? 'Ghi nhớ mã này…' : msg || 'Nhập lại mã'}</div>
    </div>
  );
}

function Hold({ done, secs, label }: { done(): void; secs: number; label: string }) {
  const [p, setP] = useState(0);
  const [hold, setHold] = useState(false);
  const [ok, finish] = useFinish(done);
  useEffect(() => {
    if (!hold || ok) return;
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setP((x) => {
        const n = Math.min(1, x + dt / secs);
        if (n >= 1) finish();
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [hold, ok]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mg-hold">
      <div className="bar">
        <i style={{ width: `${p * 100}%` }} />
      </div>
      <button className={`mg-big${hold ? ' on' : ''}`} onPointerDown={() => setHold(true)} onPointerUp={() => (setHold(false), !ok && setP(0))} onPointerLeave={() => (setHold(false), !ok && setP(0))}>
        {ok ? '✅ Xong!' : label}
      </button>
      <div className="mg-msg">{ok ? '' : 'Thả tay giữa chừng là phải làm lại.'}</div>
    </div>
  );
}

function Fuse({ done }: { done(): void }) {
  const [sw, setSw] = useState(() => {
    const a = [0, 1, 2, 3, 4].map(() => Math.random() < 0.5);
    if (a.every(Boolean)) a[2] = false;
    return a;
  });
  const [ok, finish] = useFinish(done);
  return (
    <div className="mg-fuse">
      <div className="switches">
        {sw.map((on, i) => (
          <button
            key={i}
            className={on ? 'on' : ''}
            disabled={ok}
            onClick={() => {
              const n = [...sw];
              n[i] = !n[i];
              setSw(n);
              if (n.every(Boolean)) finish();
            }}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="mg-msg">{ok ? '💡 Có điện rồi!' : `${sw.filter(Boolean).length}/5 cầu dao đã bật`}</div>
    </div>
  );
}

function CritHold({ id }: { id: string }) {
  const crit = useStore((s) => s.mole?.crit ?? 0);
  const held = useStore((s) => s.mole?.critHeld ?? []);
  const [hold, setHold] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!hold) return;
    const send = () => game.mole({ a: 'hold', console: id });
    send();
    timer.current = window.setInterval(send, 400);
    return () => clearInterval(timer.current);
  }, [hold, id]);
  useEffect(() => {
    if (!crit) setState({ moleTask: null });
  }, [crit]);
  const other = held.some((c) => c !== id);
  const left = Math.max(0, Math.ceil((crit - serverNow()) / 1000));
  return (
    <div className="mg-hold crit">
      <div className="crit-left">{left}s</div>
      <div className={`crit-other${other ? ' on' : ''}`}>{other ? '✅ Bảng bên kia đang được giữ!' : '⏳ Chờ người giữ bảng điều khiển còn lại…'}</div>
      <button className={`mg-big danger${hold ? ' on' : ''}`} onPointerDown={() => setHold(true)} onPointerUp={() => setHold(false)} onPointerLeave={() => setHold(false)}>
        {hold ? '✋ Đang giữ…' : '✋ Giữ nút'}
      </button>
      <div className="mg-msg">Không kịp trong {Math.round(MOLE_CRIT_MS / 1000)} giây là nội gián thắng!</div>
    </div>
  );
}
