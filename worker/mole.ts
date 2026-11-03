// "Nội Gián" game server, living inside the OfficeRoom Durable Object (floor 5).
// Employees finish tasks; hidden moles kill people (with a cooldown), cut the lights, slam doors
// shut, crawl through the ducts and trigger a server overload that two people must hold off together. Bodies are reported or the
// bell is rung → meeting (everyone on the floor hears each other) → vote. Ghosts keep doing tasks
// and only talk among themselves. Positions come from the players' own movement messages.
import {
  BELL,
  CAM_DESK,
  CRIT,
  DOOR_BY_ID,
  FUSE_SPOT,
  LOCKABLE_ROOMS,
  MOLE_BELL_RANGE,
  MOLE_CAM_RANGE,
  MOLE_CRIT_MS,
  MOLE_DEFAULTS,
  MOLE_DOORS,
  MOLE_DOOR_RANGE,
  MOLE_FLOOR_X0,
  MOLE_KILL_RANGE,
  MOLE_LIGHTS_MS,
  MOLE_LOCK_MS,
  MOLE_MAX,
  MOLE_MIN,
  MOLE_REPORT_RANGE,
  MOLE_SAB_CD,
  MOLE_TASK_RANGE,
  MOLE_VENT_RANGE,
  STATIONS,
  STATION_BY_ID,
  VENT_BY_ID,
  doorMid,
  molesFor,
  ventLinks,
  type MoleMsg,
  type MolePhase,
  type MolePlayer,
  type MoleRole,
  type MoleSettings,
  type MoleView,
} from '../shared/mole';
import type { ServerMsg } from '../shared/protocol';

export interface MoleHost {
  people(): Iterable<{ id: string; name: string; x: number; z: number }>;
  send(id: string, msg: ServerMsg): void;
  chat(text: string): Promise<void>;
  err(id: string, text: string): void;
}

interface P {
  id: string;
  name: string;
  role: MoleRole;
  alive: boolean;
  out?: MolePlayer['out'];
  tasks: { st: string; done: boolean }[];
  lastKill: number;
  bell: number;
}

const T = { starting: 5000, roles: 8000, meeting: 48_000, vote: 30_000, result: 9000, end: 18_000 };
const BELLS = 1;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export class MoleGame {
  private phase: MolePhase = 'lobby';
  private until = 0;
  private phaseAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settings: MoleSettings = { ...MOLE_DEFAULTS };
  private joined = new Map<string, string>(); // lobby: id → name (in join order)
  private players: P[] = [];
  private deadlineLeft = 0;
  private playSince = 0;
  private bodies: { id: string; name: string; x: number; z: number }[] = [];
  private lights = 0;
  private lightsTimer: ReturnType<typeof setTimeout> | null = null;
  private crit = 0;
  private critTimer: ReturnType<typeof setTimeout> | null = null;
  private critHeld = new Map<string, number>(); // console → last hold time
  private locks = new Map<string, number>();
  /** doors shut by hand (anyone on the floor can shut / open them) */
  private shut = new Set<string>();
  private doorAt = new Map<string, number>();
  /** moles hiding in a duct: id → vent */
  private inVent = new Map<string, string>();
  /** people watching the security cameras */
  private watching = new Set<string>();
  private sabReady = 0;
  private meeting: MoleView['meeting'] = null;
  private votes = new Map<string, string>();
  private result: MoleView['result'] = null;
  private winner: MoleRole | null = null;
  private why = '';
  private log: { t: number; text: string }[] = [];
  /** what the progress bar shows when it only refreshes at meetings */
  private shownProgress = 0;

  constructor(private host: MoleHost) {}

  // ------------------------------------------------------------------ helpers
  private get playing() {
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
  private aliveCrew() {
    return this.players.filter((p) => p.alive && p.role === 'crew');
  }
  private aliveMoles() {
    return this.players.filter((p) => p.alive && p.role === 'mole');
  }
  private progress() {
    let all = 0;
    let done = 0;
    for (const p of this.players) {
      if (p.role !== 'crew') continue;
      for (const t of p.tasks) {
        all++;
        if (t.done) done++;
      }
    }
    return all ? done / all : 0;
  }
  private deadlineNow() {
    if (!this.settings.minutes) return 0;
    return this.phase === 'play' ? Math.max(0, this.deadlineLeft - (Date.now() - this.playSince)) : this.deadlineLeft;
  }

  private setPhase(phase: MolePhase, ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // the deadline clock only runs while people are playing
    if (this.phase === 'play' && phase !== 'play') this.deadlineLeft = this.deadlineNow();
    if (phase === 'play') this.playSince = Date.now();
    this.phase = phase;
    this.phaseAt = Date.now();
    this.until = ms ? Date.now() + ms : 0;
    if (ms) this.timer = setTimeout(() => this.advance(), ms);
  }

  private clearSabotage() {
    if (this.lightsTimer) clearTimeout(this.lightsTimer);
    if (this.critTimer) clearTimeout(this.critTimer);
    this.lightsTimer = this.critTimer = null;
    this.lights = 0;
    this.crit = 0;
    this.critHeld.clear();
    this.locks.clear();
    // everything opens up again (meeting, new game, game over), everyone climbs out, screens off
    this.shut.clear();
    this.inVent.clear();
    this.watching.clear();
  }

  // ------------------------------------------------------------------ voice
  /**
   * null = normal rules (proximity / rooms). Only decides while a game runs and both people are on
   * floor 5: in a meeting the living hear each other anywhere; the dead (and onlookers) never reach
   * the living, but hear them and talk among themselves.
   */
  voice(from: { id: string; x: number }, to: { id: string; x: number }): boolean | null {
    if (!this.playing || this.phase === 'end') return null;
    if (from.x < MOLE_FLOOR_X0 || to.x < MOLE_FLOOR_X0) return null;
    const a = this.get(from.id);
    const b = this.get(to.id);
    const aLive = !!a?.alive;
    const bLive = !!b?.alive;
    if (!aLive && bLive) return false;
    const together = this.phase === 'meeting' || this.phase === 'vote' || this.phase === 'result' || this.phase === 'roles';
    if (!aLive && !bLive) return true; // ghosts talk across the floor
    if (together) return true;
    return null; // living → anyone: by distance
  }

  // ------------------------------------------------------------------ views
  private viewFor(id: string): MoleView {
    const me = this.get(id);
    const knows = (p: P) => p.id === id || this.phase === 'end' || !me || !me.alive || (me.role === 'mole' && p.role === 'mole') || (p.out === 'voted' && this.settings.reveal);
    const players: MolePlayer[] = this.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: knows(p) ? p.role : null, out: p.out }));
    const crew = me?.role === 'crew';
    return {
      phase: this.phase,
      until: this.until,
      deadlineLeft: this.deadlineNow(),
      deadlineAt: Date.now(),
      host: this.hostId(),
      joined: [...this.joined].map(([jid, name]) => ({ id: jid, name })),
      settings: this.settings,
      players,
      progress: this.settings.taskBar === 'meetings' && this.phase === 'play' ? this.shownProgress : this.progress(),
      bodies: this.bodies,
      lights: this.lights,
      crit: this.crit,
      critHeld: [...this.critHeld].filter(([, t]) => Date.now() - t < 1500).map(([c]) => c),
      locks: [...this.locks].map(([door, until]) => ({ door, until })),
      doors: [...new Set([...this.shut, ...this.locks.keys()])],
      hidden: [...this.inVent.keys()],
      cams: this.watching.size,
      meeting: this.meeting,
      voted: this.phase === 'vote' ? [...this.votes.keys()] : [],
      votes: this.phase === 'result' || this.phase === 'end' ? Object.fromEntries(this.votes) : null,
      result: this.result,
      winner: this.winner,
      why: this.why,
      log: this.log.slice(-12),
      me: {
        inGame: !!me,
        role: me?.role ?? null,
        alive: !!me?.alive,
        tasks: me ? me.tasks.map((t) => ({ st: t.st, kind: STATION_BY_ID.get(t.st)!.kind, done: crew ? t.done : false })) : [],
        mates: me?.role === 'mole' ? this.players.filter((p) => p.role === 'mole' && p.id !== id).map((p) => p.id) : [],
        killReady: me ? me.lastKill + this.settings.killCd * 1000 : 0,
        sabReady: this.sabReady,
        bell: me?.bell ?? 0,
        vote: me ? this.votes.get(me.id) ?? null : null,
        vent: this.inVent.get(id) ?? null,
      },
    };
  }

  private keepTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * While anyone is in the lobby or a game runs, keep a slow heartbeat going: the Durable Object
   * would otherwise be allowed to hibernate during a quiet stretch of play (no phase timer) and wake
   * up with the game forgotten.
   */
  private keepAlive() {
    const busy = this.joined.size > 0 || this.phase !== 'lobby';
    if (busy && !this.keepTimer) this.keepTimer = setInterval(() => this.keepAlive(), 5000);
    else if (!busy && this.keepTimer) {
      clearInterval(this.keepTimer);
      this.keepTimer = null;
    }
  }

  /** Everyone concerned: players, people in the lobby list, anyone on floor 5. */
  broadcast() {
    this.keepAlive();
    const ids = new Set<string>([...this.joined.keys(), ...this.players.map((p) => p.id)]);
    for (const p of this.host.people()) if (p.x >= MOLE_FLOOR_X0) ids.add(p.id);
    for (const id of ids) this.host.send(id, { t: 'mole', v: this.viewFor(id) });
  }

  sendTo(id: string) {
    this.host.send(id, { t: 'mole', v: this.viewFor(id) });
  }

  /** A message for everyone on floor 5. */
  private toFloor(msg: ServerMsg) {
    for (const p of this.host.people()) if (p.x >= MOLE_FLOOR_X0) this.host.send(p.id, msg);
  }

  /** Arrived on floor 5. */
  arrived(id: string) {
    this.sendTo(id);
  }

  private gone = new Map<string, ReturnType<typeof setTimeout>>();

  /** Disconnected: one minute to come back. */
  leave(id: string) {
    if (this.watching.delete(id)) this.broadcast();
    if (!this.playing && this.joined.delete(id)) return this.broadcast();
    const p = this.get(id);
    if (!p || !p.alive || this.phase === 'end') return;
    const old = this.gone.get(id);
    if (old) clearTimeout(old);
    this.gone.set(
      id,
      setTimeout(() => {
        this.gone.delete(id);
        if (!p.alive || !this.playing || this.phase === 'end' || this.players.indexOf(p) < 0) return;
        if ([...this.host.people()].some((x) => x.id === id)) return;
        p.alive = false;
        p.out = 'left';
        this.inVent.delete(id);
        this.say(`⚡ ${p.name} đã rời công ty (mất kết nối).`);
        if (!this.checkWin()) this.broadcast();
      }, 60_000),
    );
  }

  rejoin(id: string) {
    const old = this.gone.get(id);
    if (old) clearTimeout(old);
    this.gone.delete(id);
    if (this.get(id)) this.sendTo(id);
  }

  // ------------------------------------------------------------------ actions
  handle(pp: { id: string; name: string; x: number; z: number }, m: MoleMsg) {
    const me = this.get(pp.id);
    const now = Date.now();
    switch (m.a) {
      case 'join': {
        if (this.playing) return this.host.err(pp.id, 'Ván đang diễn ra — chờ ván sau nhé 🕵️');
        if (pp.x < MOLE_FLOOR_X0) return this.host.err(pp.id, 'Lên tầng 5 để tham gia Nội Gián nhé.');
        if (this.joined.size >= MOLE_MAX) return this.host.err(pp.id, `Tối đa ${MOLE_MAX} người một ván.`);
        this.joined.set(pp.id, pp.name);
        return this.broadcast();
      }
      case 'leave': {
        if (this.playing) return;
        if (this.joined.delete(pp.id) && this.phase === 'starting' && this.joined.size < MOLE_MIN) {
          this.setPhase('lobby', 0);
          this.say('Không đủ người — huỷ ván.');
        }
        return this.broadcast();
      }
      case 'settings': {
        if (this.playing || this.hostId() !== pp.id) return;
        const s = m.s ?? {};
        const n: MoleSettings = { ...this.settings };
        if (s.moles != null) n.moles = Math.max(0, Math.min(3, Math.round(Number(s.moles)) || 0));
        if (s.minutes != null) n.minutes = [0, 5, 7, 10, 15].includes(Number(s.minutes)) ? Number(s.minutes) : n.minutes;
        if (s.killCd != null) n.killCd = [20, 30, 45].includes(Number(s.killCd)) ? Number(s.killCd) : n.killCd;
        if (s.tasks != null) n.tasks = Math.max(3, Math.min(7, Math.round(Number(s.tasks)) || 5));
        if (typeof s.reveal === 'boolean') n.reveal = s.reveal;
        if (s.taskBar === 'live' || s.taskBar === 'meetings') n.taskBar = s.taskBar;
        this.settings = n;
        return this.broadcast();
      }
      case 'start': {
        if (this.playing || this.phase === 'starting') return;
        if (!this.joined.has(pp.id)) return this.host.err(pp.id, 'Bấm “Tham gia” trước đã nhé.');
        if (this.joined.size < MOLE_MIN) return this.host.err(pp.id, `Cần ít nhất ${MOLE_MIN} người (đang có ${this.joined.size}).`);
        this.log = [];
        this.say(`🕵️ ${pp.name} bắt đầu ván — 5 giây nữa vào việc!`);
        this.setPhase('starting', T.starting);
        return this.broadcast();
      }
      case 'abort': {
        if (!this.playing || this.hostId() !== pp.id) return;
        this.say(`⛔ ${pp.name} đã dừng ván chơi.`);
        this.reset();
        return this.broadcast();
      }
      case 'task': {
        if (!me || this.phase !== 'play' || me.role !== 'crew') return;
        const t = me.tasks.find((x) => x.st === m.st && !x.done);
        const st = STATION_BY_ID.get(String(m.st));
        if (!t || !st) return this.host.err(pp.id, 'Nhiệm vụ này không còn trong danh sách của bạn — tải lại trang nếu vừa có bản cập nhật.');
        if (dist(pp, st) > MOLE_TASK_RANGE + 1.2) return this.host.err(pp.id, 'Bạn đứng xa chỗ làm nhiệm vụ quá — lại gần rồi làm lại nhé.');
        t.done = true;
        // a medical scan is a show for everyone nearby (moles can't fake it)
        if (st.kind === 'scan') this.toFloor({ t: 'moleFx', fx: { kind: 'scan', id: me.id, x: pp.x, z: pp.z } });
        if (this.checkWin()) return;
        return this.broadcast();
      }
      case 'kill': {
        if (!me?.alive || me.role !== 'mole' || this.phase !== 'play' || this.inVent.has(me.id)) return;
        if (now < me.lastKill + this.settings.killCd * 1000) return;
        const v = this.get(String(m.target));
        if (!v?.alive || v.role === 'mole') return;
        const vp = this.pos(v.id);
        if (!vp || dist(pp, vp) > MOLE_KILL_RANGE + 0.6) return this.host.err(pp.id, 'Đứng gần hơn chút nữa…');
        v.alive = false;
        v.out = 'killed';
        me.lastKill = now;
        this.bodies.push({ id: v.id, name: v.name, x: vp.x, z: vp.z });
        this.host.send(v.id, { t: 'moleFx', fx: { kind: 'killed', by: me.name } });
        this.host.send(me.id, { t: 'moleFx', fx: { kind: 'kill', victim: v.name } });
        if (this.checkWin()) return;
        return this.broadcast();
      }
      case 'report': {
        if (!me?.alive || this.phase !== 'play' || this.inVent.has(me.id)) return;
        const b = this.bodies.find((x) => x.id === m.body);
        if (!b || dist(pp, b) > MOLE_REPORT_RANGE + 0.8) return;
        return this.callMeeting(me, 'report', b.id);
      }
      case 'bell': {
        if (!me?.alive || this.phase !== 'play' || this.inVent.has(me.id)) return;
        if (me.bell <= 0) return this.host.err(pp.id, 'Bạn đã dùng hết lượt bấm chuông.');
        if (this.crit) return this.host.err(pp.id, 'Đang có sự cố server — không họp được lúc này!');
        if (dist(pp, BELL) > MOLE_BELL_RANGE + 0.8) return;
        if (now - this.phaseAt < 15_000) return this.host.err(pp.id, 'Chuông chỉ bấm được sau 15 giây đầu mỗi vòng.');
        me.bell--;
        return this.callMeeting(me, 'bell', null);
      }
      case 'sabotage': {
        // moles sabotage even after being caught (ghosts too)
        if (!me || me.role !== 'mole' || this.phase !== 'play') return;
        if (now < this.sabReady) return;
        if (m.kind === 'lights') {
          if (this.lights) return;
          this.lights = now + MOLE_LIGHTS_MS;
          if (this.lightsTimer) clearTimeout(this.lightsTimer);
          this.lightsTimer = setTimeout(() => {
            this.lights = 0;
            this.broadcast();
          }, MOLE_LIGHTS_MS);
        } else if (m.kind === 'door') {
          const room = m.room && LOCKABLE_ROOMS.includes(m.room) ? m.room : null;
          if (!room) return;
          for (const d of MOLE_DOORS)
            if (d.rooms.includes(room)) {
              this.locks.set(d.id, now + MOLE_LOCK_MS);
              this.toFloor({ t: 'moleFx', fx: { kind: 'door', door: d.id, shut: true, locked: true } });
            }
          setTimeout(() => {
            // the lock runs out: those doors spring open again
            for (const [d, t] of this.locks)
              if (t <= Date.now() + 50) {
                this.locks.delete(d);
                this.shut.delete(d);
                this.toFloor({ t: 'moleFx', fx: { kind: 'door', door: d, shut: false } });
              }
            this.broadcast();
          }, MOLE_LOCK_MS + 30);
        } else if (m.kind === 'crit') {
          if (this.crit) return;
          this.crit = now + MOLE_CRIT_MS;
          this.critHeld.clear();
          this.critTimer = setTimeout(() => {
            if (!this.crit || this.phase !== 'play') return;
            this.finish('mole', '💥 Server quá tải và sập — dự án đổ bể!');
          }, MOLE_CRIT_MS);
        } else return;
        this.sabReady = now + MOLE_SAB_CD;
        return this.broadcast();
      }
      case 'fix': {
        if (!me || this.phase !== 'play' || !this.lights) return;
        if (dist(pp, FUSE_SPOT) > 2.8) return;
        this.lights = 0;
        if (this.lightsTimer) clearTimeout(this.lightsTimer);
        this.say(`🔌 ${pp.name} đã bật lại cầu dao.`);
        return this.broadcast();
      }
      case 'hold': {
        if (!me?.alive || this.phase !== 'play' || !this.crit) return;
        const c = CRIT.find((x) => x.id === m.console);
        if (!c || dist(pp, { x: c.x + Math.sin(c.ry) * 0.95, z: c.z + Math.cos(c.ry) * 0.95 }) > 2.6) return;
        const wasHeld = this.critHeld.has(c.id) && now - this.critHeld.get(c.id)! < 1500;
        this.critHeld.set(c.id, now);
        const both = CRIT.every((x) => now - (this.critHeld.get(x.id) ?? 0) < 1500);
        if (both) {
          this.crit = 0;
          this.critHeld.clear();
          if (this.critTimer) clearTimeout(this.critTimer);
          this.say('🛠️ Hai người đã cùng giữ bảng điều khiển — server ổn định trở lại!');
          return this.broadcast();
        }
        if (!wasHeld) this.broadcast();
        return;
      }
      case 'door': {
        const d = DOOR_BY_ID.get(String(m.door));
        if (!d || pp.x < MOLE_FLOOR_X0) return;
        // while a game runs only the living players move the doors (and not from a duct)
        const live = this.playing && this.phase !== 'end';
        if (live && (!me || !me.alive || this.phase !== 'play' || this.inVent.has(me.id))) return;
        if (this.locks.has(d.id)) return this.host.err(pp.id, '🔒 Cửa đang bị khoá — đợi một lát.');
        if (dist(pp, doorMid(d)) > MOLE_DOOR_RANGE + 0.8) return;
        if (now - (this.doorAt.get(d.id) ?? 0) < 600) return;
        this.doorAt.set(d.id, now);
        const shut = !this.shut.has(d.id);
        if (shut) this.shut.add(d.id);
        else this.shut.delete(d.id);
        this.toFloor({ t: 'moleFx', fx: { kind: 'door', door: d.id, shut } });
        return this.broadcast();
      }
      case 'vent': {
        if (!me?.alive || me.role !== 'mole' || this.phase !== 'play') return;
        const cur = this.inVent.get(me.id) ?? null;
        const to = m.vent == null ? null : VENT_BY_ID.get(String(m.vent)) ?? null;
        if (!cur) {
          // jump in: you must stand on the hatch
          if (!to || dist(pp, to) > MOLE_VENT_RANGE + 0.8) return;
          this.inVent.set(me.id, to.id);
          this.toFloor({ t: 'moleFx', fx: { kind: 'vent', vent: to.id } });
        } else if (!to) {
          // climb out where you are
          this.inVent.delete(me.id);
          this.toFloor({ t: 'moleFx', fx: { kind: 'vent', vent: cur } });
        } else {
          // crawl to a linked hatch
          if (!ventLinks(cur).some((v) => v.id === to.id)) return;
          this.inVent.set(me.id, to.id);
        }
        return this.broadcast();
      }
      case 'cams': {
        if (m.on) {
          if (pp.x < MOLE_FLOOR_X0 || dist(pp, CAM_DESK) > MOLE_CAM_RANGE + 0.8) return;
          if (this.playing && this.phase !== 'end' && this.phase !== 'play') return;
          if (me && this.inVent.has(me.id)) return;
          if (this.watching.has(pp.id)) return;
          this.watching.add(pp.id);
        } else if (!this.watching.delete(pp.id)) return;
        return this.broadcast();
      }
      case 'vote': {
        if (!me?.alive || this.phase !== 'vote') return;
        const t = String(m.target);
        if (t !== 'skip' && !this.get(t)?.alive) return;
        this.votes.set(me.id, t);
        if (this.players.filter((p) => p.alive).every((p) => this.votes.has(p.id))) this.hurry(1500);
        return this.broadcast();
      }
    }
  }

  private hurry(ms: number) {
    const at = Date.now() + ms;
    if (this.until && at >= this.until) return;
    if (this.timer) clearTimeout(this.timer);
    this.until = at;
    this.timer = setTimeout(() => this.advance(), ms);
  }

  private callMeeting(by: P, reason: 'report' | 'bell', body: string | null) {
    this.meeting = { by: by.id, byName: by.name, reason, body: body ? this.get(body)?.name ?? null : null };
    this.say(reason === 'report' ? `📣 ${by.name} phát hiện xác của ${this.meeting.body}!` : `🔔 ${by.name} bấm chuông họp khẩn!`);
    this.bodies = [];
    this.clearSabotage();
    this.votes.clear();
    this.shownProgress = this.progress();
    this.setPhase('meeting', T.meeting);
    this.broadcast();
  }

  // ------------------------------------------------------------------ flow
  private reset() {
    this.setPhase('lobby', 0);
    this.players = [];
    this.bodies = [];
    this.clearSabotage();
    this.meeting = null;
    this.result = null;
    this.winner = null;
    this.why = '';
    this.votes.clear();
  }

  private advance() {
    this.timer = null;
    switch (this.phase) {
      case 'starting':
        return this.deal();
      case 'roles':
        this.say('🏃 Vào việc! Làm nhiệm vụ — và để ý xung quanh.');
        this.setPhase('play', this.settings.minutes ? this.deadlineLeft : 0);
        return this.broadcast();
      case 'play':
        // the deadline ran out
        return void this.finish('mole', '⏰ Hết deadline — dự án trễ hạn, nội gián đắc thắng!');
      case 'meeting':
        this.say('🗳️ Bỏ phiếu!');
        this.setPhase('vote', T.vote);
        return this.broadcast();
      case 'vote':
        return this.tally();
      case 'result':
        this.meeting = null;
        this.result = null;
        this.votes.clear();
        if (this.checkWin()) return;
        this.setPhase('play', this.settings.minutes ? this.deadlineLeft : 0);
        // everyone's kill timer restarts after a meeting
        for (const p of this.players) if (p.role === 'mole') p.lastKill = Date.now() - Math.max(0, this.settings.killCd * 1000 - 12_000);
        return this.broadcast();
      case 'end':
        this.reset();
        return this.broadcast();
    }
  }

  private deal() {
    const ids = [...this.joined.keys()].filter((id) => [...this.host.people()].some((p) => p.id === id));
    if (ids.length < MOLE_MIN) {
      this.say('Không đủ người — huỷ ván.');
      this.setPhase('lobby', 0);
      return this.broadcast();
    }
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const nMoles = molesFor(ids.length, this.settings);
    const now = Date.now();
    // the join order decides the seats round the table, the shuffle decides the roles
    const order = [...this.joined.keys()].filter((id) => ids.includes(id));
    this.players = order.map((id) => {
      const role: MoleRole = ids.indexOf(id) < nMoles ? 'mole' : 'crew';
      const pool = [...STATIONS].sort(() => Math.random() - 0.5).slice(0, this.settings.tasks);
      return { id, name: this.joined.get(id)!, role, alive: true, tasks: pool.map((s) => ({ st: s.id, done: false })), lastKill: now - this.settings.killCd * 1000 + 25_000, bell: BELLS };
    });
    this.joined.clear();
    this.bodies = [];
    this.clearSabotage();
    this.sabReady = now + 20_000;
    this.winner = null;
    this.why = '';
    this.deadlineLeft = this.settings.minutes * 60_000;
    this.say(`🃏 ${this.players.length} người, trong đó có ${nMoles} nội gián. Xem vai của bạn!`);
    this.setPhase('roles', T.roles);
    this.broadcast();
    void this.host.chat(`🕵️ Một ván Nội Gián vừa bắt đầu ở tầng 5 với ${this.players.length} người — ai là nội gián?`);
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
    if (!best || skip >= best || top.length > 1) {
      const why = top.length > 1 ? 'tie' : 'skip';
      this.result = { out: null, name: '', wasMole: null, why, molesLeft: this.settings.reveal ? this.aliveMoles().length : null };
      this.say(why === 'tie' ? '⚖️ Phiếu hoà — không ai bị trục xuất.' : '🤷 Không đủ phiếu — không ai bị trục xuất.');
    } else {
      const p = this.get(top[0])!;
      p.alive = false;
      p.out = 'voted';
      this.result = { out: p.id, name: p.name, wasMole: this.settings.reveal ? p.role === 'mole' : null, why: 'votes', molesLeft: this.settings.reveal ? this.aliveMoles().length : null };
      this.say(
        this.settings.reveal ? `🚪 ${p.name} bị trục xuất — ${p.role === 'mole' ? 'đúng là NỘI GIÁN! 🎯' : 'nhưng họ KHÔNG phải nội gián 😱'}` : `🚪 ${p.name} bị trục xuất.`,
      );
    }
    this.setPhase('result', T.result);
    this.broadcast();
  }

  private checkWin(): boolean {
    if (!this.players.length) return false;
    const moles = this.aliveMoles().length;
    const crew = this.aliveCrew().length;
    if (!moles) return this.finish('crew', '🎯 Tất cả nội gián đã bị lộ mặt!');
    if (this.progress() >= 1) return this.finish('crew', '✅ Dự án hoàn thành — mọi nhiệm vụ đã xong!');
    if (moles >= crew) return this.finish('mole', '🔪 Nội gián đã giết đủ người — công ty thất thủ!');
    return false;
  }

  private finish(w: MoleRole, why: string): true {
    this.winner = w;
    this.why = why;
    this.meeting = null;
    this.clearSabotage();
    this.bodies = [];
    const moles = this.players.filter((p) => p.role === 'mole').map((p) => p.name).join(', ');
    this.say(`${w === 'crew' ? '🏆 NHÂN VIÊN THẮNG' : '🕵️ NỘI GIÁN THẮNG'} — ${why} (Nội gián: ${moles})`);
    this.setPhase('end', T.end);
    this.broadcast();
    void this.host.chat(`🕵️ Ván Nội Gián kết thúc — ${w === 'crew' ? 'nhân viên thắng' : 'nội gián thắng'}! (Nội gián: ${moles})`);
    return true;
  }
}
