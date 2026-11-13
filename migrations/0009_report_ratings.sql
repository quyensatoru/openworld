-- 👍 / 👎 on Tổng quản's final reports, one per report, kept with the thread it belongs to.
-- A 👎 with a reason also wrote a lesson (lesson_id), so changing the vote can take it back.
CREATE TABLE IF NOT EXISTS report_ratings (msg_id TEXT PRIMARY KEY, thread TEXT NOT NULL, user_id TEXT NOT NULL, vote INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', lesson_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ratings_user ON report_ratings (user_id, updated_at);
