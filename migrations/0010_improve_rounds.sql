-- "Vòng cải tiến mới" (the 🧠 panel): QA + Biz side by side, Dev after. Each round is kept so the
-- next one (Biz, Tổng quản) knows what earlier rounds already did and does not propose it again.
CREATE TABLE IF NOT EXISTS improve_rounds (id TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT '', root TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL, task_ids TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', closed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rounds_at ON improve_rounds (created_at);
