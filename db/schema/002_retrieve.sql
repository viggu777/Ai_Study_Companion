-- Phase 07: RAG retrieval RPC
-- Run after 001_initial_schema.sql

-- Cosine similarity search scoped by project_id.
-- similarity = 1 - (embedding <=> query_embedding)
-- Threshold is applied on similarity (not distance) to be intuitive.
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
