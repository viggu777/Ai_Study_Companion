import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { aiService, CHAT_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import { inngest } from "@/lib/jobs/client";
import {
  QUIZ_SYSTEM_PROMPT,
  QuizGenerationSchema,
  buildQuizUserPrompt,
  validateQuizOutput,
  type QuizDifficulty,
  type QuizQuestionType,
} from "@/ai/quiz";
import {
  ASSESSMENT_SYSTEM_PROMPT,
  AssessmentSchema,
  buildAssessmentUserPrompt,
  validateAssessmentOutput,
  type AssessmentEvaluation,
} from "@/ai/assessment";

const DEFAULT_QUIZ_SIZE = 5;

// Weights / thresholds for adaptive selection — combine ≥3 signals
const SCORE = {
  masteryWeight: 0.5, // (100 - mastery) * 0.5 => 0..50
  mistakeBonus: 25,
  trendDeclineBonus: 15,
  trendDeclineSmallBonus: 8,
  trendImprovingPenalty: -10,
  recentTestPenalty3d: -12,
  recentTestPenalty7d: -6,
  frequencyPerHitPenalty: -6,
  // For picking difficulty/type
  weakThreshold: 50,
  hardThreshold: 75,
};

async function emitLearningEvent(params: {
  userId: string;
  spaceId?: string | null;
  projectId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  const { error } = await db.from("learning_events").insert({
    user_id: params.userId,
    space_id: params.spaceId ?? null,
    project_id: params.projectId ?? null,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    metadata: params.metadata ?? null,
  });
  if (error) console.error("Failed to emit learning event:", error);
}

interface ConceptRow {
  id: string;
  name: string;
  description: string | null;
}

interface SelectionCandidate extends ConceptRow {
  mastery: number; // 0..100
  isRecentMistake: boolean;
  trendDelta: number; // new - previous
  daysSinceLastTest: number; // 999 if never
  frequencyCount: number; // times tested in recent window
  score: number;
  targetDifficulty: QuizDifficulty;
  targetType: QuizQuestionType;
}

/**
 * Fetch per-concept stats needed for scoring.
 * Signals: mastery, recent mistake, trend, recency/frequency
 */
async function buildConceptStats(
  projectId: string,
  userId: string,
  concepts: ConceptRow[]
): Promise<Map<string, { mastery: number; trendDelta: number; isRecentMistake: boolean; daysSinceLastTest: number; frequencyCount: number }>> {
  const db = await getDb();
  const conceptIds = concepts.map((c) => c.id);

  // 1) + 2) + 3a) are independent — fire concurrently instead of sequentially.
  const masteryPromise = db
    .from("concept_mastery")
    .select("concept_id, mastery_score")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .in("concept_id", conceptIds);

  // 2) trend from mastery_history — one batched query for all concepts
  // (previously one sequential query per concept = N+1). Take the 2 most
  // recent rows per concept in JS. The limit covers 4 rows per concept so
  // recent history is never truncated; concepts with only older history fall
  // back to delta 0, which is benign for a recency-weighted signal.
  const trendPromise = db
    .from("mastery_history")
    .select("concept_id, previous_score, new_score")
    .eq("user_id", userId)
    .in("concept_id", conceptIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(500, Math.max(20, conceptIds.length * 4)));

  // 3) recent mistakes + recency/frequency via quizzes/questions/answers
  // Fetch recent quizzes for project (limit 10 for recent window)
  const quizzesPromise = db
    .from("quizzes")
    .select("id, created_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  const [{ data: masteryRows }, { data: trendRows }, { data: quizzes }] = await Promise.all([
    masteryPromise,
    trendPromise,
    quizzesPromise,
  ]);

  // 1) mastery map (default 0 if missing — prioritizes untested)
  const masteryMap = new Map<string, number>();
  for (const r of (masteryRows ?? []) as Array<{ concept_id: string; mastery_score: number | string }>) {
    masteryMap.set(r.concept_id, Number(r.mastery_score));
  }

  // 2) group batched history rows: first 2 per concept (already globally desc)
  const trendMap = new Map<string, number>();
  const byConceptHistory = new Map<string, Array<{ previous_score: number | string; new_score: number | string }>>();
  for (const h of (trendRows ?? []) as Array<{ concept_id: string; previous_score: number | string; new_score: number | string }>) {
    const arr = byConceptHistory.get(h.concept_id) ?? [];
    if (arr.length < 2) arr.push({ previous_score: h.previous_score, new_score: h.new_score });
    byConceptHistory.set(h.concept_id, arr);
  }
  for (const cid of conceptIds) {
    const rows = byConceptHistory.get(cid) ?? [];
    if (rows.length === 2) {
      // Most recent new_score vs previous latest new_score (compare last two new_scores)
      trendMap.set(cid, Number(rows[0].new_score) - Number(rows[1].new_score));
    } else if (rows.length === 1) {
      trendMap.set(cid, Number(rows[0].new_score) - Number(rows[0].previous_score));
    } else {
      trendMap.set(cid, 0);
    }
  }

  const quizIds = ((quizzes ?? []) as Array<{ id: string; created_at: string }>).map((q) => q.id);

  let questionsByConcept = new Map<string, Array<{ id: string; created_at?: string; quiz_created_at?: string }>>();
  let answersByConceptMistake = new Set<string>();
  const lastTestDateByConcept = new Map<string, string>();
  const frequencyByConcept = new Map<string, number>();

  if (quizIds.length > 0) {
    const { data: questions } = await db
      .from("questions")
      .select("id, concept_id, quiz_id")
      .in("quiz_id", quizIds);
    const qRows = (questions ?? []) as Array<{ id: string; concept_id: string; quiz_id: string }>;
    // Map quizId -> created_at
    const quizDateMap = new Map<string, string>();
    for (const q of (quizzes ?? []) as Array<{ id: string; created_at: string }>) quizDateMap.set(q.id, q.created_at);

    // Frequency: count per concept in recent window
    for (const q of qRows) {
      frequencyByConcept.set(q.concept_id, (frequencyByConcept.get(q.concept_id) ?? 0) + 1);
      const d = quizDateMap.get(q.quiz_id);
      if (d) {
        const existing = lastTestDateByConcept.get(q.concept_id);
        if (!existing || new Date(d) > new Date(existing)) lastTestDateByConcept.set(q.concept_id, d);
      }
      // also collect for per-concept grouping
      const arr = questionsByConcept.get(q.concept_id) ?? [];
      arr.push({ id: q.id, quiz_created_at: quizDateMap.get(q.quiz_id) });
      questionsByConcept.set(q.concept_id, arr);
    }

    const questionIds = qRows.map((q) => q.id);
    if (questionIds.length > 0) {
      // Fetch recent answers for these questions (limit to recent 100)
      const { data: answers } = await db
        .from("answers")
        .select("question_id, is_correct, score")
        .eq("user_id", userId)
        .in("question_id", questionIds)
        .order("created_at", { ascending: false })
        .limit(100);
      const aRows = (answers ?? []) as Array<{ question_id: string; is_correct: boolean | null; score: number | string | null }>;
      // Need questionId -> conceptId
      const qToConcept = new Map<string, string>();
      for (const q of qRows) qToConcept.set(q.id, q.concept_id);
      // For each concept, check if any recent answer was mistake: is_correct false or score <60
      const mistakeByConcept = new Map<string, boolean>();
      for (const a of aRows) {
        const cid = qToConcept.get(a.question_id);
        if (!cid) continue;
        const isMistake = a.is_correct === false || (a.score !== null && Number(a.score) < 60);
        if (isMistake) mistakeByConcept.set(cid, true);
      }
      for (const [cid, isMistake] of mistakeByConcept) if (isMistake) answersByConceptMistake.add(cid);
    }
  }

  // Also consider quizzes beyond recent 10 for “never tested” vs “long ago” — already 999 if not in recent
  const now = Date.now();
  const result = new Map<string, { mastery: number; trendDelta: number; isRecentMistake: boolean; daysSinceLastTest: number; frequencyCount: number }>();
  for (const c of concepts) {
    const mastery = masteryMap.has(c.id) ? masteryMap.get(c.id)! : 0; // default 0 prioritizes new
    const trendDelta = trendMap.get(c.id) ?? 0;
    const isRecentMistake = answersByConceptMistake.has(c.id);
    const lastDateStr = lastTestDateByConcept.get(c.id);
    let daysSince = 999;
    if (lastDateStr) daysSince = (now - new Date(lastDateStr).getTime()) / (1000 * 60 * 60 * 24);
    const freq = frequencyByConcept.get(c.id) ?? 0;
    result.set(c.id, { mastery, trendDelta, isRecentMistake, daysSinceLastTest: daysSince, frequencyCount: freq });
  }
  return result;
}

function computeScore(s: { mastery: number; trendDelta: number; isRecentMistake: boolean; daysSinceLastTest: number; frequencyCount: number }): number {
  let score = (100 - s.mastery) * SCORE.masteryWeight;
  if (s.isRecentMistake) score += SCORE.mistakeBonus;
  if (s.trendDelta < -5) score += SCORE.trendDeclineBonus;
  else if (s.trendDelta < 0) score += SCORE.trendDeclineSmallBonus;
  else if (s.trendDelta > 5) score += SCORE.trendImprovingPenalty;
  if (s.daysSinceLastTest < 3) score += SCORE.recentTestPenalty3d;
  else if (s.daysSinceLastTest < 7) score += SCORE.recentTestPenalty7d;
  score += s.frequencyCount * SCORE.frequencyPerHitPenalty;
  return score;
}

function pickDifficultyAndType(s: {
  mastery: number;
  isRecentMistake: boolean;
  trendDelta: number;
  frequencyCount: number;
}): { difficulty: QuizDifficulty; type: QuizQuestionType } {
  // Difficulty
  let difficulty: QuizDifficulty;
  if (s.mastery < 35) difficulty = "easy";
  else if (s.mastery < 70 || s.isRecentMistake || s.trendDelta < -5) difficulty = "medium";
  else difficulty = "hard";

  // Adjust hard down to medium if declining trend
  if (difficulty === "hard" && s.trendDelta < -3) difficulty = "medium";

  // Type: weak/mistake -> MCQ, strong -> OPEN_ENDED, frequent MCQ -> switch
  let type: QuizQuestionType;
  if (s.mastery < 45 || s.isRecentMistake) type = "MCQ";
  else if (s.frequencyCount >= 2 && s.mastery > 60) type = "OPEN_ENDED";
  else type = s.mastery > 70 ? "OPEN_ENDED" : "MCQ";

  return { difficulty, type };
}

export async function selectAdaptiveConcepts(
  projectId: string,
  userId: string,
  count: number = DEFAULT_QUIZ_SIZE
): Promise<SelectionCandidate[]> {
  const db = await getDb();
  const { data: concepts } = await db.from("concepts").select("id, name, description").eq("project_id", projectId);
  const rows = (concepts ?? []) as ConceptRow[];
  if (rows.length === 0) throw new Error("No concepts available for quiz generation — upload and process material first");

  const stats = await buildConceptStats(projectId, userId, rows);

  const candidates: SelectionCandidate[] = rows.map((c) => {
    const s = stats.get(c.id)!;
    const score = computeScore(s);
    const { difficulty, type } = pickDifficultyAndType(s);
    return {
      ...c,
      mastery: s.mastery,
      isRecentMistake: s.isRecentMistake,
      trendDelta: s.trendDelta,
      daysSinceLastTest: s.daysSinceLastTest,
      frequencyCount: s.frequencyCount,
      score,
      targetDifficulty: difficulty,
      targetType: type,
    };
  });

  // Sort by score desc, then by name for stability
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Take top N, but ensure we don't exceed available
  const n = Math.min(count, candidates.length);
  return candidates.slice(0, n);
}

export async function generateQuiz(
  projectId: string,
  options?: { count?: number }
): Promise<{ quiz: { id: string; project_id: string; status: string; created_at: string }; questions: Array<{ id: string; concept_id: string; type: string; difficulty: string; question: string; options: unknown; correct_answer: string | null; explanation: string | null }> }> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  // Ownership check + fetch project meta for prompt
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, name, learning_goal, space_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");
  const spaceId = (project as { space_id: string }).space_id;
  const projectName = (project as { name: string }).name;
  const learningGoal = (project as { learning_goal: string | null }).learning_goal;

  const count = Math.max(1, Math.min(options?.count ?? DEFAULT_QUIZ_SIZE, 10));
  const selected = await selectAdaptiveConcepts(projectId, userId, count);

  // Build prompt and call AIService
  const userPrompt = buildQuizUserPrompt({
    projectName,
    learningGoal,
    concepts: selected.map((s) => ({
      concept_id: s.id,
      name: s.name,
      description: s.description,
      targetDifficulty: s.targetDifficulty,
      targetType: s.targetType,
    })),
  });

  const requestId = crypto.randomUUID();
  const start = Date.now();
  let raw: unknown;
  let latencyMs = 0;
  let alreadyLogged = false;
  try {
    raw = await aiService.generateStructured<unknown>({
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      userPrompt,
      schema: QuizGenerationSchema,
      temperature: 0.4,
      maxTokens: 2500,
    });
    latencyMs = Date.now() - start;
  } catch (e) {
    latencyMs = Date.now() - start;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[QUIZ_GENERATION ${requestId}] failed:`, errMsg);
    await logAiOperation({
      userId,
      projectId,
      feature: "QUIZ_GENERATION",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs,
      success: false,
      error: errMsg.slice(0, 2000),
    });
    alreadyLogged = true;
    throw new Error(`Quiz generation failed: ${errMsg}`);
  }

  // Validate — retry once if shape wrong
  const expectedIds = selected.map((s) => s.id);
  let validated;
  try {
    validated = validateQuizOutput(raw, expectedIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[QUIZ_GENERATION ${requestId}] validation failed, retrying once:`, msg);
    // Retry once
    try {
      const retryStart = Date.now();
      const retryRaw = await aiService.generateStructured<unknown>({
        systemPrompt: QUIZ_SYSTEM_PROMPT,
        userPrompt: userPrompt + "\n\nPrevious output failed validation: " + msg + " — fix the JSON exactly to match the schema.",
        schema: QuizGenerationSchema,
        temperature: 0.3,
        maxTokens: 2500,
      });
      latencyMs = Date.now() - retryStart;
      validated = validateQuizOutput(retryRaw, expectedIds);
      // Log retry success as success
      await logAiOperation({
        userId,
        projectId,
        feature: "QUIZ_GENERATION",
        model: CHAT_MODEL_NAME,
        requestId,
        latencyMs,
        success: true,
      });
      alreadyLogged = true;
    } catch (retryErr) {
      const rMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      await logAiOperation({
        userId,
        projectId,
        feature: "QUIZ_GENERATION",
        model: CHAT_MODEL_NAME,
        requestId,
        latencyMs,
        success: false,
        error: rMsg.slice(0, 2000),
      });
      alreadyLogged = true;
      throw new Error(`Quiz generation validation failed after retry: ${rMsg}`);
    }
  }

  // Avoid repeating exact same question text consecutively: compare with last quiz's questions for same concept
  // Fetch last quiz questions text to detect duplicates (for logging, not blocking)
  try {
    const { data: lastQuiz } = await db
      .from("quizzes")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastQuiz) {
      const { data: lastQuestions } = await db
        .from("questions")
        .select("concept_id, question")
        .eq("quiz_id", (lastQuiz as { id: string }).id);
      const lastTextByConcept = new Map<string, Set<string>>();
      for (const lq of (lastQuestions ?? []) as Array<{ concept_id: string; question: string }>) {
        const set = lastTextByConcept.get(lq.concept_id) ?? new Set();
        set.add(lq.question.trim().toLowerCase());
        lastTextByConcept.set(lq.concept_id, set);
      }
      for (const q of validated!.questions) {
        const set = lastTextByConcept.get(q.concept_id);
        if (set && set.has(q.question.trim().toLowerCase())) {
          console.warn(`Quiz duplicate question detected for concept ${q.concept_id} — same as last quiz. Prompt asked to vary but got duplicate.`);
        }
      }
    }
  } catch {
    // non-blocking
  }

  // Log success for first-try validation path (retry path already logged)
  if (validated && !alreadyLogged) {
    try {
      await logAiOperation({
        userId,
        projectId,
        feature: "QUIZ_GENERATION",
        model: CHAT_MODEL_NAME,
        requestId,
        latencyMs,
        success: true,
      });
      alreadyLogged = true;
    } catch {
      // ignore
    }
  }

  // Persist quiz + questions
  const { data: quiz, error: quizErr } = await db
    .from("quizzes")
    .insert({ project_id: projectId, user_id: userId, status: "in_progress" })
    .select()
    .single();
  if (quizErr || !quiz) throw new Error("Failed to create quiz");

  const quizId = (quiz as { id: string }).id;

  // LLMs overwhelmingly place the correct MCQ answer first, so users quickly
  // learn "option A is always right". Shuffle server-side (Fisher-Yates) so
  // position carries zero signal. Grading compares response strings against
  // correct_answer, so shuffling is grading-safe.
  const rowsToInsert = validated!.questions.map((q) => {
    let options = q.options ? [...q.options] : null;
    if (q.type === "MCQ" && options) {
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
    }
    return {
      quiz_id: quizId,
      concept_id: q.concept_id,
      type: q.type,
      difficulty: q.difficulty,
      question: q.question,
      options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
    };
  });

  const { data: insertedQuestions, error: qErr } = await db.from("questions").insert(rowsToInsert).select();
  if (qErr) {
    console.error("Failed to insert questions:", qErr);
    // cleanup quiz?
    throw new Error("Failed to persist quiz questions");
  }

  await emitLearningEvent({
    userId,
    spaceId,
    projectId,
    eventType: "QUIZ_STARTED",
    entityType: "quiz",
    entityId: quizId,
    metadata: { count: rowsToInsert.length, concepts: expectedIds },
  });

  return {
    quiz: quiz as { id: string; project_id: string; status: string; created_at: string },
    questions: (insertedQuestions ?? []) as Array<{
      id: string;
      concept_id: string;
      type: string;
      difficulty: string;
      question: string;
      options: unknown;
      correct_answer: string | null;
      explanation: string | null;
    }>,
  };
}

export async function listQuizzes(projectId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const { data, error } = await db
    .from("quizzes")
    .select("id, status, created_at, completed_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getQuizWithQuestions(projectId: string, quizId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const { data: quiz, error: quizErr } = await db
    .from("quizzes")
    .select("id, project_id, user_id, status, created_at, completed_at")
    .eq("id", quizId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (quizErr || !quiz) throw new Error("Quiz not found");
  const { data: questions, error: qErr } = await db
    .from("questions")
    .select("id, concept_id, type, difficulty, question, options, correct_answer, explanation")
    .eq("quiz_id", quizId)
    .order("id", { ascending: true });
  if (qErr) throw new Error(qErr.message);
  // Fetch concept names for display
  const conceptIds = [...new Set(((questions ?? []) as Array<{ concept_id: string }>).map((q) => q.concept_id))];
  let conceptMap = new Map<string, { name: string; description: string | null }>();
  if (conceptIds.length > 0) {
    const { data: concepts } = await db.from("concepts").select("id, name, description").in("id", conceptIds);
    for (const c of (concepts ?? []) as Array<{ id: string; name: string; description: string | null }>) conceptMap.set(c.id, { name: c.name, description: c.description });
  }
  const enriched = ((questions ?? []) as Array<{
    id: string;
    concept_id: string;
    type: string;
    difficulty: string;
    question: string;
    options: unknown;
    correct_answer: string | null;
    explanation: string | null;
  }>).map((q) => ({
    ...q,
    concept_name: conceptMap.get(q.concept_id)?.name ?? "Unknown",
  }));
  return { quiz, questions: enriched };
}

export async function getQuizWithAnswers(projectId: string, quizId: string) {
  const base = await getQuizWithQuestions(projectId, quizId);
  const userId = await getCurrentUserId();
  const db = await getDb();
  const qIds = base.questions.map((q) => q.id);
  let answerMap = new Map<string, { id: string; question_id: string; response: string; is_correct: boolean | null; score: number | null; evaluation: unknown; created_at: string }>();
  if (qIds.length > 0) {
    const { data: answers } = await db.from("answers").select("id, question_id, response, is_correct, score, evaluation, created_at").eq("user_id", userId).in("question_id", qIds);
    for (const a of (answers ?? []) as Array<{ id: string; question_id: string; response: string; is_correct: boolean | null; score: number | string | null; evaluation: unknown; created_at: string }>) {
      answerMap.set(a.question_id, { ...a, score: a.score !== null ? Number(a.score) : null });
    }
  }
  return { ...base, answers: answerMap, answersList: Array.from(answerMap.values()) };
}

export async function submitAnswer(
  projectId: string,
  quizId: string,
  questionId: string,
  response: string
): Promise<{
  answer: { id: string; question_id: string; response: string; is_correct: boolean | null; score: number | null; evaluation: AssessmentEvaluation | null; created_at: string };
  quizCompleted: boolean;
  quizStatus: string;
}> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const trimmed = response.trim();
  if (!trimmed) throw new Error("Response is required");
  if (trimmed.length > 5000) throw new Error("Response too long");

  // Ownership + existence checks — never trust ids alone
  const { data: project, error: projErr } = await db.from("projects").select("id, space_id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const spaceId = (project as { space_id: string }).space_id;

  const { data: quiz, error: quizErr } = await db.from("quizzes").select("id, project_id, user_id, status").eq("id", quizId).eq("project_id", projectId).eq("user_id", userId).single();
  if (quizErr || !quiz) throw new Error("Quiz not found");
  const quizStatusBefore = (quiz as { status: string }).status;

  const { data: question, error: qErr } = await db
    .from("questions")
    .select("id, quiz_id, concept_id, type, question, options, correct_answer, explanation")
    .eq("id", questionId)
    .eq("quiz_id", quizId)
    .single();
  if (qErr || !question) throw new Error("Question not found in this quiz");
  const qRow = question as { id: string; quiz_id: string; concept_id: string; type: string; question: string; options: unknown; correct_answer: string | null; explanation: string | null };
  const qType = qRow.type as "MCQ" | "OPEN_ENDED";

  // Idempotency per question: if already answered, return existing without side effects
  const { data: existingAnswer } = await db.from("answers").select("id, question_id, response, is_correct, score, evaluation, created_at").eq("question_id", questionId).eq("user_id", userId).maybeSingle();
  if (existingAnswer) {
    const ea = existingAnswer as { id: string; question_id: string; response: string; is_correct: boolean | null; score: number | string | null; evaluation: unknown; created_at: string };
    // Still ensure quiz completion is idempotent — check if already completed, if not and now all answered, try to complete
    const completion = await tryCompleteQuizIfNeeded(projectId, quizId, userId, spaceId);
    return {
      answer: { id: ea.id, question_id: ea.question_id, response: ea.response, is_correct: ea.is_correct, score: ea.score !== null ? Number(ea.score) : null, evaluation: ea.evaluation as AssessmentEvaluation | null, created_at: ea.created_at },
      quizCompleted: completion.completedNow || quizStatusBefore === "completed",
      quizStatus: completion.status,
    };
  }

  let isCorrect: boolean | null = null;
  let score: number | null = null;
  let evaluation: AssessmentEvaluation | null = null;

  if (qType === "MCQ") {
    // Deterministic grading — do not use LLM
    const expected = (qRow.correct_answer ?? "").trim();
    isCorrect = trimmed === expected;
    score = isCorrect ? 100 : 0;
    evaluation = null;
  } else {
    // Open-ended: AI evaluation via structured output
    // Fetch concept for prompt context
    let conceptName = "Unknown";
    let conceptDesc: string | null = null;
    try {
      const { data: concept } = await db.from("concepts").select("name, description").eq("id", qRow.concept_id).maybeSingle();
      if (concept) {
        conceptName = (concept as { name: string }).name;
        conceptDesc = (concept as { description: string | null }).description;
      }
    } catch {
      // ignore
    }
    const userPrompt = buildAssessmentUserPrompt({
      question: qRow.question,
      correctAnswer: qRow.correct_answer,
      explanation: qRow.explanation,
      conceptName,
      conceptDescription: conceptDesc,
      studentResponse: trimmed,
    });
    const requestId = crypto.randomUUID();
    const start = Date.now();
    try {
      const raw = await aiService.generateStructured<unknown>({
        systemPrompt: ASSESSMENT_SYSTEM_PROMPT,
        userPrompt,
        schema: AssessmentSchema,
        temperature: 0.2,
        maxTokens: 1000,
      });
      const latencyMs = Date.now() - start;
      evaluation = validateAssessmentOutput(raw);
      score = evaluation.score;
      isCorrect = score >= 60;
      await logAiOperation({ userId, projectId, feature: "OPEN_ENDED_EVALUATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: true });
    } catch (e) {
      const latencyMs = Date.now() - start;
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[OPEN_ENDED_EVALUATION ${requestId}] failed:`, errMsg);
      await logAiOperation({ userId, projectId, feature: "OPEN_ENDED_EVALUATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: false, error: errMsg.slice(0, 2000) });
      throw new Error(`Evaluation failed: ${errMsg}`);
    }
  }

  // Persist answer
  const { data: inserted, error: insErr } = await db
    .from("answers")
    .insert({ question_id: questionId, user_id: userId, response: trimmed, is_correct: isCorrect, score, evaluation })
    .select()
    .single();
  if (insErr || !inserted) {
    // Handle race where another request inserted concurrently
    const { data: race } = await db.from("answers").select("id, question_id, response, is_correct, score, evaluation, created_at").eq("question_id", questionId).eq("user_id", userId).maybeSingle();
    if (race) {
      const ea = race as { id: string; question_id: string; response: string; is_correct: boolean | null; score: number | string | null; evaluation: unknown; created_at: string };
      const completion = await tryCompleteQuizIfNeeded(projectId, quizId, userId, spaceId);
      return {
        answer: { id: ea.id, question_id: ea.question_id, response: ea.response, is_correct: ea.is_correct, score: ea.score !== null ? Number(ea.score) : null, evaluation: ea.evaluation as AssessmentEvaluation | null, created_at: ea.created_at },
        quizCompleted: completion.completedNow || completion.status === "completed",
        quizStatus: completion.status,
      };
    }
    throw new Error("Failed to persist answer");
  }
  const answerRow = inserted as { id: string; question_id: string; response: string; is_correct: boolean | null; score: number | string | null; evaluation: unknown; created_at: string };

  await emitLearningEvent({ userId, spaceId, projectId, eventType: "QUESTION_ANSWERED", entityType: "answer", entityId: answerRow.id, metadata: { question_id: questionId, quiz_id: quizId, is_correct: isCorrect, score } });

  const completion = await tryCompleteQuizIfNeeded(projectId, quizId, userId, spaceId);

  return {
    answer: { id: answerRow.id, question_id: answerRow.question_id, response: answerRow.response, is_correct: answerRow.is_correct, score: answerRow.score !== null ? Number(answerRow.score) : null, evaluation: answerRow.evaluation as AssessmentEvaluation | null, created_at: answerRow.created_at },
    quizCompleted: completion.completedNow,
    quizStatus: completion.status,
  };
}

async function tryCompleteQuizIfNeeded(projectId: string, quizId: string, userId: string, spaceId: string | null): Promise<{ completedNow: boolean; status: string }> {
  const db = await getDb();
  const { data: quiz } = await db.from("quizzes").select("id, status").eq("id", quizId).eq("project_id", projectId).eq("user_id", userId).single();
  if (!quiz) return { completedNow: false, status: "in_progress" };
  const currentStatus = (quiz as { status: string }).status;
  if (currentStatus === "completed") return { completedNow: false, status: "completed" };

  const { data: questions } = await db.from("questions").select("id").eq("quiz_id", quizId);
  const qIds = ((questions ?? []) as Array<{ id: string }>).map((q) => q.id);
  if (qIds.length === 0) return { completedNow: false, status: currentStatus };

  const { data: answers } = await db.from("answers").select("question_id").eq("user_id", userId).in("question_id", qIds);
  const answeredSet = new Set(((answers ?? []) as Array<{ question_id: string }>).map((a) => a.question_id));
  if (answeredSet.size < qIds.length) return { completedNow: false, status: currentStatus };

  // All answered — mark completed
  const now = new Date().toISOString();
  const { error: updErr } = await db.from("quizzes").update({ status: "completed", completed_at: now }).eq("id", quizId).eq("status", "in_progress");
  // If update affected 0 rows due to race, quiz may already be completed
  const { data: refreshed } = await db.from("quizzes").select("status").eq("id", quizId).single();
  const newStatus = (refreshed as { status: string } | null)?.status ?? "completed";
  if (newStatus !== "completed") return { completedNow: false, status: newStatus };

  // Emit QUIZ_COMPLETED idempotently — unique index will block duplicates
  const alreadyCompleted = currentStatus === "completed";
  if (!alreadyCompleted) {
    try {
      await emitLearningEvent({ userId, spaceId, projectId, eventType: "QUIZ_COMPLETED", entityType: "quiz", entityId: quizId, metadata: { question_count: qIds.length } });
    } catch (e) {
      // unique violation means duplicate — ignore per spec idempotency
      console.warn("QUIZ_COMPLETED emit idempotent duplicate ignored:", e);
    }
    if (updErr) console.warn("Quiz complete update error (may be race):", updErr);

    // Trigger mastery update workflow (Inngest step function chained after QUIZ_COMPLETED)
    try {
      await inngest.send({ name: "quiz/completed", data: { quizId, projectId, userId, spaceId } });
    } catch (e) {
      console.error("Inngest send quiz/completed failed, fallback to direct mastery update:", e);
      setTimeout(async () => {
        try {
          const { updateMasteryForQuiz } = await import("@/services/mastery.service");
          await updateMasteryForQuiz({ quizId, projectId, userId, spaceId });
          // The Inngest mastery-update function would normally chain
          // mastery/updated → recommendation-generate from here. Since Inngest
          // is unreachable, chain directly so recommendations are not dropped.
          try {
            const { generateRecommendationForProject } = await import("@/services/recommendation.service");
            await generateRecommendationForProject({ projectId, userId, spaceId });
          } catch (recErr) {
            console.error("Fallback recommendation generation failed:", recErr);
          }
        } catch (err) {
          console.error("Fallback mastery update failed:", err);
        }
      }, 100);
    }

    return { completedNow: true, status: "completed" };
  }
  return { completedNow: false, status: "completed" };
}
