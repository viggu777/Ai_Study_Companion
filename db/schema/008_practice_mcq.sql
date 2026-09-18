-- 008 Practice MCQ support (mixed MCQ + open-ended assignments)
-- Run after 007_practice.sql. Additive only — existing open-ended rows keep
-- working (question_type defaults to OPEN_ENDED, new columns stay NULL).
--
-- Design notes:
-- - question_type mirrors quiz questions (MCQ | OPEN_ENDED) so practice can
--   mix quick checks (MCQ, graded deterministically without an LLM call) with
--   deep open-ended work (graded via PRACTICE_EVALUATION).
-- - options holds exactly 4 strings for MCQ (shuffled server-side at insert,
--   same pattern as quiz), NULL for OPEN_ENDED.
-- - correct_answer must match one of options for MCQ, NULL for OPEN_ENDED.
-- - explanation is the MCQ "why correct" text, NULL for OPEN_ENDED.
-- - reference_answer (added in 007) stays the OPEN_ENDED strong-answer guide,
--   NULL for MCQ.
-- - Gating mirrors quiz: options are safe to show pre-answer, but
--   correct_answer/explanation/reference_answer are disclosed only after the
--   learner's response is graded (see practice.service strip/gate helpers).

ALTER TABLE practice_questions
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'OPEN_ENDED'
  CHECK (question_type IN ('MCQ', 'OPEN_ENDED'));

ALTER TABLE practice_questions
  ADD COLUMN IF NOT EXISTS options JSONB;

ALTER TABLE practice_questions
  ADD COLUMN IF NOT EXISTS correct_answer TEXT;

ALTER TABLE practice_questions
  ADD COLUMN IF NOT EXISTS explanation TEXT;
