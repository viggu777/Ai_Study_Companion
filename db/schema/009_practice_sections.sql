-- 009 Practice paper sections (TRUE_FALSE + ONE_WORD types)
-- Run after 008_practice_mcq.sql. Additive only — existing rows keep working.
--
-- Design notes:
-- - Practice papers are conducted exam-style in three sections:
--     A (Objective):   MCQ + TRUE_FALSE, graded deterministically.
--     B (Short):       ONE_WORD (one word / short phrase, max 4 words),
--                      graded by normalized match against correct_answer plus
--                      acceptable_answers alternates (synonyms, abbreviations).
--     C (Descriptive): OPEN_ENDED, AI-graded with rich evidence.
-- - The question_type CHECK is widened in place (old MCQ/OPEN_ENDED rows stay
--   valid). Constraint + column statements are re-runnable.
-- - Gating mirrors quiz: options are safe pre-answer, but correct_answer /
--   acceptable_answers / explanation / reference_answer are disclosed only
--   after the learner's response is graded.

-- Widen the type check (drop + recreate keeps the stable auto-generated name).
ALTER TABLE practice_questions DROP CONSTRAINT IF EXISTS practice_questions_question_type_check;
ALTER TABLE practice_questions
  ADD CONSTRAINT practice_questions_question_type_check
  CHECK (question_type IN ('MCQ', 'TRUE_FALSE', 'ONE_WORD', 'OPEN_ENDED'));

-- Alternate accepted answers for ONE_WORD (JSON array of strings, else NULL).
ALTER TABLE practice_questions
  ADD COLUMN IF NOT EXISTS acceptable_answers JSONB;
