import { useEffect, useRef, useState } from 'react';
import { loadPref, savePref } from '../profile';
import { CINEMA, DANCE_FLOOR, KARA_STAGE, WOLF_FIRE, FLOOR_NAMES, FURNITURE, LIFTS, OFFICE_D, OFFICE_W, STAIRWAYS, UP_DX, WALLS, ZONES, floorOf, type Floor } from '../../shared/map';
import { STATUS_META } from '../../shared/protocol';
import { game } from '../game';
import { getState, useStore } from '../store';

const W = 176;
const S = W / OFFICE_W; // every floor is 40 x 28 m
const H = Math.round(OFFICE_D * S);
/** The minimap shows the floor you are on. */
function area(x: number) {
  return { x0: floorOf(x) * UP_DX, z0: 0, s: S, floor: floorOf(x) };
}
const onFloor = (x: number, f: number) => floorOf(x) === f;
const ZONE_COLOR: Record<string, string> = {
  focus: '#dfe3f2',
  lounge: '#f3e9dc',
  work: '#efe1c9',
  meeting: '#e3e6f5',
  pantry: '#f6f2ea',
  lobby: '#f1efea',
  cinema: '#4a3d5c',
  bar: '#3b2c3a',
  game: '#2f3550',
  karaoke: '#3a2a52',
  wolf: '#5a4330',
  mole: '#cfd4de',
};

/** Small map of your floor; folds into a round button (remembered). */
export function Minimap() {
  const [open, setOpen] = useState(() => loadPref('minimapOpen', false));
  const floor = useStore((st) => st.floor);
  const toggle = (o: boolean) => {
    setOpen(o);
    savePref('minimapOpen', o);
  };
  if (!open)
    return (
      <button className="minimap-btn glass" onClick={() => toggle(true)} title="Mở bản đồ">
        🗺️ <b>T{floor + 1}</b>
      </button>
    );
  return <MapCanvas onClose={() => toggle(false)} />;
}

function MapCanvas({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ x0: 0, z0: 0, s: S, floor: 0 as Floor });

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const g = canvas.getContext('2d')!;
    const draw = () => {
      const st = getState();
      const mePos = st.me ? game.world?.positionOf(st.me.id) : null;
      const a = area(mePos?.x ?? 0);
      viewRef.current = a;
      const S = a.s;
      g.setTransform(dpr, 0, 0, dpr, -a.x0 * S * dpr, -a.z0 * S * dpr);
      g.clearRect(a.x0 * S, a.z0 * S, W, H);
      for (const z of ZONES) {
        if (!onFloor(z.x0, a.floor)) continue;
        g.fillStyle = ZONE_COLOR[z.kind];
        g.fillRect(z.x0 * S, z.z0 * S, (z.x1 - z.x0) * S, (z.z1 - z.z0) * S);
      }
      if (a.floor === 2) {
        // the cinema's roof (it is two storeys tall)
        g.fillStyle = '#5a5262';
        g.fillRect((CINEMA.x0 + UP_DX) * S, CINEMA.z0 * S, (CINEMA.x1 - CINEMA.x0) * S, (CINEMA.z1 - CINEMA.z0) * S);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.font = '600 10px "Be Vietnam Pro", sans-serif';
        g.fillText('mái rạp phim', (CINEMA.x0 + UP_DX + 8) * S, 11 * S);
      }
      if (a.floor === 1) {
        g.fillStyle = 'rgba(255,62,165,0.35)';
        g.fillRect(DANCE_FLOOR.x0 * S, DANCE_FLOOR.z0 * S, (DANCE_FLOOR.x1 - DANCE_FLOOR.x0) * S, (DANCE_FLOOR.z1 - DANCE_FLOOR.z0) * S);
      }
      if (a.floor === 3) {
        g.fillStyle = 'rgba(255,62,165,0.4)';
        g.fillRect(KARA_STAGE.x0 * S, KARA_STAGE.z0 * S, (KARA_STAGE.x1 - KARA_STAGE.x0) * S, (KARA_STAGE.z1 - KARA_STAGE.z0) * S);
        g.fillStyle = 'rgba(255,154,60,0.55)';
        g.beginPath();
        g.arc(WOLF_FIRE.x * S, WOLF_FIRE.z * S, 4.2 * S, 0, Math.PI * 2);
        g.fill();
        g.font = '600 10px "Be Vietnam Pro", sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillText('🎤 karaoke', (KARA_STAGE.x0 + 1.5) * S, 8.2 * S);
        g.fillText('🔥 ma sói', (WOLF_FIRE.x - 2.6) * S, (WOLF_FIRE.z + 6.4) * S);
      }
      // stairs (treads) + lift
      const sx = a.x0;
      for (const st of STAIRWAYS) {
        if (st.lower !== a.floor && st.lower + 1 !== a.floor) continue;
        g.fillStyle = 'rgba(184,138,90,0.55)';
        g.fillRect((st.x0 + sx) * S, st.z0 * S, (st.x1 - st.x0) * S, (st.z1 - st.z0) * S);
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 1;
        for (let x = st.x0; x < st.x1; x += 0.8) {
          g.beginPath();
          g.moveTo((x + sx) * S, st.z0 * S);
          g.lineTo((x + sx) * S, st.z1 * S);
          g.stroke();
        }
      }
      const lift = LIFTS[a.floor];
      g.fillStyle = 'rgba(107,140,255,0.45)';
      g.fillRect(lift.x0 * S, lift.z0 * S, (lift.x1 - lift.x0) * S, (lift.z1 - lift.z0) * S);
      g.fillStyle = 'rgba(45,49,66,0.16)';
      for (const f of FURNITURE) {
        if (!f.solid || f.kind === 'plant' || !onFloor(f.x, a.floor)) continue;
        const rot = Math.abs(Math.sin(f.ry)) > 0.5;
        const w = (rot ? f.d : f.w) * S;
        const d = (rot ? f.w : f.d) * S;
        g.fillRect(f.x * S - w / 2, f.z * S - d / 2, w, d);
      }
      g.strokeStyle = 'rgba(45,49,66,0.45)';
      g.lineWidth = 1.5;
      for (const w of WALLS) {
        if (!onFloor(w.x0, a.floor) || w.kind === 'hidden') continue;
        g.beginPath();
        g.moveTo(w.x0 * S, w.z0 * S);
        g.lineTo(w.x1 * S, w.z1 * S);
        g.stroke();
      }
      const s = getState();
      const world = game.world;
      if (world) {
        for (const p of Object.values(s.players)) {
          const pos = world.positionOf(p.id);
          if (!pos || !onFloor(pos.x, a.floor)) continue;
          g.fillStyle = STATUS_META[p.status].color;
          g.beginPath();
          g.arc(pos.x * S, pos.z * S, 3.2, 0, Math.PI * 2);
          g.fill();
        }
        if (s.me) {
          const pos = world.positionOf(s.me.id);
          if (pos) {
            g.fillStyle = '#6b8cff';
            g.strokeStyle = '#fff';
            g.lineWidth = 2;
            g.beginPath();
            g.arc(pos.x * S, pos.z * S, 4.5, 0, Math.PI * 2);
            g.fill();
            g.stroke();
          }
        }
      }
      g.font = '700 11px "Be Vietnam Pro", sans-serif';
      g.fillStyle = a.floor ? '#ffffff' : '#2d3142';
      g.fillText(FLOOR_NAMES[a.floor], (a.x0 + 0.8) * S, 2.6 * S);
    };
    draw();
    const t = setInterval(draw, 250);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="minimap glass" title="Click để đi tới">
      <button className="minimap-x" onClick={onClose} title="Thu gọn bản đồ">
        —
      </button>
      <canvas
        ref={ref}
        onClick={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const v = viewRef.current;
          game.goTo(v.x0 + (e.clientX - r.left) / v.s, v.z0 + (e.clientY - r.top) / v.s);
        }}
      />
    </div>
  );
}
