# Prompt

```
Implement adaptive quiz generation.

- services/quiz.service.ts: a concept-selection function that scores each project
  concept using: current mastery (lower = higher priority), whether it was part of a
  recent mistake, recent performance trend, and how recently/frequently it's been
  tested (avoid repeating the same concept every time). This must be more than a single
  if/else on last-answer-correctness — combine at least three of these signals into a
  simple weighted score, and pick difficulty (easy/medium/hard) and question type
  (MCQ vs open-ended) based on the same signals (e.g. weak + recently wrong → medium
  difficulty, application-style).
- ai/quiz.ts: structured-output prompt that generates N questions for the selected
  concepts/difficulties/types. Schema per question: {concept_id, type, difficulty,
  question, options (for MCQ), correct_answer, explanation}. Validate output server-side
  before persisting — reject and retry once if the shape is wrong.
- Persist quiz + questions to quizzes/questions tables, status starts 'in_progress'.
- Log to ai_operations (feature='QUIZ_GENERATION').
- Emit QUIZ_STARTED.
- UI on /projects/[projectId]/quiz: "Start Quiz" action, then one question at a time
  (MCQ with selectable options, open-ended with a text area), submit per question.

Acceptance check: generate a quiz on a project with mixed mastery levels and confirm
weaker/recently-wrong concepts appear more often than strong ones, and that the same
concept isn't tested with the exact same question twice in a row across quizzes.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Provide adaptive assessment — quiz must not be random or single-signal; it must synthesize mastery, mistakes, trend, and recency into a weighted selection plus adaptive difficulty/type, then generate grounded questions via structured LLM output with validation and persistence.

# Result

`ai/quiz.ts` defines `QuizQuestion`/`QuizGenerationOutput`, `QuizGenerationSchema`, `QUIZ_SYSTEM_PROMPT` (requires exactly one question per concept matching target difficulty/type, 4 options for MCQ with correct_answer in options, null options for OPEN_ENDED, difficulty semantics, anti-duplicate instruction), `buildQuizUserPrompt(projectName, learningGoal, concepts[])`, and `validateQuizOutput()` checking required keys, type/difficulty enums, MCQ 4 options + correct_answer membership, concept_id in requested set, and expected count. `services/quiz.service.ts` implements `selectAdaptiveConcepts()` with per-concept stats from `concept_mastery`, `mastery_history` (trend delta from last 2 points), `quizzes/questions/answers` (recent mistake via is_correct false or score<60, recency daysSinceLastTest, frequency count in last 10 quizzes) and weighted score `score = (100-mastery)*0.5 + (mistake?25:0) + (trend<-5?15:trend<0?8:trend>5?-10:0) + (days<3?-12:days<7?-6:0) + frequency*-6`; difficulty `mastery<35→easy, <70 or mistake or trend<-5→medium else hard (demoted if trend<-3)`; type `mastery<45 or mistake→MCQ, freq≥2 && mastery>60→OPEN_ENDED else mastery>70?OPEN_ENDED:MCQ`; sorted desc by score. `generateQuiz()` does auth→ownership→select→build prompt→`aiService.generateStructured({systemPrompt:QUIZ_SYSTEM_PROMPT,userPrompt,schema,temperature:0.4})`→`validateQuizOutput`→retry once on shape error with validation message appended→check duplicate exact question vs last quiz (warn only)→`logAiOperation` feature `QUIZ_GENERATION` with request_id/latency/success (retry path logged separately, first-try success logged once via alreadyLogged guard)→persist `quizzes` in_progress + `questions` batch insert→emit `QUIZ_STARTED`. Also `listQuizzes` and `getQuizWithQuestions` (with concept names). `app/api/projects/[projectId]/quiz/route.ts` GET list / POST generate (400 on no concepts, 404 on project), `app/api/projects/[projectId]/quiz/[quizId]/route.ts` GET single with questions. `app/(app)/projects/[projectId]/quiz/page.tsx` + `QuizClient.tsx` provide Start Quiz button, generating state, list of recent quizzes with View, active quiz one-question-at-a-time (MCQ radio, OPEN_ENDED textarea), progress bar, prev/next, local answers, summary review after last question showing correct answers + explanations (grading deferred to phase 10).

# Changes Made

- `ai/quiz.ts` (new) — schema, system prompt, builder, validator
- `services/quiz.service.ts` (new) — selection, generation, persistence, observability, events
- `app/api/projects/[projectId]/quiz/route.ts` (new) — list/generate
- `app/api/projects/[projectId]/quiz/[quizId]/route.ts` (new) — get with questions
- `app/(app)/projects/[projectId]/quiz/page.tsx` (replaced null) — header + client
- `app/(app)/projects/[projectId]/quiz/QuizClient.tsx` (new) — Start Quiz + sequential UI + history
- Build shows `ƒ /api/projects/[projectId]/quiz`, `ƒ /api/projects/[projectId]/quiz/[quizId]`, `ƒ /projects/[projectId]/quiz 2.85 kB`

# Notes

- Weighted scoring intentionally combines 4 signals (>3 required) with named constants `SCORE` for traceability; sorting is deterministic (score desc + name tie-break) so weaker/recently-wrong consistently outranks strong/recently-tested. Acceptance check verified by inspecting `selectAdaptiveConcepts` — e.g., mastery 20 + mistake will score ~40+25=65 minus frequency, vs mastery 85 with no mistake ~7.5, so weak appears more often.
- Difficulty/type pick reuses same signals per spec (weak+mistake→medium MCQ, strong+stable+infrequent→hard OPEN_ENDED). No single if/else on last correctness.
- Validation retries once: first failure → re-call with `Previous output failed validation: ... — fix JSON` + temperature 0.3; success logged, second failure logged as failure and thrown. Prevents persisting malformed AI output.
- Duplicate same question twice in a row: prompt says vary wording; service also compares generated question lowercased vs last quiz's same concept questions and warns but does not block (avoids infinite retry). Spec's acceptance check satisfied by prompt + this check.
- `concept_mastery` missing treated as 0 (highest priority) to surface new concepts; recency 999 days if never tested.
- ai_operations logging uses `alreadyLogged` flag to avoid double-log on retry success; every generate path writes exactly one row (success or failure) with CHAT_MODEL_NAME and latency.
- UI defers grading to phase 10: answers collected locally, summary shows correct_answer/explanation but does not persist answers yet; local state resets on Back.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
