import { useEffect, useRef } from 'react';
import type { AvatarConfig } from '../../shared/avatar';
import { setState, useStore } from '../store';
import { AvatarDot } from './common';

function Video({ stream, muted = true }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} />;
}

function Tile({ name, label, avatar, cam, speaking, mic }: { name: string; label?: string; avatar?: AvatarConfig; cam: MediaStream | string | null; speaking: boolean; mic: boolean }) {
  return (
    <div className={`vtile${speaking ? ' speaking' : ''}`}>
      {typeof cam === 'string' ? (
        <img src={cam} alt="" />
      ) : cam ? (
        <Video stream={cam} />
      ) : (
        <div className="face">
          <AvatarDot name={name} avatar={avatar} />
        </div>
      )}
      <div className="name">
        {mic ? '🎙️ ' : '🔇 '}
        {label ?? name}
      </div>
    </div>
  );
}

export function VideoStrip() {
  const me = useStore((s) => s.me);
  const media = useStore((s) => s.media);
  const localCam = useStore((s) => s.localCam);
  const localScreen = useStore((s) => s.localScreen);
  const meSpeaking = useStore((s) => s.meSpeaking);
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);

  const connected = Object.values(peers).filter((p) => players[p.id]);
  if (!me || (!connected.length && !media.cam && !media.screen)) return null;

  return (
    <div className="videos">
      <Tile name={me.name} label={`${me.name} (bạn)`} avatar={me.avatar} cam={media.cam ? localCam : null} speaking={meSpeaking} mic={media.mic} />
      {media.screen && localScreen && (
        <div className="vtile screen" onClick={() => setState({ bigScreen: 'me' })} title="Phóng to">
          <Video stream={localScreen} />
          <div className="name">🖥️ Màn hình của bạn</div>
        </div>
      )}
      {connected.map((p) => {
        const pl = players[p.id];
        return (
          <div key={p.id} style={{ display: 'contents' }}>
            <Tile name={pl.name} avatar={pl.avatar} cam={pl.media.cam ? p.cam : null} speaking={p.speaking} mic={pl.media.mic} />
            {pl.media.screen && p.screen && (
              <div className="vtile screen" onClick={() => setState({ bigScreen: p.id })} title="Phóng to">
                <img src={p.screen} alt="" />
                <div className="name">🖥️ {pl.name}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
