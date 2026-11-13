// D1 data access for the office. All functions take the D1 binding explicitly.

import { sanitizeAvatar, type AvatarConfig } from '../shared/avatar';
import { isDept, type Debrief, type Lesson } from '../shared/agents';
import type { ImproveRound } from '../shared/brain';
import type { ChatMsg, Priority, ReportRate, Task, TaskColumn, TeamMember, WorklogDay } from '../shared/protocol';
import { SCHEMA_ALTERS, SCHEMA_STATEMENTS } from './schema';

const DAY_MS = 86_400_000;

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
  for (const s of SCHEMA_ALTERS) {
    try {
      await db.prepare(s).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
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
  dept?: string | null;
  hops?: number | null;
  after_ids?: string | null;
  thread_id?: string | null;
  project?: string | null;
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
  dept: isDept(r.dept) ? r.dept : null,
  hops: r.hops ?? 0,
  after: r.after_ids ? r.after_ids.split(',').filter(Boolean) : undefined,
  thread: r.thread_id ?? undefined,
  project: r.project || undefined,
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
      `INSERT INTO tasks (id, title, descr, col, ord, assignee, priority, created_by, created_at, updated_at, done_at, dept, hops, after_ids, thread_id, project)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT(id) DO UPDATE SET title = ?2, descr = ?3, col = ?4, ord = ?5, assignee = ?6, priority = ?7,
         updated_at = ?10, done_at = ?11, dept = ?12, hops = ?13, after_ids = ?14, thread_id = ?15, project = ?16`,
    )
    .bind(t.id, t.title, t.desc, t.col, t.ord, t.assignee, t.priority, t.createdBy, t.createdAt, t.updatedAt, t.doneAt, t.dept ?? null, t.hops ?? 0, t.after?.length ? t.after.join(',') : null, t.thread ?? null, t.project ?? null)
    .run();
}

export async function deleteTask(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
}

// ---------------------------------------------------------------- chat
export async function recentChat(db: D1Database, limit = 80): Promise<ChatMsg[]> {
  const { results } = await db
    .prepare('SELECT id, ch, sender, name, text, ts, root FROM chat_messages ORDER BY ts DESC LIMIT ?')
    .bind(limit)
    .all<{ id: string; ch: string; sender: string; name: string; text: string; ts: number; root: string | null }>();
  return results.reverse().map((r) => ({ id: r.id, ch: r.ch, from: r.sender, name: r.name, text: r.text, ts: r.ts, ...(r.root ? { root: r.root } : {}) }));
}

export async function insertChat(db: D1Database, m: ChatMsg): Promise<void> {
  await db
    .prepare('INSERT INTO chat_messages (id, ch, sender, name, text, ts, root) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(m.id, m.ch, m.from, m.name, m.text, m.ts, m.root ?? null)
    .run();
}

/**
 * What one person gets back on joining: the newest lines of each channel they can read, counted per
 * channel — the private AI threads are busy enough to push the shared chat out of a single "newest
 * N overall" window — plus the opener of every thread those lines belong to. The chat shows a
 * thread by its opener, so a long thread whose opener fell out of the window vanished whole.
 */
export async function chatFor(db: D1Database, userId: string, shared = 150, own = 300): Promise<ChatMsg[]> {
  const cols = 'id, ch, sender, name, text, ts, root';
  const pick = `SELECT ${cols} FROM chat_messages WHERE ch = ? ORDER BY ts DESC LIMIT ?`;
  const mine = `ask:${userId}`;
  const { results } = await db
    .prepare(
      `WITH picked AS (SELECT * FROM (${pick}) UNION ALL SELECT * FROM (${pick}) UNION ALL SELECT * FROM (${pick}))
       SELECT * FROM picked
       UNION SELECT ${cols} FROM chat_messages WHERE id IN (SELECT root FROM picked WHERE root IS NOT NULL) AND ch IN (?, ?, ?)
       ORDER BY ts ASC`,
    )
    .bind('global', shared, 'work', shared, mine, own, 'global', 'work', mine)
    .all<{ id: string; ch: string; sender: string; name: string; text: string; ts: number; root: string | null }>();
  // the person's own 👍 / 👎 on the reports in their thread come back with them
  const rates = await ratingsOf(db, userId).catch(() => new Map<string, ReportRate>());
  return results.map((r) => ({ id: r.id, ch: r.ch, from: r.sender, name: r.name, text: r.text, ts: r.ts, ...(r.root ? { root: r.root } : {}), ...(rates.has(r.id) ? { rate: rates.get(r.id) } : {}) }));
}

export async function getChat(db: D1Database, id: string): Promise<ChatMsg | null> {
  const r = await db
    .prepare('SELECT id, ch, sender, name, text, ts, root FROM chat_messages WHERE id = ?')
    .bind(id)
    .first<{ id: string; ch: string; sender: string; name: string; text: string; ts: number; root: string | null }>();
  return r ? { id: r.id, ch: r.ch, from: r.sender, name: r.name, text: r.text, ts: r.ts, ...(r.root ? { root: r.root } : {}) } : null;
}

// ---------------------------------------------------------------- 👍 / 👎 on Tổng quản's reports
export interface RatingRow {
  msgId: string;
  thread: string;
  userId: string;
  vote: 1 | -1;
  reason: string;
  lessonId: string | null;
}

export async function getRating(db: D1Database, msgId: string): Promise<RatingRow | null> {
  const r = await db
    .prepare('SELECT msg_id, thread, user_id, vote, reason, lesson_id FROM report_ratings WHERE msg_id = ?')
    .bind(msgId)
    .first<{ msg_id: string; thread: string; user_id: string; vote: number; reason: string; lesson_id: string | null }>();
  return r ? { msgId: r.msg_id, thread: r.thread, userId: r.user_id, vote: r.vote > 0 ? 1 : -1, reason: r.reason, lessonId: r.lesson_id } : null;
}

export async function saveRating(db: D1Database, r: RatingRow, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO report_ratings (msg_id, thread, user_id, vote, reason, lesson_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(msg_id) DO UPDATE SET vote = ?4, reason = ?5, lesson_id = ?6, updated_at = ?7`,
    )
    .bind(r.msgId, r.thread, r.userId, r.vote, r.reason, r.lessonId, now)
    .run();
}

/** One person's ratings, newest first (enough to cover every report a join loads). */
async function ratingsOf(db: D1Database, userId: string, limit = 400): Promise<Map<string, ReportRate>> {
  const { results } = await db
    .prepare('SELECT msg_id, vote, reason FROM report_ratings WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(userId, limit)
    .all<{ msg_id: string; vote: number; reason: string }>();
  return new Map(results.map((r) => [r.msg_id, { v: r.vote > 0 ? 1 : -1, ...(r.reason ? { reason: r.reason } : {}) }]));
}

// ---------------------------------------------------------------- improvement rounds
type RoundRow = { id: string; project: string; root: string; by_name: string; task_ids: string; summary: string; closed: number; created_at: number };

export async function listRounds(db: D1Database, limit = 20): Promise<ImproveRound[]> {
  const { results } = await db
    .prepare('SELECT id, project, root, by_name, task_ids, summary, closed, created_at FROM improve_rounds ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<RoundRow>();
  return results.map((r) => ({ id: r.id, project: r.project, root: r.root, byName: r.by_name, at: r.created_at, tasks: r.task_ids ? r.task_ids.split(',') : [], summary: r.summary, closed: !!r.closed }));
}

export async function saveRound(db: D1Database, r: ImproveRound, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO improve_rounds (id, project, root, by_name, task_ids, summary, closed, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET task_ids = ?5, summary = ?6, closed = ?7, updated_at = ?9`,
    )
    .bind(r.id, r.project, r.root, r.byName, r.tasks.join(','), r.summary, r.closed ? 1 : 0, r.at, now)
    .run();
}

/** Keeps the newest `keep` lines of every channel, so a busy channel never wipes a quiet one. */
export async function pruneChat(db: D1Database, keep = 500): Promise<void> {
  await db
    .prepare(
      'DELETE FROM chat_messages WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY ch ORDER BY ts DESC) AS rn FROM chat_messages) WHERE rn > ?)',
    )
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

// ---------------------------------------------------------------- agents: playbook + debriefs
interface LessonRow {
  id: string;
  dept: string;
  project: string;
  machine?: string | null;
  text: string;
  by_name: string;
  updated_at: number;
}
const rowToLesson = (r: LessonRow): Lesson => ({ id: r.id, dept: r.dept === 'all' || !isDept(r.dept) ? 'all' : r.dept, project: r.project, machine: r.machine || '', text: r.text, by: r.by_name, at: r.updated_at });

export async function listLessons(db: D1Database): Promise<Lesson[]> {
  const { results } = await db.prepare('SELECT * FROM agent_lessons ORDER BY updated_at DESC LIMIT 500').all<LessonRow>();
  return results.map(rowToLesson);
}

export async function saveLesson(db: D1Database, l: Lesson): Promise<void> {
  await db
    .prepare(
      `INSERT INTO agent_lessons (id, dept, project, text, by_name, created_at, updated_at, machine) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET dept = ?2, project = ?3, text = ?4, by_name = ?5, updated_at = ?6, machine = ?7`,
    )
    .bind(l.id, l.dept, l.project, l.text, l.by, l.at, l.machine ?? '')
    .run();
}

export async function deleteLesson(db: D1Database, id: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM agent_lessons WHERE id = ?').bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

interface DebriefRow {
  id: string;
  agent: string;
  agent_name: string;
  dept: string;
  project: string;
  machine?: string | null;
  text: string;
  created_at: number;
}
const rowToDebrief = (r: DebriefRow): Debrief => ({
  id: r.id,
  agent: r.agent,
  agentName: r.agent_name,
  dept: isDept(r.dept) ? r.dept : 'dev',
  project: r.project,
  machine: r.machine || '',
  text: r.text,
  at: r.created_at,
});

export async function addDebrief(db: D1Database, d: Debrief, owner: string): Promise<void> {
  await db
    .prepare('INSERT INTO agent_debriefs (id, agent, agent_name, dept, project, owner, text, created_at, machine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(d.id, d.agent, d.agentName, d.dept, d.project, owner, d.text, d.at, d.machine ?? '')
    .run();
}

/** Debriefs waiting to be distilled — all of them, or only those of one project (plus untagged ones). */
export async function pendingDebriefs(db: D1Database, limit: number, project?: string): Promise<Debrief[]> {
  const q =
    project === undefined
      ? db.prepare('SELECT * FROM agent_debriefs WHERE done = 0 ORDER BY created_at LIMIT ?').bind(limit)
      : db.prepare("SELECT * FROM agent_debriefs WHERE done = 0 AND (project = ? OR project = '') ORDER BY created_at LIMIT ?").bind(project, limit);
  const { results } = await q.all<DebriefRow>();
  return results.map(rowToDebrief);
}

export async function countPendingDebriefs(db: D1Database, project?: string): Promise<number> {
  const r =
    project === undefined
      ? await db.prepare('SELECT COUNT(*) AS n FROM agent_debriefs WHERE done = 0').first<{ n: number }>()
      : await db.prepare("SELECT COUNT(*) AS n FROM agent_debriefs WHERE done = 0 AND (project = ? OR project = '')").bind(project).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Mark debriefs as distilled; ones older than 60 days are dropped for good. */
export async function finishDebriefs(db: D1Database, ids: string[], now: number): Promise<number> {
  if (!ids.length) return 0;
  const marks = ids.map(() => '?').join(',');
  const r = await db.prepare(`UPDATE agent_debriefs SET done = 1 WHERE done = 0 AND id IN (${marks})`).bind(...ids).run();
  await db.prepare('DELETE FROM agent_debriefs WHERE done = 1 AND created_at < ?').bind(now - 60 * DAY_MS).run();
  return r.meta.changes ?? 0;
}
