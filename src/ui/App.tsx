import { Suspense, lazy, useEffect, useState } from 'react';
import { loadProfile } from '../profile';
import { setState, useStore } from '../store';
import { Toasts } from './Toasts';

// The 3D office (three.js, the world, every panel) is its own chunk: the login screen comes up on a
// small bundle, and the rest downloads while the passcode is being typed (see warmUp).
const loadOffice = () => import('./Office');
const loadCreator = () => import('./CharacterCreator');
const Office = lazy(() => loadOffice().then((m) => ({ default: m.Office })));
const CharacterCreator = lazy(() => loadCreator().then((m) => ({ default: m.CharacterCreator })));

/** Start fetching the office code without waiting for it (a failed fetch is retried by lazy()). */
function warmUp() {
  loadOffice().catch(() => {});
}

async function boot() {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    const s = (await res.json()) as { authed: boolean; office: string; needPasscode: boolean };
    setState({ officeName: s.office, needPasscode: s.needPasscode });
    document.title = s.office;
    if (!s.authed) {
      setState({ phase: 'login' });
      // the login card is up: fetch the office in the background while the passcode is typed
      window.setTimeout(warmUp, 300);
      return;
    }
    afterLogin();
  } catch {
    setState({ phase: 'login' });
  }
}

export function afterLogin() {
  // start downloading character models early (never in the way of the login screen: we are past it)
  import('../world/avatar/manifest').then((m) => m.avatars.init()).catch(() => {});
  const p = loadProfile();
  setState({ phase: p.name && p.avatar ? 'office' : 'creator' });
}

export function App() {
  const phase = useStore((s) => s.phase);
  useEffect(() => {
    boot();
  }, []);
  return (
    <>
      {phase === 'loading' && (
        <div className="screen">
          <div className="spinner" />
        </div>
      )}
      {phase === 'login' && <Login />}
      {(phase === 'creator' || phase === 'office') && (
        <Suspense
          fallback={
            <div className="screen">
              <div style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
                <div className="spinner" />
                <p className="muted">Đang tải văn phòng…</p>
              </div>
            </div>
          }
        >
          {phase === 'creator' && <CharacterCreator mode="first" onDone={() => setState({ phase: 'office' })} />}
          {phase === 'office' && <Office />}
        </Suspense>
      )}
      <Toasts />
    </>
  );
}

function Login() {
  const officeName = useStore((s) => s.officeName);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: code }) });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (j.ok) afterLogin();
      else setErr(j.error || 'Mã không đúng.');
    } catch {
      setErr('Không kết nối được máy chủ.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="blob" style={{ width: 340, height: 340, left: '8%', top: '12%', background: '#c9d6ff' }} />
      <div className="blob" style={{ width: 260, height: 260, right: '10%', bottom: '14%', background: '#f6c9e4', animationDelay: '-5s' }} />
      <div className="blob" style={{ width: 180, height: 180, right: '24%', top: '10%', background: '#c8ecd9', animationDelay: '-9s' }} />
      <div className="login-card glass">
        <div className="logo">🏢</div>
        <h1>{officeName}</h1>
        <p>Văn phòng của team — vào làm việc cùng nhau nào!</p>
        <form onSubmit={submit}>
          <input className="input" type="password" autoFocus placeholder="Nhập mã văn phòng" value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="error-text">{err}</div>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Đang kiểm tra…' : 'Vào văn phòng →'}
          </button>
        </form>
      </div>
    </div>
  );
}
