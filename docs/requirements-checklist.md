# Requirements Verification Checklist (Task 7 — 2026-09-17)

## Requirements source

There is no standalone `PRD.md` in this repo. The requirement baseline is
`docs/architecture.md` §19 MUST list + `docs/build-prompts.md` phases + the
explicit Task 7 areas. Every verdict below cites the implementation file, not
documentation claims.

## How it was verified

- `npm test` — 10 files / 158 tests, all pass.
- `npm run eval` — 18/18 fixtures pass (`eval-20260917-181106-kzbyca`).
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
- Live probes against the real Supabase project + local embeddings Docker +
  working chat provider, all with self-cleaning test users (no leftovers):
  - `scripts/smoke-live.ts` — 27/27 PASS (auth, profile, spaces/projects CRUD,
    validation 400s, cross-user 404s, delete 404s, page content).
  - `scripts/smoke-deep.ts` — 6/6 PASS (upload 202 → READY with real extraction /
    embeddings / concepts → grounded Tutor with citation → quiz 201).
  - Ad-hoc chain probe (`/tmp`, not committed): unsupported question → fixed
    insufficient response; full quiz completion (8 answers) → 8 `concept_mastery`
    rows + `mastery_history` → 1 recommendation → growth page 200 → project
    analytics API 200.
  - `ai_operations` audit for today: `TUTOR` 12, `EMBEDDING` 22,
    `CONCEPT_EXTRACTION` 5, `QUIZ_GENERATION` 5, `RECOMMENDATION` 4,
    `FLASHCARD_GENERATION` 4, `SUBCONCEPT_GENERATION` 12 — every exercised AI
    call wrote exactly one row.

## Core learning loop

| Requirement | Verdict | Implementation / evidence |
|---|---|---|
| Authentication | PASS | Supabase Auth; `middleware.ts` guard; `lib/auth/getCurrentUser.ts` (`requireUserId` → 401 for routes, redirect for pages); live: signup/signin/logout/profile all PASS |
| Spaces | PASS | `services/project.service.ts:listSpaces/getSpace`; `/spaces` pages; live 201/400/404 checks PASS |
| Projects | PASS | Same service + `/projects/[projectId]` hub (Task 6 loop strip); live 201 + cross-user 404 PASS |
| PDF upload | PASS | `services/material.service.ts:uploadMaterial` (PDF/10 MB/`%PDF` validation, 202, `QUEUED`); live upload → READY PASS |
| Background processing | PASS | Inngest `lib/jobs/*` + direct `setTimeout` fallback; live log proves fallback path processed to READY when Inngest unreachable |
| Knowledge extraction/retrieval | PASS | Concepts extracted live (quiz generation depends on them); `lib/rag/retrieve.ts` project-scoped + `RELEVANCE_THRESHOLD=0.25`; cross-project isolation live + `RET-05` |
| Tutor | PASS | `services/tutor.service.ts:askTutor` (window 6 + rolling summary + evidence); live grounded answer with citation PASS |
| Grounded citations | PASS | 4-field citations validated (`ai/tutor.ts:validateTutorResponse`); Sources panel + `/api/chunks/[chunkId]` excerpts |
| Unsupported questions | PASS | `persistInsufficient` fixed response, no LLM call, no `ai_operations` row by design; live insufficient check PASS; `TUTOR-02` + integration tests |
| Adaptive quiz | PASS | Weighted concept/difficulty selection (`services/quiz.service.ts`); live 8-question generation 201; answer-gating tests (`tests/unit/quiz-gating.test.ts`) |
| Open-ended assessment | PASS | `ai/assessment.ts:validateAssessmentOutput`; `submitAnswer` grading path; `ASSESS-01..03` fixtures. Note: live quizzes generated all-MCQ this session, so live LLM grading was not exercised — covered by fixtures + code review |
| Mastery | PASS | `new = prev×0.7 + evidence×0.3` (`services/mastery.service.ts`); 18+ unit cases; live: 8 `concept_mastery` rows after quiz completion |
| Growth | PASS | `classifyTrend` ±5 (`services/growth.service.ts`); live `mastery_history` rows + growth page 200 |
| Recommendations | PASS | `services/recommendation.service.ts` (weak = `REQUIRES_ATTENTION` or <60, anti-generic rubric); `REC-01/02` fixtures; live: 1 recommendation generated after weak quiz |
| Analytics | PASS | `services/analytics.service.ts` project + global; live project-analytics API 200; Task 1 dashboard |
| Continue learning | PASS | `services/dashboard.service.ts` + `/dashboard` (Continue Learning / attention / next action, Task 1) |

## Engineering

| Requirement | Verdict | Implementation / evidence |
|---|---|---|
| Project isolation | PASS | `WHERE id=$1 AND user_id=$2` + RLS; live: 6 cross-user 404 conflation checks PASS |
| Authentication/authorization | PASS | 401 unauthenticated (live), 404 not-owned (live), `requireAdmin` gate for `/admin` |
| Input validation | PASS | Trim/length/type checks; live 400s (malformed JSON, empty name/question) PASS |
| Secure APIs | PASS | Thin routes → `services/`; service role server-side only; no keys in browser |
| Prompt-injection defense | PASS | `<retrieved_evidence>` untrusted-data block; `TUTOR-05` + `tutor-insufficient.test.ts` containment |
| Structured AI output validation | PASS | Validators per feature (`ai/*.ts`); invalid output rejected/logged, never persisted raw |
| AI observability | PASS | One `ai_operations` row per call incl. failures; per-feature counts verified live today |
| Evaluation | PASS | 18/18 + `runId` history + Admin `IMPROVED`/`REGRESSED`/`UNCHANGED`/`BASELINE` (Task 4) |
| Error handling | PASS | `FAILED + processing_error` (proven live by a corrupt-PDF probe), LLM fallbacks, `429 + Retry-After`, `502` evaluation-failed |
| Idempotency | PASS | Partial unique index on `learning_events`; answer re-POST returns existing; quiz <2 min guard; stale-chunk delete |
| Background jobs | PASS | `material-processing, mastery-update, recommendation-generate` + fallbacks; `/admin/jobs` |
| Testing | PASS | 158 unit/integration + 18 fixtures + 2 live smoke scripts |

## Admin

| Requirement | Verdict | Implementation / evidence |
|---|---|---|
| Users | PASS | `listAdminUsers` + `/admin/users` |
| Spaces/Projects | PASS | `listAdminSpaces` + `/admin/spaces` and `/admin/projects` filterable lists |
| Activity | PASS | `listAdminActivity` + `/admin/activity` event feed |
| Engagement | OUT OF SCOPE | Deliberately not built: per-user engagement (signups, DAU, retention) needs an analytics pipeline beyond prototype scope; the underlying data is reachable via `/admin/activity` event feed + `/admin/dashboard` counts + per-user drill-down |
| Analytics | PASS | `/admin/dashboard` counts + `/admin/ai-usage` per-feature aggregates |
| AI usage | PASS | `getAdminAiUsage` over `ai_operations` |
| AI evaluation | PASS | Run metadata + comparison + case table (Task 4) |
| Background jobs | PASS | `getAdminJobHealth` + `/admin/jobs` |
| System health | PASS | `getAdminSystemHealth` + `/admin/health` (Task 2) |
| User drill-down | PASS | `getAdminUserDetail` + `/admin/users/[userId]` |

## Documentation / submission readiness

| Requirement | Verdict | Implementation / evidence |
|---|---|---|
| README | PASS | Overview, setup, env table, test/eval commands, routes, not-deployed notice (Task 5) |
| Architecture documentation | PASS | Reconciled §§4–6, 12–15, 17–18 + regenerated `architecture.pdf` (Task 5) |
| AI usage documentation | PASS | Build-vs-runtime split; Mercury/Meta + local-384 providers; 9 features + `ai-tools-usage.pdf` (Task 5) |
| Development prompts | PASS | `01–19` complete (`01` + `17` are intentional no-prompt placeholders per prompting-guide) + dated as-built notes + regenerated `development-prompts.pdf` (Task 5) |
| Evaluation documentation | PASS | Latest run + run-tracking section; `tests/eval/history/` (Task 4/5) |
| Limitations | PASS | Honest 11-item list incl. PARTIALs from this checklist (Task 5) |
| Future improvements | PASS | 7 FUTURE items + recently-implemented note (Task 5) |

## Issues found and fixed during this verification

1. `scripts/smoke-deep.ts` used a hand-made minimal PDF that this `pdf-parse`
   build rejects (`bad XRef entry` — confirmed pdf-parse parses real PDFs fine,
   so fixture, not app). Switched to the real `node_modules/pdf-parse/test/data/01-valid.pdf`
   fixture with a matching Tutor question.
2. `scripts/smoke-deep.ts` expected lowercase statuses and a flat `{id}` quiz
   shape; the API uses UPPERCASE statuses and `{quiz:{id}}`. Fixed expectations
   (script-only change). Result: 6/6 PASS live.
3. Chain probe initially showed 0 recommendations 8 s after quiz completion —
   root cause was probe timing (recommendation needs a full LLM call), not the
   app; polling confirmed `n=1`. No app change.

## Known PARTIALs (honest, not fixed — out of scope, no new features in Task 7)

- Admin has no dedicated Engagement page (explicitly out of scope — see Admin table).
- Live open-ended LLM grading not exercised this session (all generated quiz
  questions were MCQ); path verified via fixtures + code.
- No live deployment (explicitly excluded from Tasks 1–8).
