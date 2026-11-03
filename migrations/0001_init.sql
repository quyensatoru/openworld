-- BSS Virtual Office schema (also applied idempotently by worker/schema.ts)
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL, desk TEXT, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', col TEXT NOT NULL, ord REAL NOT NULL, assignee TEXT, priority TEXT NOT NULL DEFAULT 'normal', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, done_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_tasks_col ON tasks (col, ord);
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, ch TEXT NOT NULL, sender TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_messages (ts);
CREATE TABLE IF NOT EXISTS worklog (day TEXT NOT NULL, user_id TEXT NOT NULL, check_in INTEGER, work_ms INTEGER NOT NULL DEFAULT 0, pomodoros INTEGER NOT NULL DEFAULT 0, tasks_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id));
