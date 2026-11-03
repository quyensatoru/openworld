import { ZONE_BY_ID } from '../../shared/map';
import { game } from '../game';
import { useStore } from '../store';

/** In a meeting room: one obvious button to look at (and zoom into) the room TV. */
export function MeetingTvButton() {
  const zone = useStore((s) => s.me?.zone ?? '');
  const sharer = useStore((s) => Object.values(s.players).find((p) => p.zone === s.me?.zone && p.media.screen)?.name ?? (s.me?.media.screen ? 'bạn' : null));
  if (ZONE_BY_ID.get(zone)?.kind !== 'meeting') return null;
  return (
    <button className="tv-btn glass" onClick={() => game.openTv(zone)}>
      📺 {sharer ? `Xem màn hình của ${sharer}` : 'Nhìn TV'} <small>· zoom được</small>
    </button>
  );
}
