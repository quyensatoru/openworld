// Keep in sync with migrations/0001_init.sql. Applied idempotently by the Durable Object on first use.
export const SCHEMA_VERSION = 5;
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL, desk TEXT, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', col TEXT NOT NULL, ord REAL NOT NULL, assignee TEXT, priority TEXT NOT NULL DEFAULT 'normal', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, done_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_col ON tasks (col, ord)`,
  `CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, ch TEXT NOT NULL, sender TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_messages (ts)`,
  `CREATE TABLE IF NOT EXISTS activity_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_tokens (user_id)`,
  `CREATE TABLE IF NOT EXISTS worklog (day TEXT NOT NULL, user_id TEXT NOT NULL, check_in INTEGER, work_ms INTEGER NOT NULL DEFAULT 0, pomodoros INTEGER NOT NULL DEFAULT 0, tasks_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id))`,
  `CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL, last_sent INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs (user_id)`,
  `CREATE TABLE IF NOT EXISTS wed_photos (id TEXT PRIMARY KEY, data BLOB NOT NULL, mime TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS agent_lessons (id TEXT PRIMARY KEY, dept TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, by_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS agent_debriefs (id TEXT PRIMARY KEY, agent TEXT NOT NULL, agent_name TEXT NOT NULL, dept TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_debriefs_done ON agent_debriefs (done, created_at)`,
];

/** Columns added to existing tables; each fails harmlessly once the column exists. */
export const SCHEMA_ALTERS = [`ALTER TABLE tasks ADD COLUMN dept TEXT`, `ALTER TABLE tasks ADD COLUMN hops INTEGER NOT NULL DEFAULT 0`];
