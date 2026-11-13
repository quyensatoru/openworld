-- Work and experience stay in their own project: a task names the repo it must be done in, and a
-- lesson / debrief names the on-call machine it is about ('' = any machine).
ALTER TABLE tasks ADD COLUMN project TEXT;
ALTER TABLE agent_lessons ADD COLUMN machine TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_debriefs ADD COLUMN machine TEXT NOT NULL DEFAULT '';
