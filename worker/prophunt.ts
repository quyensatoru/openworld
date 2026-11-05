// "Trốn tìm biến hình" (prop hunt) on floor 6 — the server side. Rules + floor plan: shared/prophunt.ts.
//
// A game is a few rounds; each round a rotating group of seekers waits in the locked waiting room
// while the hiders turn into furniture and hide, then hunts them with foam-ball guns. Shooting real
// furniture costs the seeker health. Teams rotate every round, points add up across rounds.
import { FURNITURE, floorOf } from '../shared/map';
import {
  PH_CAGE_SPOTS,
  PH_DEFAULTS,
  PH_FIRE_S,
  PH_FLOOR,
  PH_GRAB_RANGE,
  PH_HIT,
  PH_HP,
  PH_MAX,
  PH_MIN,
  PH_MISS,
  PH_PROPS,
  PH_SEEKER_HP,
  PH_SHOT_RANGE,
  PH_START_SPOTS,
  PH_SWAP_CD,
  PH_TAUNTS,
  PH_TAUNT_CD,
  PH_CHOICES,
  seekersFor,
  type PhFx,
  type PhMsg,
  type PhPhase,
  type PhSettings,
  type PhTeam,
  type PhView,
} from '../shared/prophunt';
import type { ServerMsg } from '../shared/protocol';

export interface PropHost {
  people(): Iterable<{ id: string; name: string; x: number; z: number }>;
  send(id: string, msg: ServerMsg): void;
  chat(text: string): Promise<void>;
  err(id: string, text: string): void;
}

interface P {
  id: string;
  name: string;
  team: PhTeam;
  alive: boolean;
  hp: number;
  maxHp: number;
  score: number;
  out?: PhView['players'][number]['out'];
  prop: { fid: string; ry: number | null } | null;
  swapAt: number;
  tauntAt: number;
  taunts: number;
  nextShot: number;
  spawn: { x: number; z: number; ry: number; key: string } | null;
}

const T = { starting: 5000, roles: 5000, roundEnd: 9000, end: 16_000 };
const FURN = new Map(FURNITURE.map((f) => [f.id, f]));
const onFloor = (x: number) => floorOf(x) === PH_FLOOR;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export class PropHuntGame {
  private phase: PhPhase = 'lobby';
  private until = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tauntTimer: ReturnType<typeof setInterval> | null = null;
  private settings: PhSettings = { ...PH_DEFAULTS };
  private joined = new Map<string, string>(); // lobby: id → name (in join order)
  private players: P[] = [];
  private round = 0;
  private winner: PhTeam | null = null;
  private why = '';
  private log: { t: number; text: string }[] = [];

  constructor(private host: PropHost) {}

  // ------------------------------------------------------------------ helpers
  get playing() {
    return this.phase !== 'lobby' && this.phase !== 'starting';
  }
  private get(id: string | null | undefined) {
    return (id && this.players.find((p) => p.id === id)) || null;
  }
  private pos(id: string) {
    for (const p of this.host.people()) if (p.id === id) return { x: p.x, z: p.z };
    return null;
  }
  private hostId() {
    if (this.playing) return this.players[0]?.id ?? null;
    return this.joined.keys().next().value ?? null;
  }
  private say(text: string) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 30) this.log.splice(0, this.log.length - 30);
  }
  private alive(team: PhTeam) {
    return this.players.filter((p) => p.alive && p.team === team);
  }
  private propName(p: P) {
    const f = p.prop ? FURN.get(p.prop.fid) : null;
    return (f && PH_PROPS[f.kind]?.name) || 'chính mình';
  }

  private setPhase(phase: PhPhase, ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = phase;
    this.until = ms ? Date.now() + ms : 0;
    if (ms) this.timer = setTimeout(() => this.advance(), ms);
    // hiders make a sound every so often while the hunt is on (nobody wins by sitting still)
    if (this.tauntTimer) clearInterval(this.tauntTimer);
    this.tauntTimer = null;
    if (phase === 'seek' && this.settings.tauntS > 0) this.tauntTimer = setInterval(() => this.autoTaunt(), this.settings.tauntS * 1000);
  }

  private reset() {
    this.setPhase('lobby', 0);
    this.players = [];
    this.round = 0;
    this.winner = null;
    this.why = '';
  }

  // ------------------------------------------------------------------ flow
  private advance() {
    switch (this.phase) {
      case 'starting': {
        const ids = [...this.joined.keys()];
        if (ids.length < PH_MIN) {
          this.setPhase('lobby', 0);
          this.say('Không đủ người — huỷ ván.');
          return this.broadcast();
        }
        this.players = ids.map((id) => ({ id, name: this.joined.get(id)!, team: 'hider', alive: true, hp: 100, maxHp: 100, score: 0, prop: null, swapAt: 0, tauntAt: 0, taunts: 0, nextShot: 0, spawn: null }));
        this.round = 0;
        return this.startRound();
      }
      case 'roles':
        this.setPhase('hide', this.settings.hideS * 1000);
        this.say(`🙈 Vòng ${this.round}: người trốn có ${this.settings.hideS} giây để biến hình và trốn!`);
        return this.broadcast();
      case 'hide': {
        // anyone still standing there as themselves is fair game
        this.setPhase('seek', this.settings.roundMin * 60_000);
        this.say('🔫 Cửa mở! Người tìm đi săn.');
        if (!this.checkRound()) this.broadcast();
        return;
      }
      case 'seek':
        return this.endRound('hider', `⏰ Hết giờ — ${this.alive('hider').length} người trốn sống sót!`);
      case 'roundEnd':
        if (this.round < this.settings.rounds && this.players.length >= 2) return this.startRound();
        return this.finish();
      case 'end':
        this.reset();
        return this.broadcast();
      default:
    }
  }

  private startRound() {
    this.round++;
    const n = this.players.length;
    const k = seekersFor(n, this.settings);
    // seekers rotate: round r takes the next k people in join order
    const first = ((this.round - 1) * k) % n;
    const seekers = new Set<number>();
    for (let i = 0; i < k; i++) seekers.add((first + i) % n);
    const cage = [...PH_CAGE_SPOTS];
    const start = [...PH_START_SPOTS].sort(() => Math.random() - 0.5);
    const key = `${Date.now()}`;
    this.players.forEach((p, i) => {
      p.team = seekers.has(i) ? 'seeker' : 'hider';
      p.alive = p.out?.how !== 'left';
      p.out = p.out?.how === 'left' ? p.out : undefined;
      p.hp = p.maxHp = p.team === 'seeker' ? PH_SEEKER_HP : 100;
      p.prop = null;
      p.swapAt = p.tauntAt = p.nextShot = 0;
      p.taunts = 0;
      const s = p.team === 'seeker' ? cage.shift() ?? PH_CAGE_SPOTS[0] : start.shift() ?? PH_START_SPOTS[0];
      p.spawn = { x: s.x, z: s.z, ry: p.team === 'seeker' ? Math.PI : 0, key };
    });
    this.winner = null;
    this.why = '';
    const names = this.players.filter((p) => p.team === 'seeker').map((p) => p.name);
    this.say(`🎬 Vòng ${this.round}/${this.settings.rounds} — người tìm: ${names.join(', ')}`);
    this.setPhase('roles', T.roles);
    this.broadcast();
  }

  private endRound(w: PhTeam, why: string) {
    if (this.phase !== 'hide' && this.phase !== 'seek') return;
    this.winner = w;
    this.why = why;
    // survivors' bonus; the last one standing a bit more
    const left = this.alive('hider');
    for (const p of left) p.score += 3 + (left.length === 1 ? 2 : 0);
    if (w === 'seeker') for (const p of this.alive('seeker')) p.score += 1;
    this.say(`${w === 'hider' ? '🪑 PHE TRỐN THẮNG' : '🔫 PHE TÌM THẮNG'} vòng ${this.round} — ${why}`);
    this.setPhase('roundEnd', T.roundEnd);
    this.broadcast();
  }

  private finish() {
    const best = [...this.players].sort((a, b) => b.score - a.score);
    const mvp = best[0];
    this.why = mvp ? `🏆 ${mvp.name} xuất sắc nhất với ${mvp.score} điểm` : '';
    this.winner = null;
    this.setPhase('end', T.end);
    this.broadcast();
    const top = best.slice(0, 3).map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} ${p.score}đ`).join(' · ');
    void this.host.chat(`🪑 Trốn tìm biến hình kết thúc! ${top}`);
  }

  /** Is the round decided? */
  private checkRound(): boolean {
    if (this.phase !== 'hide' && this.phase !== 'seek') return false;
    if (!this.alive('hider').length) {
      this.endRound('seeker', '🎯 Tìm ra tất cả người trốn!');
      return true;
    }
    if (!this.alive('seeker').length) {
      this.endRound('hider', '🙈 Người tìm đã hết máu hết cả!');
      return true;
    }
    return false;
  }

  private autoTaunt() {
    if (this.phase !== 'seek') return;
    for (const p of this.alive('hider')) {
      const at = this.pos(p.id);
      if (at) this.toFloor({ kind: 'taunt', id: p.id, x: at.x, z: at.z, n: Math.floor(Math.random() * 6), auto: true });
    }
  }

  private found(h: P, by: P) {
    const prop = this.propName(h);
    const at = this.pos(h.id) ?? { x: 0, z: 0 };
    h.alive = false;
    h.out = { how: 'found', by: by.name, prop };
    h.prop = null;
    by.score += 3;
    this.toFloor({ kind: 'found', id: h.id, by: by.id, prop, x: at.x, z: at.z });
    this.say(`🎯 ${by.name} tìm ra ${h.name}${prop !== 'chính mình' ? ` (${prop})` : ''}`);
    if (this.settings.infect) {
      // infection: the found hider picks up a gun
      h.team = 'seeker';
      h.alive = true;
      h.out = undefined;
      h.hp = h.maxHp = PH_SEEKER_HP;
    }
    const left = this.alive('hider');
    if (left.length === 1 && this.alive('seeker').length) this.say(`⚠️ Chỉ còn 1 người trốn: ${left[0].name}!`);
  }

  // ------------------------------------------------------------------ views
  private viewFor(id: string): PhView {
    const me = this.get(id);
    const iHide = me?.team === 'hider';
    const props: PhView['props'] = {};
    for (const p of this.players) if (p.alive && p.prop) props[p.id] = { fid: p.prop.fid, ry: p.prop.ry };
    return {
      phase: this.phase,
      until: this.until,
      round: this.round,
      host: this.hostId(),
      joined: [...this.joined].map(([jid, name]) => ({ id: jid, name })),
      settings: this.settings,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        alive: p.alive,
        hp: p.team === 'seeker' || iHide || p.id === id || this.phase === 'end' ? p.hp : null,
        maxHp: p.maxHp,
        score: p.score,
        out: p.out,
      })),
      props,
      hidersLeft: this.alive('hider').length,
      winner: this.winner,
      why: this.why,
      feed: this.log.slice(-8),
      me: {
        inGame: !!me,
        team: me?.team ?? null,
        alive: !!me?.alive,
        hp: me?.hp ?? 0,
        maxHp: me?.maxHp ?? 100,
        swapAt: me?.swapAt ?? 0,
        tauntAt: me?.tauntAt ?? 0,
        spawn: me?.spawn ?? null,
      },
    };
  }

  private keepTimer: ReturnType<typeof setInterval> | null = null;
  /** A slow heartbeat while anyone is in the lobby or playing (the Durable Object must not hibernate mid-game). */
  private keepAlive() {
    const busy = this.joined.size > 0 || this.phase !== 'lobby';
    if (busy && !this.keepTimer) this.keepTimer = setInterval(() => this.keepAlive(), 5000);
    else if (!busy && this.keepTimer) {
      clearInterval(this.keepTimer);
      this.keepTimer = null;
    }
  }

  /** Everyone concerned: players, the lobby list, anyone on floor 6. */
  broadcast() {
    this.keepAlive();
    const ids = new Set<string>([...this.joined.keys(), ...this.players.map((p) => p.id)]);
    for (const p of this.host.people()) if (onFloor(p.x)) ids.add(p.id);
    for (const id of ids) this.host.send(id, { t: 'prop', v: this.viewFor(id) });
  }

  sendTo(id: string) {
    this.host.send(id, { t: 'prop', v: this.viewFor(id) });
  }

  private toFloor(fx: PhFx) {
    const ids = new Set(this.players.map((p) => p.id));
    for (const p of this.host.people()) if (onFloor(p.x)) ids.add(p.id);
    for (const id of ids) this.host.send(id, { t: 'propFx', fx });
  }

  /** Arrived on floor 6. */
  arrived(id: string) {
    this.sendTo(id);
  }

  /**
   * Voice while a game runs and both are on floor 6: whoever is out (found, spent, or only watching)
   * never reaches the players still in it — but hears them and talks to the others who are out.
   * null = the usual rules (distance).
   */
  voice(from: { id: string; x: number }, to: { id: string; x: number }): boolean | null {
    if (!this.playing || this.phase === 'end' || !onFloor(from.x) || !onFloor(to.x)) return null;
    const aLive = !!this.get(from.id)?.alive;
    const bLive = !!this.get(to.id)?.alive;
    if (!aLive && bLive) return false;
    if (!aLive && !bLive) return true;
    return null;
  }

  private gone = new Map<string, ReturnType<typeof setTimeout>>();

  /** Disconnected: half a minute to come back. */
  leave(id: string) {
    if (!this.playing && this.joined.delete(id)) return this.broadcast();
    const p = this.get(id);
    if (!p || this.phase === 'end') return;
    const old = this.gone.get(id);
    if (old) clearTimeout(old);
    this.gone.set(
      id,
      setTimeout(() => {
        this.gone.delete(id);
        if (!this.playing || this.players.indexOf(p) < 0) return;
        if ([...this.host.people()].some((x) => x.id === id)) return;
        p.alive = false;
        p.prop = null;
        p.out = { how: 'left' };
        this.say(`⚡ ${p.name} đã rời ván (mất kết nối).`);
        if (this.players.every((x) => x.out?.how === 'left')) {
          this.reset();
          return this.broadcast();
        }
        if (!this.checkRound()) this.broadcast();
      }, 30_000),
    );
  }

  rejoin(id: string) {
    const old = this.gone.get(id);
    if (old) clearTimeout(old);
    this.gone.delete(id);
    this.sendTo(id);
  }

  // ------------------------------------------------------------------ actions
  handle(pp: { id: string; name: string; x: number; z: number }, m: PhMsg) {
    const me = this.get(pp.id);
    const now = Date.now();
    switch (m.a) {
      case 'join': {
        if (this.playing) return this.host.err(pp.id, 'Ván đang diễn ra — chờ ván sau nhé 🪑');
        if (!onFloor(pp.x)) return this.host.err(pp.id, 'Lên tầng 6 để tham gia Trốn tìm nhé.');
        if (this.joined.size >= PH_MAX) return this.host.err(pp.id, `Tối đa ${PH_MAX} người một ván.`);
        this.joined.set(pp.id, pp.name);
        return this.broadcast();
      }
      case 'leave': {
        if (this.playing) return;
        if (this.joined.delete(pp.id) && this.phase === 'starting' && this.joined.size < PH_MIN) {
          this.setPhase('lobby', 0);
          this.say('Không đủ người — huỷ ván.');
        }
        return this.broadcast();
      }
      case 'settings': {
        if (this.playing || this.hostId() !== pp.id) return;
        const s = m.s ?? {};
        const n: PhSettings = { ...this.settings };
        const pick = (k: keyof typeof PH_CHOICES, v: unknown) => ((PH_CHOICES[k] as readonly number[]).includes(Number(v)) ? Number(v) : n[k]);
        if (s.seekers != null) n.seekers = pick('seekers', s.seekers);
        if (s.hideS != null) n.hideS = pick('hideS', s.hideS);
        if (s.roundMin != null) n.roundMin = pick('roundMin', s.roundMin);
        if (s.rounds != null) n.rounds = pick('rounds', s.rounds);
        if (s.tauntS != null) n.tauntS = pick('tauntS', s.tauntS);
        if (typeof s.infect === 'boolean') n.infect = s.infect;
        this.settings = n;
        return this.broadcast();
      }
      case 'start': {
        if (this.playing || this.phase === 'starting') return;
        if (!this.joined.has(pp.id)) return this.host.err(pp.id, 'Bấm “Tham gia” trước đã nhé.');
        if (this.joined.size < PH_MIN) return this.host.err(pp.id, `Cần ít nhất ${PH_MIN} người (đang có ${this.joined.size}).`);
        this.log = [];
        this.say(`🪑 ${pp.name} bắt đầu ván — 5 giây nữa chia phe!`);
        this.setPhase('starting', T.starting);
        return this.broadcast();
      }
      case 'abort': {
        if (!this.playing || this.hostId() !== pp.id) return;
        this.say(`⛔ ${pp.name} đã dừng ván chơi.`);
        this.reset();
        return this.broadcast();
      }
      case 'prop': {
        if (!me?.alive || me.team !== 'hider' || (this.phase !== 'hide' && this.phase !== 'seek')) return;
        const at = this.pos(pp.id) ?? pp;
        if (m.fid == null) {
          // back to yourself: only while hiding
          if (this.phase !== 'hide' || !me.prop) return;
          me.prop = null;
          me.hp = me.maxHp = 100;
          this.toFloor({ kind: 'poof', id: me.id, x: at.x, z: at.z });
          return this.broadcast();
        }
        const f = FURN.get(String(m.fid));
        const info = f && PH_PROPS[f.kind];
        if (!f || !info || !onFloor(f.x)) return;
        if (dist(at, f) - Math.max(f.w, f.d) / 2 > PH_GRAB_RANGE + 1.5) return this.host.err(pp.id, 'Lại gần món đồ hơn chút nữa…');
        if (me.prop?.fid === f.id) return;
        if (this.phase === 'seek' && now < me.swapAt) return;
        // health follows the size: keep the same share of it
        const share = me.hp / me.maxHp;
        me.maxHp = PH_HP[info.size];
        me.hp = Math.max(1, Math.round(share * me.maxHp));
        me.prop = { fid: f.id, ry: null };
        if (this.phase === 'seek') me.swapAt = now + PH_SWAP_CD * 1000;
        this.toFloor({ kind: 'poof', id: me.id, x: at.x, z: at.z });
        return this.broadcast();
      }
      case 'lock': {
        if (!me?.alive || !me.prop) return;
        me.prop.ry = typeof m.ry === 'number' && Number.isFinite(m.ry) ? m.ry : null;
        return this.broadcast();
      }
      case 'taunt': {
        if (!me?.alive || me.team !== 'hider' || (this.phase !== 'hide' && this.phase !== 'seek') || now < me.tauntAt) return;
        me.tauntAt = now + PH_TAUNT_CD * 1000;
        if (this.phase === 'seek' && me.taunts < PH_TAUNTS) {
          me.taunts++;
          me.score += 1;
        }
        const at = this.pos(pp.id) ?? pp;
        this.toFloor({ kind: 'taunt', id: me.id, x: at.x, z: at.z, n: Math.floor(Math.random() * 6), auto: false });
        return this.sendTo(me.id);
      }
      case 'shoot': {
        if (!me?.alive || me.team !== 'seeker' || this.phase !== 'seek') return;
        if (now < me.nextShot) return;
        me.nextShot = now + PH_FIRE_S * 1000 * 0.75;
        const nums = [m.tx, m.ty, m.tz].map(Number);
        if (nums.every(Number.isFinite)) this.toFloor({ kind: 'shot', by: me.id, x: pp.x, z: pp.z, tx: nums[0], ty: nums[1], tz: nums[2] });
        if (m.hit) {
          const h = this.get(m.hit);
          const hp = h && this.pos(h.id);
          if (!h || !h.alive || h.team !== 'hider' || !hp || dist(pp, hp) > PH_SHOT_RANGE + 2) return;
          h.hp -= PH_HIT;
          me.score += 1;
          this.toFloor({ kind: 'hit', id: h.id, by: me.id, hp: Math.max(0, h.hp) });
          if (h.hp <= 0) {
            this.found(h, me);
            if (!this.checkRound()) this.broadcast();
          } else this.sendTo(h.id);
          return;
        }
        if (m.fid) {
          const f = FURN.get(String(m.fid));
          // only the pieces people can turn into count as "furniture" (walls, lockers and the board are free)
          if (!f || !PH_PROPS[f.kind] || !onFloor(f.x) || dist(pp, f) > PH_SHOT_RANGE + 2) return;
          me.hp -= PH_MISS;
          this.host.send(me.id, { t: 'propFx', fx: { kind: 'miss', hp: Math.max(0, me.hp) } });
          if (me.hp <= 0) {
            me.alive = false;
            me.out = { how: 'spent' };
            this.say(`💥 ${me.name} bắn nhầm đồ quá nhiều — hết máu!`);
            if (!this.checkRound()) this.broadcast();
          }
        }
        return;
      }
      default:
    }
  }
}
