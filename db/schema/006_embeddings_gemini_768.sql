-- Phase: switch embeddings to Google Gemini Embeddings (gemini-embedding-001, 768 dims)
-- Run after 004_embeddings_384.sql / 005_conversation_summary.sql (Supabase SQL Editor).
-- MUST be deployed together with the code change (AIService GEMINI_*,
-- @google/genai). Old bge-small-en-v1.5 (384d) and nomic-embed-text-v1.5 (768d)
-- vectors are model-incompatible even when dims collide — cosine comparison
-- across models is meaningless, so stale chunks are purged below. Never mix.
--
-- Re-index path: PDFs remain in Storage, so pressing Retry in the UI (or
-- running scripts/reindex-gemini-embeddings.ts) reprocesses each FAILED
-- material end-to-end via the SAME Gemini model/config used for queries.

-- 1. Old-model chunks are incompatible. Purge them and park affected
--    materials as FAILED with an actionable message.
DELETE FROM chunks;

UPDATE materials
SET status = 'FAILED',
    processing_error = 'Embedding model changed to gemini-embedding-001 (768 dims). Press Retry to reprocess with Gemini.',
    updated_at = NOW()
WHERE status IN ('QUEUED', 'PROCESSING', 'READY');

-- 2. Resize the vector column (table is now empty of embeddings, so no cast issues).
DROP INDEX IF EXISTS idx_chunks_embedding;
ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(768);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Retrieval RPC bound to the new dimension.
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
