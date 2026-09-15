-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- spaces
CREATE TABLE spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    learning_goal TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- materials
CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('QUEUED','PROCESSING','READY','FAILED')) DEFAULT 'QUEUED',
    page_count INTEGER,
    processing_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- chunks
CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    embedding VECTOR(768),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- concepts
CREATE TABLE concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    source_material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- concept_mastery
CREATE TABLE concept_mastery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mastery_score NUMERIC NOT NULL DEFAULT 0,
    evidence JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, concept_id, user_id)
);

-- mastery_history
CREATE TABLE mastery_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    previous_score NUMERIC NOT NULL,
    new_score NUMERIC NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- conversations
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- quizzes
CREATE TABLE quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- questions
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('MCQ','OPEN_ENDED')),
    difficulty TEXT NOT NULL,
    question TEXT NOT NULL,
    options JSONB,
    correct_answer TEXT,
    explanation TEXT
);

-- answers
CREATE TABLE answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    is_correct BOOLEAN,
    score NUMERIC,
    evaluation JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- recommendations
CREATE TABLE recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    action_items JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','DISMISSED')) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- learning_events
CREATE TABLE learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    space_id UUID REFERENCES spaces(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ai_operations
CREATE TABLE ai_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    feature TEXT NOT NULL,
    model TEXT NOT NULL,
    request_id UUID NOT NULL,
    latency_ms INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    estimated_cost NUMERIC,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes on foreign keys
CREATE INDEX idx_spaces_user_id ON spaces(user_id);
CREATE INDEX idx_projects_space_id ON projects(space_id);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_materials_project_id ON materials(project_id);
CREATE INDEX idx_materials_user_id ON materials(user_id);
CREATE INDEX idx_chunks_material_id ON chunks(material_id);
CREATE INDEX idx_chunks_project_id ON chunks(project_id);
CREATE INDEX idx_concepts_project_id ON concepts(project_id);
CREATE INDEX idx_concepts_source_material_id ON concepts(source_material_id);
CREATE INDEX idx_concept_mastery_project_id ON concept_mastery(project_id);
CREATE INDEX idx_concept_mastery_concept_id ON concept_mastery(concept_id);
CREATE INDEX idx_concept_mastery_user_id ON concept_mastery(user_id);
CREATE INDEX idx_mastery_history_concept_id ON mastery_history(concept_id);
CREATE INDEX idx_mastery_history_user_id ON mastery_history(user_id);
CREATE INDEX idx_conversations_project_id ON conversations(project_id);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_quizzes_project_id ON quizzes(project_id);
CREATE INDEX idx_quizzes_user_id ON quizzes(user_id);
CREATE INDEX idx_questions_quiz_id ON questions(quiz_id);
CREATE INDEX idx_questions_concept_id ON questions(concept_id);
CREATE INDEX idx_answers_question_id ON answers(question_id);
CREATE INDEX idx_answers_user_id ON answers(user_id);
CREATE INDEX idx_recommendations_project_id ON recommendations(project_id);
CREATE INDEX idx_recommendations_user_id ON recommendations(user_id);
CREATE INDEX idx_learning_events_user_id ON learning_events(user_id);
CREATE INDEX idx_learning_events_space_id ON learning_events(space_id);
CREATE INDEX idx_learning_events_project_id ON learning_events(project_id);
CREATE INDEX idx_learning_events_project_created ON learning_events(project_id, created_at);
CREATE INDEX idx_ai_operations_user_id ON ai_operations(user_id);
CREATE INDEX idx_ai_operations_project_id ON ai_operations(project_id);

-- Vector index for cosine similarity search on chunks.embedding
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Unique constraint on learning_events for idempotency
CREATE UNIQUE INDEX uq_learning_events_idempotency
    ON learning_events (project_id, entity_type, entity_id, event_type)
    WHERE event_type IN ('QUIZ_COMPLETED', 'MATERIAL_READY');

-- Enable Row Level Security on all user-owned tables
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_operations ENABLE ROW LEVEL SECURITY;

-- RLS policies: user_id = auth.uid()
CREATE POLICY spaces_user_isolation ON spaces FOR ALL USING (user_id = auth.uid());
CREATE POLICY projects_user_isolation ON projects FOR ALL USING (user_id = auth.uid());
CREATE POLICY materials_user_isolation ON materials FOR ALL USING (user_id = auth.uid());
CREATE POLICY chunks_user_isolation ON chunks FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY concepts_user_isolation ON concepts FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY concept_mastery_user_isolation ON concept_mastery FOR ALL USING (user_id = auth.uid());
CREATE POLICY mastery_history_user_isolation ON mastery_history FOR ALL USING (user_id = auth.uid());
CREATE POLICY conversations_user_isolation ON conversations FOR ALL USING (user_id = auth.uid());
CREATE POLICY messages_user_isolation ON messages FOR ALL USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY quizzes_user_isolation ON quizzes FOR ALL USING (user_id = auth.uid());
CREATE POLICY questions_user_isolation ON questions FOR ALL USING (quiz_id IN (SELECT id FROM quizzes WHERE user_id = auth.uid()));
CREATE POLICY answers_user_isolation ON answers FOR ALL USING (user_id = auth.uid());
CREATE POLICY recommendations_user_isolation ON recommendations FOR ALL USING (user_id = auth.uid());
CREATE POLICY learning_events_user_isolation ON learning_events FOR ALL USING (user_id = auth.uid());
CREATE POLICY ai_operations_user_isolation ON ai_operations FOR ALL USING (user_id = auth.uid());