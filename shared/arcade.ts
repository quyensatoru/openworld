// BSS Net (the game room): multiplayer games run by the server (OfficeRoom → worker/arcade.ts).
// Types + pure rules shared by the worker and the client.

// ------------------------------------------------------------------ snake battle
export const SNAKE_W = 40;
export const SNAKE_H = 26;
export const SNAKE_TICK_MS = 125;
export const SNAKE_ROUND_MS = 120_000;
export const SNAKE_MAX = 10;
export const SNAKE_COLORS = ['#ff3ea5', '#2de2e6', '#ffd23f', '#39ff88', '#ff7a00', '#9b5cff', '#ff5d5d', '#5d9bff', '#e8e8e8', '#b6ff3e'];

export interface SnakePlayer {
  id: string;
  name: string;
  color: string;
  /** Cells head first: [x0, y0, x1, y1, …]. Empty once dead. */
  body: number[];
  alive: boolean;
  score: number;
}

export interface SnakeFrame {
  phase: 'idle' | 'countdown' | 'play' | 'over';
  /** Server time (ms) when the current phase ends. */
  until: number;
  round: number;
  players: SnakePlayer[];
  /** Waiting for the next round. */
  queue: { id: string; name: string }[];
  food: number[];
  winner: { id: string; name: string } | null;
}

/** 0 up, 1 right, 2 down, 3 left. */
export const DIR_X = [0, 1, 0, -1];
export const DIR_Y = [-1, 0, 1, 0];

// ------------------------------------------------------------------ caro (gomoku)
export const CARO_N = 15;
export const CARO_TURN_MS = 30_000;
export type CaroMark = 'x' | 'o';

export interface CaroGame {
  id: string;
  x: string; // player id, or 'bot'
  o: string;
  xName: string;
  oName: string;
  /** CARO_N² chars: '.', 'x', 'o'. */
  board: string;
  turn: CaroMark;
  moves: number;
  last: number; // index of the last move, -1 before the first
  turnEnds: number; // server time
  winner: CaroMark | 'draw' | null;
  line: number[] | null;
  reason: string | null; // 'timeout' | 'resign' | 'left'
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** Five or more in a row through cell `i` for `who` → the cells; otherwise null. */
export function caroWinLine(board: string, i: number, who: CaroMark): number[] | null {
  const x0 = i % CARO_N;
  const y0 = Math.floor(i / CARO_N);
  for (const [dx, dy] of DIRS) {
    const cells = [i];
    for (const s of [1, -1]) {
      let x = x0 + dx * s;
      let y = y0 + dy * s;
      while (x >= 0 && y >= 0 && x < CARO_N && y < CARO_N && board[y * CARO_N + x] === who) {
        cells.push(y * CARO_N + x);
        x += dx * s;
        y += dy * s;
      }
    }
    if (cells.length >= 5) return cells.sort((a, b) => a - b);
  }
  return null;
}

/** How good it is for `who` to play at (x, y): line lengths and open ends in the 4 directions. */
function lineScore(board: string, x0: number, y0: number, who: CaroMark): number {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1;
    let open = 0;
    for (const s of [1, -1]) {
      let x = x0 + dx * s;
      let y = y0 + dy * s;
      while (x >= 0 && y >= 0 && x < CARO_N && y < CARO_N && board[y * CARO_N + x] === who) {
        count++;
        x += dx * s;
        y += dy * s;
      }
      if (x >= 0 && y >= 0 && x < CARO_N && y < CARO_N && board[y * CARO_N + x] === '.') open++;
    }
    if (count >= 5) total += 1_000_000;
    else if (count === 4) total += open === 2 ? 100_000 : open === 1 ? 12_000 : 0;
    else if (count === 3) total += open === 2 ? 8_000 : open === 1 ? 600 : 0;
    else if (count === 2) total += open === 2 ? 400 : open === 1 ? 50 : 0;
    else total += open * 5;
  }
  return total;
}

/** A decent (beatable) gomoku move: attack + defence heuristic over cells near the stones. */
export function caroBotMove(board: string, me: CaroMark, rnd: () => number = Math.random): number {
  const them: CaroMark = me === 'x' ? 'o' : 'x';
  const centre = Math.floor(CARO_N / 2) * (CARO_N + 1);
  if (!board.includes('x') && !board.includes('o')) return centre;
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== '.') continue;
    const x = i % CARO_N;
    const y = Math.floor(i / CARO_N);
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < CARO_N && yy < CARO_N && board[yy * CARO_N + xx] !== '.') {
          near = true;
          break;
        }
      }
    }
    if (!near) continue;
    const score = lineScore(board, x, y, me) * 1.1 + lineScore(board, x, y, them) + rnd() * 30;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? best : board.indexOf('.');
}

// ------------------------------------------------------------------ messages
export type ArcadeMsg =
  | { a: 'snake:join' }
  | { a: 'snake:leave' }
  | { a: 'snake:dir'; d: number }
  | { a: 'snake:watch'; on: boolean }
  | { a: 'caro:queue' }
  | { a: 'caro:bot' }
  | { a: 'caro:cancel' }
  | { a: 'caro:move'; i: number }
  | { a: 'caro:resign' };
