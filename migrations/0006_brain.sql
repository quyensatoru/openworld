-- Tổng quản: a task may wait for other tasks, so one plan can dispatch several departments at once.
ALTER TABLE tasks ADD COLUMN after_ids TEXT;
ALTER TABLE tasks ADD COLUMN thread_id TEXT;
ALTER TABLE chat_messages ADD COLUMN root TEXT;
