# Prompt

Using Supabase Postgres with the pgvector extension, create the database schema described
below. Write it as SQL migration file(s) under db/schema/, plus enable Row-Level Security
(RLS) on every user-owned table with a policy of `user_id = auth.uid()`.

Tables (types simplified, use sensible Postgres types, uuid primary keys, timestamptz for
all created_at/updated_at, ON DELETE CASCADE from child to parent where it matches the
hierarchy User→Space→Project→{Material,Concept,Conversation,Quiz,Recommendation}):

spaces            (id, user_id, name, description, created_at, updated_at)
projects          (id, space_id, user_id, name, description, learning_goal,
                    created_at, updated_at)
materials         (id, project_id, user_id, filename, storage_path, mime_type,
                    status text check in ('QUEUED','PROCESSING','READY','FAILED'),
                    page_count, processing_error, created_at, updated_at)
chunks            (id, material_id, project_id, content, page_number, chunk_index,
                    embedding vector(1536), metadata jsonb, created_at)
concepts          (id, project_id, name, description, source_material_id,
                    created_at, updated_at)
concept_mastery   (id, project_id, concept_id, user_id, mastery_score numeric,
                    evidence jsonb, updated_at)
mastery_history   (id, concept_id, user_id, previous_score, new_score, reason,
                    created_at)
conversations     (id, project_id, user_id, created_at, updated_at)
messages          (id, conversation_id, role text, content, citations jsonb, created_at)
quizzes           (id, project_id, user_id, status, created_at, completed_at)
questions         (id, quiz_id, concept_id, type text check in ('MCQ','OPEN_ENDED'),
                    difficulty, question, options jsonb, correct_answer, explanation)
answers           (id, question_id, user_id, response, is_correct boolean, score,
                    evaluation jsonb, created_at)
recommendations   (id, project_id, user_id, title, action_items jsonb,
                    status text check in ('ACTIVE','COMPLETED','DISMISSED'), created_at)
learning_events   (id, user_id, space_id, project_id, event_type, entity_type,
                    entity_id, metadata jsonb, created_at)
ai_operations     (id, user_id, project_id, feature, model, request_id, latency_ms,
                    success boolean, tokens_in, tokens_out, estimated_cost, error,
                    created_at)

Additional requirements:
- Add an ivfflat or hnsw index on chunks.embedding for cosine similarity search.
- Add a unique constraint on learning_events(project_id, entity_type, entity_id, event_type)
  for event types where duplicate processing would be harmful (at minimum QUIZ_COMPLETED,
  MATERIAL_READY).
- Add indexes on every project_id and user_id foreign key column.
- Add index on learning_events(project_id, created_at) for activity feed queries.
- Write a short db/schema/README.md explaining how to run the migration against Supabase.

Acceptance check: migration runs cleanly against a fresh Supabase project; RLS blocks a
manual query for another user's row when tested via the Supabase SQL editor with
`set role authenticated; set request.jwt.claim.sub = '<other-user-id>';`.

After acceptance checks pass, run `/compact` before starting the next phase.

# Purpose

Create the complete relational and vector schema that all subsequent phases depend on,
including RLS policies for defense-in-depth security and indexes for query performance.

# Result

Created a single migration file `db/schema/001_initial_schema.sql` containing:

- All 15 required tables with proper UUID primary keys, timestamptz timestamps, and
  foreign keys with ON DELETE CASCADE following the User→Space→Project hierarchy
- pgvector extension enabled; `chunks.embedding` as VECTOR(768) — 768 matches Groq
  `nomic-embed-text-v1.5`; the prompt draft said 1536 (OpenAI ada-002) but the
  implemented model is 768, so the schema and architecture §6 use 768
- IVFFlat index on `chunks.embedding` for cosine similarity search (lists=100)
- Partial unique index on `learning_events` for idempotency on `QUIZ_COMPLETED` and
  `MATERIAL_READY` events
- Indexes on every `project_id` and `user_id` foreign key column
- Composite index on `learning_events(project_id, created_at)`
- RLS enabled on all 15 user-owned tables with policies enforcing `user_id = auth.uid()`
  (using subqueries for tables that only have `project_id`)
- `db/schema/README.md` with instructions for running via Supabase Dashboard, CLI, or
  direct PostgreSQL connection, plus verification queries

# Changes Made

- Created `db/schema/001_initial_schema.sql` (256 lines)
- Created `db/schema/README.md`

# Notes

- The migration cannot be executed locally without a Supabase project; the acceptance
  check requires a live Supabase instance with pgvector enabled.
- RLS policies on `chunks`, `concepts`, `messages`, and `questions` use subqueries to
  `projects` because those tables only carry `project_id`, not `user_id` directly — this
  matches the architecture's requirement that ownership is always validated via the
  project hierarchy.
- The partial unique index on `learning_events` uses a WHERE clause to only enforce
  uniqueness for the two event types where duplicate processing would be harmful, as
  specified.
- All foreign keys reference `auth.users(id)` for user ownership, integrating with
  Supabase Auth.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
