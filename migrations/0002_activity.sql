-- Claude Code activity feed tokens (also applied idempotently by worker/schema.ts)
CREATE TABLE IF NOT EXISTS activity_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_tokens (user_id);
