-- Virtual employees: department on Kanban tasks, the playbook and the session debriefs.
ALTER TABLE tasks ADD COLUMN dept TEXT;
ALTER TABLE tasks ADD COLUMN hops INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS agent_lessons (id TEXT PRIMARY KEY, dept TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, by_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_debriefs (id TEXT PRIMARY KEY, agent TEXT NOT NULL, agent_name TEXT NOT NULL, dept TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_debriefs_done ON agent_debriefs (done, created_at);
