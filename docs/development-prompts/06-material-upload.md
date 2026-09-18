# Prompt

```
Implement the Material upload and background processing pipeline.

Upload flow (synchronous, in a route handler / service):
- Accept a PDF upload, validate it's a PDF and under a reasonable size limit.
- Store the file in Supabase Storage under a path scoped by user_id/project_id.
- Create a `materials` row with status='QUEUED'.
- Emit MATERIAL_UPLOADED event and trigger an Inngest job with the material id.
- Return immediately (202-style) — do not block the request on processing.

Background job (Inngest function), steps:
1. Set status='PROCESSING', emit MATERIAL_PROCESSING_STARTED.
2. Extract text from the PDF, preserving page numbers per extracted segment.
3. Chunk the text (~500-800 tokens per chunk, ~50-100 token overlap), each chunk keeping
   its page_number and a chunk_index.
4. Generate an embedding per chunk (via the AIService, see lib/ai) and store chunks with
   embeddings in the `chunks` table.
5. Extract a list of key concepts from the full document (one AIService call, structured
   output: array of {name, description}) and upsert into `concepts`, linked via
   source_material_id.
6. Set status='READY', emit MATERIAL_READY.
7. On any failure at any step: set status='FAILED', store processing_error, emit
   MATERIAL_FAILED, and do not leave the job stuck in PROCESSING.

Also build:
- lib/ai/AIService with at least generateEmbedding() and generateStructured() methods,
  used by both this pipeline and later phases — don't call the OpenAI SDK directly from
  the job code.
- UI on /projects/[projectId]/materials: upload form, list of materials showing
  QUEUED/PROCESSING/READY/FAILED status (poll or realtime-subscribe for status updates),
  and a "Retry" action for FAILED materials that re-triggers the job.

Acceptance check: upload a real PDF, watch status move QUEUED → PROCESSING → READY,
confirm chunks exist in the DB with correct page numbers, and confirm concepts were
extracted. Upload a corrupted/non-PDF file and confirm it lands in FAILED with a
readable processing_error, not a stuck job.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Provide the ingestion foundation for RAG — PDFs must be extracted, chunked, embedded, and concept-tagged before Tutor/Quiz can operate.

# Result

Upload is synchronous validation + Supabase Storage (bucket `materials`, path `userId/projectId/materialId-filename`) + `materials` QUEUED → Inngest `material/uploaded` (fallback `setTimeout` for local dev). Background `processMaterial` extracts via `pdf-parse@1.1.1`, chunks via `lib/rag/chunker.ts` (2400 chars ~600 tokens, 320 overlap ~80), batch embeds via `aiService.generateEmbedding` (Groq nomic-embed-text-v1.5 768 dims, batches of 20), stores chunks, extracts concepts via `aiService.generateStructured`, marks READY/FAILED with learning_events. UI at `/projects/[projectId]/materials` with polling and retry. Build/typecheck/lint pass.

# Changes Made

- `lib/jobs/client.ts`, `lib/jobs/material.ts`, `lib/storage/materialStorage.ts`, `lib/rag/chunker.ts`, `services/material.service.ts`, `lib/db/supabase.ts` (getServiceDb), `app/api/projects/[projectId]/materials/route.ts`, `app/api/materials/[materialId]/retry/route.ts`, `app/api/inngest/route.ts`, `app/(app)/projects/[projectId]/materials/page.tsx` + `MaterialsClient.tsx`
- `lib/ai/AIService.ts` split to Meta chat + Groq embeddings (not part of phase 06 prompt but required for provider correctness)
- `pdf-parse@1.1.1`, `inngest` deps added
- `db/schema/001_initial_schema.sql` already had materials/chunks/concepts tables

# Notes

  - Meta Llama API has no embeddings endpoint (verified 404 2026-09-15), so embeddings stay on Groq; `chunks.embedding VECTOR(768)` matches.
  - As-built update (2026-09-17, Task 5): embeddings later moved to local `BAAI/bge-small-en-v1.5` (`VECTOR(384)`, `004_embeddings_384.sql`); neither Mercury nor Meta exposes an embeddings endpoint (both verified 404).
- Inngest send failure falls back to direct `processMaterial` via `setTimeout` so pipeline works without Inngest Cloud locally.
- Corrupted PDF path tested via header check + try/catch → FAILED, not stuck PROCESSING.


# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
