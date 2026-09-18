-- Phase: persistent Tutor continuity (Task 3)
-- Lightweight conversation-summary persisted on conversations so older
-- context survives beyond the bounded recent-message window.
-- Run after 004_embeddings_384.sql (Supabase SQL Editor).
-- Backwards compatible: all columns nullable / defaulted; service code
-- treats a missing summary as "no summary yet" and tolerates a DB where
-- this migration has not been applied yet.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS summary_message_count INTEGER NOT NULL DEFAULT 0;

-- Conversations already have RLS user isolation; no new policy needed.
-- Summary inherits the same project/conversation scoping as the row itself.
