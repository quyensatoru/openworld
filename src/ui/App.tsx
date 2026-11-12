import { useEffect, useState } from 'react';
import { loadProfile } from '../profile';
import { setState, useStore } from '../store';
import { avatars } from '../world/avatar/manifest';
import { CharacterCreator } from './CharacterCreator';
import { Office } from './Office';
import { Toasts } from './Toasts';

async function boot() {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    const s = (await res.json()) as { authed: boolean; office: string; needPasscode: boolean };
    setState({ officeName: s.office, needPasscode: s.needPasscode });
    document.title = s.office;
    if (!s.authed) return setState({ phase: 'login' });
    afterLogin();
  } catch {
    setState({ phase: 'login' });
  }
}

export function afterLogin() {
  avatars.init(); // start downloading character models early
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
      {phase === 'creator' && <CharacterCreator mode="first" onDone={() => setState({ phase: 'office' })} />}
      {phase === 'office' && <Office />}
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
