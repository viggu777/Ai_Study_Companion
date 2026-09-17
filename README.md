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
   | `ADMIN_EMAILS`, `ADMIN_USER_IDS` | Prototype admin allow-list for `/admin/*` (comma-separated) |

3. Run the database migrations (`db/schema/README.md`): apply
   `db/schema/001_initial_schema.sql` then `db/schema/002_retrieve.sql` via the
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
npm test        # vitest — 46 unit/integration tests (mastery formula, ownership, tutor insufficient-evidence path)
npm run eval    # tsx tests/eval/run-eval.ts — 18 evaluation fixtures, writes tests/eval/results.json + evaluation-results.json
npm run build   # production Next.js build (must compile clean)
npm run lint    # ESLint (must report no warnings)
npm run typecheck
```

Results feed `/admin/ai-evaluation`; the curated report is `docs/evaluation.md`.

## Project map

- `app/` — routes: `/` (session-aware redirect), `/login`, `/signup`, `/dashboard`,
  `/spaces`, `/projects/[projectId]/{materials,tutor,quiz,mastery,growth,analytics,recommendations}`,
  `/admin/*`, plus thin API route handlers (`app/api/*` call `services/`, never the DB directly).
- `components/Sidebar.tsx` — shared sidebar shell (workspace / project / admin sections, mobile drawer).
- `services/` + `lib/` + `ai/` — service layer, RAG/Auth/DB helpers, and prompt+schema definitions per feature.
- `db/schema/` — SQL migrations + `match_chunks` pgvector RPC.
- `docs/` — `architecture.md` (+ `.pdf`), `evaluation.md`, `ai-tools-usage.md` (+`.pdf`),
  `limitations.md`, `future-improvements.md`, `development-prompts/` (per-phase log), `build-prompts.md`.
