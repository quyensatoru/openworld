// Karaoke room server, living inside the OfficeRoom Durable Object: the song queue, who holds the
// two mics (and their echo / reverb settings), scoring. The video itself plays on every client in
// sync from `now.startAt` (like the cinema); song ends are timed here once someone reports the length.
import {
  DEFAULT_FX,
  KARA_LEAD_MS,
  KARA_MAX_QUEUE,
  KARA_MICS,
  KARA_PER_PERSON,
  KARA_REACTS,
  KARA_SCORE_MS,
  sanitizeFx,
  scoreComment,
  type KaraMsg,
  type KaraSong,
  type KaraState,
  type MicFx,
} from '../shared/karaoke';
import { YT_ID, clampStr, type ServerMsg } from '../shared/protocol';

export interface KaraHost {
  people(): Iterable<{ id: string; name: string; zone: string }>;
  /** Everyone (the hall marquee shows what is playing). */
  broadcast(msg: ServerMsg): void;
  /** Only the people in the karaoke room. */
  room(msg: ServerMsg): void;
  err(id: string, text: string): void;
  save(state: KaraState): void;
}

const ROOM = 'karaoke';

export class Karaoke {
  state: KaraState = { queue: [], now: null, mics: [], last: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Remembered mic settings per person (so your preset sticks between songs). */
  private fx = new Map<string, MicFx>();
  /** Voice activity reported by the mic holders for the current song: seconds sung / heard. */
  private voice = new Map<string, { sung: number; heard: number }>();
  private lastReact = new Map<string, number>();

  constructor(private host: KaraHost) {}

  /** After waking up (state loaded from storage): resume the timeline. */
  restore(s: KaraState | undefined) {
    if (!s) return;
    this.state = { queue: s.queue ?? [], now: s.now ?? null, mics: [], last: s.last ?? null };
    this.schedule();
  }

  private person(id: string) {
    for (const p of this.host.people()) if (p.id === id) return p;
    return null;
  }

  private inRoom(id: string) {
    return this.person(id)?.zone === ROOM;
  }

  private publish() {
    this.host.broadcast({ t: 'kara', s: this.state });
    this.host.save(this.state);
  }

  handle(p: { id: string; name: string; zone: string }, m: KaraMsg) {
    const st = this.state;
    const now = Date.now();
    switch (m.a) {
      case 'add': {
        if (!YT_ID.test(String(m.videoId))) return;
        if (st.queue.length >= KARA_MAX_QUEUE) return this.host.err(p.id, 'Danh sách chờ đã đầy rồi 😅');
        if (st.queue.filter((q) => q.by === p.id).length >= KARA_PER_PERSON) return this.host.err(p.id, `Mỗi người chỉ xếp tối đa ${KARA_PER_PERSON} bài thôi nhé 🎤`);
        const song: KaraSong = {
          sid: crypto.randomUUID().slice(0, 8),
          videoId: String(m.videoId),
          title: clampStr(m.title ?? '', 140),
          by: p.id,
          byName: p.name,
          dur: Math.max(0, Math.min(1800, Number(m.dur) || 0)),
        };
        st.queue.push(song);
        if (!st.now && !this.timer) this.next();
        else this.publish();
        return;
      }
      case 'remove': {
        const i = st.queue.findIndex((q) => q.sid === m.sid);
        if (i < 0) return;
        const q = st.queue[i];
        if (q.by !== p.id && this.person(q.by)) return this.host.err(p.id, 'Chỉ người chọn bài mới xoá được bài đó.');
        st.queue.splice(i, 1);
        this.publish();
        return;
      }
      case 'skip': {
        const cur = st.now;
        if (!cur) return;
        const owner = cur.song.by === p.id || st.mics.some((x) => x.id === p.id);
        if (!owner && this.inRoom(cur.song.by)) return this.host.err(p.id, 'Chỉ người hát / người chọn bài mới qua bài được.');
        this.finish((now - cur.startAt) / 1000 > 45);
        return;
      }
      case 'pause':
      case 'resume':
      case 'restart': {
        const cur = st.now;
        if (!cur) return;
        if (cur.song.by !== p.id && !st.mics.some((x) => x.id === p.id) && this.inRoom(cur.song.by)) return;
        if (m.a === 'pause' && cur.pausedAt == null) cur.pausedAt = Math.max(0, (now - cur.startAt) / 1000);
        else if (m.a === 'resume' && cur.pausedAt != null) {
          cur.startAt = now - cur.pausedAt * 1000;
          cur.pausedAt = null;
        } else if (m.a === 'restart') {
          cur.startAt = now + KARA_LEAD_MS;
          cur.pausedAt = null;
          this.voice.clear();
        }
        this.schedule();
        this.publish();
        return;
      }
      case 'mic': {
        const holding = st.mics.some((x) => x.id === p.id);
        if (m.on && !holding) {
          if (p.zone !== ROOM) return;
          if (st.mics.length >= KARA_MICS) return this.host.err(p.id, 'Cả hai mic đều đang có người cầm rồi 🎤');
          st.mics.push({ id: p.id, name: p.name, fx: this.fx.get(p.id) ?? DEFAULT_FX });
        } else if (!m.on && holding) st.mics = st.mics.filter((x) => x.id !== p.id);
        else return;
        this.publish();
        return;
      }
      case 'fx': {
        const mic = st.mics.find((x) => x.id === p.id);
        const fx = sanitizeFx(m.fx);
        this.fx.set(p.id, fx);
        if (!mic) return;
        mic.fx = fx;
        this.publish();
        return;
      }
      case 'react': {
        if (p.zone !== ROOM || !(KARA_REACTS as readonly string[]).includes(m.e)) return;
        if (now - (this.lastReact.get(p.id) ?? 0) < 250) return;
        this.lastReact.set(p.id, now);
        this.host.room({ t: 'karaReact', id: p.id, e: m.e });
        return;
      }
      case 'meta': {
        const song = st.now?.song.sid === m.sid ? st.now.song : st.queue.find((q) => q.sid === m.sid);
        if (!song) return;
        let changed = false;
        if (!song.title && m.title) {
          song.title = clampStr(m.title, 140);
          changed = true;
        }
        const dur = Number(m.dur);
        if (Number.isFinite(dur) && dur > 5 && dur < 1800 && Math.abs(dur - song.dur) > 2) {
          song.dur = Math.round(dur);
          changed = true;
        }
        if (!changed) return;
        if (song === st.now?.song) this.schedule();
        this.publish();
        return;
      }
      case 'voice': {
        if (st.now?.song.sid !== m.sid || !st.mics.some((x) => x.id === p.id)) return;
        const sung = Math.max(0, Math.min(1800, Number(m.sung) || 0));
        const heard = Math.max(0, Math.min(1800, Number(m.heard) || 0));
        const v = this.voice.get(p.id) ?? { sung: 0, heard: 0 };
        this.voice.set(p.id, { sung: Math.max(v.sung, sung), heard: Math.max(v.heard, heard) });
        return;
      }
      case 'broken': {
        // the video refuses to play embedded: drop it (anyone in the room can report it)
        if (st.now?.song.sid !== m.sid || p.zone !== ROOM) return;
        this.host.room({ t: 'karaReact', id: 'system', e: `⚠️ “${st.now.song.title || 'Bài này'}” không cho phát ngoài YouTube — tự chuyển bài.` });
        this.finish(false);
        return;
      }
    }
  }

  /** Someone left the room / the office: free their mic. */
  left(id: string) {
    if (!this.state.mics.some((x) => x.id === id)) return;
    this.state.mics = this.state.mics.filter((x) => x.id !== id);
    this.publish();
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** (Re)arm the end-of-song timer. */
  private schedule() {
    this.clear();
    const cur = this.state.now;
    if (!cur) {
      if (this.state.queue.length) this.timer = setTimeout(() => this.next(), 500);
      return;
    }
    if (cur.pausedAt != null || !cur.song.dur) {
      // unknown length: give up after 15 minutes so the room never gets stuck
      if (cur.pausedAt == null) this.timer = setTimeout(() => this.finish(true), Math.max(1000, cur.startAt + 15 * 60_000 - Date.now()));
      return;
    }
    const end = cur.startAt + cur.song.dur * 1000 + 1200;
    this.timer = setTimeout(() => this.finish(true), Math.max(200, end - Date.now()));
  }

  /** Current song over: score it (if it was sung), show the score, then the next song. */
  private finish(scored: boolean) {
    this.clear();
    const cur = this.state.now;
    if (!cur) return this.next();
    const mics = this.state.mics;
    if (scored && mics.length) {
      let best = 0;
      let heard = 0;
      for (const m of mics) {
        const v = this.voice.get(m.id);
        if (!v) continue;
        best = Math.max(best, v.sung);
        heard = Math.max(heard, v.heard);
      }
      const ratio = heard > 10 ? best / heard : 0;
      const score =
        best < 6 ? Math.round(30 + Math.random() * 25) : Math.min(100, Math.round(70 + 27 * Math.min(1, ratio / 0.55) + (Math.random() * 6 - 2)));
      this.state.last = { sid: cur.song.sid, title: cur.song.title || 'Bài hát', singers: mics.map((m) => m.name).join(' & '), score, comment: scoreComment(score), at: Date.now() };
    }
    this.state.now = null;
    this.voice.clear();
    // mics go back on the stand; the next singer picks theirs up
    this.state.mics = [];
    this.publish();
    this.timer = setTimeout(() => this.next(), scored && this.state.last?.sid === cur.song.sid ? KARA_SCORE_MS : 1200);
  }

  private next() {
    this.clear();
    const song = this.state.queue.shift();
    if (!song) {
      this.state.now = null;
      this.publish();
      return;
    }
    this.state.now = { song, startAt: Date.now() + KARA_LEAD_MS, pausedAt: null };
    this.voice.clear();
    const owner = this.person(song.by);
    this.state.mics = owner && owner.zone === ROOM ? [{ id: owner.id, name: owner.name, fx: this.fx.get(owner.id) ?? DEFAULT_FX }] : [];
    this.schedule();
    this.publish();
  }
}
