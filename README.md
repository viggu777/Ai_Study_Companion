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
npm test        # vitest — 270 unit/integration tests across 21 files (mastery formula, ownership, tutor insufficient-evidence path, tutor conversation-summary continuity, quiz answer-gating, rate-limit windows, 401/404 mapping, admin system-health, evaluation run-tracking, profile, gemini-embedding-2 formatting, migration ordering)
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

Embeddings use Google Gemini (Free Tier eligible) — no Docker needed:

```bash
# .env.local
GEMINI_API_KEY=your-key-from-https://aistudio.google.com/apikey
```

Apply `db/schema/012_embeddings_gemini2_768.sql` so `chunks.embedding` stays
`VECTOR(768)` in the Gemini 2 embedding space. Old gemini-embedding-001
(768d) / bge-small (384d) / nomic (768d) rows are purged by the
migration — press Retry on FAILED materials or run
`npx tsx scripts/reindex-gemini-embeddings.ts` to re-embed.

## Configuration examples

Copy `.env.example` to `.env.local` — it lists every required variable name
with empty values and inline comments (never commit real secrets; `.env.local`
is gitignored). `.env.example` is the canonical key list.

## Deployment information

**Status: live.** Production URL: https://ai-study-companion-three-inky.vercel.app/

Deployment architecture: Vercel (Next.js app) + Supabase (Postgres/pgvector,
Auth, Storage) + Inngest (background jobs) + Google Gemini embeddings.
Steps: import the repo in Vercel, set all `.env.example` keys
in Vercel + Inngest, run migrations `001`→`010` via `npm run migrate`
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
