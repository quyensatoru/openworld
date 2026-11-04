import { useEffect, useState } from 'react';
import { ZONE_BY_ID } from '../../shared/map';
import type { CinemaState } from '../../shared/protocol';
import type { CinemaPlayer } from '../cinema/player';
import { game } from '../game';
import { setState, useStore } from '../store';
import { fmtClock } from './common';

interface PanelCfg {
  state: CinemaState | null;
  open: boolean;
  setOpen(open: boolean): void;
  player: CinemaPlayer | null;
  icon: string;
  title: string;
  pillIdle: string;
  idleText: string;
  playingLabel: string;
  resumeLabel: string;
  playLabel: string;
  hint: string;
  play(link: string): boolean;
  control(action: 'pause' | 'resume' | 'stop'): void;
  seek(delta: number): void;
  setVolume(v: number): void;
  stopTitle: string;
  className?: string;
}

/** Shared YouTube controls (cinema projector, bar jukebox): collapsible to a pill. */
function PlayerPanel(c: PanelCfg) {
  const [link, setLink] = useState('');
  const [vol, setVol] = useState(c.player?.volume ?? 100);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = c.state;
  if (!c.open)
    return (
      <button className={`cinema-pill glass ${c.className ?? ''}`} onClick={() => c.setOpen(true)}>
        {c.icon} {s ? (s.pausedAt != null ? '⏸️ ' : '▶️ ') + (s.title || c.playingLabel) : c.pillIdle} <small>· mở điều khiển</small>
      </button>
    );
  const pos = c.player?.position() ?? 0;
  const dur = c.player?.duration() ?? 0;
  return (
    <div className={`cinema-panel glass ${c.className ?? ''}`} onKeyDown={(e) => e.stopPropagation()}>
      <div className="cp-head">
        <b>
          {c.icon} {c.title}
        </b>
        <button className="close-x" style={{ position: 'static' }} onClick={() => c.setOpen(false)} title="Thu gọn">
          —
        </button>
      </div>
      {s ? (
        <>
          <div className="cp-title">{s.title || 'Đang tải video…'}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {s.pausedAt != null ? '⏸️ Tạm dừng' : `▶️ ${c.playingLabel}`} · {fmtClock(pos * 1000)}
            {dur ? ` / ${fmtClock(dur * 1000)}` : ''} · chọn bởi {s.byName}
          </div>
          <div className="cp-controls">
            <button className="btn" onClick={() => c.seek(-10)} title="Lùi 10 giây">
              ⏪
            </button>
            {s.pausedAt != null ? (
              <button className="btn primary" onClick={() => c.control('resume')}>
                ▶️ {c.resumeLabel}
              </button>
            ) : (
              <button className="btn" onClick={() => c.control('pause')}>
                ⏸️ Tạm dừng
              </button>
            )}
            <button className="btn" onClick={() => c.seek(10)} title="Tua 10 giây">
              ⏩
            </button>
            <button className="btn danger" onClick={() => c.control('stop')} title={c.stopTitle}>
              ⏹️
            </button>
          </div>
          <label className="cp-vol">
            🔊
            <input
              type="range"
              min={0}
              max={100}
              value={vol}
              onChange={(e) => {
                setVol(Number(e.target.value));
                c.setVolume(Number(e.target.value));
              }}
            />
          </label>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 13.5, margin: '4px 0 8px' }}>
          {c.idleText}
        </div>
      )}
      <form
        className="cp-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (c.play(link)) setLink('');
        }}
      >
        <input className="input" placeholder="https://youtube.com/watch?v=…" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn primary" disabled={!link.trim()}>
          {c.playLabel}
        </button>
      </form>
      <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.45 }}>
        {c.hint}
      </div>
    </div>
  );
}

/** Projector controls, shown while you are in the cinema. */
export function CinemaPanel() {
  const zone = useStore((s) => s.me?.zone);
  const open = useStore((s) => s.cinemaPanel);
  const cinema = useStore((s) => s.cinema);
  if (zone !== 'cinema') return null;
  return (
    <PlayerPanel
      state={cinema}
      open={open}
      setOpen={(o) => setState({ cinemaPanel: o })}
      player={game.cinema}
      icon="🎬"
      title="Rạp BSS"
      pillIdle="Máy chiếu"
      idleText="Máy chiếu đang tắt. Dán link YouTube để cả rạp cùng xem."
      playingLabel="Đang chiếu"
      resumeLabel="Chiếu tiếp"
      playLabel="Chiếu"
      hint="Chạm / click một ghế đỏ để ngồi — tự chuyển góc nhìn thứ nhất như ở rạp. Bấm — để thu gọn bảng này."
      play={(l) => game.cinemaPlay(l)}
      control={(a) => game.cinemaControl(a)}
      seek={(d) => game.cinemaSeek(d)}
      setVolume={(v) => game.setCinemaVolume(v)}
      stopTitle="Tắt máy chiếu"
    />
  );
}

/** Jukebox controls, shown while you are in the bar: anyone can pick the song for the room. */
export function BarPanel() {
  const zone = useStore((s) => s.me?.zone ?? '');
  const open = useStore((s) => s.barPanel);
  const jukebox = useStore((s) => s.jukebox);
  if (ZONE_BY_ID.get(zone)?.kind !== 'bar') return null;
  return (
    <PlayerPanel
      className="bar-panel"
      state={jukebox}
      open={open}
      setOpen={(o) => setState({ barPanel: o })}
      player={game.jukebox}
      icon="🎵"
      title="Jukebox BSS Bar"
      pillIdle="Nhạc DJ · chọn bài"
      idleText="Đang phát nhạc của DJ. Dán link YouTube để cả bar nghe bài bạn chọn (tự lặp lại)."
      playingLabel="Đang phát"
      resumeLabel="Phát tiếp"
      playLabel="Phát"
      hint="Bài hát hiện trên màn LED cạnh bàn DJ. Bấm ⏹️ để quay lại nhạc DJ. Đứng trên sàn LED là tự nhảy 💃"
      play={(l) => game.jukeboxPlay(l)}
      control={(a) => game.jukeboxControl(a)}
      seek={(d) => game.jukeboxSeek(d)}
      setVolume={(v) => game.setJukeboxVolume(v)}
      stopTitle="Tắt bài, quay lại nhạc DJ"
    />
  );
}
