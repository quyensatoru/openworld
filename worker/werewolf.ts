// Ma Sói game master, living inside the OfficeRoom Durable Object. Sit on a stump round the camp
// fire (floor 4) to join; the server deals roles, runs nights and days on timers, and decides who
// hears whom on voice (wolves whisper at night, lovers too, the dead only talk among themselves).
// Sides: the village, the wolves (+ Alpha, + the human traitor), and third parties — the Fool
// (wins by being hanged), the Killer (last one standing) and a cross-team couple made by Cupid.
import {
  DAY_CHOICES,
  ROLE_META,
  SPECIALS,
  TEAM_LABEL,
  WOLF_DEFAULTS,
  WOLF_MAX,
  WOLF_MIN,
  isWolf,
  rolesFor,
  type WolfLog,
  type WolfMe,
  type WolfMsg,
  type WolfPhase,
  type WolfPlayer,
  type WolfRole,
  type WolfSettings,
  type WolfTeam,
  type WolfView,
  type WolfVoice,
} from '../shared/werewolf';
import type { ServerMsg } from '../shared/protocol';

export interface WolfHost {
  people(): Iterable<{ id: string; name: string; zone: string; seat: string | null }>;
  send(id: string, msg: ServerMsg): void;
  chat(text: string): Promise<void>;
  err(id: string, text: string): void;
}

interface P {
  id: string;
  name: string;
  seat: string;
  role: WolfRole;
  alive: boolean;
  cause?: WolfPlayer['cause'];
  lover?: string;
}

type Cause = NonNullable<WolfPlayer['cause']>;

const ROOM = 'wolfroom';
const T = {
  starting: 5000,
  reveal: 10_000,
  night: 45_000,
  nightMin: 14_000,
  witch: 20_000,
  dawn: 8000,
  hunter: 16_000,
  vote: 35_000,
  defense: 25_000,
  verdict: 16_000,
  end: 30_000,
};

const pick = <X>(a: X[]): X => a[Math.floor(Math.random() * a.length)];
const roleLabel = (r: WolfRole) => `${ROLE_META[r].emoji} ${ROLE_META[r].name}`;

export class Werewolf {
  private phase: WolfPhase = 'lobby';
  private day = 0;
  private until = 0;
  private phaseAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settings: WolfSettings = { ...WOLF_DEFAULTS, roles: { ...WOLF_DEFAULTS.roles } };
  private players: P[] = [];
  private log: WolfLog[] = [];
  private winner: WolfTeam | null = null;
  private winners: string[] = [];
  // night
  private wolfVotes = new Map<string, string>();
  private guardPick: string | null = null;
  private lastGuard: string | null = null;
  private seerPick: string | null = null;
  private stabPick: string | null = null;
  private pairPick: string[] | null = null;
  private seen = new Map<string, { id: string; wolf: boolean; day: number }[]>();
  private potions = { save: true, poison: true };
  private witchUse: { kind: 'save' | 'poison' | 'pass'; target: string | null } | null = null;
  private victim: string | null = null;
  // day
  private votes = new Map<string, string>();
  private skipDay = new Set<string>();
  private accused: string | null = null;
  private hunterQueue: string[] = [];
  private hunterShot: string | null = null;
  private afterHunter: (() => void) | null = null;

  constructor(private host: WolfHost) {}

  // ------------------------------------------------------------------ helpers
  private get playing() {
    return this.phase !== 'lobby' && this.phase !== 'starting';
  }
  private get(id: string | null | undefined) {
    return (id && this.players.find((p) => p.id === id)) || null;
  }
  private alive() {
    return this.players.filter((p) => p.alive);
  }
  private aliveRole(...r: WolfRole[]) {
    return this.players.filter((p) => p.alive && r.includes(p.role));
  }
  private aliveWolves() {
    return this.players.filter((p) => p.alive && isWolf(p.role));
  }
  private hasRole(r: WolfRole) {
    return this.players.some((p) => p.role === r);
  }
  /** People sitting round the fire. */
  private seated() {
    const out: { id: string; name: string; seat: string }[] = [];
    for (const p of this.host.people()) if (p.seat?.startsWith('wolf-') && !p.seat.startsWith('wolf-log')) out.push({ id: p.id, name: p.name, seat: p.seat });
    return out.sort((a, b) => a.seat.localeCompare(b.seat));
  }
  private hostId(): string | null {
    if (this.playing) return this.players[0]?.id ?? null;
    return this.seated()[0]?.id ?? null;
  }
  private say(text: string, kind: WolfLog['kind'] = 'info') {
    this.log.push({ t: Date.now(), text, kind });
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
  }
  private nameOf(id: string | null) {
    return this.get(id)?.name || 'ai đó';
  }
  /** A couple from two different sides plays for itself. */
  private crossCouple(): [P, P] | null {
    const a = this.players.find((p) => p.lover);
    const b = a ? this.get(a.lover) : null;
    if (!a || !b) return null;
    return ROLE_META[a.role].team !== ROLE_META[b.role].team ? [a, b] : null;
  }
  private teamOf(p: P): WolfTeam {
    const cc = this.crossCouple();
    if (cc && (cc[0] === p || cc[1] === p)) return 'lovers';
    return ROLE_META[p.role].team;
  }

  private setPhase(phase: WolfPhase, ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = phase;
    this.phaseAt = Date.now();
    this.until = ms ? Date.now() + ms : 0;
    if (ms) this.timer = setTimeout(() => this.advance(), ms);
  }

  /** End the current phase early (but not before `minMs` into it). */
  private hurry(minMs = 1500) {
    const at = Math.max(Date.now() + 1200, this.phaseAt + minMs);
    if (this.until && at >= this.until) return;
    if (this.timer) clearTimeout(this.timer);
    this.until = at;
    this.timer = setTimeout(() => this.advance(), at - Date.now());
  }

  // ------------------------------------------------------------------ voice
  private get dark() {
    return this.phase === 'reveal' || this.phase === 'night' || this.phase === 'witch';
  }

  /** May `from`'s voice reach `to`? (both are in the village already) */
  voiceAllowed(from: string, to: string): boolean {
    if (!this.playing || this.phase === 'end') return true;
    const a = this.get(from);
    const b = this.get(to);
    const aLive = !!a?.alive;
    const bLive = !!b?.alive;
    if (!aLive) return !bLive; // ghosts and onlookers talk among themselves
    if (!bLive) return true; // …and hear everything
    if (this.dark) return (isWolf(a!.role) && isWolf(b!.role)) || a!.lover === b!.id;
    if (this.phase === 'defense') return from === this.accused;
    return true;
  }

  private voiceOf(p: P | null): WolfVoice {
    if (!this.playing || this.phase === 'end') return 'all';
    if (!p?.alive) return 'ghosts';
    if (this.dark) {
      if (isWolf(p.role) && this.aliveWolves().length > 1) return 'wolves';
      if (p.lover && this.get(p.lover)?.alive) return 'lovers';
      return 'listen';
    }
    if (this.phase === 'defense') return p.id === this.accused ? 'accused' : 'listen';
    return 'all';
  }

  // ------------------------------------------------------------------ views
  private viewFor(id: string): WolfView {
    const me = this.get(id);
    // the dead and onlookers only get to see every card when the host allows it
    const ghost = (!me || !me.alive) && this.playing && this.settings.ghostsSee;
    const wolf = isWolf(me?.role);
    const minion = me?.role === 'minion';
    const cupid = me?.role === 'cupid';
    const players: WolfPlayer[] = this.players.map((p) => {
      const known =
        p.id === id || this.phase === 'end' || ghost || ((wolf || minion) && isWolf(p.role)) || (!p.alive && this.settings.reveal);
      const loverKnown = !!p.lover && (ghost || this.phase === 'end' || p.id === id || p.lover === id || cupid);
      return { id: p.id, name: p.name, seat: p.seat, alive: p.alive, role: known ? p.role : null, cause: p.alive ? undefined : p.cause, lover: loverKnown || undefined };
    });
    const votes: Record<string, string> = {};
    if (this.phase === 'vote' || this.phase === 'verdict' || this.phase === 'defense') for (const [k, v] of this.votes) votes[k] = v;
    const mine: WolfMe = {
      inGame: !!me,
      alive: !!me?.alive,
      role: me?.role ?? null,
      mates: wolf || minion ? this.players.filter((p) => isWolf(p.role) && p.id !== id).map((p) => p.id) : [],
      lover: me?.lover ?? null,
      act: me ? this.actFor(me) : null,
      seen: this.seen.get(id) ?? [],
      voice: this.voiceOf(me),
    };
    if (wolf && (this.phase === 'night' || this.phase === 'witch')) mine.pack = Object.fromEntries(this.wolfVotes);
    return {
      phase: this.phase,
      day: this.day,
      until: this.until,
      host: this.hostId(),
      players,
      seated: this.playing ? [] : this.seated(),
      settings: this.settings,
      log: this.log.slice(-18),
      votes,
      accused: this.accused,
      skipDay: [...this.skipDay],
      winner: this.winner,
      winners: this.winners,
      me: mine,
    };
  }

  private actFor(me: P): WolfMe['act'] {
    const alive = this.alive().map((p) => p.id);
    if (this.phase === 'hunter' && this.hunterQueue[0] === me.id) {
      return { kind: 'shoot', targets: alive.filter((x) => x !== me.id), chosen: this.hunterShot, done: false };
    }
    if (!me.alive) return null;
    if (this.phase === 'night') {
      if (isWolf(me.role)) {
        const prey = alive.filter((x) => !isWolf(this.get(x)?.role));
        return { kind: 'kill', targets: prey, chosen: this.wolfVotes.get(me.id) ?? null, done: this.wolfVotes.has(me.id) };
      }
      if (me.role === 'guard') return { kind: 'protect', targets: alive.filter((x) => x !== this.lastGuard), chosen: this.guardPick, done: this.guardPick != null };
      if (me.role === 'seer') return { kind: 'check', targets: alive.filter((x) => x !== me.id), chosen: this.seerPick, done: this.seerPick != null };
      if (me.role === 'killer') return { kind: 'stab', targets: alive.filter((x) => x !== me.id), chosen: this.stabPick, done: this.stabPick != null };
      if (me.role === 'cupid' && this.day === 1) return { kind: 'pair', targets: alive, chosen: null, pair: this.pairPick ?? [], done: !!this.pairPick };
    }
    if (this.phase === 'witch' && me.role === 'witch') {
      return {
        kind: 'witch',
        targets: alive.filter((x) => x !== me.id),
        chosen: this.witchUse?.target ?? null,
        done: !!this.witchUse,
        victim: this.victim,
        // no saving yourself
        save: this.potions.save && this.victim !== me.id,
        poison: this.potions.poison,
        used: this.witchUse && this.witchUse.kind !== 'pass' ? this.witchUse.kind : null,
      };
    }
    return null;
  }

  /** Send everyone concerned their own view: the village, the players, and whoever just left it. */
  broadcast(extra: string[] = []) {
    const ids = new Set<string>(extra);
    for (const p of this.host.people()) if (p.zone === ROOM) ids.add(p.id);
    for (const p of this.players) ids.add(p.id);
    for (const id of ids) this.host.send(id, { t: 'wolf', v: this.viewFor(id) });
  }

  /** Called on welcome / entering the room. */
  sendTo(id: string) {
    this.host.send(id, { t: 'wolf', v: this.viewFor(id) });
  }

  // ------------------------------------------------------------------ seats
  /** May this person sit on that stump? (during a game the seats belong to the players) */
  canSit(id: string, seat: string): boolean {
    if (!this.playing) return true;
    const p = this.get(id);
    return !!p && p.seat === seat;
  }

  onSeatChange() {
    if (this.phase === 'starting' && this.seated().length < WOLF_MIN) {
      this.say('Không đủ người — huỷ ván.', 'info');
      this.setPhase('lobby', 0);
    }
    this.broadcast();
  }

  private gone = new Map<string, ReturnType<typeof setTimeout>>();

  /** A player disconnected: they have a minute to come back (a page reload must not kill them). */
  leave(id: string) {
    const p = this.get(id);
    if (!p || !this.playing || this.phase === 'end' || !p.alive) return this.broadcast();
    const old = this.gone.get(id);
    if (old) clearTimeout(old);
    this.gone.set(
      id,
      setTimeout(() => {
        this.gone.delete(id);
        if (!p.alive || !this.playing || this.phase === 'end' || this.players.indexOf(p) < 0) return;
        if ([...this.host.people()].some((x) => x.id === id)) return;
        this.die(p, 'left');
        this.say(`⚡ ${p.name} đã rời làng (mất kết nối).`, 'death');
        this.wolfVotes.delete(id);
        if (!this.checkWin()) this.broadcast();
      }, 60_000),
    );
    this.broadcast();
  }

  /** Back online (reconnect): cancel the pending removal, send the game. */
  rejoin(id: string) {
    const old = this.gone.get(id);
    if (old) clearTimeout(old);
    this.gone.delete(id);
    // always: after a server restart the page may still hold an old game (and a muted night mic)
    this.sendTo(id);
  }

  // ------------------------------------------------------------------ actions
  handle(pp: { id: string; name: string; zone: string; seat: string | null }, m: WolfMsg) {
    const me = this.get(pp.id);
    switch (m.a) {
      case 'settings': {
        if (this.playing || this.hostId() !== pp.id) return;
        const s = m.s ?? {};
        const next: WolfSettings = { ...this.settings, roles: { ...this.settings.roles } };
        if (s.mode === 'auto' || s.mode === 'custom') next.mode = s.mode;
        if (s.wolves != null) next.wolves = Math.max(1, Math.min(4, Math.round(Number(s.wolves)) || 1));
        if (typeof s.reveal === 'boolean') next.reveal = s.reveal;
        if (typeof s.ghostsSee === 'boolean') next.ghostsSee = s.ghostsSee;
        if (s.roles && typeof s.roles === 'object') for (const k of SPECIALS) if (typeof s.roles[k] === 'boolean') next.roles[k] = s.roles[k]!;
        if (s.dayS != null && DAY_CHOICES.includes(Number(s.dayS))) next.dayS = Number(s.dayS);
        this.settings = next;
        this.broadcast();
        return;
      }
      case 'start': {
        if (this.playing) return;
        const seated = this.seated();
        if (!seated.some((s) => s.id === pp.id)) return this.host.err(pp.id, 'Ngồi vào một gốc cây quanh đống lửa để tham gia nhé 🔥');
        if (seated.length < WOLF_MIN) return this.host.err(pp.id, `Cần ít nhất ${WOLF_MIN} người ngồi quanh đống lửa (đang có ${seated.length}).`);
        if (seated.length > WOLF_MAX) return this.host.err(pp.id, `Tối đa ${WOLF_MAX} người một ván.`);
        this.log = [];
        this.say(`🔥 ${pp.name} châm lửa — ván Ma Sói bắt đầu sau 5 giây!`, 'info');
        this.setPhase('starting', T.starting);
        this.broadcast();
        return;
      }
      case 'abort': {
        if (!this.playing || this.hostId() !== pp.id) return;
        this.say(`⛔ ${pp.name} đã dừng ván chơi.`, 'info');
        this.reset();
        this.broadcast();
        return;
      }
      case 'act': {
        if (!me) return;
        const act = this.actFor(me);
        if (!act) return;
        const target = m.target && act.targets.includes(m.target) ? m.target : null;
        if (act.kind === 'kill') {
          if (!target) return;
          this.wolfVotes.set(me.id, target);
        } else if (act.kind === 'protect') {
          if (!target) return;
          this.guardPick = target;
        } else if (act.kind === 'stab') {
          if (!target) return;
          this.stabPick = target;
        } else if (act.kind === 'pair') {
          const pair = [...new Set((m.pair ?? []).map(String))].filter((x) => act.targets.includes(x));
          if (pair.length !== 2 || this.pairPick) return;
          this.pairPick = pair;
          const [a, b] = pair.map((x) => this.get(x)!);
          a.lover = b.id;
          b.lover = a.id;
        } else if (act.kind === 'check') {
          if (!target || this.seerPick) return;
          this.seerPick = target;
          const t = this.get(target)!;
          const list = this.seen.get(me.id) ?? [];
          // the Alpha and the traitor read as "not a wolf"
          list.push({ id: target, wolf: t.role === 'wolf', day: this.day });
          this.seen.set(me.id, list);
        } else if (act.kind === 'witch') {
          if (this.witchUse) return;
          if (m.use === 'save') {
            if (!act.save || !this.victim) return;
            this.potions.save = false;
            this.witchUse = { kind: 'save', target: this.victim };
          } else if (m.use === 'poison') {
            if (!this.potions.poison || !target) return;
            this.potions.poison = false;
            this.witchUse = { kind: 'poison', target };
          } else this.witchUse = { kind: 'pass', target: null };
          this.hurry(4000);
        } else if (act.kind === 'shoot') {
          this.hunterShot = target;
          this.hurry(800);
        }
        if (this.phase === 'night' && this.nightDone()) this.hurry(T.nightMin);
        this.broadcast();
        return;
      }
      case 'vote': {
        if (!me?.alive || this.phase !== 'vote') return;
        const t = String(m.target);
        if (t !== 'skip' && (!this.get(t)?.alive || t === me.id)) return;
        this.votes.set(me.id, t);
        if (this.alive().every((p) => this.votes.has(p.id))) this.hurry(2500);
        this.broadcast();
        return;
      }
      case 'verdict': {
        if (!me?.alive || this.phase !== 'verdict' || me.id === this.accused) return;
        this.votes.set(me.id, m.yes ? 'yes' : 'no');
        if (this.alive().every((p) => p.id === this.accused || this.votes.has(p.id))) this.hurry(2000);
        this.broadcast();
        return;
      }
      case 'skipday': {
        if (!me?.alive || this.phase !== 'day') return;
        if (this.skipDay.has(me.id)) this.skipDay.delete(me.id);
        else this.skipDay.add(me.id);
        if (this.skipDay.size > this.alive().length / 2 && this.until - Date.now() > 2000) {
          this.say('⏩ Quá nửa làng muốn bỏ phiếu luôn.', 'day');
          this.hurry(1500);
        }
        this.broadcast();
        return;
      }
    }
  }

  private nightDone(): boolean {
    if (!this.aliveWolves().every((w) => this.wolfVotes.has(w.id))) return false;
    if (this.aliveRole('guard').length && this.guardPick == null) return false;
    if (this.aliveRole('seer').length && this.seerPick == null) return false;
    if (this.aliveRole('killer').length && this.stabPick == null) return false;
    if (this.day === 1 && this.aliveRole('cupid').length && !this.pairPick) return false;
    return true;
  }

  // ------------------------------------------------------------------ flow
  private reset() {
    this.setPhase('lobby', 0);
    this.players = [];
    this.day = 0;
    this.winner = null;
    this.winners = [];
    this.accused = null;
    this.votes.clear();
    this.skipDay.clear();
    this.wolfVotes.clear();
    this.seen.clear();
    this.hunterQueue = [];
    this.afterHunter = null;
    this.pairPick = null;
  }

  private advance() {
    this.timer = null;
    switch (this.phase) {
      case 'starting':
        return this.deal();
      case 'reveal':
        return this.night();
      case 'night':
        return this.endNight();
      case 'witch':
        return this.dawn();
      case 'dawn':
        return this.afterDeaths(() => this.dayStart());
      case 'hunter':
        return this.hunterFire();
      case 'day':
        return this.voteStart();
      case 'vote':
        return this.tally();
      case 'defense':
        return this.verdictStart();
      case 'verdict':
        return this.judge();
      case 'end':
        this.reset();
        this.broadcast();
        return;
    }
  }

  private deal() {
    const seated = this.seated();
    if (seated.length < WOLF_MIN) {
      this.say('Không đủ người — huỷ ván.', 'info');
      this.setPhase('lobby', 0);
      return this.broadcast();
    }
    const roles = rolesFor(seated.length, this.settings);
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    this.players = seated.map((s, i) => ({ id: s.id, name: s.name, seat: s.seat, role: roles[i], alive: true }));
    this.potions = { save: true, poison: true };
    this.lastGuard = null;
    this.pairPick = null;
    this.seen.clear();
    this.winner = null;
    this.winners = [];
    this.day = 0;
    const count = (r: WolfRole) => roles.filter((x) => x === r).length;
    const parts = (['wolf', 'alpha', 'minion', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'fool', 'killer', 'villager'] as WolfRole[])
      .filter((r) => count(r))
      .map((r) => `${count(r)} ${roleLabel(r)}`);
    this.say(`🃏 Chia bài cho ${seated.length} người: ${parts.join(', ')}. Xem lá bài của bạn!`, 'info');
    this.setPhase('reveal', T.reveal);
    this.broadcast();
    void this.host.chat(`🐺 Một ván Ma Sói vừa bắt đầu ở tầng 4 với ${seated.length} người chơi — lên xem nhé!`);
  }

  private night() {
    this.day++;
    this.wolfVotes.clear();
    this.guardPick = null;
    this.seerPick = null;
    this.stabPick = null;
    this.witchUse = null;
    this.victim = null;
    this.accused = null;
    this.votes.clear();
    this.skipDay.clear();
    this.say(`🌙 Đêm ${this.day} buông xuống. Cả làng nhắm mắt đi ngủ…`, 'night');
    this.setPhase('night', T.night);
    this.broadcast();
  }

  private endNight() {
    // the pack's choice: most votes, ties broken at random
    const tally = new Map<string, number>();
    for (const t of this.wolfVotes.values()) tally.set(t, (tally.get(t) ?? 0) + 1);
    let best = 0;
    let top: string[] = [];
    for (const [t, n] of tally) {
      if (n > best) {
        best = n;
        top = [t];
      } else if (n === best) top.push(t);
    }
    this.victim = top.length ? pick(top) : null;
    this.lastGuard = this.guardPick ?? null;
    if (this.day === 1 && this.pairPick) this.say('💘 Thần Tình Yêu đã bắn mũi tên… có hai trái tim vừa được nối với nhau.', 'night');
    if (this.hasRole('witch')) {
      const w = this.aliveRole('witch')[0];
      // the witch's turn always takes a while, so nobody can tell whether she is still alive
      const ms = w && (this.potions.save || this.potions.poison) ? T.witch : 7000 + Math.random() * 5000;
      this.setPhase('witch', ms);
      return this.broadcast();
    }
    this.dawn();
  }

  private dawn() {
    const deaths: { p: P; cause: Cause }[] = [];
    const add = (p: P | null, cause: Cause) => {
      if (p?.alive && !deaths.some((d) => d.p === p)) deaths.push({ p, cause });
    };
    const guarded = this.guardPick;
    const v = this.get(this.victim);
    // a bite: not if guarded, not if the witch saved them, and the Killer shrugs it off
    if (v && v.id !== guarded && this.witchUse?.kind !== 'save' && v.role !== 'killer') add(v, 'wolf');
    const s = this.get(this.stabPick);
    if (s && s.id !== guarded) add(s, 'stab');
    if (this.witchUse?.kind === 'poison') add(this.get(this.witchUse.target), 'poison');
    this.hunterQueue = [];
    if (!deaths.length) this.say('☀️ Trời sáng. Đêm qua bình yên, không ai chết 🕊️', 'day');
    for (const d of deaths) {
      const role = this.settings.reveal ? ` — là ${roleLabel(d.p.role)}` : '';
      const msg: Record<string, string> = {
        wolf: `☀️ Trời sáng. ${d.p.name} được phát hiện đã chết 😱${role}`,
        stab: `🔪 ${d.p.name} bị một kẻ giấu mặt đâm chết trong đêm${role}`,
        poison: `🧪 ${d.p.name} chết một cách bí ẩn trong đêm${role}`,
      };
      this.say(msg[d.cause] ?? `${d.p.name} đã chết${role}`, 'death');
      this.die(d.p, d.cause);
    }
    if (this.checkWin()) return;
    this.setPhase('dawn', T.dawn);
    this.broadcast();
  }

  /** Kill someone: their lover dies of a broken heart, a dead hunter gets to shoot. */
  private die(p: P, cause: Cause) {
    if (!p.alive) return;
    p.alive = false;
    p.cause = cause;
    if (p.role === 'hunter' && cause !== 'poison' && cause !== 'left') this.hunterQueue.push(p.id);
    const l = this.get(p.lover);
    if (l?.alive) {
      const role = this.settings.reveal ? ` — là ${roleLabel(l.role)}` : '';
      this.say(`💔 ${l.name} không chịu nổi nỗi đau mất người yêu và ra đi theo${role}`, 'death');
      this.die(l, 'heart');
    }
  }

  /** Let any dead hunter shoot, then go on. */
  private afterDeaths(then: () => void) {
    if (this.hunterQueue.length) {
      this.afterHunter = then;
      this.hunterShot = null;
      this.say(`🏹 ${this.nameOf(this.hunterQueue[0])} là Thợ Săn — đang giương cung…`, 'death');
      this.setPhase('hunter', T.hunter);
      return this.broadcast();
    }
    then();
  }

  private hunterFire() {
    const hunter = this.hunterQueue.shift();
    const t = this.get(this.hunterShot);
    if (t?.alive) {
      const role = this.settings.reveal ? ` — là ${roleLabel(t.role)}` : '';
      this.say(`🏹 Thợ Săn ${this.nameOf(hunter ?? null)} bắn chết ${t.name}!${role}`, 'death');
      this.die(t, 'shot');
    } else this.say(`🏹 Thợ Săn ${this.nameOf(hunter ?? null)} không bắn ai.`, 'death');
    if (this.checkWin()) return;
    const then = this.afterHunter ?? (() => this.dayStart());
    this.afterHunter = null;
    this.afterDeaths(then);
  }

  private dayStart() {
    this.skipDay.clear();
    this.votes.clear();
    this.accused = null;
    this.say(`🗣️ Ngày ${this.day}: cả làng thảo luận xem ai là Sói.`, 'day');
    this.setPhase('day', this.settings.dayS * 1000);
    this.broadcast();
  }

  private voteStart() {
    this.votes.clear();
    this.say('🗳️ Bỏ phiếu! Chọn người bạn nghi là Sói (hoặc bỏ qua).', 'vote');
    this.setPhase('vote', T.vote);
    this.broadcast();
  }

  private tally() {
    const n = new Map<string, number>();
    let skip = 0;
    for (const t of this.votes.values()) {
      if (t === 'skip') skip++;
      else if (this.get(t)?.alive) n.set(t, (n.get(t) ?? 0) + 1);
    }
    let best = 0;
    let top: string[] = [];
    for (const [t, c] of n) {
      if (c > best) {
        best = c;
        top = [t];
      } else if (c === best) top.push(t);
    }
    if (!best || top.length > 1 || skip >= best) {
      this.say(top.length > 1 ? '⚖️ Phiếu bằng nhau — hôm nay không ai bị treo.' : '⚖️ Làng chưa thống nhất được — hôm nay không ai bị treo.', 'vote');
      return this.night();
    }
    this.accused = top[0];
    this.say(`⚖️ ${this.nameOf(this.accused)} bị nhiều phiếu nhất (${best}) — có 25 giây để bào chữa.`, 'vote');
    this.votes.clear();
    this.setPhase('defense', T.defense);
    this.broadcast();
  }

  private verdictStart() {
    this.votes.clear();
    this.say(`👍👎 Treo cổ ${this.nameOf(this.accused)} hay tha?`, 'vote');
    this.setPhase('verdict', T.verdict);
    this.broadcast();
  }

  private judge() {
    let yes = 0;
    let no = 0;
    for (const v of this.votes.values()) v === 'yes' ? yes++ : no++;
    const p = this.get(this.accused);
    this.accused = null;
    if (p?.alive && yes > no) {
      const role = this.settings.reveal || p.role === 'fool' ? ` Họ là ${roleLabel(p.role)}.` : '';
      this.say(`🪢 Làng treo cổ ${p.name} (${yes} đồng ý, ${no} phản đối).${role}`, 'death');
      this.hunterQueue = [];
      this.die(p, 'hang');
      // the Fool wanted exactly this
      if (p.role === 'fool') return this.finish('fool', [p.id]);
      if (this.checkWin()) return;
      return this.afterDeaths(() => this.night());
    }
    this.say(`🙏 ${p?.name ?? 'Người bị buộc tội'} được tha (${yes} đồng ý, ${no} phản đối).`, 'vote');
    this.night();
  }

  private checkWin(): boolean {
    const alive = this.alive();
    const cc = this.crossCouple();
    if (cc && cc[0].alive && cc[1].alive && alive.length === 2) return this.finish('lovers', [cc[0].id, cc[1].id]);
    const killer = alive.find((p) => p.role === 'killer');
    if (killer && alive.length <= 2) return this.finish('killer', [killer.id]);
    if (!alive.length) return this.finish('village', []);
    const wolves = alive.filter((p) => isWolf(p.role)).length;
    if (!wolves && !killer) return this.finish('village', null);
    if (wolves && !killer && wolves >= alive.length - wolves) return this.finish('wolves', null);
    return false;
  }

  /** Game over. `ids` null = everyone on that team (dead or alive), minus a cross-team couple. */
  private finish(w: WolfTeam, ids: string[] | null): true {
    this.winner = w;
    this.accused = null;
    this.winners = ids ?? this.players.filter((p) => this.teamOf(p) === w).map((p) => p.id);
    const wolfNames = this.players.filter((p) => isWolf(p.role)).map((p) => p.name).join(', ');
    const names = this.winners.map((id) => this.nameOf(id)).join(', ');
    const line: Record<WolfTeam, string> = {
      village: `🏡 DÂN LÀNG THẮNG! Bầy sói (${wolfNames}) đã bị tiêu diệt.`,
      wolves: `🐺 PHE SÓI THẮNG! Bầy sói: ${wolfNames}.`,
      fool: `🤡 THẰNG NGỐ THẮNG! ${names} đã lừa được cả làng treo cổ mình.`,
      killer: `🔪 SÁT NHÂN THẮNG! ${names} là người cuối cùng còn đứng vững.`,
      lovers: `💘 CẶP ĐÔI THẮNG! ${names} — tình yêu vượt qua mọi phe phái.`,
    };
    this.say(line[w], 'win');
    this.setPhase('end', T.end);
    this.broadcast();
    void this.host.chat(`🐺 Ván Ma Sói kết thúc — ${TEAM_LABEL[w].replace(/^\S+ /, '').toLowerCase()}! (${w === 'wolves' || w === 'village' ? `Sói: ${wolfNames}` : names})`);
    return true;
  }
}
