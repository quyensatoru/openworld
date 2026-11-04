import { useEffect, useState } from 'react';
import { voiceMode, zoneAt } from '../../shared/map';
import { game } from '../game';
import { useStore } from '../store';

/** One line above the toolbar telling who you can hear — so "why can't we talk?" answers itself. */
export function VoiceStatus() {
  const mic = useStore((s) => s.media.mic);
  const me = useStore((s) => s.me);
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);
  const failed = useStore((s) => s.voiceFailed);
  const prompt = useStore((s) => s.prompt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, []);
  if (!me || (!mic && !Object.keys(peers).length)) return null;

  const around = Object.values(peers).map((p) => players[p.id]?.name).filter(Boolean);
  const pos = game.world?.positionOf(me.id);
  const zone = pos ? zoneAt(pos.x, pos.z) : null;
  void failed;

  let text: string;
  if (zone && voiceMode(zone) === 'none') text = '🤫 Thư viện là vùng yên tĩnh — ra ngoài để nói chuyện';
  else if (me.status === 'focus') text = '🎧 Bạn đang Tập trung nên voice tạm tắt';
  else if (around.length) text = `🔊 ${mic ? 'Đang nói/nghe với' : 'Đang nghe'}: ${around.join(', ')}`;
  else text = '🎙️ Mic đang bật — đi vào vòng tròn xanh của ai đó để nói chuyện';

  return <div className={`voice-status glass${prompt ? ' raised' : ''}`}>{text}</div>;
}
