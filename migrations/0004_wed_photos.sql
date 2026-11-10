-- The wedding hall's photo album (also applied idempotently by worker/schema.ts).
-- The client shrinks pictures to ~1600 px JPEG first; the list itself lives in the room's state.
CREATE TABLE IF NOT EXISTS wed_photos (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
