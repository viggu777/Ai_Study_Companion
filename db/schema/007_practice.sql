-- 007 Practice Assignments + lightweight knowledge graph + misconceptions
-- Run after 006_embeddings_gemini_768.sql (Supabase SQL Editor).
-- Smallest clean extension for Practice (open-ended deep learning):
--   practice_assignments / practice_questions / practice_responses
--   concept_edges (PREREQUISITE | RELATED | SUBCONCEPT, relational, no graph DB)
--   misconceptions (recurring incorrect reasoning, per learner+concept)
--
-- Design notes:
-- - Mastery stays in concept_mastery + mastery_history (reused, not duplicated).
--   Practice writes evidence via deterministic backend formula; AI never writes mastery.
-- - Edges start at confidence 0.5 / evidence_count 1 and only become trusted
--   after >=2 evidences. One weak answer can never permanently create a relation.
-- - practice_responses UNIQUE(question_id, user_id) gives per-question idempotency
--   (same pattern as quiz answers race handling).
-- - learning_events idempotency for PRACTICE_COMPLETED mirrors QUIZ_COMPLETED.

-- practice_assignments
CREATE TABLE IF NOT EXISTS practice_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('in_progress','completed')) DEFAULT 'in_progress',
    target_count INTEGER NOT NULL DEFAULT 5 CHECK (target_count BETWEEN 1 AND 10),
    focus_summary TEXT,
    selection_context JSONB,
    summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- practice_questions (open-ended only)
CREATE TABLE IF NOT EXISTS practice_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES practice_assignments(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    related_concept_ids JSONB,
    subconcept_label TEXT,
    intent TEXT NOT NULL CHECK (intent IN ('EXPLAIN','WHY','APPLY','COMPARE','SCENARIO','PROBLEM_SOLVING','TEACH_BACK')) DEFAULT 'EXPLAIN',
    difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
    question TEXT NOT NULL,
    reference_answer TEXT,
    grounding JSONB,
    selection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- practice_responses (one per learner per question; confidence 1-5 optional)
CREATE TABLE IF NOT EXISTS practice_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES practice_questions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    confidence SMALLINT CHECK (confidence BETWEEN 1 AND 5),
    score NUMERIC,
    evaluation JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_id, user_id)
);

-- concept_edges: lightweight project-level knowledge graph (relational)
CREATE TABLE IF NOT EXISTS concept_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    to_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK (relation IN ('PREREQUISITE','RELATED','SUBCONCEPT')),
    confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
    evidence_count INTEGER NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
    last_evidence_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, from_concept_id, to_concept_id, relation),
    CHECK (from_concept_id != to_concept_id)
);

-- misconceptions: recurring incorrect reasoning per learner+concept
CREATE TABLE IF NOT EXISTS misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    normalized TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','RESOLVED')) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_id, concept_id, normalized)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_practice_assignments_project_id ON practice_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_practice_assignments_user_id ON practice_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_questions_assignment_id ON practice_questions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_practice_questions_concept_id ON practice_questions(concept_id);
CREATE INDEX IF NOT EXISTS idx_practice_responses_question_id ON practice_responses(question_id);
CREATE INDEX IF NOT EXISTS idx_practice_responses_user_id ON practice_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_edges_project_id ON concept_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_concept_edges_from_id ON concept_edges(from_concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_edges_to_id ON concept_edges(to_concept_id);
CREATE INDEX IF NOT EXISTS idx_misconceptions_project_id ON misconceptions(project_id);
CREATE INDEX IF NOT EXISTS idx_misconceptions_user_concept ON misconceptions(user_id, concept_id);

-- Idempotency for PRACTICE_COMPLETED (mirrors QUIZ_COMPLETED pattern)
CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_events_practice_completed
    ON learning_events (project_id, entity_type, entity_id, event_type)
    WHERE event_type IN ('PRACTICE_COMPLETED');

-- RLS
ALTER TABLE practice_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE misconceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_assignments_user_isolation ON practice_assignments;
CREATE POLICY practice_assignments_user_isolation ON practice_assignments FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS practice_questions_user_isolation ON practice_questions;
CREATE POLICY practice_questions_user_isolation ON practice_questions FOR ALL USING (
  assignment_id IN (SELECT id FROM practice_assignments WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS practice_responses_user_isolation ON practice_responses;
CREATE POLICY practice_responses_user_isolation ON practice_responses FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS concept_edges_user_isolation ON concept_edges;
CREATE POLICY concept_edges_user_isolation ON concept_edges FOR ALL USING (
  project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS misconceptions_user_isolation ON misconceptions;
CREATE POLICY misconceptions_user_isolation ON misconceptions FOR ALL USING (user_id = auth.uid());
