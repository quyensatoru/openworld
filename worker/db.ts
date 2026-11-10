// D1 data access for the office. All functions take the D1 binding explicitly.

import { sanitizeAvatar, type AvatarConfig } from '../shared/avatar';
import type { ChatMsg, Priority, Task, TaskColumn, TeamMember, WorklogDay } from '../shared/protocol';
import { SCHEMA_STATEMENTS } from './schema';

const DAY_MS = 86_400_000;

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
}

// ---------------------------------------------------------------- users
export interface UserRow {
  id: string;
  name: string;
  avatar: string;
  desk: string | null;
  last_seen: number;
}

export async function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function upsertUser(db: D1Database, id: string, name: string, avatar: AvatarConfig, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, name, avatar, last_seen) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET name = ?2, avatar = ?3, last_seen = ?4`,
    )
    .bind(id, name, JSON.stringify(avatar), now)
    .run();
}

export async function touchUser(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, id).run();
}

export async function setUserDesk(db: D1Database, id: string, desk: string): Promise<void> {
  await db.prepare('UPDATE users SET desk = ? WHERE id = ?').bind(desk, id).run();
}

interface TeamRow extends UserRow {
  day: string | null;
  check_in: number | null;
  work_ms: number | null;
  pomodoros: number | null;
  tasks_done: number | null;
}

export async function listTeam(db: D1Database, day: string, now: number): Promise<TeamMember[]> {
  const { results } = await db
    .prepare(
      `SELECT u.*, w.day, w.check_in, w.work_ms, w.pomodoros, w.tasks_done
       FROM users u LEFT JOIN worklog w ON w.user_id = u.id AND w.day = ?1
       WHERE u.last_seen > ?2 ORDER BY u.name LIMIT 300`,
    )
    .bind(day, now - 45 * DAY_MS)
    .all<TeamRow>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    avatar: safeAvatar(r.avatar),
    lastSeen: r.last_seen,
    desk: r.desk,
    today: r.day
      ? { day: r.day, checkIn: r.check_in, workMs: r.work_ms ?? 0, pomodoros: r.pomodoros ?? 0, tasksDone: r.tasks_done ?? 0 }
      : null,
  }));
}

function safeAvatar(json: string): AvatarConfig {
  try {
    return sanitizeAvatar(JSON.parse(json));
  } catch {
    return sanitizeAvatar({});
  }
}

// ---------------------------------------------------------------- tasks
interface TaskRow {
  id: string;
  title: string;
  descr: string;
  col: string;
  ord: number;
  assignee: string | null;
  priority: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  done_at: number | null;
}

const rowToTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  desc: r.descr,
  col: r.col as TaskColumn,
  ord: r.ord,
  assignee: r.assignee,
  priority: r.priority as Priority,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
});

/** Active tasks + tasks finished in the last 14 days. */
export async function loadTasks(db: D1Database, now: number): Promise<Task[]> {
  const { results } = await db
    .prepare(`SELECT * FROM tasks WHERE col != 'done' OR done_at > ? ORDER BY col, ord`)
    .bind(now - 14 * DAY_MS)
    .all<TaskRow>();
  return results.map(rowToTask);
}

export async function saveTask(db: D1Database, t: Task): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tasks (id, title, descr, col, ord, assignee, priority, created_by, created_at, updated_at, done_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(id) DO UPDATE SET title = ?2, descr = ?3, col = ?4, ord = ?5, assignee = ?6, priority = ?7,
         updated_at = ?10, done_at = ?11`,
    )
    .bind(t.id, t.title, t.desc, t.col, t.ord, t.assignee, t.priority, t.createdBy, t.createdAt, t.updatedAt, t.doneAt)
    .run();
}

export async function deleteTask(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
}

// ---------------------------------------------------------------- chat
export async function recentChat(db: D1Database, limit = 80): Promise<ChatMsg[]> {
  const { results } = await db
    .prepare('SELECT id, ch, sender, name, text, ts FROM chat_messages ORDER BY ts DESC LIMIT ?')
    .bind(limit)
    .all<{ id: string; ch: string; sender: string; name: string; text: string; ts: number }>();
  return results.reverse().map((r) => ({ id: r.id, ch: r.ch, from: r.sender, name: r.name, text: r.text, ts: r.ts }));
}

export async function insertChat(db: D1Database, m: ChatMsg): Promise<void> {
  await db
    .prepare('INSERT INTO chat_messages (id, ch, sender, name, text, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(m.id, m.ch, m.from, m.name, m.text, m.ts)
    .run();
}

export async function pruneChat(db: D1Database, keep = 500): Promise<void> {
  await db
    .prepare('DELETE FROM chat_messages WHERE ts < (SELECT ts FROM chat_messages ORDER BY ts DESC LIMIT 1 OFFSET ?)')
    .bind(keep)
    .run();
}

// ---------------------------------------------------------------- worklog
export async function getWorklog(db: D1Database, day: string, userId: string): Promise<WorklogDay> {
  const r = await db
    .prepare('SELECT * FROM worklog WHERE day = ? AND user_id = ?')
    .bind(day, userId)
    .first<{ day: string; check_in: number | null; work_ms: number; pomodoros: number; tasks_done: number }>();
  return r
    ? { day, checkIn: r.check_in, workMs: r.work_ms, pomodoros: r.pomodoros, tasksDone: r.tasks_done }
    : { day, checkIn: null, workMs: 0, pomodoros: 0, tasksDone: 0 };
}

export interface WorklogDelta {
  checkIn?: number;
  workMs?: number;
  pomodoros?: number;
  tasksDone?: number;
}

export async function addWorklog(db: D1Database, day: string, userId: string, d: WorklogDelta): Promise<void> {
  await db
    .prepare(
      `INSERT INTO worklog (day, user_id, check_in, work_ms, pomodoros, tasks_done) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(day, user_id) DO UPDATE SET
         check_in = COALESCE(worklog.check_in, ?3),
         work_ms = worklog.work_ms + ?4,
         pomodoros = worklog.pomodoros + ?5,
         tasks_done = worklog.tasks_done + ?6`,
    )
    .bind(day, userId, d.checkIn ?? null, Math.round(d.workMs ?? 0), d.pomodoros ?? 0, d.tasksDone ?? 0)
    .run();
}

// ---------------------------------------------------------------- activity tokens
export async function replaceActivityToken(db: D1Database, userId: string, token: string | null, now: number): Promise<void> {
  const stmts = [db.prepare('DELETE FROM activity_tokens WHERE user_id = ?').bind(userId)];
  if (token) stmts.push(db.prepare('INSERT INTO activity_tokens (token, user_id, created_at) VALUES (?, ?, ?)').bind(token, userId, now));
  await db.batch(stmts);
}

export async function userForToken(db: D1Database, token: string): Promise<string | null> {
  const r = await db.prepare('SELECT user_id FROM activity_tokens WHERE token = ?').bind(token).first<{ user_id: string }>();
  return r?.user_id ?? null;
}

// ---------------------------------------------------------------- push subscriptions
export interface PushRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  last_sent: number;
}

export async function savePushSub(db: D1Database, userId: string, endpoint: string, p256dh: string, auth: string, now: number): Promise<void> {
  // one row per device; re-subscribing with the same endpoint just refreshes the keys
  await db
    .prepare(
      `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at, last_sent) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(endpoint, userId, p256dh, auth, now)
    .run();
}

export async function deletePushSub(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(endpoint).run();
}

/** Everyone worth notifying: not in the room right now, and not pushed to recently. */
export async function pushTargets(db: D1Database, excludeUsers: string[], quietBefore: number, limit: number): Promise<PushRow[]> {
  const holes = excludeUsers.map(() => '?').join(',');
  const sql =
    `SELECT endpoint, user_id, p256dh, auth, last_sent FROM push_subs WHERE last_sent < ?` +
    (excludeUsers.length ? ` AND user_id NOT IN (${holes})` : '') +
    ` ORDER BY last_sent ASC LIMIT ?`;
  const res = await db
    .prepare(sql)
    .bind(quietBefore, ...excludeUsers, limit)
    .all<PushRow>();
  return res.results ?? [];
}

export async function markPushed(db: D1Database, endpoints: string[], now: number): Promise<void> {
  if (!endpoints.length) return;
  const holes = endpoints.map(() => '?').join(',');
  await db.prepare(`UPDATE push_subs SET last_sent = ? WHERE endpoint IN (${holes})`).bind(now, ...endpoints).run();
}

export async function dropPushSubs(db: D1Database, endpoints: string[]): Promise<void> {
  if (!endpoints.length) return;
  const holes = endpoints.map(() => '?').join(',');
  await db.prepare(`DELETE FROM push_subs WHERE endpoint IN (${holes})`).bind(...endpoints).run();
}

/** Every device one person has registered. */
export async function subsForUser(db: D1Database, userId: string): Promise<PushRow[]> {
  const r = await db.prepare(`SELECT endpoint, user_id, p256dh, auth, last_sent FROM push_subs WHERE user_id = ?`).bind(userId).all<PushRow>();
  return r.results ?? [];
}

// ---------------------------------------------------------------- wedding photos
export async function putWedPhoto(db: D1Database, id: string, data: ArrayBuffer, mime: string, now: number): Promise<void> {
  await db.prepare('INSERT INTO wed_photos (id, data, mime, created_at) VALUES (?, ?, ?, ?)').bind(id, data, mime, now).run();
}

export async function getWedPhoto(db: D1Database, id: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const row = await db.prepare('SELECT data, mime FROM wed_photos WHERE id = ?').bind(id).first<{ data: ArrayBuffer | number[]; mime: string }>();
  if (!row) return null;
  // D1 hands BLOBs back as an array of numbers
  const data = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data).buffer;
  return { data, mime: row.mime };
}

/** Delete every photo not in `keep` (the album is small, so this is the simplest correct sweep). */
export async function keepWedPhotos(db: D1Database, keep: string[]): Promise<void> {
  if (!keep.length) {
    await db.prepare('DELETE FROM wed_photos').run();
    return;
  }
  await db
    .prepare(`DELETE FROM wed_photos WHERE id NOT IN (${keep.map(() => '?').join(',')})`)
    .bind(...keep)
    .run();
}
