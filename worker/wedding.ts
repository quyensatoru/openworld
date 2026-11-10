// Wedding hall server (floor 7), living inside the OfficeRoom Durable Object: who is the groom, the
// bride and the MC, which step of the programme is on (everyone's screen, music, lights and effects
// follow `step` + `stepAt`), the song the band plays, the pretend gift envelopes and wishes, outfits,
// the guests' "Hôn đi!" meter, the table toasts and the bouquet toss (the server times everyone's
// grab and decides who caught it). State is saved to DO storage so a sleeping room keeps it.
import {
  BOUQUET_OPEN,
  DZO_MS,
  GIFT_AMOUNTS,
  STEP_SET,
  WED_DANCE,
  WED_MAX_GIFTS,
  WED_PROGRAM,
  WED_REACTS,
  WED_T,
  WED_WISH_MAX,
  autoMusic,
  emptyWed,
  inCatchZone,
  inWedZone,
  money,
  nextStep,
  tableNear,
  LIGHTS_ORDER,
  type WedAttire,
  type WedMsg,
  type WedPerson,
  type WedRole,
  type WedState,
  type WedStep,
} from '../shared/wedding';
import { YT_ID, clampStr, type ServerMsg } from '../shared/protocol';

export interface WedHost {
  people(): Iterable<{ id: string; name: string; zone: string; x: number; z: number }>;
  broadcast(msg: ServerMsg): void;
  chat(text: string): void;
  err(id: string, text: string): void;
  save(state: WedState): void;
}

const ATTIRES: WedAttire[] = ['bride', 'groom', 'bridesmaid', 'groomsman'];
const ROLE_NAME: Record<WedRole, string> = { groom: 'chú rể', bride: 'cô dâu', mc: 'MC' };
/** Steps where only the people running the show change the music (anyone may in the others). */
const OPEN_MIC: WedStep[] = ['idle', 'feast', 'party'];

type Who = { id: string; name: string; zone: string; x: number; z: number };

export class Wedding {
  state: WedState = emptyWed();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private kissTimer: ReturnType<typeof setTimeout> | null = null;
  private last = new Map<string, number>();
  /** Bouquet grabs: player → ms after `stepAt` (one try each). */
  private grabs = new Map<string, number>();
  /** Table toasts that are counting, by table. */
  private dzo = new Map<number, { at: number; ids: string[]; timer: ReturnType<typeof setTimeout> }>();
  private dzoLast = new Map<number, number>();

  constructor(private host: WedHost) {
    this.state.music.at = Date.now();
  }

  /** After waking up (state loaded from storage). */
  restore(s: WedState | undefined) {
    if (!s || typeof s !== 'object') return;
    const music = s.music && typeof s.music.id === 'string' ? s.music : autoMusic(STEP_SET[s.step] ?? 'lounge', s.count ?? 0, Date.now());
    this.state = { ...emptyWed(), ...s, attire: s.attire ?? {}, gifts: s.gifts ?? [], lights: s.lights ?? 'auto', music, kiss: s.kiss ?? null };
    // a toss in the air / a kiss being chanted for when the room went to sleep: finish it now
    this.arm();
  }

  private person(id: string) {
    for (const p of this.host.people()) if (p.id === id) return p;
    return null;
  }

  /** Someone who holds a role and is still up on floor 7. */
  private here(p: WedPerson | null): boolean {
    return !!p && inWedZone(this.person(p.id)?.zone);
  }

  /** The couple and the MC run the show; when none of them is around, anyone in the hall may. */
  private canRun(id: string): boolean {
    const s = this.state;
    if (s.groom?.id === id || s.bride?.id === id || s.mc?.id === id) return true;
    return !this.here(s.groom) && !this.here(s.bride) && !this.here(s.mc);
  }

  private publish() {
    this.host.broadcast({ t: 'wed', s: this.state });
    this.host.save(this.state);
  }

  private throttle(id: string, key: string, ms: number): boolean {
    const k = `${key}:${id}`;
    const now = Date.now();
    if (now - (this.last.get(k) ?? 0) < ms) return false;
    this.last.set(k, now);
    return true;
  }

  handle(p: Who, m: WedMsg) {
    const s = this.state;
    const onFloor = inWedZone(p.zone);
    switch (m.a) {
      case 'role': {
        if (!onFloor) return this.host.err(p.id, 'Lên tầng 7 (sảnh tiệc cưới) rồi mới nhận vai được nhé 💒');
        const role = m.role;
        if (role !== 'groom' && role !== 'bride' && role !== 'mc') return;
        if (!m.on) {
          if (s[role]?.id !== p.id) return;
          s[role] = null;
          this.publish();
          return;
        }
        const holder = s[role];
        if (holder && holder.id !== p.id && this.here(holder)) return this.host.err(p.id, `Đã có ${ROLE_NAME[role]} rồi (${holder.name}) 😄`);
        // one role each
        for (const r of ['groom', 'bride', 'mc'] as WedRole[]) if (s[r]?.id === p.id) s[r] = null;
        s[role] = { id: p.id, name: p.name };
        // the couple's outfit comes with the role
        delete s.attire[p.id];
        this.publish();
        if (role !== 'mc' && s.groom && s.bride && s.step === 'idle') this.host.chat(`💍 ${s.groom.name} và ${s.bride.name} sắp làm đám cưới ở tầng 7 — chuẩn bị phong bì nhé! 💌`);
        return;
      }
      case 'step':
      case 'next': {
        if (!onFloor) return;
        if (!this.canRun(p.id)) return this.host.err(p.id, 'Chỉ cô dâu, chú rể hoặc MC mới điều khiển chương trình được.');
        const step: WedStep = m.a === 'next' ? nextStep(s.step) : m.step;
        if (!WED_PROGRAM.includes(step)) return;
        if (!s.groom || !s.bride) return this.host.err(p.id, 'Cần có đủ cô dâu và chú rể mới bắt đầu được 💑');
        if (!this.throttle(p.id, 'step', 900)) return;
        this.go(step);
        return;
      }
      case 'end': {
        if (!onFloor || s.step === 'idle') return;
        if (!this.canRun(p.id)) return this.host.err(p.id, 'Chỉ cô dâu, chú rể hoặc MC mới kết thúc tiệc được.');
        this.finish();
        return;
      }
      case 'gift': {
        if (!onFloor) return;
        const amount = Number(m.amount);
        if (!(GIFT_AMOUNTS as readonly number[]).includes(amount)) return;
        if (!this.throttle(p.id, 'gift', 4000)) return this.host.err(p.id, 'Từ từ thôi, phong bì vẫn đang bay vào thùng 😄');
        const wish = clampStr(m.wish ?? '', WED_WISH_MAX);
        if (!s.gifts.some((g) => g.id === p.id)) s.givers++;
        s.gifts.push({ id: p.id, name: p.name, amount, wish, at: Date.now() });
        if (s.gifts.length > WED_MAX_GIFTS) s.gifts.splice(0, s.gifts.length - WED_MAX_GIFTS);
        s.total += amount;
        this.host.broadcast({ t: 'wedFx', fx: { k: 'gift', id: p.id, name: p.name, amount, wish } });
        this.publish();
        return;
      }
      case 'react': {
        if (!onFloor || !(WED_REACTS as readonly string[]).includes(m.e)) return;
        if (!this.throttle(p.id, 'react', 250)) return;
        this.host.broadcast({ t: 'wedFx', fx: { k: 'react', id: p.id, e: m.e } });
        return;
      }
      case 'popper':
      case 'petals': {
        if (!onFloor || !this.throttle(p.id, m.a, 1500)) return;
        this.host.broadcast({ t: 'wedFx', fx: { k: m.a, id: p.id } });
        return;
      }
      case 'lights': {
        if (!onFloor || !LIGHTS_ORDER.includes(m.lights) || m.lights === s.lights) return;
        // during the ceremony the lights belong to whoever runs it; otherwise anyone up here
        if (s.step !== 'idle' && !this.canRun(p.id)) return this.host.err(p.id, 'Đang làm lễ — chỉ cô dâu, chú rể hoặc MC mới đổi đèn được 💡');
        if (!this.throttle(p.id, 'lights', 700)) return;
        s.lights = m.lights;
        this.host.broadcast({ t: 'wedFx', fx: { k: 'lights', id: p.id, name: p.name, lights: m.lights } });
        this.publish();
        return;
      }
      case 'attire': {
        if (!onFloor) return;
        if (m.attire === null) delete s.attire[p.id];
        else if (ATTIRES.includes(m.attire)) s.attire[p.id] = m.attire;
        else return;
        this.publish();
        return;
      }
      case 'song':
      case 'skip': {
        if (!onFloor) return;
        if (m.a === 'song' && (typeof m.id !== 'string' || !YT_ID.test(m.id))) return;
        if (!OPEN_MIC.includes(s.step) && !this.canRun(p.id)) return this.host.err(p.id, 'Đang làm lễ — chỉ cô dâu, chú rể hoặc MC mới đổi nhạc được 🎵');
        if (!this.throttle(p.id, 'song', 2500)) return this.host.err(p.id, 'Từ từ nào, bài vừa đổi xong 😄');
        const set = STEP_SET[s.step];
        // a little lead so everyone's player has loaded it when it starts
        const at = Date.now() + 800;
        if (m.a === 'skip') s.music = autoMusic(set, s.music.by || s.music.set !== set ? s.music.pick : s.music.pick + 1, at);
        else {
          const dur = Math.max(0, Math.min(36_000, Math.round(Number(m.dur) || 0)));
          s.music = { id: m.id, title: clampStr(m.title ?? '', 100) || 'Bài hát YouTube', set, pick: s.music.pick, at, dur, by: p.name };
        }
        this.host.broadcast({ t: 'wedFx', fx: { k: 'song', id: p.id, name: p.name, title: s.music.title, skip: m.a === 'skip' } });
        this.publish();
        return;
      }
      case 'chant': {
        const k = s.kiss;
        if (s.step !== 'kiss' || !k || k.at !== null || p.zone !== 'wedding') return;
        if (s.groom?.id === p.id || s.bride?.id === p.id) return;
        if (!this.throttle(p.id, 'chant', 140)) return;
        k.n++;
        this.host.broadcast({ t: 'wedFx', fx: { k: 'chant', id: p.id, n: k.n, goal: k.goal } });
        if (k.n >= k.goal) this.kissNow();
        return;
      }
      case 'dzo': {
        if (p.zone !== 'wedding') return;
        const t = tableNear(p.x, p.z);
        if (t < 0) return this.host.err(p.id, 'Ngồi vào (hoặc đứng cạnh) một bàn tiệc rồi hãy “dô” nhé 🍻');
        const now = Date.now();
        const cur = this.dzo.get(t);
        if (cur && now < cur.at) {
          // the table is counting: join in
          if (cur.ids.includes(p.id)) return;
          cur.ids.push(p.id);
          this.host.broadcast({ t: 'wedFx', fx: { k: 'dzo', t, at: cur.at, ids: cur.ids } });
          return;
        }
        if (now - (this.dzoLast.get(t) ?? 0) < 1500 || !this.throttle(p.id, 'dzo', 2500)) return;
        const at = now + DZO_MS;
        const ids = [p.id];
        const timer = setTimeout(() => {
          this.dzo.delete(t);
          this.dzoLast.set(t, Date.now());
          this.host.broadcast({ t: 'wedFx', fx: { k: 'dzoGo', t, ids } });
        }, DZO_MS);
        this.dzo.set(t, { at, ids, timer });
        this.host.broadcast({ t: 'wedFx', fx: { k: 'dzo', t, at, ids } });
        return;
      }
      case 'catch': {
        if (s.step !== 'bouquet' || s.bouquet || p.zone !== 'wedding') return;
        if (s.groom?.id === p.id || s.bride?.id === p.id || this.grabs.has(p.id)) return;
        const got = Date.now() - s.stepAt;
        // a little slack either side for the network
        if (got < BOUQUET_OPEN - 200 || got > WED_T.bouquetResolve + 150) return;
        // the moment the guest pressed (their clock is synced to ours), so a slow connection doesn't
        // cost them the bouquet — but never later than it arrived, nor long before
        const said = Number(m.el);
        this.grabs.set(p.id, Number.isFinite(said) ? Math.min(got, Math.max(got - 1000, BOUQUET_OPEN - 200, said)) : got);
        return;
      }
    }
  }

  /** The meter is full (or the guests were shy): they kiss. */
  private kissNow() {
    const k = this.state.kiss;
    if (this.state.step !== 'kiss' || !k || k.at !== null) return;
    if (this.kissTimer) clearTimeout(this.kissTimer);
    this.kissTimer = null;
    k.n = Math.max(k.n, k.goal);
    k.at = Date.now() + WED_T.kissLead;
    this.publish();
  }

  private go(step: WedStep) {
    const s = this.state;
    const first = s.step === 'idle';
    s.step = step;
    s.stepAt = Date.now();
    if (first) s.startedAt = s.stepAt;
    s.bouquet = null;
    this.grabs.clear();
    // the band moves on with the programme (a song carries on through steps that share a set)
    const set = STEP_SET[step];
    if (set !== s.music.set) s.music = autoMusic(set, s.count, s.stepAt);
    // the kiss: with guests watching, they chant for it first
    s.kiss = null;
    if (step === 'kiss') {
      const couple = new Set([s.groom?.id, s.bride?.id]);
      const guests = [...this.host.people()].filter((q) => q.zone === 'wedding' && !couple.has(q.id)).length;
      s.kiss = guests ? { n: 0, goal: Math.min(60, Math.max(12, 8 + guests * 7)), at: null } : { n: 0, goal: 0, at: s.stepAt + WED_T.kiss };
    }
    this.arm();
    this.publish();
    if (first && s.groom && s.bride) this.host.chat(`💒 Hôn lễ của ${s.groom.name} & ${s.bride.name} đang bắt đầu ở tầng 7 — mời cả nhà lên chung vui! 🎉`);
    else if (step === 'party') this.host.chat(`🎉 Tiệc cưới tầng 7 đã sang phần quẩy — sàn nhảy đang chờ mọi người!`);
  }

  /** Timed parts of a step that the server decides (the kiss when the guests are shy, the bouquet's catcher). */
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    if (this.kissTimer) clearTimeout(this.kissTimer);
    this.timer = this.kissTimer = null;
    const s = this.state;
    if (s.step === 'kiss' && s.kiss && s.kiss.at === null) this.kissTimer = setTimeout(() => this.kissNow(), Math.max(0, s.stepAt + WED_T.kissMax - Date.now()));
    if (s.step !== 'bouquet' || s.bouquet) return;
    const at = s.stepAt + WED_T.bouquetResolve;
    this.timer = setTimeout(() => this.toss(), Math.max(0, at - Date.now()));
  }

  /**
   * The bouquet comes down: whoever in the crowd reached for it closest to the perfect moment gets
   * it; if nobody reached, it falls to someone near where it drops (or on the floor).
   */
  private toss() {
    this.timer = null;
    const s = this.state;
    if (s.step !== 'bouquet' || s.bouquet) return;
    const couple = new Set([s.groom?.id, s.bride?.id]);
    const guests = [...this.host.people()].filter((q) => q.zone === 'wedding' && !couple.has(q.id));
    // only the crowd in front of the stage (not the MC, not the groom's friends up there)
    const front = guests.filter((q) => inCatchZone(q.x, q.z));
    let x = WED_DANCE.x0 + 1 + Math.random() * (WED_DANCE.x1 - WED_DANCE.x0 - 2);
    let z = WED_DANCE.z0 + 1.5 + Math.random() * 3.5;
    let catcher: (typeof guests)[number] | null = null;
    let off: number | null = null;
    const tried = front.filter((q) => this.grabs.has(q.id)).map((q) => ({ q, off: Math.abs(this.grabs.get(q.id)! - WED_T.bouquetPerfect) }));
    this.grabs.clear();
    if (tried.length) {
      tried.sort((a, b) => a.off - b.off);
      // a dead heat (within 30 ms) is settled by luck
      const best = tried.filter((t) => t.off - tried[0].off < 30);
      const win = best[Math.floor(Math.random() * best.length)];
      catcher = win.q;
      off = Math.round(win.off);
      x = catcher.x;
      z = catcher.z;
    } else if (front.length) {
      // weighted by closeness to the random landing spot, so it is not always the same person
      const w = front.map((q) => 1 / (0.4 + Math.hypot(q.x - x, q.z - z)) ** 2);
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < front.length; i++) {
        r -= w[i];
        if (r <= 0) {
          catcher = front[i];
          break;
        }
      }
      catcher ??= front[front.length - 1];
      x = catcher.x;
      z = catcher.z;
    }
    s.bouquet = { at: Date.now() + WED_T.bouquetFly, x, z, id: catcher?.id ?? null, name: catcher?.name ?? null, off, tries: tried.length };
    this.publish();
    const name = catcher?.name;
    const how = off !== null && tried.length > 1 ? ` — nhanh tay nhất trong ${tried.length} người (lệch ${(off / 1000).toFixed(2)} giây)` : '';
    setTimeout(() => {
      if (name) this.host.chat(`💐 ${name} đã bắt được hoa cưới của ${s.bride?.name ?? 'cô dâu'}${how}! Sắp có đám cưới tiếp theo rồi 😉`);
    }, WED_T.bouquetFly + 300);
  }

  /** The party is over: thank everyone, then the hall is free for the next couple. */
  private finish() {
    const s = this.state;
    if (s.groom && s.bride) {
      const gifts = s.givers ? ` · ${s.givers} người mừng cưới (tổng ${money(s.total)} — tiền ảo cho vui 😄)` : '';
      this.host.chat(`🎊 Đám cưới của ${s.groom.name} & ${s.bride.name} đã kết thúc tốt đẹp${gifts}. Chúc hai bạn trăm năm hạnh phúc! 💕`);
    }
    const count = s.count + 1;
    this.state = { ...emptyWed(), count, attire: s.attire, mc: s.mc, lights: s.lights, music: autoMusic('lounge', count, Date.now()) };
    for (const d of this.dzo.values()) clearTimeout(d.timer);
    this.dzo.clear();
    this.grabs.clear();
    this.arm();
    this.publish();
  }

  /**
   * Someone left floor 7 (`gone` = left the office altogether): a role nobody is using while the
   * hall is quiet frees up; outfits stay on until you leave the office.
   */
  left(id: string, gone: boolean) {
    const s = this.state;
    let changed = false;
    if (gone && s.attire[id]) {
      delete s.attire[id];
      changed = true;
    }
    if (s.step === 'idle') {
      for (const r of ['groom', 'bride', 'mc'] as WedRole[])
        if (s[r]?.id === id) {
          s[r] = null;
          changed = true;
        }
    }
    if (changed) this.publish();
  }
}
