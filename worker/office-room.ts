// OfficeRoom: one Durable Object instance holds the live office — presence, movement relay,
// chat routing, the Kanban board, worklog accounting and WebRTC signaling.
// Uses the WebSocket Hibernation API so an idle office costs (almost) nothing.

import { DurableObject } from 'cloudflare:workers';
import { sanitizeAvatar } from '../shared/avatar';
import { BUILD_ID } from '../shared/build';
import { AgentHub } from './agents';
import { Arcade } from './arcade';
import { Karaoke } from './karaoke';
import { Wedding } from './wedding';
import { WED_PHOTO_BYTES, inWedZone, type WedState } from '../shared/wedding';
import { isDept } from '../shared/agents';
import { Werewolf } from './werewolf';
import { MoleGame } from './mole';
import { PropHuntGame } from './prophunt';
import { sendPush, vapidFrom, type VapidKeys } from './push';
import type { KaraState } from '../shared/karaoke';
import { MEDIA_KIND, WORLD_D as OFFICE_D, WORLD_W as OFFICE_W, SEAT_BY_ID, SPAWN, ZONE_BY_ID, inRange, zoneAt, type MediaKind } from '../shared/map';
import {
  COLUMNS,
  EMOTES,
  LIMITS,
  PRIORITY_META,
  STATUS_META,
  WHEEL_PRIZES,
  WHEEL_SPIN_MS,
  YT_ID,
  clampStr,
  dayKey,
  type ActivityEvent,
  type AnimState,
  type CinemaState,
  type ChatMsg,
  type ClientMsg,
  type Emote,
  type PlayerState,
  type Pomodoro,
  type Priority,
  type ServerMsg,
  type Status,
  type Task,
  type TaskColumn,
  type WorklogDay,
} from '../shared/protocol';
import * as db from './db';
import { SCHEMA_VERSION } from './schema';

interface Attachment {
  p?: PlayerState;
  workSince?: number | null;
}

interface Conn {
  ws: WebSocket;
  p: PlayerState;
  workSince: number | null;
  msgWindow: number;
  msgCount: number;
  chatTimes: number[];
  lastCinema: number;
  lastWheel: number;
}

const CID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const ANIMS: AnimState[] = ['idle', 'walk', 'run', 'sit'];
const COL_IDS = new Set<TaskColumn>(COLUMNS.map((c) => c.id));
const FLUSH_EVERY_MS = 5 * 60_000;
const ACTIVITY_KEEP = 25;
const ACTIVITY_WELCOME_MS = 12 * 3600_000;

export class OfficeRoom extends DurableObject<Env> {
  private conns = new Map<string, Conn>();
  private tasks: Map<string, Task> | null = null;
  private tasksLoading: Promise<Map<string, Task>> | null = null;
  private schemaReady: Promise<void>;
  private tz: number;
  private chatSinceprune = 0;
  private cinema: CinemaState | null = null;
  /** The bar's YouTube jukebox (same shape as the cinema; null = house music). */
  private jukebox: CinemaState | null = null;
  private wheelBusyUntil = 0;
  /** Office Net games (snake battle, caro). */
  private arcade = new Arcade({
    people: () => [...this.conns.values()].map((c) => c.p),
    send: (id, msg) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, msg);
    },
    chat: (text) => this.systemChat(text),
  });
  /** Karaoke room (floor 4). */
  private kara = new Karaoke({
    people: () => [...this.conns.values()].map((c) => c.p),
    broadcast: (msg) => this.broadcast(msg),
    room: (msg) => this.broadcast(msg, undefined, (o) => o.p.zone === 'karaoke'),
    err: (id, text) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, { t: 'err', msg: text });
    },
    save: (state) => void this.ctx.storage.put('kara', state).catch(() => {}),
  });
  /** Ma Sói round the camp fire (floor 4). */
  private wolf = new Werewolf({
    people: () => [...this.conns.values()].map((c) => c.p),
    send: (id, msg) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, msg);
    },
    chat: (text) => this.systemChat(text),
    err: (id, text) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, { t: 'err', msg: text });
    },
  });
  /** Nội Gián on floor 5. */
  private mole = new MoleGame({
    people: () => [...this.conns.values()].map((c) => c.p),
    send: (id, msg) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, msg);
    },
    chat: (text) => this.systemChat(text),
    err: (id, text) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, { t: 'err', msg: text });
    },
  });
  /** Trốn tìm biến hình (prop hunt) on floor 6. */
  private ph = new PropHuntGame({
    people: () => [...this.conns.values()].map((c) => c.p),
    send: (id, msg) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, msg);
    },
    chat: (text) => this.systemChat(text),
    err: (id, text) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, { t: 'err', msg: text });
    },
  });
  /** The wedding hall (floor 7). */
  private wed = new Wedding({
    people: () => [...this.conns.values()].map((c) => c.p),
    broadcast: (msg) => this.broadcast(msg),
    chat: (text) => void this.systemChat(text),
    err: (id, text) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, { t: 'err', msg: text });
    },
    save: (state) => void this.ctx.storage.put('wed', state).catch(() => {}),
    dropPhotos: (keep) => void db.keepWedPhotos(this.env.DB, keep).catch((err) => console.error('wed photos sweep failed', err)),
  });
  private activityRate = new Map<string, { t: number; n: number }>();
  /** Virtual employees: Claude Code sessions sitting at the desks of floor 1. */
  private agents = new AgentHub({
    DB: this.env.DB,
    storage: this.ctx.storage,
    tz: Number(this.env.TZ_OFFSET_MINUTES) || 420,
    broadcast: (msg) => this.broadcast(msg),
    sendTo: (id, msg) => {
      const c = this.conns.get(id);
      if (c) this.send(c.ws, msg);
    },
    seatTaken: (seatId) => [...this.conns.values()].some((c) => c.p.seat === seatId),
    people: () => [...this.conns.values()].map((c) => c.p),
    getTasks: () => this.getTasks(),
    saveTask: async (task, by) => {
      (await this.getTasks()).set(task.id, task);
      this.broadcast({ t: 'task', task, by });
      await db.saveTask(this.env.DB, task);
    },
    chat: (m) => this.globalChat(m),
    systemChat: (text) => this.systemChat(text),
    userName: async (uid) => this.conns.get(uid)?.p.name ?? (await db.getUser(this.env.DB, uid))?.name ?? 'Team',
    pushActivity: (id, ev) => this.pushActivity(id, ev),
    dropActivity: (id) => this.ctx.storage.delete(`act:${id}`).then(() => {}),
    wakeAt: async (ms) => {
      const cur = await this.ctx.storage.getAlarm();
      if (cur == null || cur > ms) await this.ctx.storage.setAlarm(ms);
    },
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.tz = Number(env.TZ_OFFSET_MINUTES) || 420;
    // Rebuild presence after waking from hibernation.
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.p) this.conns.set(a.p.id, this.makeConn(ws, a.p, a.workSince ?? null));
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.schemaReady = ctx.blockConcurrencyWhile(async () => {
      this.cinema = (await ctx.storage.get<CinemaState>('cinema')) ?? null;
      this.jukebox = (await ctx.storage.get<CinemaState>('jukebox')) ?? null;
      this.kara.restore((await ctx.storage.get<KaraState>('kara')) ?? undefined);
      this.wed.restore((await ctx.storage.get<WedState>('wed')) ?? undefined);
      await this.agents.restore();
      const v = await ctx.storage.get<number>('schemaVersion');
      if (v !== SCHEMA_VERSION) {
        await db.ensureSchema(env.DB);
        await ctx.storage.put('schemaVersion', SCHEMA_VERSION);
      }
    });
  }

  private makeConn(ws: WebSocket, p: PlayerState, workSince: number | null): Conn {
    return { ws, p, workSince, msgWindow: 0, msgCount: 0, chatTimes: [], lastCinema: 0, lastWheel: 0 };
  }

  // ------------------------------------------------------------------ transport
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/activity' && req.method === 'POST') return this.onActivity(req);
    if (url.pathname === '/wed-photo' && req.method === 'POST') return this.onWedPhoto(req);
    if (url.pathname === '/agent-mcp' && req.method === 'POST') {
      await this.schemaReady;
      const b = (await req.json().catch(() => null)) as { uid?: string; agent?: string; body?: unknown } | null;
      if (!b?.uid || !CID_RE.test(b.uid)) return new Response('bad', { status: 400 });
      return this.agents.mcp(b.uid, String(b.agent ?? ''), b.body);
    }
    if (url.pathname === '/agent-api' && req.method === 'POST') {
      await this.schemaReady;
      const b = (await req.json().catch(() => null)) as { uid?: string; op?: string; body?: Record<string, unknown>; depts?: string } | null;
      if (!b?.uid || !CID_RE.test(b.uid)) return new Response('bad', { status: 400 });
      if (b.op === 'jobs') return Response.json(await this.agents.jobs(b.uid, String(b.depts ?? '')));
      if (b.op === 'claim') return Response.json(await this.agents.claim(b.uid, b.body ?? {}));
      if (b.op === 'exit') return Response.json(await this.agents.exit(b.uid, b.body ?? {}));
      if (b.op === 'feed') return Response.json(await this.agents.feed(b.uid, b.body ?? {}));
      if (b.op === 'brain') return Response.json({ job: await this.agents.brain.job(b.uid) });
      if (b.op === 'brainResult') return Response.json(await this.agents.brain.result(b.uid, String(b.body?.id ?? ''), String(b.body?.raw ?? '')));
      return new Response('bad op', { status: 400 });
    }
    if (url.pathname === '/nudge-status') {
      // why the room did or did not wake anybody — the gates are invisible from outside otherwise
      const [from, to] = this.nudgeHours;
      return Response.json({
        here: this.present().length,
        conns: this.conns.size,
        sockets: this.ctx.getWebSockets().length,
        needs: OfficeRoom.NUDGE_MIN_PEOPLE,
        hourLocal: new Date(Date.now() + this.tz * 60_000).getUTCHours(),
        hours: [from, to],
        msSinceLastNudge: this.lastNudge ? Date.now() - this.lastNudge : null,
        roomGapMs: OfficeRoom.NUDGE_ROOM_GAP,
        hasVapid: !!vapidFrom(this.env as Env & { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }),
      });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({} satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A photo for the wedding album (the worker checked the session; we check the role and the bytes). */
  private async onWedPhoto(req: Request): Promise<Response> {
    await this.schemaReady;
    const cid = req.headers.get('x-cid') ?? '';
    const no = (error: string, status = 400) => Response.json({ ok: false, error }, { status });
    const why = this.wed.canAddPhoto(cid);
    if (why) return no(why, 403);
    const data = await req.arrayBuffer();
    if (!data.byteLength || data.byteLength > WED_PHOTO_BYTES) return no('Ảnh quá lớn — tối đa 1,5 MB', 413);
    const b = new Uint8Array(data, 0, Math.min(12, data.byteLength));
    const mime =
      b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
        ? 'image/jpeg'
        : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
          ? 'image/png'
          : String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
            ? 'image/webp'
            : null;
    if (!mime) return no('Chỉ nhận ảnh JPEG, PNG hoặc WebP');
    const dim = (h: string) => Math.max(1, Math.min(8192, Math.round(Number(req.headers.get(h)) || 0)));
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    await db.putWedPhoto(this.env.DB, id, data, mime, Date.now());
    if (!this.wed.addPhoto(cid, { id, w: dim('x-w'), h: dim('x-h') })) {
      await db.keepWedPhotos(this.env.DB, this.wed.state.photos.map((x) => x.id));
      return no('Không thêm được ảnh vào album', 409);
    }
    return Response.json({ ok: true, id });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return this.relayMedia(ws, raw);
    if (raw.length > 100_000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    await this.schemaReady;

    const conn = this.connOf(ws);
    if (!conn) {
      if (msg.t === 'hello') await this.onHello(ws, msg);
      return;
    }
    if (!this.allowMessage(conn)) return;

    try {
      await this.dispatch(conn, msg);
    } catch (err) {
      console.error('message failed', msg.t, err);
      this.send(conn.ws, { t: 'err', msg: 'Có lỗi xảy ra, thử lại nhé.' });
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.dropSocket(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  async alarm(): Promise<void> {
    // Periodically bank ongoing work time so a crash never loses more than a few minutes.
    const now = Date.now();
    let anyone = false;
    for (const c of this.conns.values()) {
      anyone = true;
      if (c.workSince != null) {
        const ms = now - c.workSince;
        c.workSince = now;
        this.persistAttachment(c);
        await db.addWorklog(this.env.DB, this.day(now), c.p.id, { workMs: ms });
      }
    }
    const agentsLeft = await this.agents.sweep(now);
    if (anyone || agentsLeft) await this.ctx.storage.setAlarm(now + FLUSH_EVERY_MS);
  }

  // ------------------------------------------------------------------ helpers
  private connOf(ws: WebSocket): Conn | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    const id = a?.p?.id;
    if (!id) return null;
    const c = this.conns.get(id);
    if (c && c.ws === ws) return c;
    if (!c) {
      // Woken from hibernation before the map was rebuilt for this socket.
      const conn = this.makeConn(ws, a.p!, a.workSince ?? null);
      this.conns.set(id, conn);
      return conn;
    }
    return null; // stale socket replaced by a newer tab
  }

  private allowMessage(c: Conn): boolean {
    const now = Date.now();
    if (now - c.msgWindow > 1000) {
      c.msgWindow = now;
      c.msgCount = 0;
    }
    return ++c.msgCount <= 90;
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }

  private broadcast(msg: ServerMsg, exceptId?: string, filter?: (c: Conn) => boolean): void {
    const data = JSON.stringify(msg);
    for (const c of this.conns.values()) {
      if (c.p.id === exceptId) continue;
      if (filter && !filter(c)) continue;
      try {
        c.ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private persistAttachment(c: Conn): void {
    try {
      c.ws.serializeAttachment({ p: c.p, workSince: c.workSince } satisfies Attachment);
    } catch (err) {
      console.error('serializeAttachment failed', err);
    }
  }

  private update(c: Conn, patch: Partial<PlayerState>, persist = true): void {
    Object.assign(c.p, patch);
    this.broadcast({ t: 'upd', id: c.p.id, patch });
    if (persist) this.persistAttachment(c);
  }

  private day(ms = Date.now()): string {
    return dayKey(ms, this.tz);
  }

  private async getTasks(): Promise<Map<string, Task>> {
    if (this.tasks) return this.tasks;
    this.tasksLoading ??= db.loadTasks(this.env.DB, Date.now()).then((list) => {
      this.tasks = new Map(list.map((t) => [t.id, t]));
      this.tasksLoading = null;
      return this.tasks;
    });
    return this.tasksLoading;
  }

  private isWorking(p: PlayerState): boolean {
    const kind = ZONE_BY_ID.get(p.zone)?.kind;
    if (p.status === 'meeting') return kind === 'meeting';
    if (p.status === 'working' || p.status === 'focus') return kind === 'work' || kind === 'focus' || p.seat != null;
    return false;
  }

  /** Start/stop the working-time segment after any state change. */
  private async syncWork(c: Conn): Promise<void> {
    const now = Date.now();
    const working = this.isWorking(c.p);
    if (working && c.workSince == null) {
      c.workSince = now;
      this.persistAttachment(c);
      await db.addWorklog(this.env.DB, this.day(now), c.p.id, { checkIn: now });
      await this.ctx.storage.setAlarm(now + FLUSH_EVERY_MS);
      await this.sendToday(c);
    } else if (!working && c.workSince != null) {
      const ms = now - c.workSince;
      c.workSince = null;
      this.persistAttachment(c);
      await db.addWorklog(this.env.DB, this.day(now), c.p.id, { workMs: ms });
      await this.sendToday(c);
    }
  }

  private async todayOf(c: Conn): Promise<WorklogDay> {
    const w = await db.getWorklog(this.env.DB, this.day(), c.p.id);
    return { ...w, activeSince: c.workSince };
  }

  private async sendToday(c: Conn): Promise<void> {
    const today = await this.todayOf(c);
    this.send(c.ws, { t: 'today', today });
    this.broadcast({ t: 'team', member: { id: c.p.id, name: c.p.name, avatar: c.p.avatar, lastSeen: Date.now(), desk: null, today } }, c.p.id);
  }

  private async systemChat(text: string): Promise<void> {
    await this.globalChat({ id: crypto.randomUUID(), ch: 'global', from: 'system', name: 'Văn phòng', text, ts: Date.now() });
  }

  /** Every line of the office-wide chat and of the private threads (people, agents, the office). */
  private async globalChat(m: ChatMsg, zone?: string): Promise<void> {
    // `ask:<uid>` is one person's own thread with the AI — nobody else is shown it
    const owner = m.ch.startsWith('ask:') ? m.ch.slice(4) : null;
    if (owner) this.broadcast({ t: 'chat', m }, undefined, (o) => o.p.id === owner);
    else this.broadcast({ t: 'chat', m });
    this.agents.onChat(m, zone);
    await db.insertChat(this.env.DB, m);
    if (++this.chatSinceprune >= 50) {
      this.chatSinceprune = 0;
      await db.pruneChat(this.env.DB);
    }
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    const id = a?.p?.id;
    if (!id) return;
    const c = this.conns.get(id);
    if (!c || c.ws !== ws) return; // already replaced by a newer tab
    this.conns.delete(id);
    this.agents.left(id);
    this.arcade.leave(id);
    this.kara.left(id);
    this.broadcast({ t: 'leave', id });
    this.wolf.leave(id);
    this.mole.leave(id);
    this.ph.leave(id);
    this.wed.left(id, true);
    const now = Date.now();
    if (c.workSince != null) {
      await db.addWorklog(this.env.DB, this.day(now), id, { workMs: now - c.workSince });
    }
    await db.touchUser(this.env.DB, id, now);
  }

  // ---------------------------------------------------------------- push nudges
  /** The whole room is only allowed to wake people this often, however many come and go. */
  private static readonly NUDGE_ROOM_GAP = 2 * 3600_000;
  /** And one person is only woken this often, whatever the room does. */
  private static readonly NUDGE_PERSON_GAP = 6 * 3600_000;
  /** Below this it is not worth anyone's trip. */
  private static readonly NUDGE_MIN_PEOPLE = 3;
  /** One fetch per device, and the free plan allows 50 subrequests per invocation. */
  private static readonly NUDGE_BATCH = 40;
  private lastNudge = 0;
  /** Local hours between which it is acceptable to buzz someone, from PUSH_HOURS ("8-22"). */
  private get nudgeHours(): [number, number] {
    const raw = (this.env as Env & { PUSH_HOURS?: string }).PUSH_HOURS ?? '8-22';
    const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(raw.trim());
    if (!m) return [8, 22];
    return [Math.min(23, Number(m[1])), Math.min(24, Number(m[2]))];
  }

  /**
   * Who is actually in the room. `this.conns` is rebuilt from the sockets each time the object
   * wakes, so during a wake it can be empty while people are plainly connected — read the sockets
   * themselves instead.
   */
  private present(): PlayerState[] {
    const out: PlayerState[] = [];
    const seen = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.p && !seen.has(a.p.id)) {
        seen.add(a.p.id);
        out.push(a.p);
      }
    }
    for (const c of this.conns.values()) if (!seen.has(c.p.id)) { seen.add(c.p.id); out.push(c.p); }
    return out;
  }

  /**
   * Tell people who are not here that it has got busy. This is the only thing in the whole app
   * that can reach someone who closed the tab, which also makes it the easiest thing to ruin:
   * one badly-timed buzz and they turn notifications off for good. Hence the gates below —
   * enough people, not too often, and not in the middle of the night.
   */
  private maybeNudge(now: number) {
    const here = this.present();
    if (here.length < OfficeRoom.NUDGE_MIN_PEOPLE) return;
    if (now - this.lastNudge < OfficeRoom.NUDGE_ROOM_GAP) return;
    const hour = new Date(now + this.tz * 60_000).getUTCHours();
    const [from, to] = this.nudgeHours;
    if (hour < from || hour >= to) return; // nobody wants this at two in the morning
    const vapid = vapidFrom(this.env as Env & { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string });
    if (!vapid) return; // push not set up on this deployment
    this.lastNudge = now;
    void this.sendNudge(vapid, here, now);
  }

  private async sendNudge(vapid: VapidKeys, here: PlayerState[], now: number) {
    try {
      const names = here.map((p) => p.name).filter(Boolean);
      const onlineIds = here.map((p) => p.id);
      const targets = await db.pushTargets(this.env.DB, onlineIds, now - OfficeRoom.NUDGE_PERSON_GAP, OfficeRoom.NUDGE_BATCH);
      if (!targets.length) {
        console.log('push: nobody to tell (everyone subscribed is already here, or was told recently)');
        return;
      }
      // say who is there — a name you know is the whole reason to come back
      const who = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} và ${names.length - 2} người nữa`;
      const payload = {
        title: `${here.length} người đang ở Office`,
        body: `${who} đang online. Vào chơi cùng không?`,
        tag: 'office-busy',
        url: '/',
      };
      const results = await Promise.all(targets.map((t) => sendPush(vapid, t, payload)));
      const sent: string[] = [];
      const gone: string[] = [];
      targets.forEach((t, i) => (results[i] === 'gone' ? gone : results[i] === 'sent' ? sent : []).push(t.endpoint));
      await Promise.all([db.markPushed(this.env.DB, sent, now), db.dropPushSubs(this.env.DB, gone)]);
      console.log(`push: ${sent.length} sent, ${gone.length} dropped, ${targets.length - sent.length - gone.length} failed`);
    } catch (err) {
      console.error('nudge failed', err);
    }
  }

  /** Rooms with their own game state: give it to people walking in, drop mics of people walking out. */
  private zoneChanged(c: Conn, prev: string) {
    const zone = c.p.zone;
    if (prev === 'karaoke' && zone !== 'karaoke') this.kara.left(c.p.id);
    if (zone === 'wolfroom' && prev !== 'wolfroom') this.wolf.sendTo(c.p.id);
    if (prev === 'wolfroom' && zone !== 'wolfroom') this.wolf.broadcast();
    const f5 = (z: string) => z.startsWith('f5-');
    if (f5(zone) && !f5(prev)) this.mole.arrived(c.p.id);
    const f6 = (z: string) => z.startsWith('f6-');
    if (f6(zone) && !f6(prev)) this.ph.arrived(c.p.id);
    if (inWedZone(prev) && !inWedZone(zone)) this.wed.left(c.p.id, false);
  }

  // ------------------------------------------------------------------ voice / camera / screen relay
  // Media goes through this Durable Object over the WebSocket (no peer-to-peer, no TURN needed):
  // client → [kind][payload]; server → [kind][idLen][id][payload] to everyone in range.
  private relayMedia(ws: WebSocket, buf: ArrayBuffer): void {
    if (buf.byteLength < 2 || buf.byteLength > 900_000) return;
    const c = this.connOf(ws);
    if (!c || !this.allowMessage(c)) return;
    const kindByte = new Uint8Array(buf, 0, 1)[0];
    const kind = (Object.keys(MEDIA_KIND) as MediaKind[]).find((k) => MEDIA_KIND[k] === kindByte);
    if (!kind) return;
    const id = new TextEncoder().encode(c.p.id);
    const out = new Uint8Array(2 + id.length + buf.byteLength - 1);
    out[0] = kindByte;
    out[1] = id.length;
    out.set(id, 2);
    out.set(new Uint8Array(buf, 1), 2 + id.length);
    // Ma Sói: at night only the wolves hear each other, the dead only talk among themselves…
    const voice = kind === 'audio' || kind === 'opus';
    const village = voice && zoneAt(c.p.x, c.p.z).id === 'wolfroom';
    for (const o of this.conns.values()) {
      if (o === c) continue;
      // Nội Gián (floor 5) may open or close the line regardless of distance
      const forced = voice ? (this.mole.voice(c.p, o.p) ?? this.ph.voice(c.p, o.p)) : null;
      if (forced === false) continue;
      if (forced !== true && !inRange(c.p, o.p, kind, 1)) continue;
      if (village && !this.wolf.voiceAllowed(c.p.id, o.p.id)) continue;
      try {
        o.ws.send(out);
      } catch {
        /* gone */
      }
    }
  }

  // ------------------------------------------------------------------ Claude Code activity
  private async onActivity(req: Request): Promise<Response> {
    await this.schemaReady;
    const body = (await req.json().catch(() => null)) as {
      uid?: string;
      ev?: ActivityEvent | null;
      v2?: boolean;
      sid?: string;
      event?: string;
      dept?: string;
      agent?: string;
    } | null;
    if (!body?.uid || !CID_RE.test(body.uid) || (!body.ev && !body.v2)) return new Response('bad', { status: 400 });
    const now = Date.now();
    const r = this.activityRate.get(body.uid);
    if (r && now - r.t < 1000) {
      if (++r.n > 20) return new Response('slow down', { status: 429 });
    } else this.activityRate.set(body.uid, { t: now, n: 1 });
    const ev: ActivityEvent | null = body.ev
      ? {
          ts: now,
          kind: body.ev.kind,
          icon: clampStr(body.ev.icon, 8),
          text: clampStr(body.ev.text, 120),
          project: body.ev.project ? clampStr(body.ev.project, 40) : undefined,
        }
      : null;
    // v2 hooks: a session an on-call machine started, reporting from its department's desk
    const out = body.v2
      ? await this.agents.hook({
          uid: body.uid,
          sid: clampStr(body.sid ?? '', 80),
          event: clampStr(body.event ?? '', 40),
          ev,
          agent: clampStr(body.agent ?? '', 40),
          project: ev?.project,
        })
      : null;
    // Your own monitor shows it only while you sit at your desk (or a focus desk): stand up and the
    // screen goes dark, events sent meanwhile are dropped — the hook can stay installed.
    const seatId = this.conns.get(body.uid)?.p.seat;
    const seat = seatId ? SEAT_BY_ID.get(seatId) : undefined;
    if (ev && seat && (seat.kind === 'desk' || seat.kind === 'focus')) await this.pushActivity(body.uid, ev);
    if (out) return new Response(out, { headers: { 'Content-Type': 'application/json' } });
    return new Response(null, { status: 204 });
  }

  private async pushActivity(id: string, ev: ActivityEvent): Promise<void> {
    const key = `act:${id}`;
    const list = ((await this.ctx.storage.get<ActivityEvent[]>(key)) ?? []).concat(ev).slice(-ACTIVITY_KEEP);
    await this.ctx.storage.put(key, list);
    this.broadcast({ t: 'activity', id, ev });
  }

  private async recentActivity(now: number): Promise<Record<string, ActivityEvent[]>> {
    const out: Record<string, ActivityEvent[]> = {};
    const all = await this.ctx.storage.list<ActivityEvent[]>({ prefix: 'act:' });
    for (const [key, list] of all) {
      const recent = list.filter((e) => now - e.ts < ACTIVITY_WELCOME_MS).slice(-12);
      if (recent.length) out[key.slice(4)] = recent;
    }
    return out;
  }

  // ------------------------------------------------------------------ hello
  private async onHello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>): Promise<void> {
    if (!CID_RE.test(String(msg.cid))) {
      this.send(ws, { t: 'err', msg: 'clientId không hợp lệ' });
      ws.close(4001, 'bad id');
      return;
    }
    const id = msg.cid;
    const name = clampStr(msg.name, LIMITS.name) || 'Khách';
    const avatar = sanitizeAvatar(msg.avatar);
    const now = Date.now();

    // One live session per person: the newest tab wins.
    const old = this.conns.get(id);
    if (old && old.ws !== ws) {
      this.send(old.ws, { t: 'kicked', reason: 'Bạn vừa mở văn phòng ở một tab/máy khác.' });
      this.conns.delete(id);
      if (old.workSince != null) await db.addWorklog(this.env.DB, this.day(now), id, { workMs: now - old.workSince });
      try {
        old.ws.close(4000, 'replaced');
      } catch {
        /* ignore */
      }
      this.broadcast({ t: 'leave', id });
    }

    const user = await db.getUser(this.env.DB, id);
    let x = SPAWN.x + (Math.random() - 0.5) * 3;
    let z = SPAWN.z + (Math.random() - 0.5) * 1.5;
    let ry = SPAWN.ry;
    const desk = user?.desk ? SEAT_BY_ID.get(user.desk) : undefined;
    if (desk && ![...this.conns.values()].some((c) => c.p.seat === desk.id)) {
      // Appear standing right behind your usual chair.
      x = desk.x - Math.sin(desk.ry) * 0.7;
      z = desk.z - Math.cos(desk.ry) * 0.7;
      ry = desk.ry;
    }

    const tasks = await this.getTasks();
    let taskId: string | null = null;
    for (const t of tasks.values()) {
      if (t.assignee === id && t.col === 'doing' && (!taskId || t.updatedAt > tasks.get(taskId)!.updatedAt)) taskId = t.id;
    }

    const p: PlayerState = {
      id,
      name,
      avatar,
      x,
      z,
      ry,
      anim: 'idle',
      zone: zoneAt(x, z).id,
      status: 'online',
      statusManual: false,
      statusText: '',
      seat: null,
      taskId,
      pomo: null,
      media: { mic: false, cam: false, screen: false },
      joinedAt: now,
    };
    const conn = this.makeConn(ws, p, null);
    this.conns.set(id, conn);
    this.persistAttachment(conn);
    this.maybeNudge(now);

    const day = this.day(now);
    const activity = await this.recentActivity(now);
    const [, chat, team, today] = await Promise.all([
      db.upsertUser(this.env.DB, id, name, avatar, now),
      db.recentChat(this.env.DB),
      db.listTeam(this.env.DB, day, now),
      db.getWorklog(this.env.DB, day, id),
    ]);
    if (this.conns.get(id) !== conn) return; // replaced while loading

    this.send(ws, {
      t: 'welcome',
      build: BUILD_ID,
      you: p,
      players: [...[...this.conns.values()].filter((c) => c !== conn).map((c) => c.p), ...this.agents.players()],
      tasks: [...tasks.values()],
      // other people's private threads with the AI are not theirs to read
      chat: chat.filter((m) => !m.ch.startsWith('ask:') || m.ch === `ask:${id}`),
      team,
      today: { ...today, activeSince: null },
      office: { name: this.env.OFFICE_NAME || 'Văn phòng', tzOffsetMinutes: this.tz },
      serverTime: now,
      cinema: this.cinema,
      jukebox: this.jukebox,
      kara: this.kara.state,
      wed: this.wed.state,
      activity,
      meetings: this.agents.meetingsView(),
      approvals: this.agents.approvalsView(),
      access: await this.agents.accessReady(),
      brain: this.agents.brain.view(),
    });
    this.broadcast({ t: 'join', p }, id);
    this.wolf.rejoin(id);
    this.mole.rejoin(id);
    this.ph.rejoin(id);
  }

  // ------------------------------------------------------------------ dispatch
  private async dispatch(c: Conn, msg: ClientMsg): Promise<void> {
    const p = c.p;
    switch (msg.t) {
      case 'hello':
        return; // already greeted
      case 'ping':
        this.send(c.ws, { t: 'pong' });
        return;

      case 'move': {
        const x = Number(msg.x);
        const z = Number(msg.z);
        const ry = Number(msg.ry);
        if (![x, z, ry].every(Number.isFinite)) return;
        if (x < 0 || x > OFFICE_W || z < 0 || z > OFFICE_D) return;
        const anim: AnimState = ANIMS.includes(msg.anim) ? msg.anim : 'idle';
        p.x = x;
        p.z = z;
        p.ry = ry;
        p.anim = anim;
        this.broadcast({ t: 'mv', id: p.id, x, z, ry, anim }, p.id);
        const zone = zoneAt(x, z).id;
        if (zone !== p.zone) {
          const prev = p.zone;
          this.update(c, { zone });
          this.zoneChanged(c, prev);
          await this.syncWork(c);
        } else if (anim === 'idle') {
          this.persistAttachment(c);
        }
        return;
      }

      case 'chat': {
        const text = clampStr(msg.text, LIMITS.chat);
        if (!text) return;
        const now = Date.now();
        c.chatTimes = c.chatTimes.filter((t) => now - t < 5000);
        if (c.chatTimes.length >= 6) {
          this.send(c.ws, { t: 'err', msg: 'Bạn đang chat hơi nhanh, chậm lại chút nhé 🙂' });
          return;
        }
        c.chatTimes.push(now);
        if (msg.ch === 'zone') {
          const m: ChatMsg = { id: crypto.randomUUID(), ch: `zone:${p.zone}`, from: p.id, name: p.name, text, ts: now };
          this.broadcast({ t: 'chat', m }, undefined, (o) => o.p.zone === p.zone);
          return;
        }
        // 'ask' = this person's channel with the AI staff, which only they and their agents see.
        // A `root` makes the line a reply inside that work's thread.
        // ('work' was a separate feed once; an old tab sending it now just talks to the office.)
        const ch = msg.ch === 'ask' ? `ask:${p.id}` : 'global';
        const root = typeof msg.root === 'string' && /^[\w:-]{6,80}$/.test(msg.root) ? msg.root : undefined;
        await this.globalChat({ id: crypto.randomUUID(), ch, from: p.id, name: p.name, text, ts: now, ...(root ? { root } : {}) }, p.zone);
        return;
      }

      case 'emote': {
        if (!EMOTES.includes(msg.e)) return;
        this.broadcast({ t: 'emote', id: p.id, e: msg.e as Emote }, p.id);
        return;
      }

      case 'wave': {
        const target = this.conns.get(String(msg.to));
        if (target && target !== c) this.send(target.ws, { t: 'wave', from: p.id, name: p.name });
        return;
      }

      case 'status': {
        if (!(msg.status in STATUS_META)) return;
        this.update(c, {
          status: msg.status as Status,
          statusManual: Boolean(msg.manual),
          statusText: clampStr(msg.text ?? '', LIMITS.statusText),
        });
        await this.syncWork(c);
        return;
      }

      case 'sit': {
        const wasWolf = SEAT_BY_ID.get(p.seat ?? '')?.kind === 'wolf';
        if (msg.seat == null) {
          if (p.seat) {
            this.update(c, { seat: null, anim: 'idle' });
            if (wasWolf) this.wolf.onSeatChange();
            await this.syncWork(c);
          }
          return;
        }
        const seat = SEAT_BY_ID.get(String(msg.seat));
        if (!seat) return;
        const taken = [...this.conns.values()].some((o) => o !== c && o.p.seat === seat.id);
        if (taken) {
          this.send(c.ws, { t: 'err', msg: 'Ghế này đã có người ngồi rồi.' });
          return;
        }
        this.agents.vacate(seat.id); // virtual employees give their chair to a person
        if (seat.kind === 'wolf' && !this.wolf.canSit(p.id, seat.id)) {
          this.send(c.ws, { t: 'err', msg: 'Ván Ma Sói đang diễn ra — ghế này của người chơi khác. Ngồi khúc gỗ xem nhé 🪵' });
          return;
        }
        const prevZone = p.zone;
        this.update(c, { seat: seat.id, x: seat.x, z: seat.z, ry: seat.ry, anim: 'sit', zone: seat.zone });
        if (prevZone !== seat.zone) this.zoneChanged(c, prevZone);
        if (seat.kind === 'wolf' || wasWolf) this.wolf.onSeatChange();
        if (seat.kind === 'desk') await db.setUserDesk(this.env.DB, p.id, seat.id);
        await this.syncWork(c);
        return;
      }

      case 'pomo': {
        const prev = p.pomo;
        const pomo = sanitizePomo(msg.pomo);
        this.update(c, { pomo });
        if (msg.completed && prev?.mode === 'focus' && Date.now() >= prev.endsAt - 5000) {
          await db.addWorklog(this.env.DB, this.day(), p.id, { pomodoros: 1 });
          await this.sendToday(c);
        }
        return;
      }

      case 'profile': {
        const name = clampStr(msg.name, LIMITS.name) || p.name;
        const avatar = sanitizeAvatar(msg.avatar);
        this.update(c, { name, avatar });
        await db.upsertUser(this.env.DB, p.id, name, avatar, Date.now());
        return;
      }

      case 'media': {
        const m = msg.media ?? {};
        this.update(c, { media: { mic: Boolean(m.mic), cam: Boolean(m.cam), screen: Boolean(m.screen), opus: Boolean(m.opus) } });
        return;
      }

      case 'rtc': {
        const target = this.conns.get(String(msg.to));
        if (target && target !== c) this.send(target.ws, { t: 'rtc', from: p.id, data: msg.data });
        return;
      }

      case 'rtcBye': {
        const target = this.conns.get(String(msg.to));
        if (target && target !== c) this.send(target.ws, { t: 'rtcBye', from: p.id });
        return;
      }

      case 'cinema':
      case 'jukebox': {
        const now = Date.now();
        if (now - c.lastCinema < 400) return;
        c.lastCinema = now;
        const room = msg.t;
        const cur = room === 'cinema' ? this.cinema : this.jukebox;
        const pos = cur ? (cur.pausedAt ?? (now - cur.startAt) / 1000) : 0;
        const at = Math.max(0, Math.min(24 * 3600, Number(msg.at) || 0));
        let next: CinemaState | null = cur;
        switch (msg.action) {
          case 'play':
            if (!YT_ID.test(String(msg.videoId))) return;
            next = { videoId: String(msg.videoId), startAt: now - at * 1000, pausedAt: null, by: p.id, byName: p.name, title: '', updatedAt: now };
            break;
          case 'pause':
            if (!cur || cur.pausedAt != null) return;
            next = { ...cur, pausedAt: pos, updatedAt: now };
            break;
          case 'resume':
            if (!cur || cur.pausedAt == null) return;
            next = { ...cur, startAt: now - cur.pausedAt * 1000, pausedAt: null, updatedAt: now };
            break;
          case 'seek':
            if (!cur) return;
            next = cur.pausedAt != null ? { ...cur, pausedAt: at, updatedAt: now } : { ...cur, startAt: now - at * 1000, updatedAt: now };
            break;
          case 'title':
            if (!cur || cur.title) return;
            next = { ...cur, title: clampStr(msg.title, 120) };
            break;
          case 'stop':
            next = null;
            break;
          default:
            return;
        }
        if (room === 'cinema') this.cinema = next;
        else this.jukebox = next;
        await this.ctx.storage.put(room, next);
        this.broadcast({ t: room, state: next, by: p.id, action: msg.action });
        if (msg.action === 'play' && room === 'cinema') await this.systemChat(`🎬 ${p.name} vừa bật phim ở Rạp chiếu phim — ghé xem nhé!`);
        return;
      }

      case 'wheel': {
        const now = Date.now();
        if (now - c.lastWheel < 20_000) return this.send(c.ws, { t: 'err', msg: 'Đợi chút rồi quay tiếp nhé 🎡' });
        if (now < this.wheelBusyUntil) return this.send(c.ws, { t: 'err', msg: 'Vòng quay đang quay, chờ xíu nhé 🎡' });
        c.lastWheel = now;
        this.wheelBusyUntil = now + WHEEL_SPIN_MS + 600;
        const prize = Math.floor(Math.random() * WHEEL_PRIZES.length);
        this.broadcast({ t: 'wheel', by: p.id, name: p.name, prize, at: now });
        // announce once the wheel has stopped (no spoilers in the chat)
        await new Promise((r) => setTimeout(r, WHEEL_SPIN_MS + 300));
        await this.systemChat(`🎡 ${p.name} quay vòng quay may mắn ở Office Bar và trúng: ${WHEEL_PRIZES[prize]}`);
        return;
      }

      case 'arcade':
        if (msg.m && typeof msg.m === 'object') this.arcade.handle(p, msg.m);
        return;

      case 'kara':
        if (msg.m && typeof msg.m === 'object') this.kara.handle(p, msg.m);
        return;

      case 'wolf':
        if (msg.m && typeof msg.m === 'object') this.wolf.handle(p, msg.m);
        return;

      case 'mole':
        if (msg.m && typeof msg.m === 'object') this.mole.handle(p, msg.m);
        return;

      case 'prop':
        if (msg.m && typeof msg.m === 'object') this.ph.handle(p, msg.m);
        return;

      case 'wed':
        if (msg.m && typeof msg.m === 'object') this.wed.handle(p, msg.m);
        return;

      case 'activity:token': {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await db.replaceActivityToken(this.env.DB, p.id, token, Date.now());
        this.send(c.ws, { t: 'activityToken', token });
        return;
      }

      case 'agents':
        if (msg.m && typeof msg.m === 'object') await this.agents.handle(p.id, msg.m, p.name);
        return;

      case 'activity:revoke': {
        await db.replaceActivityToken(this.env.DB, p.id, null, Date.now());
        this.send(c.ws, { t: 'activityToken', token: null });
        await this.agents.dropOwner(p.id);
        return;
      }

      case 'task:create': {
        const title = clampStr(msg.title, LIMITS.taskTitle);
        if (!title) return;
        const tasks = await this.getTasks();
        const col: TaskColumn = COL_IDS.has(msg.col as TaskColumn) ? (msg.col as TaskColumn) : 'todo';
        let ord = 0;
        for (const t of tasks.values()) if (t.col === col) ord = Math.max(ord, t.ord);
        const now = Date.now();
        const task: Task = {
          id: crypto.randomUUID(),
          title,
          desc: clampStr(msg.desc ?? '', LIMITS.taskDesc),
          col,
          ord: ord + 1,
          assignee: sanitizeAssignee(msg.assignee),
          priority: sanitizePriority(msg.priority),
          createdBy: p.id,
          createdAt: now,
          updatedAt: now,
          doneAt: col === 'done' ? now : null,
          dept: isDept(msg.dept) ? msg.dept : null,
          hops: 0,
        };
        tasks.set(task.id, task);
        this.agents.taskTouched(task, p.id);
        this.broadcast({ t: 'task', task, by: p.id });
        await db.saveTask(this.env.DB, task);
        return;
      }

      case 'task:update': {
        const tasks = await this.getTasks();
        const task = tasks.get(String(msg.id));
        if (!task || !msg.patch) return;
        const patch = msg.patch;
        if (patch.title !== undefined) task.title = clampStr(patch.title, LIMITS.taskTitle) || task.title;
        if (patch.desc !== undefined) task.desc = clampStr(patch.desc, LIMITS.taskDesc);
        if (patch.assignee !== undefined) task.assignee = sanitizeAssignee(patch.assignee);
        if (patch.priority !== undefined) task.priority = sanitizePriority(patch.priority);
        if (patch.dept !== undefined) {
          task.dept = isDept(patch.dept) ? patch.dept : null;
          task.hops = 0; // a person re-routed it: the bounce counter starts again
        }
        // whoever last wrote or re-routed it answers for it (a runner takes it only if it trusts them)
        if (patch.title !== undefined || patch.desc !== undefined || patch.dept !== undefined) this.agents.taskTouched(task, p.id);
        task.updatedAt = Date.now();
        this.broadcast({ t: 'task', task, by: p.id });
        await db.saveTask(this.env.DB, task);
        return;
      }

      case 'task:move': {
        const tasks = await this.getTasks();
        const task = tasks.get(String(msg.id));
        const ord = Number(msg.ord);
        if (!task || !COL_IDS.has(msg.col) || !Number.isFinite(ord)) return;
        const wasDone = task.col === 'done';
        const now = Date.now();
        // putting a department's task back in To do sets the runners going again: on this person's word
        if (msg.col === 'todo' && task.col !== 'todo' && task.dept) this.agents.taskTouched({ ...task, col: 'todo', assignee: null }, p.id);
        task.col = msg.col;
        task.ord = ord;
        task.updatedAt = now;
        if (task.col === 'done' && !wasDone) task.doneAt = now;
        if (task.col !== 'done') task.doneAt = null;
        this.broadcast({ t: 'task', task, by: p.id });
        await db.saveTask(this.env.DB, task);

        const owner = task.assignee ? this.conns.get(task.assignee) : c;
        if (task.col === 'doing' && owner && !owner.p.taskId) this.update(owner, { taskId: task.id });
        if (task.col === 'done' && !wasDone) {
          for (const o of this.conns.values()) if (o.p.taskId === task.id) this.update(o, { taskId: null });
          const creditId = task.assignee && !this.agents.has(task.assignee) ? task.assignee : p.id;
          await db.addWorklog(this.env.DB, this.day(now), creditId, { tasksDone: 1 });
          const credited = this.conns.get(creditId);
          if (credited) await this.sendToday(credited);
          const who = (task.assignee && this.agents.players().find((x) => x.id === task.assignee)?.name) || (credited?.p.name ?? p.name);
          await this.systemChat(`🎉 ${who} vừa hoàn thành “${task.title}”`);
        }
        return;
      }

      case 'task:delete': {
        const tasks = await this.getTasks();
        const id = String(msg.id);
        if (!tasks.delete(id)) return;
        this.broadcast({ t: 'taskDel', id });
        for (const o of this.conns.values()) if (o.p.taskId === id) this.update(o, { taskId: null });
        await db.deleteTask(this.env.DB, id);
        return;
      }

      case 'task:focus': {
        if (msg.id == null) {
          this.update(c, { taskId: null });
          return;
        }
        const tasks = await this.getTasks();
        if (tasks.has(String(msg.id))) this.update(c, { taskId: String(msg.id) });
        return;
      }
    }
  }
}

function sanitizePomo(v: unknown): Pomodoro | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const startedAt = Number(o.startedAt);
  const endsAt = Number(o.endsAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return null;
  if (endsAt - startedAt > 3 * 3600_000) return null;
  return { mode: o.mode === 'break' ? 'break' : 'focus', startedAt, endsAt };
}

function sanitizeAssignee(v: unknown): string | null {
  return typeof v === 'string' && CID_RE.test(v) ? v : null;
}

function sanitizePriority(v: unknown): Priority {
  return typeof v === 'string' && v in PRIORITY_META ? (v as Priority) : 'normal';
}
