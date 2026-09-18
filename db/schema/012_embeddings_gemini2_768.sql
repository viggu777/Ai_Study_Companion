-- Phase: switch embeddings to Google Gemini Embedding 2 (gemini-embedding-2, 768 dims)
-- Run after 011_material_file_size.sql (Supabase SQL Editor or `npm run migrate`).
-- MUST be deployed together with the code change (AIService GEMINI_* defaults
-- to gemini-embedding-2, @google/genai with per-input Content objects).
--
-- Why a purge even though the dimension is unchanged (768 → 768):
-- gemini-embedding-001 and gemini-embedding-2 use INCOMPATIBLE embedding
-- spaces, and Embedding 2 additionally conditions vectors on instruction
-- prefixes (documents `title: ... | text: ...`, queries
-- `task: search result | query: ...`). Cosine comparison across models is
-- meaningless, so stale chunks are purged below. Never mix.
--
-- Re-index path: PDFs remain in Storage, so pressing Retry in the UI (or
-- running scripts/reindex-gemini-embeddings.ts) reprocesses each FAILED
-- material end-to-end via the SAME Gemini 2 model/config used for queries.
-- The script matches BOTH the old ('gemini-embedding-001') and the new
-- ('gemini-embedding-2') markers, so partially migrated estates converge
-- safely; re-running is safe (processMaterial deletes stale chunks before
-- insert, so no duplicates).
--
-- Safe to re-run: DELETE + UPDATE are idempotent, ALTER to the same
-- vector(768) type is a no-op on migrated DBs, RPC uses CREATE OR REPLACE.

-- 1. Old-model chunks are incompatible. Purge them and park affected
--    materials as FAILED with an actionable message.
DELETE FROM chunks;

UPDATE materials
SET status = 'FAILED',
    processing_error = 'Embedding model changed to gemini-embedding-2 (768 dims). Press Retry to reprocess with Gemini 2.',
    updated_at = NOW()
WHERE status IN ('QUEUED', 'PROCESSING', 'READY');

-- 2. Keep the vector column at 768 (unchanged size, new embedding space).
DROP INDEX IF EXISTS idx_chunks_embedding;
-- ALTER is a no-op when already vector(768); kept so partially migrated DBs converge.
ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(768);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Retrieval RPC bound to the 768-dim Gemini 2 space.
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  match_project_id uuid,
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  material_id uuid,
  project_id uuid,
  content text,
  page_number int,
  chunk_index int,
  similarity float,
  metadata jsonb
)
LANGUAGE sql STABLE
AS $$
  SELECT
    chunks.id,
    chunks.material_id,
    chunks.project_id,
    chunks.content,
    chunks.page_number,
    chunks.chunk_index,
    1 - (chunks.embedding <=> query_embedding) AS similarity,
    chunks.metadata
  FROM chunks
  WHERE chunks.project_id = match_project_id
    AND chunks.embedding IS NOT NULL
    AND 1 - (chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
