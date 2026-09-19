# AI Study Companion

A persistent, contextual, and measurable AI learning companion — not a PDF chatbot.
Organize learning into **Spaces → Projects**, upload **Materials** (PDFs), learn via a
**grounded Tutor** (citations, unsupported-question handling, prompt-injection defenses),
get tested via an **Adaptive Quiz** (MCQ + open-ended), and watch the system track
**Concept Mastery** over time to produce **Growth Analysis** and actionable
**Recommendations**. Every AI feature either produces evidence or acts on evidence —
the closed learning loop.

**Live deployment:** https://ai-study-companion-three-inky.vercel.app/
(Vercel + Supabase + Inngest Cloud — see Deployment information below).

## Demo accounts (video-ready)

Database was reset to a clean state on 2026-09-18 (all learning rows deleted,
`materials` Storage bucket emptied; schema, RLS, indexes, `match_chunks`, and
14 migrations preserved; `auth.users` kept). Two fresh accounts were created
for the demo video — log in with these on localhost or the live URL:

| Role  | Email                      | Password   | Notes                                              |
| ----- | -------------------------- | ---------- | -------------------------------------------------- |
| Learner (user) | `demo.learner@aistudy.app` | `Demo1234!` | Empty workspace — use for the full learning loop |
| Admin | `demo.admin@aistudy.app`   | `Admin1234!` | In `ADMIN_EMAILS` — can open `/admin/*`         |

> Deploy note: Vercel's `ADMIN_EMAILS` must include `demo.admin@aistudy.app`
> (currently `kmvk777@gmail.com` only locally) or the admin login on the live
> URL will be denied at `/admin/*`. Both accounts are email-confirmed, so no
> verification step blocks recording.

## Demo video flow (PRD §20 order)

Record with the learner account, then the admin account:

1. Create Space → 2. Create Project → 3. Upload Material (PDF) →
4. Wait for status QUEUED → PROCESSING → READY → 5. Ask Tutor (grounded
question) → 6. Show citation (`Source: <file> — Page N`) → 7. Ask an
unsupported question (shows insufficient-evidence response) →
8. Start Adaptive Quiz (MCQ) → 9. Answer an open-ended question (AI-graded
feedback) → 10. Open Mastery / Growth → 11. Open Analytics (project + global)
→ 12. Open Recommendations → 13. Log in as `demo.admin@aistudy.app` and walk
through Admin Dashboard (users, spaces, projects, activity, engagement,
learning, AI usage, AI evaluation, jobs, health).

## Must-Have coverage (PRD §18 — all present)

| Requirement | Where in this repo |
| ----------- | ------------------ |
| Authentication | `app/(auth)/{login,signup}`, `middleware.ts`, `tests/unit/rate-limit-auth.test.ts` |
| Spaces and Projects | `app/api/spaces/*`, `app/api/projects/[projectId]/route.ts`, `services/project.service.ts` |
| PDF materials | `services/material.service.ts`, `app/(app)/projects/[projectId]/materials/page.tsx` |
| Background document processing | `lib/jobs/`, `app/api/inngest/route.ts`, `tests/unit/job-guards.test.ts` |
| AI Tutor | `services/tutor.service.ts`, `app/(app)/projects/[projectId]/tutor/page.tsx` |
| Grounded answers with citations | `services/tutor.service.ts`, `tests/unit/tutor-citations.test.ts` |
| Unsupported-question handling | `tests/integration/tutor-insufficient.test.ts` (+ eval fixtures) |
| Adaptive Quiz | `services/quiz.service.ts`, `app/(app)/projects/[projectId]/quiz/page.tsx`, `tests/unit/quiz-gating.test.ts` |
| Open-ended assessment | `ai/assessment.ts`, `services/quiz.service.ts` (AI-graded with feedback) |
| Concept mastery | `services/mastery.service.ts`, `.../mastery/page.tsx`, `tests/unit/mastery*.test.ts` |
| Growth Analysis | `services/growth.service.ts`, `.../growth/page.tsx`, `tests/unit/growth-trends.test.ts` |
| Recommendations | `services/recommendation.service.ts`, `.../recommendations/page.tsx` |
| Project and global analytics | `services/analytics.service.ts`, `.../analytics/page.tsx`, `app/api/analytics/global/route.ts` |
| Activity tracking | `learning_events` table, `app/(app)/admin/activity/page.tsx` |
| Admin Dashboard | `app/(app)/admin/*` (dashboard, users, spaces, projects, activity, engagement, learning, ai-usage, ai-evaluation, jobs, health) |
| Persistent relevant learning context | Conversation summaries (`ai/tutor.ts`, `005_conversation_summary.sql`, `tests/unit/tutor-summary.test.ts`) |
| Project-level data isolation | Ownership `WHERE id=$1 AND user_id=$2` + RLS, `tests/unit/ownership.test.ts` |
| Structured AI interaction | `ai/*.ts` prompt+schema modules, `tests/unit/validation-schemas.test.ts` |
| Basic AI observability and evaluation | `ai_operations` log, `admin/ai-usage`, `admin/ai-evaluation`, `npm run eval` (18 fixtures) |
| Error handling | Retries/fallbacks, idempotency guards, `app/error.tsx`, `app/not-found.tsx` |
| Testing | `npm test` — 314 tests across 26 files |
| Deployment | Live at https://ai-study-companion-three-inky.vercel.app/ |
| Architecture documentation | `docs/architecture.md` + `submission-docs/` (PDF/HTML/MD) |

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment example and fill in the values:

   ```bash
   cp .env.example .env.local
   ```

   Required env vars (see `.env.example`):

   | Var | Used for |
   | --- | -------- |
   | `DATABASE_URL` | Direct Postgres connection (migrations via `psql`) |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (client + server) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser session) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role — server/admin paths only, never the browser |
    | `MERCURY_API_KEY` | Mercury (Inception Labs) for chat / structured output / evaluation (model `mercury-2.5`) |
    | `MERCURY_API_BASE_URL` | Optional, defaults to `https://api.inceptionlabs.ai/v1` |
    | `MERCURY_CHAT_MODEL` | Optional, defaults to `mercury-2.5` |
    | `GEMINI_API_KEY` | Google Gemini Embeddings API key (server-only, never client) — free tier at https://aistudio.google.com/apikey. `chunks.embedding` is `VECTOR(768)` per `db/schema/012_embeddings_gemini2_768.sql`. |
    | `GEMINI_EMBEDDING_MODEL` | Optional, defaults to `gemini-embedding-2` |
    | `GEMINI_EMBEDDING_DIM` | Optional, defaults to `768` (must match `chunks.embedding`) |
    | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest background jobs (material processing, mastery, recommendations) |
    | `INNGEST_DEV` | Set `=1` for local dev so missing Inngest keys fall back to direct processing instead of timing out |
   | `ADMIN_EMAILS`, `ADMIN_USER_IDS` | Prototype admin allow-list for `/admin/*` (comma-separated) |

3. Run the database migrations (`db/schema/README.md`): apply
   `db/schema/001_initial_schema.sql`, then `002_retrieve.sql`,
   then `003_storage.sql`, then `004_embeddings_384.sql`, then
   `005_conversation_summary.sql`, then `006_embeddings_gemini_768.sql`,
   then `007_practice.sql`, `008_practice_mcq.sql`,
   `009_practice_sections.sql`, `010_material_dedup.sql`,
   `011_material_file_size.sql`, then `012_embeddings_gemini2_768.sql`,
   `013_conversation_pinning.sql`, `014_concepts_dedupe.sql`
   in order via `npm run migrate` (recommended) or the
   Supabase SQL Editor, ensuring the `materials` Storage bucket exists (private).

4. Run the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) — `/` redirects to
   `/dashboard` when logged in, `/login` otherwise. For background jobs locally,
   run `npx inngest-cli dev` (or use Inngest Cloud pointed at `/api/inngest`).

## How to run tests

```bash
npm test        # vitest — 314 unit/integration tests across 26 files (mastery formula, ownership, tutor insufficient-evidence path, tutor conversation-summary continuity, quiz answer-gating, rate-limit windows, 401/404 mapping, admin system-health, evaluation run-tracking, profile, gemini-embedding-2 formatting + mocked error paths, migration ordering)
npm run eval    # tsx tests/eval/run-eval.ts — 18 evaluation fixtures, writes tests/eval/results.json + evaluation-results.json + per-run history in tests/eval/history/
npm run build   # production Next.js build (must compile clean)
npm run lint    # ESLint (must report no warnings)
npm run typecheck
```

Results feed `/admin/ai-evaluation`, which shows run metadata plus run-over-run
regression tracking (`IMPROVED` / `REGRESSED` / `UNCHANGED` / `BASELINE`).

## Project map

- `app/` — routes: `/` (session-aware redirect), `/login`, `/signup`, `/dashboard`,
  `/spaces`, `/spaces/[spaceId]`, `/profile`,
  `/projects/[projectId]` (project hub) + `{materials,tutor,quiz,mastery,growth,analytics,recommendations,flashcards,concepts}`,
  `/admin/{dashboard,users,spaces,projects,activity,engagement,learning,ai-usage,ai-evaluation,jobs,health}` (plus `/admin/users/[userId]` drill-down),
  plus thin API route handlers (`app/api/*` call `services/`, never the DB directly).
- `components/Sidebar.tsx` — shared sidebar shell (workspace / project / admin sections, mobile drawer).
- `services/` + `lib/` + `ai/` — service layer, RAG/Auth/DB helpers, and prompt+schema definitions per feature.
- `db/schema/` — SQL migrations + `match_chunks` pgvector RPC.

## Architecture summary

Next.js 14 App Router + TypeScript. Thin API routes (`app/api/*`) delegate to
`services/` (ownership via `WHERE id=$1 AND user_id=$2` + RLS); background work
(material processing, mastery, recommendations) runs on Inngest (`lib/jobs/`,
served at `/api/inngest`) with a direct-processing fallback for local dev.
Data/Auth/Storage live in one Supabase project (Postgres + pgvector + Auth +
private `materials` bucket). Retrieval is pgvector `match_chunks` scoped by
`project_id` with `RELEVANCE_THRESHOLD=0.25`. Runtime AI goes through
`lib/ai/AIService.ts`: chat/structured/evaluation use Mercury `mercury-2.5`;
 embeddings use Google
Gemini `gemini-embedding-2` (768 dims, `chunks.embedding VECTOR(768)`).

## Embedding-service setup

Embeddings use Google Gemini `gemini-embedding-2` (Free Tier eligible) — no Docker needed.
`gemini-embedding-2` is the current and only embedding model. Document and query
embeddings always use the same model and configuration (`outputDimensionality=768`,
documents as `title: ... | text: ...`, queries as `task: search result | query: ...`).

```bash
# .env.local (server-only, never exposed to the client)
GEMINI_API_KEY=your-key-from-https://aistudio.google.com/apikey
```

Vector dimension: **768**. `gemini-embedding-2` natively supports Matryoshka
truncation; 768 is a Google-recommended size that preserves the existing
`chunks.embedding VECTOR(768)` column (no resize needed), keeps storage and
vector-search cost low, and is verified live (`outputDimensionality=768`
returns 768 floats). `match_chunks(query_embedding vector(768), ...)` and the
`EMBEDDING_DIM` / `GEMINI_EMBEDDING_DIM` guards enforce it — never mix models
or dimensions in `chunks.embedding`.

Clean dataset (2026-09-18, video-ready): all learning and indexing data
(spaces, projects, materials, chunks, concepts, concept_mastery,
mastery_history, conversations, messages, quizzes, questions, answers,
recommendations, learning events, `ai_operations`, practice tables,
misconceptions, concept_edges) was deleted via a transactional reset and all
objects in the `materials` Storage bucket were removed — verified 0 rows in
every learning table. Schema, RLS policies, indexes, `match_chunks`, all 14
migrations, and `auth.users` were preserved. Fresh demo accounts
`demo.learner@aistudy.app` / `demo.admin@aistudy.app` (see Demo accounts
above) were created for recording. No old vectors were migrated or
re-embedded; the application starts from a clean dataset ready for fresh
materials.

New indexing flow: PDF → extract text → chunk (~2400 chars / 320 overlap) →
Gemini Embedding 2 (batched, 20 per request) → store vector → concept
extraction → READY. Statuses stay QUEUED → PROCESSING → READY / FAILED with
claim-guard idempotency and Inngest + inline fallback — no duplicate chunks or
duplicate embedding operations, READY materials are never auto-reprocessed.

Retrieval flow: question → Gemini Embedding 2 (same model/dim, cached 10 min
per normalized query) → pgvector `match_chunks` scoped by `project_id`
(`RELEVANCE_THRESHOLD=0.25`, default top-K 5, balanced across materials) →
grounded Tutor with citations, or the fixed insufficient-evidence response.
Manual check: `GET /api/projects/[projectId]/retrieve?q=...`.

Cost control: Gemini is called only for real embedding work (material
processing batches + uncached retrieval queries). No embeddings on page open,
dashboard loading, or for READY materials; no re-index of historical data
(`scripts/reindex-gemini-embeddings.ts` is a manual tool, not run as part of
this reset). Every embedding call logs provider, model, latency,
success/failure, request ID, and token/cost estimates to `ai_operations`
without ever logging the API key.

## Configuration examples

Copy `.env.example` to `.env.local` — it lists every required variable name
with empty values and inline comments (never commit real secrets; `.env.local`
is gitignored). `.env.example` is the canonical key list.

## Deployment information

**Status: live.** Production URL: https://ai-study-companion-three-inky.vercel.app/

Deployment architecture: Vercel (Next.js app) + Supabase (Postgres/pgvector,
Auth, Storage) + Inngest (background jobs) + Google Gemini embeddings.
Steps: import the repo in Vercel, set all `.env.example` keys
in Vercel + Inngest, run migrations `001`→`014` via `npm run migrate`
(or Supabase SQL Editor in order),
ensure the private `materials` bucket exists, sync `/api/inngest` in Inngest
Cloud, then smoke-test the full loop on the live URL (signup → space/project
→ PDF → READY → Tutor → quiz → mastery/growth/recommendations).

Production hardening already shipped (see `git log`): inline material
processing fallback + `maxDuration=60` so Vercel serverless never leaves
materials stuck in QUEUED when Inngest delivery fails, retry always
processes inline, Gemini 2 768-d embeddings with purge + reindex.

## Known limitations

Prototype scope (2–3 days) — honest short list:

- Mastery is a simple `0.7/0.3` weighted average; growth uses a fixed ±5
  threshold — explainable, not a full learning-science model.
- Admin auth is a prototype `ADMIN_EMAILS`/`ADMIN_USER_IDS` allow-list, no
  fine-grained RBAC.
- Evaluation is 18 curated fixtures + 158 unit/integration tests with
  file-based run tracking — no LLM-as-judge, no CI gating.
- Rate limiting is a single-instance cost guard; no response caching or token
  streaming; uploads validate type/size plus SHA-256 duplicate detection but have no per-user quota.
- Live at https://ai-study-companion-three-inky.vercel.app/ — demo video still pending.
