# Prompt

```
Implement deterministic mastery updates triggered by QUIZ_COMPLETED.

- services/mastery.service.ts: on QUIZ_COMPLETED (handled in an Inngest function, not
  inline in the request), for each concept touched by the quiz, compute:
    new_mastery = previous_mastery * 0.7 + latest_evidence_score * 0.3
  where latest_evidence_score aggregates that quiz's evidence for the concept (MCQ
  correctness as 0/100, open-ended score as-is; average if multiple questions touched
  the same concept). This calculation must be plain backend code — the LLM must not
  directly set a mastery number.
- Upsert concept_mastery (mastery_score, evidence jsonb summarizing what evidence fed
  the score), and insert a mastery_history row (previous_score, new_score, reason).
- Emit MASTERY_UPDATED per concept changed.
- Do this as its own Inngest step function chained after QUIZ_COMPLETED (per the
  "Learning Workflow" in architecture.md §13) so it's retryable independently of the
  quiz-submission request.

Acceptance check: complete a quiz touching 2+ concepts, confirm concept_mastery updates
using the exact formula above (verify the math by hand on one example), and confirm a
mastery_history row was written for each concept changed.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Turn per-question evidence from a completed quiz into deterministic, explainable mastery scores that power Growth and Recommendations — keeping the LLM as evidence producer only.

# Result

`services/mastery.service.ts` exports `computeNewMastery(previous, evidence)` → `round(clamp(previous*0.7+evidence*0.3,0,100),2)` and `updateMasteryForQuiz({quizId,projectId,userId,spaceId})` which: groups questions by `concept_id`, collects scores per question (`score` if present else `is_correct?100:0`), averages per concept to get `latest_evidence_score`, loads `concept_mastery` previous (0 if missing), idempotency checks (`mastery_history reason ilike %quizId%` and `concept_mastery.evidence.quiz_id === quizId`) to skip re-apply, computes `newScore = previous*0.7+evidence*0.3`, upserts `concept_mastery` with `evidence` JSON `{quiz_id, concept_id, previous_score, new_score, evidence_score, question_count, question_ids, question_scores, computed_at}`, inserts `mastery_history {concept_id,user_id,previous_score,new_score,reason:"quiz:${quizId} evidence:${evidence} questions:${n}"}`, emits `MASTERY_UPDATED` (`entity_type concept`, `entity_id conceptId`, metadata quiz/prev/new/evidence) via `getServiceDb()` so it works outside request context. Uses `getServiceDb()` intentionally (background job has no cookies, must bypass RLS via service role).

`lib/jobs/mastery.ts` defines `masteryUpdateFunction` (`id: mastery-update`, `trigger: quiz/completed`) with `step.run("update-mastery", () => import mastery.service updateMasteryForQuiz)` — retryable independently per architecture §13 Learning Workflow chain `Quiz Completed → Evaluate → Update Mastery → Detect Weakness → Generate Recommendation`.

`services/quiz.service.ts` updated: imports `inngest`, and `tryCompleteQuizIfNeeded` after emitting `QUIZ_COMPLETED` now sends `inngest.send({name:"quiz/completed", data:{quizId,projectId,userId,spaceId}})`; on send failure falls back to `setTimeout 100ms → import mastery.service updateMasteryForQuiz` (mirrors `material/uploaded` fallback for local dev without Inngest cloud).

`app/api/inngest/route.ts` now serves `[...materialFunctions, ...masteryFunctions]` so both `material/uploaded` and `quiz/completed` workflows are registered.

Build `✓` `typecheck` 0 `lint` ✔; manual check: quiz with 2 concepts (MCQ correct=100, open-ended 60) → concept A previous 50 evidence 100 new 65 (`50*0.7+100*0.3`), concept B previous 20 evidence 60 new 32 (`20*0.7+60*0.3`), `concept_mastery` upserted and `mastery_history` row per concept, `learning_events MASTERY_UPDATED` emitted; duplicate `quiz/completed` replays skip via idempotency.

# Changes Made

- `services/mastery.service.ts` (new) — deterministic formula, aggregation, upsert, history, events, idempotency
- `lib/jobs/mastery.ts` (new) — Inngest step function `mastery-update` triggered by `quiz/completed`
- `services/quiz.service.ts` (modified) — `import { inngest }`, `tryCompleteQuizIfNeeded` chains `inngest.send("quiz/completed")` + fallback direct update
- `app/api/inngest/route.ts` (modified) — merges `materialFunctions` + `masteryFunctions`

# Notes

- LLM never writes mastery: `services/mastery.service.ts:7` `computeNewMastery` is pure math; evidence comes only from `answers.score/is_correct` persisted by `submitAnswer()` (MCQ deterministic, open-ended validated `0-100`). Architecture §10 rule `LLM never directly writes mastery scores` satisfied.
- Aggregation: MCQ `correct →100 else 0`, open-ended uses `score` as-is; if quiz tests same concept twice, evidence is arithmetic mean of that concept's question scores in this quiz. Example verified: previous 50, MCQ 100 → 65; previous 0, `100 →30`.
- Idempotency two layers: (1) `learning_events uq_learning_events_idempotency` prevents duplicate `QUIZ_COMPLETED`; (2) mastery layer checks `mastery_history reason LIKE %quizId%` and `concept_mastery.evidence.quiz_id` before recomputing, plus handles concurrent upsert race — ensures replaying the Inngest function does not double-apply `0.7/0.3`.
- Uses `getServiceDb()` not `getDb()` because Inngest has no request cookies; `updateMasteryForQuiz` is background-only and bypasses RLS via `SUPABASE_SERVICE_ROLE_KEY` (same pattern as `processMaterial`).
- Inngest chaining is explicit per §13: `quiz.service` emits `QUIZ_COMPLETED` (for activity feed) and `quiz/completed` (for jobs); `mastery-update` is a separate function retryable independently of the HTTP request.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
