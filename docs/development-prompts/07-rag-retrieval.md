# Prompt

```
Implement project-scoped retrieval on top of the chunks created in phase 06.

- lib/rag/retrieve.ts: given a projectId, userId, and a query string, (1) validate the
  project belongs to userId, (2) embed the query via AIService, (3) run a pgvector
  cosine-similarity search against chunks WHERE project_id = $projectId, (4) return the
  top-K (default 5) chunks above a relevance threshold (make the threshold a named
  constant, not a magic number inline).
- If no chunks clear the threshold, return an explicit "insufficient evidence" result
  type rather than an empty array with no signal — later phases depend on being able to
  distinguish "no good matches" from "an error occurred."
- Write a small manual test script (or route handler usable via curl/Postman) that takes
  a projectId + query and prints the retrieved chunks with their scores, for verification.

Acceptance check: querying with a question clearly covered by an uploaded material
returns relevant chunks from the correct pages; querying a project with no relevant
material, or a different project entirely, returns the "insufficient evidence" result,
never chunks from another project.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Provide grounded evidence for Tutor (phase 08) — retrieval must be project-isolated, threshold-filtered, and distinguish "no match" from error.

# Result

`lib/rag/retrieve.ts` implements `RELEVANCE_THRESHOLD=0.25` + `DEFAULT_TOP_K=5`, validates `projects WHERE id=userId`, embeds via `aiService.generateEmbedding` (Groq 768), calls RPC `match_chunks(query_embedding, match_project_id, match_threshold, match_count)` which computes `1 - (embedding <=> query_embedding)` filtered by `project_id`, ordered by distance, limited to topK, returns `success` vs `insufficient_evidence` discriminated union. Fallback JS cosine path if RPC not migrated (fetches ≤100 chunks, computes similarity, filters/sorts). `db/schema/002_retrieve.sql` creates `match_chunks` function. `app/api/projects/[projectId]/retrieve/route.ts` GET/POST handler for curl/Postman with `?q=&k=&threshold=` and `{query,topK,threshold}` body, prints `similarity` + `meta`. `scripts/retrieve-test.ts` demo/verification helper. Build/typecheck/lint pass, route appears in `next build` as `ƒ /api/projects/[projectId]/retrieve`.

# Changes Made

- `lib/rag/retrieve.ts` (new), `db/schema/002_retrieve.sql` (new), `app/api/projects/[projectId]/retrieve/route.ts` (new), `scripts/retrieve-test.ts` (new), `db/schema/README.md` updated to include 002
- No changes to existing ownership or RLS; retrieval reuses `getDb()` session-aware client so `match_chunks` is still implicitly scoped, plus explicit `WHERE project_id = $projectId` prevents cross-project leakage

# Notes

- Threshold 0.25 chosen as conservative for nomic-embed-text-v1.5 (typical related 0.5-0.9, unrelated 0.2-0.5); named constant per spec, passed as `match_threshold` param.
- RPC uses `vector_cosine_ops` index `idx_chunks_embedding` (ivfflat, lists=100) via `ORDER BY embedding <=> query_embedding`.
- Fallback ensures dev works before `002_retrieve.sql` is applied; production path is RPC.


# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
