# AI Study Companion

A persistent, contextual, and measurable AI learning companion — not a PDF chatbot.
Organize learning into **Spaces → Projects**, upload **Materials** (PDFs), learn via a
**grounded Tutor** (citations, unsupported-question handling, prompt-injection defenses),
get tested via an **Adaptive Quiz** (MCQ + open-ended), and watch the system track
**Concept Mastery** over time to produce **Growth Analysis** and actionable
**Recommendations**. Every AI feature either produces evidence or acts on evidence —
the closed learning loop in `docs/architecture.md`.

**Live deployment:** not yet deployed — follow `docs/development-prompts/18-deployment.md`
(Vercel import + env vars + Inngest Cloud sync), then put the URL here.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment example and fill in the values:

   ```bash
   cp .env.example .env.local
   ```

   Required env vars (see `.env.example`, full list in `docs/architecture.md` §17):

   | Var | Used for |
   | --- | -------- |
   | `DATABASE_URL` | Direct Postgres connection (migrations via `psql`) |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (client + server) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser session) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role — server/admin paths only, never the browser |
    | `META_API_KEY` | Meta's Llama API for chat / structured output / evaluation — production path, used when `MERCURY_API_KEY` is unset (model `Llama-4-Maverick-17B-128E-Instruct-FP8`) |
    | `MERCURY_API_KEY` | Mercury (Inception Labs) for chat / structured output / evaluation — testing default (model `mercury-2.5`); unset it to switch back to Meta |
    | `MERCURY_API_BASE_URL` | Optional, defaults to `https://api.inceptionlabs.ai/v1` |
    | `MERCURY_CHAT_MODEL` | Optional, defaults to `mercury-2.5` |
   | `META_API_BASE_URL` | Optional, defaults to `https://api.llama.com/compat/v1` |
    | `GROQ_API_KEY` | Only for `EMBEDDING_PROVIDER=groq` fallback (768 dims, needs column re-migration). Default embeddings are local: `BAAI/bge-small-en-v1.5` (384 dims) via Docker — see `embeddings/README.md`. `chunks.embedding` is `VECTOR(384)` per `db/schema/004_embeddings_384.sql`. |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest background jobs (material processing, mastery, recommendations) |
   | `EMBEDDING_PROVIDER` | `local` (default, `BAAI/bge-small-en-v1.5` 384 dims via `embeddings/` Docker) or `groq` fallback |
   | `EMBEDDING_API_BASE_URL` | Optional, defaults to `http://localhost:8000/v1` |
   | `EMBEDDING_MODEL` | Optional, defaults to `BAAI/bge-small-en-v1.5` |
   | `INNGEST_DEV` | Set `=1` for local dev so missing Inngest keys fall back to direct processing instead of timing out |
   | `ADMIN_EMAILS`, `ADMIN_USER_IDS` | Prototype admin allow-list for `/admin/*` (comma-separated) |

3. Run the database migrations (`db/schema/README.md`): apply
   `db/schema/001_initial_schema.sql`, then `002_retrieve.sql`,
   then `003_storage.sql`, then `004_embeddings_384.sql`, then
   `005_conversation_summary.sql` in order via the
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
npm test        # vitest — 158 unit/integration tests across 10 files (mastery formula, ownership, tutor insufficient-evidence path, tutor conversation-summary continuity, quiz answer-gating, rate-limit windows, 401/404 mapping, admin system-health, evaluation run-tracking, profile)
npm run eval    # tsx tests/eval/run-eval.ts — 18 evaluation fixtures, writes tests/eval/results.json + evaluation-results.json + per-run history in tests/eval/history/
npm run build   # production Next.js build (must compile clean)
npm run lint    # ESLint (must report no warnings)
npm run typecheck
```

Results feed `/admin/ai-evaluation`, which shows run metadata plus run-over-run
regression tracking (`IMPROVED` / `REGRESSED` / `UNCHANGED` / `BASELINE`); the
curated report is `docs/evaluation.md`.

## Project map

- `app/` — routes: `/` (session-aware redirect), `/login`, `/signup`, `/dashboard`,
  `/spaces`, `/spaces/[spaceId]`, `/profile`,
  `/projects/[projectId]` (project hub) + `{materials,tutor,quiz,mastery,growth,analytics,recommendations,flashcards,concepts}`,
  `/admin/{dashboard,users,projects,activity,ai-usage,ai-evaluation,jobs,health}` (plus `/admin/users/[userId]` drill-down),
  plus thin API route handlers (`app/api/*` call `services/`, never the DB directly).
- `components/Sidebar.tsx` — shared sidebar shell (workspace / project / admin sections, mobile drawer).
- `services/` + `lib/` + `ai/` — service layer, RAG/Auth/DB helpers, and prompt+schema definitions per feature.
- `db/schema/` — SQL migrations + `match_chunks` pgvector RPC.
- `docs/` — `architecture.md` (+ `.pdf`), `evaluation.md`, `ai-tools-usage.md` (+`.pdf`),
  `limitations.md`, `future-improvements.md`, `development-prompts/` (per-phase log), `build-prompts.md`.

## Architecture summary

Next.js 14 App Router + TypeScript. Thin API routes (`app/api/*`) delegate to
`services/` (ownership via `WHERE id=$1 AND user_id=$2` + RLS); background work
(material processing, mastery, recommendations) runs on Inngest (`lib/jobs/`,
served at `/api/inngest`) with a direct-processing fallback for local dev.
Data/Auth/Storage live in one Supabase project (Postgres + pgvector + Auth +
private `materials` bucket). Retrieval is pgvector `match_chunks` scoped by
`project_id` with `RELEVANCE_THRESHOLD=0.25`. Runtime AI goes through
`lib/ai/AIService.ts`: chat/structured defaults to Mercury `mercury-2.5` with
Meta `Llama-4-Maverick-17B-128E-Instruct-FP8` fallback; embeddings default to
local `BAAI/bge-small-en-v1.5` (384 dims, `chunks.embedding VECTOR(384)`).
Full spec: `docs/architecture.md` (single source of truth).

## Embedding-service setup

Default embeddings are local — no API key needed:

```bash
cd embeddings
docker compose up -d --build
curl localhost:8000/health
# {"status":"ok","model":"BAAI/bge-small-en-v1.5","dimension":384}
```

Keep the defaults (`EMBEDDING_PROVIDER=local`,
`EMBEDDING_API_BASE_URL=http://localhost:8000/v1`,
`EMBEDDING_MODEL=BAAI/bge-small-en-v1.5`) and apply
`db/schema/004_embeddings_384.sql` so `chunks.embedding` stays `VECTOR(384)`.
Groq `nomic-embed-text-v1.5` (768 dims) is an explicit opt-in fallback only
(`EMBEDDING_PROVIDER=groq` + `GROQ_API_KEY`, plus a column re-migration).
Details: `embeddings/README.md`.

## Configuration examples

Copy `.env.example` to `.env.local` — it lists every required variable name
with empty values and inline comments (never commit real secrets; `.env.local`
is gitignored). Canonical key list lives in `docs/architecture.md` §17.

## Deployment information

**Status: not deployed.** No production URL, no Inngest Cloud sync, no demo
video — do not treat this snapshot as live.

Deployment architecture: Vercel (Next.js app) + Supabase (Postgres/pgvector,
Auth, Storage) + Inngest (background jobs) + local-embeddings Docker host (or
Groq fallback). Steps: import the repo in Vercel, set all `.env.example` keys
in Vercel + Inngest, run migrations `001`→`005` on the Supabase project,
ensure the private `materials` bucket exists, sync `/api/inngest` in Inngest
Cloud, then smoke-test the full loop on the live URL (signup → space/project
→ PDF → READY → Tutor → quiz → mastery/growth/recommendations). Full
checklist: `docs/development-prompts/18-deployment.md`; env reference:
`docs/architecture.md` §17.

## Known limitations

Prototype scope (2–3 days) — honest short list, full detail in
`docs/limitations.md`, roadmap in `docs/future-improvements.md`:

- Mastery is a simple `0.7/0.3` weighted average; growth uses a fixed ±5
  threshold — explainable, not a full learning-science model.
- Admin auth is a prototype `ADMIN_EMAILS`/`ADMIN_USER_IDS` allow-list, no
  fine-grained RBAC.
- Evaluation is 18 curated fixtures + 158 unit/integration tests with
  file-based run tracking — no LLM-as-judge, no CI gating.
- Rate limiting is a single-instance cost guard; no response caching or token
  streaming; uploads validate type/size but have no per-user quota.
- No live deployment yet (see above).
