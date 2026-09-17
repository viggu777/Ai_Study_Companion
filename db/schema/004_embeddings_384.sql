-- Phase: switch embeddings to BAAI/bge-small-en-v1.5 (384 dims, local FastEmbed/Docker)
-- Run after 003_storage.sql (Supabase SQL Editor).
-- MUST be deployed together with the code change (AIService EMBEDDING_PROVIDER=local,
-- default). Never mix 768-dim (Groq nomic) and 384-dim rows — cosine comparison
-- across dimensions errors, so stale chunks are purged below.

-- 1. Old 768-dim chunks are incompatible with the new model. Purge them and park
--    affected materials as FAILED with an actionable message. The PDF is still in
--    Storage, so pressing Retry in the UI reprocesses the material end-to-end.
DELETE FROM chunks;

UPDATE materials
SET status = 'FAILED',
    processing_error = 'Embedding model changed to bge-small-en-v1.5 (384 dims). Press Retry to reprocess.',
    updated_at = NOW()
WHERE status IN ('QUEUED', 'PROCESSING', 'READY');

-- 2. Resize the vector column (table is now empty of embeddings, so no cast issues).
DROP INDEX IF EXISTS idx_chunks_embedding;
ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(384);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Retrieval RPC bound to the new dimension.
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(384),
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
