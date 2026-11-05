// Office Net game server, living inside the OfficeRoom Durable Object.
//  - Snake battle: one shared arena, rounds of up to SNAKE_MAX players, simulated here at 8 Hz.
//  - Caro (gomoku): 1v1 matches from a queue, or against a simple bot.
// The interval only runs while somebody is playing, so the DO can still hibernate when idle.
import {
  CARO_N,
  CARO_TURN_MS,
  DIR_X,
  DIR_Y,
  SNAKE_COLORS,
  SNAKE_H,
  SNAKE_MAX,
  SNAKE_ROUND_MS,
  SNAKE_TICK_MS,
  SNAKE_W,
  caroBotMove,
  caroWinLine,
  type ArcadeMsg,
  type CaroGame,
  type CaroMark,
  type SnakeFrame,
} from '../shared/arcade';
import type { ServerMsg } from '../shared/protocol';

export interface ArcadeHost {
  /** Connected players (id, name, zone). */
  people(): Iterable<{ id: string; name: string; zone: string }>;
  send(id: string, msg: ServerMsg): void;
  chat(text: string): Promise<void>;
}

interface Snake {
  id: string;
  name: string;
  color: string;
  body: { x: number; y: number }[];
  dir: number;
  queue: number[];
  alive: boolean;
  score: number;
  grow: number;
}

const COUNTDOWN_MS = 4000;
const OVER_MS = 5500;
const BOT = 'bot';

export class Arcade {
  // ---- snake
  private phase: SnakeFrame['phase'] = 'idle';
  private until = 0;
  private round = 0;
  private roundStart = 0;
  private joined = new Map<string, string>(); // id → name, wants to play
  private snakes = new Map<string, Snake>();
  private food: { x: number; y: number }[] = [];
  private winner: SnakeFrame['winner'] = null;
  private watchers = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickN = 0;
  // ---- caro
  private games = new Map<string, CaroGame>();
  private gameOf = new Map<string, string>();
  private queue: string | null = null;
  private seq = 0;

  constructor(private host: ArcadeHost) {}

  handle(p: { id: string; name: string }, m: ArcadeMsg) {
    switch (m.a) {
      case 'snake:join':
        if (!this.joined.has(p.id) && this.joined.size >= SNAKE_MAX * 2) return;
        this.joined.set(p.id, p.name);
        this.watchers.add(p.id);
        if (this.phase === 'idle') this.startCountdown();
        this.broadcastSnake();
        return;
      case 'snake:leave':
        this.leaveSnake(p.id);
        return;
      case 'snake:watch':
        if (m.on) {
          this.watchers.add(p.id);
          this.host.send(p.id, { t: 'snake', f: this.frame() });
        } else if (!this.joined.has(p.id)) this.watchers.delete(p.id);
        return;
      case 'snake:dir': {
        const s = this.snakes.get(p.id);
        const d = Number(m.d);
        if (!s || !s.alive || !(d >= 0 && d <= 3) || this.phase !== 'play') return;
        const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
        if (d === last || (d + 2) % 4 === last || s.queue.length >= 3) return;
        s.queue.push(d);
        return;
      }
      case 'caro:queue':
        return this.caroQueue(p.id);
      case 'caro:bot':
        return this.caroStart(p.id, BOT);
      case 'caro:cancel':
        if (this.queue === p.id) this.queue = null;
        this.host.send(p.id, { t: 'caro', g: this.myGame(p.id), queued: false });
        return;
      case 'caro:move':
        return this.caroMove(p.id, Number(m.i));
      case 'caro:resign': {
        const g = this.myGame(p.id);
        if (g && !g.winner) this.caroEnd(g, g.x === p.id ? 'o' : 'x', 'resign');
        return;
      }
    }
  }

  /** Someone disconnected (or stood up from their PC). */
  leave(id: string) {
    this.leaveSnake(id);
    this.watchers.delete(id);
    if (this.queue === id) this.queue = null;
    const g = this.myGame(id);
    if (g && !g.winner) {
      if (g.x === BOT || g.o === BOT) this.dropGame(g);
      else this.caroEnd(g, g.x === id ? 'o' : 'x', 'left');
    }
  }

  // ------------------------------------------------------------------ snake
  private leaveSnake(id: string) {
    this.joined.delete(id);
    const s = this.snakes.get(id);
    if (s?.alive && this.phase === 'play') this.kill(s);
    if (!this.joined.size && this.phase === 'countdown') this.setIdle();
    this.broadcastSnake();
  }

  private ensureTimer() {
    this.timer ??= setInterval(() => this.tick(), SNAKE_TICK_MS);
  }

  private setIdle() {
    this.phase = 'idle';
    this.snakes.clear();
    this.food = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private startCountdown() {
    this.phase = 'countdown';
    this.until = Date.now() + COUNTDOWN_MS;
    this.winner = null;
    this.snakes.clear();
    this.food = [];
    this.ensureTimer();
  }

  private startRound() {
    const ids = [...this.joined.entries()].slice(0, SNAKE_MAX);
    this.phase = 'play';
    this.round++;
    this.roundStart = Date.now();
    this.until = this.roundStart + SNAKE_ROUND_MS;
    this.snakes.clear();
    // spawn spots around the edge, heading inward
    const spots: [number, number, number][] = [
      [4, 4, 1],
      [SNAKE_W - 5, SNAKE_H - 5, 3],
      [SNAKE_W - 5, 4, 2],
      [4, SNAKE_H - 5, 0],
      [Math.floor(SNAKE_W / 2), 3, 2],
      [Math.floor(SNAKE_W / 2), SNAKE_H - 4, 0],
      [3, Math.floor(SNAKE_H / 2), 1],
      [SNAKE_W - 4, Math.floor(SNAKE_H / 2), 3],
      [12, 8, 1],
      [SNAKE_W - 13, SNAKE_H - 9, 3],
    ];
    ids.forEach(([id, name], i) => {
      const [x, y, dir] = spots[i];
      const body = [0, 1, 2].map((k) => ({ x: x - DIR_X[dir] * k, y: y - DIR_Y[dir] * k }));
      this.snakes.set(id, { id, name, color: SNAKE_COLORS[i % SNAKE_COLORS.length], body, dir, queue: [], alive: true, score: 0, grow: 0 });
    });
    this.food = [];
    this.topUpFood();
  }

  private occupied(): Set<number> {
    const occ = new Set<number>();
    for (const s of this.snakes.values()) for (const c of s.body) occ.add(c.y * SNAKE_W + c.x);
    for (const f of this.food) occ.add(f.y * SNAKE_W + f.x);
    return occ;
  }

  private topUpFood() {
    const alive = [...this.snakes.values()].filter((s) => s.alive).length;
    const want = Math.max(3, alive + 2);
    const occ = this.occupied();
    let guard = 0;
    while (this.food.length < want && guard++ < 500) {
      const x = 1 + Math.floor(Math.random() * (SNAKE_W - 2));
      const y = 1 + Math.floor(Math.random() * (SNAKE_H - 2));
      if (occ.has(y * SNAKE_W + x)) continue;
      occ.add(y * SNAKE_W + x);
      this.food.push({ x, y });
    }
  }

  private kill(s: Snake) {
    s.alive = false;
    // the body turns into snacks for the others
    s.body.forEach((c, i) => {
      if (i % 2 === 0 && this.food.length < 60) this.food.push({ x: c.x, y: c.y });
    });
    s.body = [];
  }

  private tick() {
    const now = Date.now();
    this.tickN++;
    if (this.phase === 'countdown') {
      if (!this.joined.size) return this.setIdle();
      if (now >= this.until) {
        this.startRound();
        this.broadcastSnake();
      } else if (this.tickN % 4 === 0) this.broadcastSnake();
      return;
    }
    if (this.phase === 'over') {
      if (now >= this.until) {
        if (this.joined.size) this.startCountdown();
        else this.setIdle();
        this.broadcastSnake();
      } else if (this.tickN % 8 === 0) this.broadcastSnake();
      return;
    }
    if (this.phase !== 'play') return;

    const live = [...this.snakes.values()].filter((s) => s.alive);
    // 1. move heads
    const heads = new Map<Snake, { x: number; y: number }>();
    for (const s of live) {
      const q = s.queue.shift();
      if (q !== undefined) s.dir = q;
      const h = s.body[0];
      heads.set(s, { x: h.x + DIR_X[s.dir], y: h.y + DIR_Y[s.dir] });
    }
    // 2. eat
    for (const [s, h] of heads) {
      const fi = this.food.findIndex((f) => f.x === h.x && f.y === h.y);
      if (fi >= 0) {
        this.food.splice(fi, 1);
        s.grow += 1;
        s.score += 1;
      }
    }
    // 3. advance bodies
    for (const [s, h] of heads) {
      s.body.unshift(h);
      if (s.grow > 0) s.grow--;
      else s.body.pop();
    }
    // 4. collisions (walls, bodies, head-on)
    const cells = new Map<number, number>();
    for (const s of live) s.body.forEach((c, i) => i > 0 && cells.set(c.y * SNAKE_W + c.x, (cells.get(c.y * SNAKE_W + c.x) ?? 0) + 1));
    const headCount = new Map<number, number>();
    for (const h of heads.values()) headCount.set(h.y * SNAKE_W + h.x, (headCount.get(h.y * SNAKE_W + h.x) ?? 0) + 1);
    const dead: Snake[] = [];
    for (const [s, h] of heads) {
      const k = h.y * SNAKE_W + h.x;
      if (h.x < 0 || h.y < 0 || h.x >= SNAKE_W || h.y >= SNAKE_H || cells.has(k) || (headCount.get(k) ?? 0) > 1) dead.push(s);
    }
    for (const s of dead) this.kill(s);
    this.topUpFood();

    // 5. round over?
    const alive = [...this.snakes.values()].filter((s) => s.alive);
    const solo = this.snakes.size === 1;
    if ((solo && alive.length === 0) || (!solo && alive.length <= 1) || now >= this.until) {
      const all = [...this.snakes.values()];
      const best = alive.length === 1 && !solo ? alive[0] : [...(alive.length ? alive : all)].sort((a, b) => b.score - a.score)[0];
      this.winner = best ? { id: best.id, name: best.name } : null;
      this.phase = 'over';
      this.until = now + OVER_MS;
      if (best && !solo) void this.host.chat(`🐍 ${best.name} thắng ván Rắn săn mồi ở Office Net (${best.score} điểm, ${all.length} người chơi)!`);
    }
    this.broadcastSnake();
  }

  private frame(): SnakeFrame {
    return {
      phase: this.phase,
      until: this.until,
      round: this.round,
      players: [...this.snakes.values()].map((s) => ({ id: s.id, name: s.name, color: s.color, body: s.body.flatMap((c) => [c.x, c.y]), alive: s.alive, score: s.score })),
      queue: [...this.joined.entries()].filter(([id]) => !this.snakes.has(id) || this.phase !== 'play').map(([id, name]) => ({ id, name })),
      food: this.food.flatMap((f) => [f.x, f.y]),
      winner: this.winner,
    };
  }

  private broadcastSnake() {
    const msg: ServerMsg = { t: 'snake', f: this.frame() };
    for (const p of this.host.people()) if (this.watchers.has(p.id) || p.zone === 'netcafe') this.host.send(p.id, msg);
  }

  // ------------------------------------------------------------------ caro
  private myGame(id: string): CaroGame | null {
    const gid = this.gameOf.get(id);
    return gid ? (this.games.get(gid) ?? null) : null;
  }

  private nameOf(id: string): string {
    for (const p of this.host.people()) if (p.id === id) return p.name;
    return 'Ai đó';
  }

  private isOnline(id: string): boolean {
    for (const p of this.host.people()) if (p.id === id) return true;
    return false;
  }

  private caroQueue(id: string) {
    const cur = this.myGame(id);
    if (cur && !cur.winner) return this.host.send(id, { t: 'caro', g: cur, queued: false });
    if (cur) this.dropGame(cur);
    if (this.queue && this.queue !== id && this.isOnline(this.queue)) {
      const other = this.queue;
      this.queue = null;
      return this.caroStart(other, id);
    }
    this.queue = id;
    this.host.send(id, { t: 'caro', g: null, queued: true });
  }

  private caroStart(a: string, b: string) {
    for (const id of [a, b]) {
      const old = id === BOT ? null : this.myGame(id);
      if (old) {
        if (!old.winner) this.caroEnd(old, old.x === id ? 'o' : 'x', 'left');
        this.dropGame(old);
      }
      if (this.queue === id) this.queue = null;
    }
    const swap = b !== BOT && Math.random() < 0.5;
    const x = swap ? b : a;
    const o = swap ? a : b;
    const g: CaroGame = {
      id: `c${++this.seq}`,
      x,
      o,
      xName: x === BOT ? '🤖 Máy' : this.nameOf(x),
      oName: o === BOT ? '🤖 Máy' : this.nameOf(o),
      board: '.'.repeat(CARO_N * CARO_N),
      turn: 'x',
      moves: 0,
      last: -1,
      turnEnds: Date.now() + CARO_TURN_MS,
      winner: null,
      line: null,
      reason: null,
    };
    this.games.set(g.id, g);
    for (const id of [x, o]) if (id !== BOT) this.gameOf.set(id, g.id);
    this.sendGame(g);
    this.armTimer(g);
    if (g.x === BOT) this.botTurn(g);
  }

  private caroMove(id: string, i: number) {
    const g = this.myGame(id);
    if (!g || g.winner || !Number.isInteger(i) || i < 0 || i >= CARO_N * CARO_N) return;
    const mark: CaroMark = g.x === id ? 'x' : 'o';
    if (g.turn !== mark || g.board[i] !== '.') return;
    this.place(g, i, mark);
  }

  private place(g: CaroGame, i: number, mark: CaroMark) {
    g.board = g.board.slice(0, i) + mark + g.board.slice(i + 1);
    g.moves++;
    g.last = i;
    const line = caroWinLine(g.board, i, mark);
    if (line) {
      g.line = line;
      return this.caroEnd(g, mark, null);
    }
    if (!g.board.includes('.')) return this.caroEnd(g, 'draw', null);
    g.turn = mark === 'x' ? 'o' : 'x';
    g.turnEnds = Date.now() + CARO_TURN_MS;
    this.sendGame(g);
    this.armTimer(g);
    if ((g.turn === 'x' ? g.x : g.o) === BOT) this.botTurn(g);
  }

  private botTurn(g: CaroGame) {
    const moves = g.moves;
    setTimeout(() => {
      if (g.winner || g.moves !== moves || !this.games.has(g.id)) return;
      const me = g.x === BOT ? 'x' : 'o';
      this.place(g, caroBotMove(g.board, me), me);
    }, 450 + Math.random() * 500);
  }

  private armTimer(g: CaroGame) {
    const moves = g.moves;
    setTimeout(() => {
      if (g.winner || g.moves !== moves || !this.games.has(g.id)) return;
      this.caroEnd(g, g.turn === 'x' ? 'o' : 'x', 'timeout');
    }, CARO_TURN_MS + 300);
  }

  private caroEnd(g: CaroGame, winner: CaroMark | 'draw', reason: string | null) {
    g.winner = winner;
    g.reason = reason;
    this.sendGame(g);
    const vsBot = g.x === BOT || g.o === BOT;
    if (winner === 'draw') return;
    const w = winner === 'x' ? g.xName : g.oName;
    const l = winner === 'x' ? g.oName : g.xName;
    if (!vsBot) void this.host.chat(`⭕ ${w} thắng ${l} một ván caro ở Office Net${reason === 'timeout' ? ' (đối thủ hết giờ)' : reason === 'resign' ? ' (đối thủ chịu thua)' : ''}!`);
    else if ((winner === 'x' ? g.x : g.o) !== BOT) void this.host.chat(`🤖 ${w} vừa đánh bại máy ở cờ caro!`);
  }

  private dropGame(g: CaroGame) {
    this.games.delete(g.id);
    for (const id of [g.x, g.o]) if (this.gameOf.get(id) === g.id) this.gameOf.delete(id);
  }

  private sendGame(g: CaroGame) {
    for (const id of [g.x, g.o]) if (id !== BOT) this.host.send(id, { t: 'caro', g, queued: false });
  }
}
