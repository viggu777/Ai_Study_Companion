-- Phase: tutor conversation pinning (chats panel)
-- Adds persistent pin state so pinned chats stay on top.
-- Backwards compatible: nullable/defaulted; service tolerates a DB where
-- this migration has not been applied yet (falls back to unpinned).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations(project_id, is_pinned, updated_at DESC);
