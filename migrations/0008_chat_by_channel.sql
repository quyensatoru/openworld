-- Chat history is loaded and pruned per channel now.
CREATE INDEX IF NOT EXISTS idx_chat_ch_ts ON chat_messages (ch, ts);
