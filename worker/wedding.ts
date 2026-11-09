// Wedding hall server (floor 7), living inside the OfficeRoom Durable Object: who is the groom, the
// bride and the MC, which step of the programme is on (everyone's screen, music, lights and effects
// follow `step` + `stepAt`), the pretend gift envelopes and wishes, outfits, and the bouquet toss
// (the server picks who catches it). State is saved to DO storage so a sleeping room keeps it.
import {
  GIFT_AMOUNTS,
  STEP_META,
  WED_DANCE,
  WED_MAX_GIFTS,
  WED_PROGRAM,
  WED_REACTS,
  WED_T,
  WED_WISH_MAX,
  emptyWed,
  inWedZone,
  money,
  nextStep,
  onWedStage,
  type WedAttire,
  type WedMsg,
  type WedPerson,
  type WedRole,
  type WedState,
  type WedStep,
} from '../shared/wedding';
import { clampStr, type ServerMsg } from '../shared/protocol';

export interface WedHost {
  people(): Iterable<{ id: string; name: string; zone: string; x: number; z: number }>;
  broadcast(msg: ServerMsg): void;
  chat(text: string): void;
  err(id: string, text: string): void;
  save(state: WedState): void;
}

const ATTIRES: WedAttire[] = ['bride', 'groom', 'bridesmaid', 'groomsman'];
const ROLE_NAME: Record<WedRole, string> = { groom: 'chú rể', bride: 'cô dâu', mc: 'MC' };

export class Wedding {
  state: WedState = emptyWed();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = new Map<string, number>();

  constructor(private host: WedHost) {}

  /** After waking up (state loaded from storage). */
  restore(s: WedState | undefined) {
    if (!s || typeof s !== 'object') return;
    this.state = { ...emptyWed(), ...s, attire: s.attire ?? {}, gifts: s.gifts ?? [] };
    // a toss that was in the air when the room went to sleep: land it now
    if (this.state.step === 'bouquet' && !this.state.bouquet) this.arm();
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

  handle(p: { id: string; name: string; zone: string }, m: WedMsg) {
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
      case 'attire': {
        if (!onFloor) return;
        if (m.attire === null) delete s.attire[p.id];
        else if (ATTIRES.includes(m.attire)) s.attire[p.id] = m.attire;
        else return;
        this.publish();
        return;
      }
    }
  }

  private go(step: WedStep) {
    const s = this.state;
    const first = s.step === 'idle';
    s.step = step;
    s.stepAt = Date.now();
    if (first) s.startedAt = s.stepAt;
    if (step !== 'bouquet') s.bouquet = null;
    this.arm();
    this.publish();
    if (first && s.groom && s.bride) this.host.chat(`💒 Hôn lễ của ${s.groom.name} & ${s.bride.name} đang bắt đầu ở tầng 7 — mời cả nhà lên chung vui! 🎉`);
    else if (step === 'party') this.host.chat(`🎉 Tiệc cưới tầng 7 đã sang phần quẩy — sàn nhảy đang chờ mọi người!`);
    void STEP_META;
  }

  /** Timed parts of a step that the server decides (the bouquet's catcher). */
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.state;
    if (s.step !== 'bouquet' || s.bouquet) return;
    const at = s.stepAt + WED_T.bouquetThrow;
    this.timer = setTimeout(() => this.toss(), Math.max(0, at - Date.now()));
  }

  /** The bouquet flies: whoever is closest to where it lands (and wants it) catches it. */
  private toss() {
    this.timer = null;
    const s = this.state;
    if (s.step !== 'bouquet' || s.bouquet) return;
    const couple = new Set([s.groom?.id, s.bride?.id]);
    const guests = [...this.host.people()].filter((q) => q.zone === 'wedding' && !couple.has(q.id));
    // aim at the dance floor; a crowd standing there pulls it their way
    // (nobody on the stage — the MC, the groom's friends up there — only the crowd in front)
    const front = guests.filter((q) => !onWedStage(q.x, q.z) && q.z > WED_DANCE.z0 - 1 && q.z < WED_DANCE.z1 + 5 && q.x > WED_DANCE.x0 - 3 && q.x < WED_DANCE.x1 + 3);
    let x = WED_DANCE.x0 + 1 + Math.random() * (WED_DANCE.x1 - WED_DANCE.x0 - 2);
    let z = WED_DANCE.z0 + 1.5 + Math.random() * 3.5;
    let catcher: (typeof guests)[number] | null = null;
    if (front.length) {
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
    s.bouquet = { at: Date.now() + WED_T.bouquetFly, x, z, id: catcher?.id ?? null, name: catcher?.name ?? null };
    this.publish();
    const name = catcher?.name;
    setTimeout(() => {
      if (name) this.host.chat(`💐 ${name} đã bắt được hoa cưới của ${s.bride?.name ?? 'cô dâu'}! Sắp có đám cưới tiếp theo rồi 😉`);
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
    this.state = { ...emptyWed(), count, attire: s.attire, mc: s.mc };
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
