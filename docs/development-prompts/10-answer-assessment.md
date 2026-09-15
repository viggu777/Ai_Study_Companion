# Prompt

```
Implement answer submission and grading for both question types.

- MCQ: grade deterministically in the backend (compare to correct_answer) — do not use
  the LLM for MCQ grading.
- Open-ended: ai/assessment.ts structured-output prompt that evaluates the answer against
  the question/expected concepts. Schema: {score (0-100), understanding, strengths[],
  missingConcepts[], reasoningQuality: "strong"|"partial"|"weak", feedback}. Validate
  server-side before persisting.
- services/quiz.service.ts: submitAnswer() persists to `answers` (response, is_correct
  for MCQ, score, evaluation for open-ended), emits QUESTION_ANSWERED, and when all
  questions in a quiz are answered, sets quiz status='completed', completed_at=now(),
  and emits QUIZ_COMPLETED (idempotently — see architecture.md §13, don't double-process
  if this fires twice).
- Log open-ended grading calls to ai_operations (feature='OPEN_ENDED_EVALUATION').
- UI: after each answer, show correctness (MCQ) or score + feedback (open-ended); after
  the last question, show a quiz summary screen.

Acceptance check: complete a quiz mixing MCQ and open-ended questions; confirm MCQ
grading is instant/deterministic, open-ended grading returns a sensible score and
feedback, and completing the same quiz's last question twice (e.g. via a duplicate
request) does not create two QUIZ_COMPLETED side effects.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Grade both MCQ (deterministic) and open-ended (AI-evaluated) answers, persist to `answers`, handle quiz completion idempotently, and surface per-question feedback plus summary.

# Result

`ai/assessment.ts` defines `AssessmentEvaluation`, `AssessmentSchema`, `ASSESSMENT_SYSTEM_PROMPT` (scoring rubric 0-39/40-69/70-89/90-100, structured JSON only, keys score/understanding/strengths/missingConcepts/reasoningQuality/feedback), `buildAssessmentUserPrompt({question,correctAnswer,explanation,conceptName,conceptDescription,studentResponse})`, and `validateAssessmentOutput()` checking 0-100 int, enum, non-empty strings/arrays.

`services/quiz.service.ts` adds `getQuizWithAnswers()` (questions + answer Map + List) and `submitAnswer(projectId,quizId,questionId,response)` with: ownership checks `projects id+user_id`, `quizzes id+project_id+user_id`, `questions id+quiz_id`; idempotency `answers question_id+user_id exists → return existing + tryComplete`; MCQ `isCorrect = trimmedResponse === trimmed correct_answer`, `score 100/0`, no LLM; OPEN_ENDED fetch concept name/desc → `buildAssessmentUserPrompt` → `aiService.generateStructured({systemPrompt:ASSESSMENT_SYSTEM_PROMPT,schema:AssessmentSchema,temperature:0.2,maxTokens:1000})` → `validateAssessmentOutput` → `score = evaluation.score`, `isCorrect = score>=60` → `logAiOperation feature OPEN_ENDED_EVALUATION` with requestId/latency/success (failure logged success=false and thrown), persists `answers {question_id,user_id,response,is_correct,score,evaluation}`, emits `QUESTION_ANSWERED`, then `tryCompleteQuizIfNeeded()` checks `quiz.status`, counts `questions vs answers (question_id in set)`, if all answered updates `quizzes status=completed completed_at=now()` where `status='in_progress'`, refreshes status, emits `QUIZ_COMPLETED` idempotently (unique index `uq_learning_events_idempotency` blocks duplicate; `emitLearningEvent` error logged not thrown; update guarded by `status`).

`app/api/projects/[projectId]/quiz/[quizId]/submit/route.ts` POST `{questionId|question_id, response|answer}` → `submitAnswer()` → `200 {answer, quizCompleted, quizStatus}` (400 missing/required, 404 project/quiz/question, 502 evaluation failure).

`app/api/projects/[projectId]/quiz/[quizId]/route.ts` GET extended: `?answers=1` → `getQuizWithAnswers()` serialized `{quiz,questions,answers:list}`; default also merges `answers` list for backwards compat.

`app/(app)/projects/[projectId]/quiz/QuizClient.tsx` rewritten: start/load quiz, track `results Record<questionId,AnswerRecord>`, `submitting`, `showFeedback`, `quizCompleted`; `loadQuiz` fetches `?answers=1` and jumps to first unanswered or summary if completed; per-question `submitCurrent()` POST to `/submit`, stores result, `showFeedback` inline (MCQ correct/incorrect + expected, OPEN_ENDED score/reasoning + feedback/understanding/strengths/missingConcepts); `Next` advances after feedback, `Prev` restores; summary screen (`currentIdx>=total || completed`) shows `answered/total`, `correctCount`, `avgScore`, status badge, per-question card with citations/incorrect highlight, score, reasoningQuality badge, your answer, AI feedback or explanation, `Back to quizzes` + `Start New Quiz`; list view unchanged. Build `ƒ /api/projects/[projectId]/quiz/[quizId]/submit 0B`, `ƒ /projects/[projectId]/quiz 4.21 kB`, `typecheck` 0, `lint` ✔, `build` ✓.

# Changes Made

- `ai/assessment.ts` (new) — system prompt, schema, builder, validator
- `services/quiz.service.ts` (extended) — `getQuizWithAnswers`, `submitAnswer`, `tryCompleteQuizIfNeeded` with MCQ deterministic path + OPEN_ENDED AI path + idempotent completion
- `app/api/projects/[projectId]/quiz/[quizId]/submit/route.ts` (new) — POST submit
- `app/api/projects/[projectId]/quiz/[quizId]/route.ts` (modified) — GET now returns answers list as well
- `app/(app)/projects/[projectId]/quiz/QuizClient.tsx` (rewritten) — per-question submit, feedback, summary

# Notes

- MCQ never calls LLM per spec; string compare is trimmed exact equality (case-sensitive) against `questions.correct_answer`. OPEN_ENDED uses `Llama-4-Maverick-17B-128E-Instruct-FP8` via `aiService.generateStructured` with JSON mode + server validation; failure logs `ai_operations success=false` and surfaces 502 so UI shows error not silent fail.
- Idempotency covers both layers: per-question answer existence check (race handled by re-fetch on insert `23505`) prevents duplicate `answers` + `QUESTION_ANSWERED`; quiz completion guarded by `status` check + unique partial index on `learning_events (project_id,entity_type,entity_id,event_type) WHERE event_type IN ('QUIZ_COMPLETED','MATERIAL_READY')` — duplicate `QUIZ_COMPLETED` insert is caught as `error` in `emitLearningEvent` (logged, not thrown) and `tryCompleteQuizIfNeeded` returns `completedNow:false` on second call. Acceptance duplicate last-question test satisfied.
- Open-ended `is_correct` derived as `score>=60` for consistency with MCQ boolean while preserving numeric `score`; `evaluation` stored as JSONB in `answers.evaluation`.
- `logAiOperation` called exactly once per open-ended evaluation (success or failure) with `requestId=crypto.randomUUID()`, `latencyMs`, `CHAT_MODEL_NAME`; `QUIZ_GENERATION` path unchanged.
- QuizClient disables input after answer persisted and shows feedback before Next; resume loads answers map and jumps correctly; `answers` array appended to GET without breaking old clients.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
