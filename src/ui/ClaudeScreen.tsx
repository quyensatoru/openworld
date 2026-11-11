import { useEffect, useState } from 'react';
import { DEPTS, isDept, type DeptId } from '../../shared/agents';
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
            <div key={`${e.ts}-${i}`} className={`ct-line k-${e.kind}${e.icon === '❌' ? ' k-err' : ''}`}>
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

export function CopyRow({ text, label }: { text: string; label: string }) {
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
export function ClaudeConnect({ intro = true }: { intro?: boolean }) {
  const token = useStore((s) => s.activityToken);
  const [share, setShare] = useState(false);
  const [dept, setDept] = useState<DeptId>(() => (isDept(localStorage.getItem('office-agent-dept')) ? (localStorage.getItem('office-agent-dept') as DeptId) : 'dev'));
  const endpoint = `${location.origin}/api/activity?v=2${share ? '&p=1' : ''}`;
  const script = `curl -fsSL ${location.origin}/claude-hook.cjs | node -`;
  const install = token ? `${script} install '${endpoint}' ${token} ${dept}` : '';
  const uninstall = `${script} uninstall`;
  const cmd = token
    ? `[ -n "\${OFFICE_RUNNER:-}" ] || curl -sf -m 4 -X POST -H 'Authorization: Bearer ${token}' -H "X-Office-Dept: \${OFFICE_DEPT:-${dept}}" -H 'Content-Type: application/json' --data-binary @- '${endpoint}' 2>/dev/null || true # office-activity`
    : '';
  const hook = (matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmd }] }];
  const snippet = token
    ? JSON.stringify(
        {
          permissions: { allow: ['mcp__office'] },
          hooks: { SessionStart: hook(), UserPromptSubmit: hook(), PostToolUse: hook('*'), Notification: hook(), Stop: hook(), SessionEnd: hook() },
        },
        null,
        2,
      ) + `\n\n# và MCP:\nclaude mcp add --scope user --transport http office ${location.origin}/api/mcp --header "Authorization: Bearer ${token}"`
    : '';
  return (
    <div className="claude-connect">
      {intro && (
        <>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>🤖 Claude Code của bạn trong Office</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Mỗi phiên Claude Code trên máy bạn thành một <b>nhân viên ảo</b> ngồi ở bàn của phòng ban bạn chọn: màn hình hiện nó đang làm gì, nó đọc được sổ kinh nghiệm của công ty, chat thật với mọi người và bàn giao việc qua Kanban. Chỉ gửi tên công cụ + tên file/mô tả lệnh, không gửi nội dung code.
          </div>
        </>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, margin: '10px 0 0' }}>
        Phòng ban:
        <select
          className="input"
          style={{ width: 'auto', padding: '6px 10px' }}
          value={dept}
          onChange={(e) => {
            if (!isDept(e.target.value)) return;
            setDept(e.target.value);
            try {
              localStorage.setItem('office-agent-dept', e.target.value);
            } catch {
              /* private mode */
            }
          }}
        >
          {DEPTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon} {d.name}
            </option>
          ))}
        </select>
      </label>
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
