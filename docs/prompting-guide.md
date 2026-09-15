# Prompting Guide — Generating Build Prompts for the Coding Agent

Purpose: feed this file + `architecture.md` to ChatGPT so it can generate well-scoped, correctly-ordered prompts for your coding agent (OpenCode). Each generated prompt should be small enough to implement and verify in one sitting, and should always restate the relevant constraints from `architecture.md` rather than assume the agent remembers earlier context.

## How to instruct ChatGPT

Give ChatGPT this brief instruction before asking for each prompt:

> "Using architecture.md as ground truth, write one implementation prompt for phase N below. The prompt must: (1) state exactly what to build, (2) name the files/services involved per the repo structure in architecture.md §5, (3) restate any security/ownership rules from §11 that apply, (4) specify the acceptance check — what a working result looks like, (5) NOT introduce technology or structure not already decided in architecture.md."

Ask for **one phase at a time**. Don't let ChatGPT generate all 19 prompts in one shot — you want to actually verify each phase works (or adjust) before generating the next prompt, especially since you're building in parallel with the agent.

## Phase → Prompt File Mapping

Build vertically, in this order. Do not start a phase until the previous one runs end-to-end.

| # | File | Phase | What "done" looks like |
|---|---|---|---|
| 01 | `01-architecture.md` | Project setup review | N/A — this doc itself |
| 02 | `02-project-setup.md` | Next.js + TS + Tailwind scaffold, repo structure per §5 | App boots locally, empty routes exist |
| 03 | `03-database.md` | Supabase Postgres schema + pgvector extension + RLS policies | Tables from §6 exist; RLS blocks cross-user reads in a manual test |
| 04 | `04-authentication.md` | Supabase Auth: signup/login/logout/session/protected routes | Can sign up, log in, hit a protected route, get 401 when logged out |
| 05 | `05-spaces-projects.md` | CRUD for Spaces & Projects, ownership-scoped queries | Creating/listing Spaces/Projects only ever shows the logged-in user's own data |
| 06 | `06-material-processing.md` | Upload → Storage → Inngest job → extract → chunk → embed → concepts → READY | Upload a PDF, watch status QUEUED→PROCESSING→READY, chunks exist with page numbers |
| 07 | `07-rag-retrieval.md` | pgvector similarity search scoped by project_id/user_id | A query returns top-K chunks from the right project only |
| 08 | `08-ai-tutor.md` | Grounded Tutor with structured output, citations, unsupported-question path, prompt-injection guard | Ask a grounded question → cited answer; ask an out-of-scope question → "insufficient evidence" response; upload a PDF containing an injection attempt → it's treated as data |
| 09 | `09-quiz.md` | Adaptive quiz generation (MCQ + open-ended), selection logic per §10 | Generating a quiz picks weak/recent-mistake concepts, not just random |
| 10 | `10-assessment.md` | Open-ended answer evaluation, structured grading output | Submitting an open-ended answer returns score + strengths + missing concepts |
| 11 | `11-mastery.md` | Deterministic mastery formula, `mastery_history` writes | Completing a quiz updates mastery via the formula, not the LLM directly |
| 12 | `12-recommendations.md` | Recommendation generation from weak concepts + history | Recommendation card is specific/actionable, not "keep studying" |
| 13 | `13-analytics.md` | Project + global analytics aggregation | Dashboards show real numbers computed from `learning_events`/`answers`/`concept_mastery` |
| 14 | `14-admin.md` | Admin dashboard: users, projects, activity, AI usage, evaluation, job health | Admin can drill User → Projects → Activity → Mastery → AI Usage |
| 15 | `15-observability.md` | `ai_operations` logging wired into every AIService call | Every Tutor/quiz/assessment/recommendation call produces one row with latency/tokens/cost |
| 16 | `16-testing.md` | Unit tests for mastery formula + ownership checks; integration test for unsupported-question path | Tests pass locally |
| 17 | `17-debugging.md` | (as-needed, not pre-written) | N/A |
| 18 | `18-deployment.md` | Vercel + Supabase + Inngest wiring, env vars, `.env.example` | Deployed URL works end-to-end |
| 19 | `19-documentation.md` | README, architecture PDF export, AI usage doc, evaluation doc | All 6 final submission artifacts exist |

## Rules for prompt generation (give these to ChatGPT verbatim)

1. Every prompt for phases 04–15 must explicitly mention: "never trust projectId/materialId/userId from the client — resolve and validate ownership server-side" (architecture.md §11).
2. Every prompt touching AI output (08, 09, 10, 12) must require a structured JSON schema and server-side validation before persistence — no raw LLM text saved to the DB.
3. Every prompt must name which file(s) under `services/`, `ai/`, `lib/`, or `app/` it creates or edits, matching the structure in architecture.md §5.
4. Keep each prompt scoped to one phase. If a phase feels too big for one prompt, ask ChatGPT to split it into sub-prompts (e.g. 06a-upload, 06b-processing-job) rather than writing a vague, oversized prompt.
5. After the agent implements a phase, save the actual prompt used (not a cleaned-up version) into `docs/development-prompts/NN-name.md` using this template:

```
# Prompt
<actual prompt sent to the agent>

# Purpose
<why this prompt was needed>

# Result
<what it produced>

# Changes Made
<what you actually kept/modified>

# Notes
<decisions, deviations from architecture.md, gotchas>
```

## Time budget reminder (2–3 days)

- Day 1: phases 02–07 (setup through working RAG retrieval).
- Day 2: phases 08–13 (Tutor through analytics) — this is the core grading surface, protect this time.
- Day 3: phases 14–19 (admin, observability, tests, deploy, docs) — cut scope here first if behind, not on Day 2.

If you must cut something under time pressure, cut in this order: Admin polish → Global analytics detail → Evaluation breadth → Observability detail. Never cut: grounded citations, unsupported-question handling, ownership/security checks, or the mastery→growth→recommendation chain — these are the parts of the PRD that distinguish this product from a generic RAG chatbot.
