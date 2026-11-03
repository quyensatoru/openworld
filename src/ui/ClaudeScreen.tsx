import { useEffect, useState } from 'react';
import { game } from '../game';
import { serverNow, setState, useStore } from '../store';
import { isLive } from '../world/claude-screen';
import { fmtTime } from './common';

const SPIN = ['✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳'];

/** Full view of someone's Claude Code screen (click their monitor or "Xem màn hình"). */
export function ClaudeScreenModal() {
  const id = useStore((s) => s.screenOf);
  const name = useStore((s) => (s.screenOf ? (s.me?.id === s.screenOf ? s.me.name : s.players[s.screenOf]?.name ?? s.team[s.screenOf]?.name) : ''));
  const events = useStore((s) => (s.screenOf ? s.activity[s.screenOf] : undefined));
  const isMe = useStore((s) => s.me?.id === s.screenOf);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!id) return null;
  const close = () => setState({ screenOf: null });
  const live = isLive(events, serverNow());
  const project = events ? [...events].reverse().find((e) => e.project)?.project : undefined;

  return (
    <div className="modal-bg" onClick={close}>
      <div className="claude-term" onClick={(e) => e.stopPropagation()}>
        <div className="ct-bar">
          <span className="dot" style={{ background: '#ff5f57' }} onClick={close} />
          <span className="dot" style={{ background: '#febc2e' }} />
          <span className="dot" style={{ background: '#28c840' }} />
          <b>✻ Claude Code</b>
          <span className="ct-who">
            {name}
            {project ? ` · ${project}` : ''}
          </span>
        </div>
        <div className="ct-body">
          {!events?.length && (
            <div className="ct-empty">
              {isMe ? (
                <>
                  Chưa có hoạt động nào. Vào <b>Cài đặt → Màn hình Claude Code</b> để kết nối Claude Code của bạn — mọi người sẽ thấy bạn đang làm gì trên màn hình bàn làm việc.
                  <br />
                  <button className="btn primary" style={{ marginTop: 14 }} onClick={() => setState({ screenOf: null, settingsOpen: true })}>
                    Mở cài đặt
                  </button>
                </>
              ) : (
                `${name} chưa kết nối Claude Code với văn phòng.`
              )}
            </div>
          )}
          {events?.map((e, i) => (
            <div key={`${e.ts}-${i}`} className={`ct-line k-${e.kind}`}>
              <span className="ct-time">{fmtTime(e.ts)}</span>
              <span>
                {e.kind === 'prompt' ? '> ' : ''}
                {e.icon} {e.text}
              </span>
            </div>
          ))}
        </div>
        <div className="ct-status">
          {live ? <span style={{ color: '#d97757' }}>{SPIN[frame % SPIN.length]} Đang làm việc…</span> : <span>● Chờ lệnh</span>}
          {!isMe && game.world && (
            <button className="btn" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 13 }} onClick={() => (game.goToPlayer(id), close())}>
              🚶 Ghé qua bàn
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyRow({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 8 }}>
      <pre className="snippet" style={{ flex: 1, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {text}
      </pre>
      <button
        className="btn"
        style={{ whiteSpace: 'nowrap' }}
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? '✅ Đã copy' : `📋 ${label}`}
      </button>
    </div>
  );
}

/** Settings section: connect your Claude Code via hooks (one-line install / uninstall). */
export function ClaudeConnect() {
  const token = useStore((s) => s.activityToken);
  const [share, setShare] = useState(false);
  const endpoint = `${location.origin}/api/activity${share ? '?p=1' : ''}`;
  const script = `curl -fsSL ${location.origin}/claude-hook.cjs | node -`;
  const install = token ? `${script} install '${endpoint}' ${token}` : '';
  const uninstall = `${script} uninstall`;
  const cmd = token ? `curl -s -m 3 -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- '${endpoint}' >/dev/null 2>&1 || true # bss-office` : '';
  const hook = (matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] }];
  const snippet = token
    ? JSON.stringify({ hooks: { SessionStart: hook(), UserPromptSubmit: hook(), PostToolUse: hook('*'), Notification: hook(), Stop: hook() } }, null, 2)
    : '';
  return (
    <div className="claude-connect">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🤖 Màn hình Claude Code</div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Khi bạn <b>ngồi ở bàn</b>, màn hình máy tính trong văn phòng hiện Claude Code của bạn đang làm gì (sửa file nào, chạy lệnh gì…). Đứng dậy là màn hình tự tắt — lúc đó server bỏ qua mọi hoạt động, không cần gỡ gì. Chỉ gửi tên công cụ + tên file/mô tả lệnh, không gửi nội dung code.
      </div>
      {token === undefined || token === null ? (
        <button className="btn primary" style={{ marginTop: 10 }} onClick={() => game.requestActivityToken()}>
          Tạo mã kết nối
        </button>
      ) : (
        <>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, margin: '10px 0 6px' }}>
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            Hiện cả nội dung câu hỏi (prompt) cho mọi người
          </label>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            <b>Cài tự động</b> — dán vào terminal (cần Node), rồi mở lại Claude Code:
          </div>
          <CopyRow text={install} label="Copy" />
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            <b>Gỡ hẳn</b> (trả <code>~/.claude/settings.json</code> về như cũ, giữ nguyên các hook khác):
          </div>
          <CopyRow text={uninstall} label="Copy" />
          <details style={{ fontSize: 13, margin: '4px 0 10px' }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Hoặc tự thêm bằng tay vào settings.json</summary>
            <pre className="snippet">{snippet}</pre>
          </details>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => game.requestActivityToken()} title="Mã cũ sẽ ngừng hoạt động (chạy lại lệnh cài)">
              Đổi mã
            </button>
            <button className="btn danger" onClick={() => game.revokeActivityToken()} title="Vô hiệu mã hiện tại trên server">
              Ngắt kết nối
            </button>
          </div>
        </>
      )}
    </div>
  );
}
