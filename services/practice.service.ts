import { getDb, getServiceDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { aiService, CHAT_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import { inngest } from "@/lib/jobs/client";
import {
  PRACTICE_DEFAULT_COUNT,
  PRACTICE_EVALUATION_SYSTEM_PROMPT,
  PRACTICE_GENERATION_SYSTEM_PROMPT,
  PRACTICE_MAX_COUNT,
  PracticeEvaluationSchema,
  PracticeGenerationSchema,
  buildPracticeEvaluationUserPrompt,
  buildPracticeGenerationUserPrompt,
  calibrateConfidence,
  clampPracticeCount,
  validatePracticeEvaluationOutput,
  validatePracticeGenerationOutput,
  type PracticeDifficulty,
  type PracticeEvaluation,
  type PracticeIntent,
  type PracticeQuestionType,
} from "@/ai/practice";
import { computeNewMastery } from "@/services/mastery.service";

export const DEFAULT_PRACTICE_SIZE = PRACTICE_DEFAULT_COUNT;
export const MAX_PRACTICE_SIZE = PRACTICE_MAX_COUNT;

/** Returned when db/schema/008_practice_mcq.sql was never applied — actionable, not a bare 500. */
export const PRACTICE_MCQ_SETUP_MESSAGE =
  "Practice MCQ columns are missing — run `npm run migrate` (or apply db/schema/008_practice_mcq.sql in the Supabase SQL Editor), then retry.";

/**
 * Detect a missing-COLUMN error for the 008 MCQ columns (question_type /
 * options / correct_answer / explanation). PostgREST surfaces unknown columns
 * as PGRST204 ("Could not find the ... column") rather than a missing-table
 * error, so this needs its own shape check. Pure.
 */
export function isMissingPracticeMcqColumnError(e: unknown): boolean {
  const obj = (typeof e === "object" && e !== null ? e : {}) as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const code = typeof obj.code === "string" ? obj.code : "";
  const text = [obj.message, obj.details, obj.hint, typeof e === "string" ? e : ""]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  const mentionsColumn = ["question_type", "correct_answer", "options", "explanation"].some((c) =>
    text.includes(c)
  );
  if (!mentionsColumn) return false;
  if (code === "PGRST204") return true;
  if (text.includes("could not find") && text.includes("column")) return true;
  if (text.includes("does not exist") && text.includes("column")) return true;
  return false;
}

/** Throw the actionable 008 setup error when a practice read/write hits a missing MCQ column. */
export function throwIfPracticeMcqColumnsMissing(err: unknown): void {
  if (err && isMissingPracticeMcqColumnError(err)) throw new Error(PRACTICE_MCQ_SETUP_MESSAGE);
}

/** Returned when db/schema/007_practice.sql was never applied — actionable, not a bare 500. */
export const PRACTICE_SETUP_MESSAGE =
  "Practice tables are missing — run `npm run migrate` (or apply db/schema/007_practice.sql in the Supabase SQL Editor after 006), then retry.";

/**
 * Detect missing-table errors across shapes: thrown Errors, PostgREST error
 * objects ({ message, code: PGRST205 }), and raw Postgres 42P01. PostgREST
 * "table not in schema cache" errors do NOT throw — they arrive as
 * `{ data: null, error }` — so callers must pass the `error` object itself.
 * Pure — unit-tested.
 */
export function isMissingTableError(e: unknown, table?: string): boolean {
  const obj = (typeof e === "object" && e !== null ? e : {}) as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const code = typeof obj.code === "string" ? obj.code : "";
  if (code === "42P01" || code === "PGRST205") return true;
  if (e instanceof Error && table && e.message.toLowerCase().includes(table.toLowerCase())) return true;
  const text = [obj.message, obj.details, obj.hint, typeof e === "string" ? e : ""]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  if (text.includes("schema cache") || text.includes("could not find the table")) return true;
  if (text.includes("does not exist") && (!table || text.includes(table.toLowerCase()))) return true;
  return false;
}

/** Throw the actionable setup error when a practice-table read/write hit a missing table. */
export function throwIfPracticeTablesMissing(err: unknown, table?: string): void {
  if (err && isMissingTableError(err, table)) throw new Error(PRACTICE_SETUP_MESSAGE);
}

/* Selection weights — deliberately multi-signal (NOT wrong->easy). */
export const PRACTICE_SCORE = {
  masteryWeight: 0.4,
  mistakeBonus: 20,
  trendDeclineBonus: 12,
  trendDeclineSmallBonus: 6,
  trendImprovingPenalty: -8,
  misconceptionBase: 15,
  misconceptionPerExtra: 3,
  misconceptionCap: 30,
  recentPracticePenalty3d: -10,
  recentPracticePenalty7d: -5,
  frequencyPerHitPenalty: -5,
  prerequisiteBoost: 10,
  weakThreshold: 50,
};

export interface PracticeCandidate {
  id: string;
  name: string;
  description: string | null;
  mastery: number;
  isRecentMistake: boolean;
  trendDelta: number;
  daysSinceLastTest: number;
  frequencyCount: number;
  misconceptionCount: number;
  misconceptionOccurrences: number;
  isPrerequisiteForWeak: boolean;
  score: number;
  targetIntent: PracticeIntent;
  targetDifficulty: PracticeDifficulty;
  targetType: PracticeQuestionType;
  materialHint: string | null;
}

export interface PracticeStats {
  mastery: number;
  trendDelta: number;
  isRecentMistake: boolean;
  daysSinceLastTest: number;
  frequencyCount: number;
  misconceptionCount: number;
  misconceptionOccurrences: number;
}

/** Multi-signal score. Pure — unit-tested. */
export function computePracticeScore(s: PracticeStats & { isPrerequisiteForWeak: boolean }): number {
  let score = (100 - s.mastery) * PRACTICE_SCORE.masteryWeight;
  if (s.isRecentMistake) score += PRACTICE_SCORE.mistakeBonus;
  if (s.trendDelta < -5) score += PRACTICE_SCORE.trendDeclineBonus;
  else if (s.trendDelta < 0) score += PRACTICE_SCORE.trendDeclineSmallBonus;
  else if (s.trendDelta > 5) score += PRACTICE_SCORE.trendImprovingPenalty;
  if (s.misconceptionCount > 0) {
    score += Math.min(
      PRACTICE_SCORE.misconceptionCap,
      PRACTICE_SCORE.misconceptionBase + PRACTICE_SCORE.misconceptionPerExtra * Math.min(s.misconceptionOccurrences, 5)
    );
  }
  if (s.isPrerequisiteForWeak) score += PRACTICE_SCORE.prerequisiteBoost;
  if (s.daysSinceLastTest < 3) score += PRACTICE_SCORE.recentPracticePenalty3d;
  else if (s.daysSinceLastTest < 7) score += PRACTICE_SCORE.recentPracticePenalty7d;
  score += s.frequencyCount * PRACTICE_SCORE.frequencyPerHitPenalty;
  return score;
}

/**
 * Adaptive intent choice from weakness + history (NOT difficulty-only).
 * - active misconception -> WHY (surface reasoning) or TEACH_BACK if repeated
 * - very weak (<40) -> EXPLAIN foundation
 * - weak + mistake -> WHY / COMPARE
 * - mid (40-70) -> APPLY / SCENARIO
 * - strong (>70) -> TEACH_BACK / PROBLEM_SOLVING / COMPARE (depth)
 * Pure — unit-tested.
 */
export function pickPracticeIntent(s: {
  mastery: number;
  isRecentMistake: boolean;
  misconceptionCount: number;
  misconceptionOccurrences: number;
  trendDelta: number;
  frequencyCount: number;
}): PracticeIntent {
  if (s.misconceptionCount > 0) {
    if (s.misconceptionOccurrences >= 3) return "TEACH_BACK";
    return "WHY";
  }
  if (s.mastery < 35) return "EXPLAIN";
  if (s.mastery < 50) return s.isRecentMistake ? "WHY" : "EXPLAIN";
  if (s.mastery < 65) {
    if (s.isRecentMistake) return "COMPARE";
    return s.frequencyCount >= 2 ? "SCENARIO" : "APPLY";
  }
  if (s.mastery < 80) return s.trendDelta < 0 ? "APPLY" : "SCENARIO";
  return s.frequencyCount >= 2 ? "TEACH_BACK" : "PROBLEM_SOLVING";
}

export function pickPracticeDifficulty(mastery: number, intent: PracticeIntent): PracticeDifficulty {
  if (mastery < 40 && (intent === "EXPLAIN" || intent === "WHY")) return "easy";
  if (mastery >= 75 || intent === "PROBLEM_SOLVING" || intent === "TEACH_BACK") return "hard";
  if (intent === "SCENARIO" || intent === "APPLY") return mastery < 55 ? "medium" : "hard";
  return "medium";
}

/**
 * Adaptive question-type choice (MCQ quick check vs open-ended depth).
 * - Active misconception -> OPEN_ENDED (free text surfaces the faulty reasoning).
 * - Explanation-heavy intents (EXPLAIN / WHY / TEACH_BACK) -> OPEN_ENDED.
 * - APPLY / COMPARE / SCENARIO / PROBLEM_SOLVING on shaky ground
 *   (recent mistake or mastery < 60) -> MCQ quick check.
 * - Same intents on solid ground -> OPEN_ENDED stretch.
 * Pure — unit-tested.
 */
export function pickPracticeQuestionType(s: {
  mastery: number;
  isRecentMistake: boolean;
  misconceptionCount: number;
  intent: PracticeIntent;
}): PracticeQuestionType {
  if (s.misconceptionCount > 0) return "OPEN_ENDED";
  if (s.intent === "EXPLAIN" || s.intent === "WHY" || s.intent === "TEACH_BACK") return "OPEN_ENDED";
  if (s.isRecentMistake || s.mastery < 60) return "MCQ";
  return "OPEN_ENDED";
}

/**
 * Guarantee a mixed assignment: when count >= 2 and every candidate landed on
 * the same type, flip one question so the assignment always contains both an
 * MCQ and an open-ended question. Flips the weakest MCQ-friendly candidate to
 * MCQ (quick win first), or the strongest candidate to OPEN_ENDED (stretch
 * last) when everything came out MCQ. Pure — unit-tested.
 */
export function ensurePracticeTypeMix<
  T extends { targetType: PracticeQuestionType; mastery: number; targetIntent: PracticeIntent },
>(candidates: T[]): T[] {
  if (candidates.length < 2) return candidates;
  const types = new Set(candidates.map((c) => c.targetType));
  if (types.size > 1) return candidates;
  const out = candidates.map((c) => ({ ...c }));
  if (out[0].targetType === "OPEN_ENDED") {
    const mcqFriendly: PracticeIntent[] = ["APPLY", "COMPARE", "SCENARIO", "PROBLEM_SOLVING"];
    const idx = out.findIndex((c) => mcqFriendly.includes(c.targetIntent));
    out[idx === -1 ? 0 : idx].targetType = "MCQ";
  } else {
    let strongest = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i].mastery > out[strongest].mastery) strongest = i;
    }
    out[strongest].targetType = "OPEN_ENDED";
  }
  return out;
}

/**
 * Deterministic evidence mapping for secondary concepts (explainable).
 * Primary uses the raw score; secondaries use category-fixed evidence so a
 * single answer cannot wildly swing an unrelated concept.
 * Pure — tested.
 */
export function practiceEvidenceFor(
  source: "primary" | "demonstrated" | "partial" | "missing",
  score: number
): number {
  if (source === "primary") return Math.max(0, Math.min(100, Math.round(score)));
  if (source === "demonstrated") return 80;
  if (source === "partial") return 50;
  return Math.min(Math.max(0, Math.round(score)), 30);
}

/** Stable history reason for idempotency per (assignment, question, concept). Pure — tested. */
export function buildPracticeHistoryReason(
  assignmentId: string,
  questionId: string,
  conceptId: string,
  source: string,
  evidence: number
): string {
  return `practice:${assignmentId}:${questionId}:${conceptId} source:${source} evidence:${evidence}`;
}

async function emitLearningEvent(params: {
  userId: string;
  spaceId?: string | null;
  projectId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  useServiceDb?: boolean;
}) {
  const db = params.useServiceDb ? getServiceDb() : await getDb();
  const { error } = await (db as Awaited<ReturnType<typeof getDb>>).from("learning_events").insert({
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
  source_material_id?: string | null;
}

/** Shared stats builder: quiz + practice mistakes/recency, mastery, trend, misconceptions, edges. */
async function buildPracticeConceptStats(
  projectId: string,
  userId: string,
  concepts: ConceptRow[],
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{
  stats: Map<string, PracticeStats>;
  masteryByConcept: Map<string, number>;
  materialHintByConcept: Map<string, string | null>;
  prerequisiteForWeak: Set<string>;
}> {
  const conceptIds = concepts.map((c) => c.id);
  // Required tables (pre-007 schema) fail loudly; practice-only tables
  // (007 migration) degrade to empty so selection still works when the
  // migration hasn't been applied yet.
  const [masteryRes, trendRes] = await Promise.all([
    db.from("concept_mastery").select("concept_id, mastery_score").eq("project_id", projectId).eq("user_id", userId).in("concept_id", conceptIds),
    db.from("mastery_history").select("concept_id, previous_score, new_score").eq("user_id", userId).in("concept_id", conceptIds).order("created_at", { ascending: false }).limit(Math.min(500, Math.max(20, conceptIds.length * 4))),
  ]);
  let misconRes: { data: unknown } = { data: [] };
  let edgesRes: { data: unknown } = { data: [] };
  try {
    const r = await db.from("misconceptions").select("concept_id, occurrence_count").eq("project_id", projectId).eq("user_id", userId).eq("status", "ACTIVE").in("concept_id", conceptIds);
    misconRes = (r as { error?: unknown }).error ? { data: [] } : r;
  } catch (e) {
    if (!isMissingTableError(e, "misconceptions")) console.warn("practice stats misconceptions fallback:", e instanceof Error ? e.message : String(e));
    misconRes = { data: [] };
  }
  try {
    const r = await db.from("concept_edges").select("from_concept_id, to_concept_id, relation").eq("project_id", projectId).limit(300);
    edgesRes = (r as { error?: unknown }).error ? { data: [] } : r;
  } catch (e) {
    if (!isMissingTableError(e, "concept_edges")) console.warn("practice stats edges fallback:", e instanceof Error ? e.message : String(e));
    edgesRes = { data: [] };
  }

  const masteryByConcept = new Map<string, number>();
  for (const r of ((masteryRes.data ?? []) as Array<{ concept_id: string; mastery_score: number | string }>)) {
    masteryByConcept.set(r.concept_id, Number(r.mastery_score));
  }

  const byHist = new Map<string, Array<{ previous_score: number | string; new_score: number | string }>>();
  for (const h of ((trendRes.data ?? []) as Array<{ concept_id: string; previous_score: number | string; new_score: number | string }>)) {
    const arr = byHist.get(h.concept_id) ?? [];
    if (arr.length < 2) arr.push({ previous_score: h.previous_score, new_score: h.new_score });
    byHist.set(h.concept_id, arr);
  }
  const trendByConcept = new Map<string, number>();
  for (const cid of conceptIds) {
    const rows = byHist.get(cid) ?? [];
    if (rows.length === 2) trendByConcept.set(cid, Number(rows[0].new_score) - Number(rows[1].new_score));
    else if (rows.length === 1) trendByConcept.set(cid, Number(rows[0].new_score) - Number(rows[0].previous_score));
    else trendByConcept.set(cid, 0);
  }

  const miscByConcept = new Map<string, { count: number; occurrences: number }>();
  for (const m of ((misconRes.data ?? []) as Array<{ concept_id: string; occurrence_count: number }>)) {
    const cur = miscByConcept.get(m.concept_id) ?? { count: 0, occurrences: 0 };
    cur.count += 1;
    cur.occurrences += Number(m.occurrence_count ?? 1);
    miscByConcept.set(m.concept_id, cur);
  }

  // Weak set for prerequisite boost: mastery<60 or declining trend.
  const weakSet = new Set<string>();
  for (const cid of conceptIds) {
    const mastery = masteryByConcept.has(cid) ? masteryByConcept.get(cid)! : 0;
    const delta = trendByConcept.get(cid) ?? 0;
    if (mastery < 60 || delta < -5) weakSet.add(cid);
  }
  const edges = ((edgesRes.data ?? []) as Array<{ from_concept_id: string; to_concept_id: string; relation: string }>) ?? [];
  const prerequisiteForWeak = new Set<string>();
  for (const e of edges) {
    if (e.relation === "PREREQUISITE" && weakSet.has(e.to_concept_id)) prerequisiteForWeak.add(e.from_concept_id);
  }

  // Recent mistakes + recency/frequency across BOTH quiz and practice.
  const { data: quizzes } = await db.from("quizzes").select("id, created_at").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  const quizIds = ((quizzes ?? []) as Array<{ id: string; created_at: string }>).map((q) => q.id);
  const quizDateById = new Map(((quizzes ?? []) as Array<{ id: string; created_at: string }>).map((q) => [q.id, q.created_at]));
  const { data: assignments } = await db.from("practice_assignments").select("id, created_at").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  const assignmentIds = ((assignments ?? []) as Array<{ id: string; created_at: string }>).map((a) => a.id);
  const assignmentDateById = new Map(((assignments ?? []) as Array<{ id: string; created_at: string }>).map((a) => [a.id, a.created_at]));

  const mistakeSet = new Set<string>();
  const lastTestByConcept = new Map<string, string>();
  const freqByConcept = new Map<string, number>();

  if (quizIds.length > 0) {
    const { data: qs } = await db.from("questions").select("id, concept_id, quiz_id").in("quiz_id", quizIds);
    const qRows = (qs ?? []) as Array<{ id: string; concept_id: string; quiz_id: string }>;
    const qToConcept = new Map(qRows.map((q) => [q.id, q.concept_id]));
    for (const q of qRows) {
      freqByConcept.set(q.concept_id, (freqByConcept.get(q.concept_id) ?? 0) + 1);
      const d = quizDateById.get(q.quiz_id);
      if (d) {
        const ex = lastTestByConcept.get(q.concept_id);
        if (!ex || new Date(d) > new Date(ex)) lastTestByConcept.set(q.concept_id, d);
      }
    }
    const qIds = qRows.map((q) => q.id);
    if (qIds.length > 0) {
      const { data: ans } = await db.from("answers").select("question_id, is_correct, score").eq("user_id", userId).in("question_id", qIds).order("created_at", { ascending: false }).limit(100);
      for (const a of ((ans ?? []) as Array<{ question_id: string; is_correct: boolean | null; score: number | string | null }>)) {
        const cid = qToConcept.get(a.question_id);
        if (!cid) continue;
        if (a.is_correct === false || (a.score !== null && Number(a.score) < 60)) mistakeSet.add(cid);
      }
    }
  }

  if (assignmentIds.length > 0) {
    const { data: pqs } = await db.from("practice_questions").select("id, concept_id, assignment_id").in("assignment_id", assignmentIds);
    const pqRows = (pqs ?? []) as Array<{ id: string; concept_id: string; assignment_id: string }>;
    const pqToConcept = new Map(pqRows.map((q) => [q.id, q.concept_id]));
    for (const q of pqRows) {
      freqByConcept.set(q.concept_id, (freqByConcept.get(q.concept_id) ?? 0) + 1);
      const d = assignmentDateById.get(q.assignment_id);
      if (d) {
        const ex = lastTestByConcept.get(q.concept_id);
        if (!ex || new Date(d) > new Date(ex)) lastTestByConcept.set(q.concept_id, d);
      }
    }
    const pqIds = pqRows.map((q) => q.id);
    if (pqIds.length > 0) {
      const { data: pres } = await db.from("practice_responses").select("question_id, score").eq("user_id", userId).in("question_id", pqIds).order("created_at", { ascending: false }).limit(100);
      for (const a of ((pres ?? []) as Array<{ question_id: string; score: number | string | null }>)) {
        const cid = pqToConcept.get(a.question_id);
        if (!cid) continue;
        if (a.score !== null && Number(a.score) < 60) mistakeSet.add(cid);
      }
    }
  }

  // Material hints per concept (source material filename, best-effort).
  const materialHintByConcept = new Map<string, string | null>();
  try {
    const sourceIds = [...new Set(concepts.map((c) => c.source_material_id).filter(Boolean))] as string[];
    if (sourceIds.length > 0) {
      const { data: mats } = await db.from("materials").select("id, filename").in("id", sourceIds);
      const nameById = new Map(((mats ?? []) as Array<{ id: string; filename: string }>).map((m) => [m.id, m.filename]));
      for (const c of concepts) {
        materialHintByConcept.set(c.id, c.source_material_id ? (nameById.get(c.source_material_id) ?? null) : null);
      }
    } else {
      for (const c of concepts) materialHintByConcept.set(c.id, null);
    }
  } catch {
    for (const c of concepts) materialHintByConcept.set(c.id, null);
  }

  const now = Date.now();
  const stats = new Map<string, PracticeStats>();
  for (const c of concepts) {
    const mastery = masteryByConcept.has(c.id) ? masteryByConcept.get(c.id)! : 0;
    const misc = miscByConcept.get(c.id) ?? { count: 0, occurrences: 0 };
    const lastStr = lastTestByConcept.get(c.id);
    const days = lastStr ? (now - new Date(lastStr).getTime()) / (1000 * 60 * 60 * 24) : 999;
    stats.set(c.id, {
      mastery,
      trendDelta: trendByConcept.get(c.id) ?? 0,
      isRecentMistake: mistakeSet.has(c.id),
      daysSinceLastTest: days,
      frequencyCount: freqByConcept.get(c.id) ?? 0,
      misconceptionCount: misc.count,
      misconceptionOccurrences: misc.occurrences,
    });
  }
  return { stats, masteryByConcept, materialHintByConcept, prerequisiteForWeak };
}

export async function selectPracticeConcepts(
  projectId: string,
  userId: string,
  count: number = DEFAULT_PRACTICE_SIZE
): Promise<PracticeCandidate[]> {
  const db = await getDb();
  const { data: concepts } = await db.from("concepts").select("id, name, description, source_material_id").eq("project_id", projectId);
  const allRows = (concepts ?? []) as Array<ConceptRow>;
  const sourced = allRows.filter((c) => c.source_material_id !== null);
  const rows: ConceptRow[] = (sourced.length > 0 ? sourced : allRows).map(({ source_material_id: _o, ...c }) => c as ConceptRow);
  // Re-attach source for hints
  const byId = new Map(allRows.map((c) => [c.id, c]));
  for (const r of rows) (r as ConceptRow).source_material_id = byId.get(r.id)?.source_material_id ?? null;
  if (rows.length === 0) throw new Error("No concepts available for practice — upload and process material first");

  const { stats, masteryByConcept: _m, materialHintByConcept, prerequisiteForWeak } = await buildPracticeConceptStats(projectId, userId, rows, db);

  const candidates: PracticeCandidate[] = rows.map((c) => {
    const s = stats.get(c.id)!;
    const isPre = prerequisiteForWeak.has(c.id);
    const score = computePracticeScore({ ...s, isPrerequisiteForWeak: isPre });
    const intent = pickPracticeIntent({
      mastery: s.mastery,
      isRecentMistake: s.isRecentMistake,
      misconceptionCount: s.misconceptionCount,
      misconceptionOccurrences: s.misconceptionOccurrences,
      trendDelta: s.trendDelta,
      frequencyCount: s.frequencyCount,
    });
    return {
      ...c,
      mastery: s.mastery,
      isRecentMistake: s.isRecentMistake,
      trendDelta: s.trendDelta,
      daysSinceLastTest: s.daysSinceLastTest,
      frequencyCount: s.frequencyCount,
      misconceptionCount: s.misconceptionCount,
      misconceptionOccurrences: s.misconceptionOccurrences,
      isPrerequisiteForWeak: isPre,
      score,
      targetIntent: intent,
      targetDifficulty: pickPracticeDifficulty(s.mastery, intent),
      targetType: pickPracticeQuestionType({
        mastery: s.mastery,
        isRecentMistake: s.isRecentMistake,
        misconceptionCount: s.misconceptionCount,
        intent,
      }),
      materialHint: materialHintByConcept.get(c.id) ?? null,
    };
  });
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const picked = candidates.slice(0, Math.min(count, candidates.length));
  // Assignments with 2+ questions always mix MCQ + open-ended.
  return ensurePracticeTypeMix(picked);
}

/** Best-effort material excerpts per concept for grounding (keyword ilike, like subconcepts). */
async function fetchEvidenceForConcepts(
  projectId: string,
  concepts: Array<{ id: string; name: string }>,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ perConcept: Map<string, string[]>; flat: string[] }> {
  const perConcept = new Map<string, string[]>();
  const flat: string[] = [];
  for (const c of concepts.slice(0, 8)) {
    try {
      const keywords = c.name.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
      if (keywords.length === 0) {
        perConcept.set(c.id, []);
        continue;
      }
      const orFilter = keywords.map((k) => `content.ilike.%${k}%`).join(",");
      const { data: chunks } = await db.from("chunks").select("content").eq("project_id", projectId).or(orFilter).limit(3);
      const texts = ((chunks ?? []) as Array<{ content: string }>).map((x) => x.content);
      perConcept.set(c.id, texts);
      for (const t of texts.slice(0, 2)) {
        if (flat.length < 12) flat.push(`[${c.name}] ${t.slice(0, 500)}`);
      }
    } catch {
      perConcept.set(c.id, []);
    }
  }
  return { perConcept, flat };
}

/* Gating: answers hidden until graded (mirrors quiz gating). Options are safe
   to show pre-answer (the learner needs them to respond); correct_answer /
   explanation / reference_answer are disclosed only after grading. */
export interface TakingPracticeQuestion {
  id: string;
  concept_id: string;
  concept_name?: string;
  related_concept_ids: string[];
  subconcept_label: string | null;
  intent: string;
  difficulty: string;
  question_type: string;
  question: string;
  options: string[] | null;
  selection_reason: string | null;
  grounding_material?: string | null;
  reference_answer?: string | null;
  correct_answer?: string | null;
  explanation?: string | null;
  answered: boolean;
}

export function stripPracticeQuestionForTaking(q: Record<string, unknown>): TakingPracticeQuestion {
  const { reference_answer: _r, correct_answer: _c, explanation: _e, ...rest } = q;
  void _r;
  void _c;
  void _e;
  return { ...(rest as Omit<TakingPracticeQuestion, "answered">), answered: false };
}

export function gatePracticeQuestionForReview(
  q: Record<string, unknown> & {
    reference_answer?: string | null;
    correct_answer?: string | null;
    explanation?: string | null;
  },
  answered: boolean
): TakingPracticeQuestion {
  if (answered) return { ...(q as Omit<TakingPracticeQuestion, "answered">), answered: true };
  const { reference_answer: _r, correct_answer: _c, explanation: _e, ...rest } = q;
  void _r;
  void _c;
  void _e;
  return {
    ...(rest as Omit<TakingPracticeQuestion, "answered">),
    answered: false,
    reference_answer: null,
    correct_answer: null,
    explanation: null,
  };
}

/* Generation */

export async function generatePracticeAssignment(
  projectId: string,
  options?: { count?: number }
): Promise<{
  assignment: { id: string; project_id: string; status: string; created_at: string; focus_summary: string | null };
  questions: TakingPracticeQuestion[];
}> {
  const userId = await getCurrentUserId();
  const db = await getDb();
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
  const count = clampPracticeCount(options?.count);

  // Idempotency: recent assignment with zero responses is reused (double-click guard).
  try {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await db
      .from("practice_assignments")
      .select("id, project_id, status, created_at, focus_summary")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .gte("created_at", twoMinAgo)
      .order("created_at", { ascending: false })
      .limit(3);
    for (const ra of (recent ?? []) as Array<{ id: string; project_id: string; status: string; created_at: string; focus_summary: string | null }>) {
      const { data: qIds } = await db.from("practice_questions").select("id").eq("assignment_id", ra.id);
      const ids = ((qIds ?? []) as Array<{ id: string }>).map((q) => q.id);
      let answered = 0;
      if (ids.length > 0) {
        const { count: c } = await db.from("practice_responses").select("id", { count: "exact", head: true }).eq("user_id", userId).in("question_id", ids);
        answered = c ?? 0;
      }
      if (answered === 0 && ids.length > 0) {
        const { data: qs, error: reuseErr } = await db
          .from("practice_questions")
          .select("id, concept_id, related_concept_ids, subconcept_label, intent, difficulty, question_type, question, options, selection_reason")
          .eq("assignment_id", ra.id)
          .order("created_at", { ascending: true });
        if (reuseErr) throw reuseErr;
        const enriched = await enrichQuestionsWithConceptNames(projectId, (qs ?? []) as Array<Record<string, unknown>>);
        return {
          assignment: { id: ra.id, project_id: ra.project_id, status: ra.status, created_at: ra.created_at, focus_summary: ra.focus_summary },
          questions: enriched.map((q) => stripPracticeQuestionForTaking(q as Record<string, unknown>)),
        };
      }
    }
  } catch (e) {
    // Setup errors (missing 007 tables / 008 columns) must surface immediately
    // instead of falling through to a doomed generation attempt.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("007_practice") || msg.includes("008_practice_mcq")) throw e;
    // best-effort
  }

  const selected = await selectPracticeConcepts(projectId, userId, count);

  // Misconception notes per concept for the prompt.
  let miscByConcept = new Map<string, string[]>();
  try {
    const { data: misc } = await db
      .from("misconceptions")
      .select("concept_id, description")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .in("concept_id", selected.map((s) => s.id))
      .limit(30);
    for (const m of ((misc ?? []) as Array<{ concept_id: string; description: string }>)) {
      const arr = miscByConcept.get(m.concept_id) ?? [];
      if (arr.length < 3) arr.push(m.description);
      miscByConcept.set(m.concept_id, arr);
    }
  } catch {
    miscByConcept = new Map();
  }

  const { flat: evidenceFlat } = await fetchEvidenceForConcepts(
    projectId,
    selected.map((s) => ({ id: s.id, name: s.name })),
    db
  );

  const userPrompt = buildPracticeGenerationUserPrompt({
    projectName,
    learningGoal,
    concepts: selected.map((s) => ({
      concept_id: s.id,
      name: s.name,
      description: s.description,
      mastery: s.mastery,
      trend: s.trendDelta < -5 ? "declining" : s.trendDelta > 5 ? "improving" : "stable",
      isRecentMistake: s.isRecentMistake,
      misconceptions: miscByConcept.get(s.id) ?? [],
      targetIntent: s.targetIntent,
      targetDifficulty: s.targetDifficulty,
      targetType: s.targetType,
      materialHint: s.materialHint,
    })),
    evidence: evidenceFlat,
  });

  const requestId = crypto.randomUUID();
  const start = Date.now();
  let raw: unknown;
  let latencyMs = 0;
  let alreadyLogged = false;
  try {
    raw = await aiService.generateStructured<unknown>({
      systemPrompt: PRACTICE_GENERATION_SYSTEM_PROMPT,
      userPrompt,
      schema: PracticeGenerationSchema,
      temperature: 0.5,
      maxTokens: 3000,
    });
    latencyMs = Date.now() - start;
  } catch (e) {
    latencyMs = Date.now() - start;
    const errMsg = e instanceof Error ? e.message : String(e);
    await logAiOperation({ userId, projectId, feature: "PRACTICE_GENERATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: false, error: errMsg.slice(0, 2000) });
    throw new Error(`Practice generation failed: ${errMsg}`);
  }

  const expectedIds = selected.map((s) => s.id);
  let validated;
  try {
    validated = validatePracticeGenerationOutput(raw, expectedIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const retryStart = Date.now();
      const retryRaw = await aiService.generateStructured<unknown>({
        systemPrompt: PRACTICE_GENERATION_SYSTEM_PROMPT,
        userPrompt: userPrompt + "\n\nPrevious output failed validation: " + msg + " — fix the JSON exactly to match the schema.",
        schema: PracticeGenerationSchema,
        temperature: 0.4,
        maxTokens: 3000,
      });
      latencyMs = Date.now() - retryStart;
      validated = validatePracticeGenerationOutput(retryRaw, expectedIds);
      await logAiOperation({ userId, projectId, feature: "PRACTICE_GENERATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: true });
      alreadyLogged = true;
    } catch (retryErr) {
      const rMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      await logAiOperation({ userId, projectId, feature: "PRACTICE_GENERATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: false, error: rMsg.slice(0, 2000) });
      alreadyLogged = true;
      throw new Error(`Practice generation validation failed after retry: ${rMsg}`);
    }
  }
  if (validated && !alreadyLogged) {
    try {
      await logAiOperation({ userId, projectId, feature: "PRACTICE_GENERATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: true });
    } catch {
      // ignore
    }
  }

  const focusSummary = selected.map((s) => `${s.name} (${s.targetType === "MCQ" ? "mcq" : s.targetIntent.toLowerCase()}, mastery ${Math.round(s.mastery)})`).join("; ").slice(0, 800);
  const selectionContext = {
    generated_at: new Date().toISOString(),
    learning_goal: learningGoal,
    concepts: selected.map((s) => ({
      concept_id: s.id,
      name: s.name,
      mastery: Math.round(s.mastery * 100) / 100,
      trendDelta: Math.round(s.trendDelta * 100) / 100,
      isRecentMistake: s.isRecentMistake,
      misconceptionCount: s.misconceptionCount,
      isPrerequisiteForWeak: s.isPrerequisiteForWeak,
      score: Math.round(s.score * 100) / 100,
      targetIntent: s.targetIntent,
      targetDifficulty: s.targetDifficulty,
      targetType: s.targetType,
      selection_notes: miscByConcept.get(s.id) ?? [],
    })),
  };

  const { data: assignment, error: aErr } = await db
    .from("practice_assignments")
    .insert({ project_id: projectId, user_id: userId, status: "in_progress", target_count: validated!.questions.length, focus_summary: focusSummary, selection_context: selectionContext })
    .select("id, project_id, status, created_at, focus_summary")
    .single();
  if (aErr || !assignment) {
    throwIfPracticeTablesMissing(aErr, "practice_assignments");
    throw new Error("Failed to create practice assignment");
  }
  const assignmentId = (assignment as { id: string }).id;

  const nameById = new Map(selected.map((s) => [s.id, s.name]));
  // LLMs overwhelmingly place the correct MCQ answer first, so users quickly
  // learn "option A is always right". Shuffle server-side (Fisher-Yates) so
  // position carries zero signal. Grading compares response strings against
  // correct_answer, so shuffling is grading-safe (same pattern as quiz).
  const rowsToInsert = validated!.questions.map((q) => {
    const options = q.options ? [...q.options] : null;
    if (q.question_type === "MCQ" && options) {
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
    }
    return {
      assignment_id: assignmentId,
      concept_id: q.concept_id,
      related_concept_ids: q.related_concept_ids,
      subconcept_label: q.subconcept_label,
      intent: q.intent,
      difficulty: q.difficulty,
      question_type: q.question_type,
      question: q.question,
      options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      reference_answer: q.reference_answer,
      grounding: { material_hint: selected.find((s) => s.id === q.concept_id)?.materialHint ?? null },
      selection_reason: q.selection_reason,
    };
  });
  const { data: inserted, error: qErr } = await db.from("practice_questions").insert(rowsToInsert).select("id, concept_id, related_concept_ids, subconcept_label, intent, difficulty, question_type, question, options, selection_reason");
  if (qErr || !inserted) {
    throwIfPracticeMcqColumnsMissing(qErr);
    throwIfPracticeTablesMissing(qErr, "practice_questions");
    // Assignment row without questions is useless — remove it so retries start clean.
    try {
      await db.from("practice_assignments").delete().eq("id", assignmentId);
    } catch {
      // best-effort cleanup
    }
    throw new Error("Failed to persist practice questions");
  }

  // Validated edge proposals — conservative upsert (single evidence, untrusted until repeated).
  try {
    const { upsertConceptEdge } = await import("@/services/knowledge-graph.service");
    for (const e of validated!.suggested_edges.slice(0, 6)) {
      try {
        await upsertConceptEdge({ projectId, fromConceptId: e.from_concept_id, toConceptId: e.to_concept_id, relation: e.relation });
      } catch {
        // invalid proposal (e.g. concept deleted mid-flight) — skip
      }
    }
  } catch {
    // graph is additive; never block practice on it
  }

  await emitLearningEvent({
    userId,
    spaceId,
    projectId,
    eventType: "PRACTICE_STARTED",
    entityType: "practice_assignment",
    entityId: assignmentId,
    metadata: { count: rowsToInsert.length, concepts: expectedIds, focus: focusSummary },
  });

  const enriched = ((inserted ?? []) as Array<Record<string, unknown>>).map((q) => ({
    ...q,
    concept_name: nameById.get(q.concept_id as string) ?? "Unknown",
  }));
  return {
    assignment: assignment as { id: string; project_id: string; status: string; created_at: string; focus_summary: string | null },
    questions: enriched.map((q) => stripPracticeQuestionForTaking(q)),
  };
}

async function enrichQuestionsWithConceptNames(
  projectId: string,
  questions: Array<Record<string, unknown> & { concept_id?: string }>
): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  const ids = [...new Set(questions.map((q) => String(q.concept_id ?? "")).filter(Boolean))];
  let nameById = new Map<string, string>();
  let materialByConcept = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: concepts } = await db.from("concepts").select("id, name").in("id", ids);
    for (const c of ((concepts ?? []) as Array<{ id: string; name: string }>)) nameById.set(c.id, c.name);
    void projectId;
  }
  return questions.map((q) => ({
    ...q,
    concept_name: nameById.get(String(q.concept_id ?? "")) ?? "Unknown",
    grounding_material: materialByConcept.get(String(q.concept_id ?? "")) ?? null,
  }));
}

export async function listPracticeAssignments(projectId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const { data, error } = await db
    .from("practice_assignments")
    .select("id, status, created_at, completed_at, focus_summary, target_count")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingTableError(error, "practice_assignments")) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getPracticeAssignmentWithQuestions(projectId: string, assignmentId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const { data: assignment, error: aErr } = await db
    .from("practice_assignments")
    .select("id, project_id, user_id, status, created_at, completed_at, focus_summary, selection_context, summary")
    .eq("id", assignmentId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (aErr || !assignment) {
    throwIfPracticeTablesMissing(aErr, "practice_assignments");
    throw new Error("Practice assignment not found");
  }
  const { data: questions, error: qErr } = await db
    .from("practice_questions")
    .select("id, concept_id, related_concept_ids, subconcept_label, intent, difficulty, question_type, question, options, selection_reason")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (qErr) {
    throwIfPracticeMcqColumnsMissing(qErr);
    throw new Error(qErr.message);
  }
  const qIds = ((questions ?? []) as Array<{ id: string }>).map((q) => q.id);
  let responseMap = new Map<string, { id: string; question_id: string; response: string; confidence: number | null; score: number | null; evaluation: PracticeEvaluation | null; created_at: string }>();
  if (qIds.length > 0) {
    const { data: responses } = await db.from("practice_responses").select("id, question_id, response, confidence, score, evaluation, created_at").eq("user_id", userId).in("question_id", qIds);
    for (const r of ((responses ?? []) as Array<{ id: string; question_id: string; response: string; confidence: number | null; score: number | string | null; evaluation: unknown; created_at: string }>)) {
      responseMap.set(r.question_id, { ...r, score: r.score !== null ? Number(r.score) : null, evaluation: r.evaluation as PracticeEvaluation | null });
    }
  }
  const conceptIds = [...new Set(((questions ?? []) as Array<{ concept_id: string }>).map((q) => q.concept_id))];
  let conceptMap = new Map<string, string>();
  if (conceptIds.length > 0) {
    const { data: concepts } = await db.from("concepts").select("id, name").in("id", conceptIds);
    for (const c of ((concepts ?? []) as Array<{ id: string; name: string }>)) conceptMap.set(c.id, c.name);
  }
  const enriched = ((questions ?? []) as Array<Record<string, unknown> & { id: string; concept_id: string }>).map((q) => ({
    ...stripPracticeQuestionForTaking(q),
    concept_name: conceptMap.get(q.concept_id) ?? "Unknown",
  }));
  return { assignment, questions: enriched, responses: responseMap, responsesList: Array.from(responseMap.values()) };
}

export async function getPracticeAssignmentDetail(projectId: string, assignmentId: string) {
  const base = await getPracticeAssignmentWithQuestions(projectId, assignmentId);
  const userId = await getCurrentUserId();
  const db = await getDb();
  const qIds = base.questions.map((q) => q.id);
  let fullMap = new Map<string, { reference_answer: string | null; correct_answer: string | null; explanation: string | null }>();
  if (qIds.length > 0) {
    const { data: full, error: fullErr } = await db.from("practice_questions").select("id, reference_answer, correct_answer, explanation").in("id", qIds);
    if (fullErr) throwIfPracticeMcqColumnsMissing(fullErr);
    for (const f of ((full ?? []) as Array<{ id: string; reference_answer: string | null; correct_answer: string | null; explanation: string | null }>)) {
      fullMap.set(f.id, { reference_answer: f.reference_answer, correct_answer: f.correct_answer ?? null, explanation: f.explanation ?? null });
    }
  }
  const questions = base.questions.map((q) => {
    const full = fullMap.get(q.id);
    return {
      ...gatePracticeQuestionForReview(
        {
          ...q,
          reference_answer: full?.reference_answer ?? null,
          correct_answer: full?.correct_answer ?? null,
          explanation: full?.explanation ?? null,
        },
        base.responses.has(q.id)
      ),
    };
  });
  return { assignment: base.assignment, questions, responses: base.responses, responsesList: base.responsesList };
}

/** Map free-text concept mentions to real project concept ids (case-insensitive). */
export function mapMentionsToConceptIds(
  mentions: string[],
  concepts: Array<{ id: string; name: string }>
): Array<{ mention: string; conceptId: string; conceptName: string }> {
  const out: Array<{ mention: string; conceptId: string; conceptName: string }> = [];
  const byLower = new Map(concepts.map((c) => [c.name.toLowerCase(), c]));
  for (const m of mentions) {
    const low = m.toLowerCase();
    // Exact name match first.
    const exact = byLower.get(low.trim());
    if (exact) {
      out.push({ mention: m, conceptId: exact.id, conceptName: exact.name });
      continue;
    }
    // Substring either way (handles "gradient descent intuition" ~ "Gradient Descent").
    const hit = concepts.find((c) => {
      const n = c.name.toLowerCase();
      return low.includes(n) || n.includes(low.slice(0, Math.min(low.length, 40)));
    });
    if (hit) out.push({ mention: m, conceptId: hit.id, conceptName: hit.name });
  }
  // Dedup by concept.
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.conceptId) ? false : (seen.add(x.conceptId), true)));
}

export async function submitPracticeResponse(
  projectId: string,
  assignmentId: string,
  questionId: string,
  response: string,
  confidence?: number | null
): Promise<{
  response: { id: string; question_id: string; response: string; confidence: number | null; score: number | null; evaluation: PracticeEvaluation | null; created_at: string };
  masteryDeltas: Array<{ conceptId: string; conceptName: string; previous: number; evidence: number; newScore: number; source: string }>;
  calibration: "OVERCONFIDENT" | "UNDERCONFIDENT" | "CALIBRATED" | "UNKNOWN";
  assignmentCompleted: boolean;
  assignmentStatus: string;
  /** Disclosed because this question is now being graded (mirrors quiz submit). */
  correct_answer: string | null;
  explanation: string | null;
  reference_answer: string | null;
}> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const trimmed = response.trim();
  if (!trimmed) throw new Error("Response is required");
  if (trimmed.length > 8000) throw new Error("Response too long");
  let conf: number | null = null;
  if (confidence !== undefined && confidence !== null) {
    const n = Number(confidence);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("Confidence must be an integer 1-5");
    conf = n;
  }

  const { data: project, error: projErr } = await db.from("projects").select("id, space_id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const spaceId = (project as { space_id: string }).space_id;

  const { data: assignment, error: aErr } = await db
    .from("practice_assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (aErr || !assignment) {
    throwIfPracticeTablesMissing(aErr, "practice_assignments");
    throw new Error("Practice assignment not found");
  }

  const { data: question, error: qErr } = await db
    .from("practice_questions")
    .select("id, assignment_id, concept_id, related_concept_ids, subconcept_label, intent, difficulty, question_type, question, options, correct_answer, explanation, reference_answer, grounding, selection_reason")
    .eq("id", questionId)
    .eq("assignment_id", assignmentId)
    .single();
  if (qErr || !question) {
    throwIfPracticeMcqColumnsMissing(qErr);
    throwIfPracticeTablesMissing(qErr, "practice_questions");
    throw new Error("Practice question not found in this assignment");
  }
  const qRow = question as {
    id: string; assignment_id: string; concept_id: string; related_concept_ids: string[] | null;
    subconcept_label: string | null; intent: string; difficulty: string; question_type: string | null;
    question: string; options: string[] | null; correct_answer: string | null; explanation: string | null;
    reference_answer: string | null; grounding: unknown; selection_reason: string | null;
  };
  const qType = (qRow.question_type ?? "OPEN_ENDED") as "MCQ" | "OPEN_ENDED";

  // Idempotency: graded response already exists -> return it.
  const { data: existing } = await db.from("practice_responses").select("id, question_id, response, confidence, score, evaluation, created_at").eq("question_id", questionId).eq("user_id", userId).maybeSingle();
  const ea = existing as { id: string; question_id: string; response: string; confidence: number | null; score: number | string | null; evaluation: unknown; created_at: string } | null;
  if (ea && ea.score !== null && ea.evaluation != null) {
    const completion = await tryCompletePracticeIfNeeded(projectId, assignmentId, userId, spaceId);
    const evaluation = ea.evaluation as PracticeEvaluation;
    return {
      response: { id: ea.id, question_id: ea.question_id, response: ea.response, confidence: ea.confidence, score: Number(ea.score), evaluation, created_at: ea.created_at },
      masteryDeltas: await fetchMasteryDeltasForQuestion(projectId, assignmentId, questionId, userId),
      calibration: calibrateConfidence(ea.confidence, Number(ea.score)),
      assignmentCompleted: completion.completedNow || completion.status === "completed",
      assignmentStatus: completion.status,
      correct_answer: qType === "MCQ" ? qRow.correct_answer : null,
      explanation: qType === "MCQ" ? qRow.explanation : null,
      reference_answer: qType === "MCQ" ? null : qRow.reference_answer,
    };
  }

  // Persist pending first so a provider failure never loses the answer.
  let responseId: string | null = ea?.id ?? null;
  if (!responseId) {
    const { data: pending, error: pendErr } = await db
      .from("practice_responses")
      .insert({ question_id: questionId, user_id: userId, response: trimmed, confidence: conf, score: null, evaluation: null })
      .select("id")
      .single();
    if (pendErr || !pending) {
      throwIfPracticeTablesMissing(pendErr, "practice_responses");
      const { data: race } = await db.from("practice_responses").select("id, score, evaluation").eq("question_id", questionId).eq("user_id", userId).maybeSingle();
      const raceRow = race as { id: string; score: number | string | null; evaluation: unknown } | null;
      if (raceRow && raceRow.score !== null && raceRow.evaluation != null) {
        return submitPracticeResponse(projectId, assignmentId, questionId, response, confidence);
      }
      if (raceRow) responseId = raceRow.id;
      else throw new Error("Failed to persist practice response");
    } else {
      responseId = (pending as { id: string }).id;
    }
  } else if (conf !== null) {
    await db.from("practice_responses").update({ confidence: conf, response: trimmed }).eq("id", responseId);
  }

  // Concept context for the evaluation prompt.
  let conceptName = "Unknown";
  let conceptDesc: string | null = null;
  let relatedNames: string[] = [];
  let materialEvidence: string[] = [];
  try {
    const { data: concept } = await db.from("concepts").select("name, description").eq("id", qRow.concept_id).maybeSingle();
    if (concept) {
      conceptName = (concept as { name: string }).name;
      conceptDesc = (concept as { description: string | null }).description;
    }
    const relIds = (qRow.related_concept_ids ?? []) as string[];
    if (relIds.length > 0) {
      const { data: rels } = await db.from("concepts").select("name").in("id", relIds);
      relatedNames = ((rels ?? []) as Array<{ name: string }>).map((r) => r.name);
    } else {
      const { data: others } = await db.from("concepts").select("name").eq("project_id", projectId).neq("id", qRow.concept_id).limit(8);
      relatedNames = ((others ?? []) as Array<{ name: string }>).map((r) => r.name);
    }
    const keywords = conceptName.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    if (keywords.length > 0) {
      const orFilter = keywords.map((k) => `content.ilike.%${k}%`).join(",");
      const { data: chunks } = await db.from("chunks").select("content").eq("project_id", projectId).or(orFilter).limit(3);
      materialEvidence = ((chunks ?? []) as Array<{ content: string }>).map((c) => c.content);
    }
  } catch {
    // context is best-effort
  }

  const userPrompt = buildPracticeEvaluationUserPrompt({
    question: qRow.question,
    intent: qRow.intent,
    referenceAnswer: qRow.reference_answer,
    conceptName,
    conceptDescription: conceptDesc,
    relatedConcepts: relatedNames,
    materialEvidence,
    studentResponse: trimmed,
  });

  const requestId = crypto.randomUUID();
  const start = Date.now();
  let evaluation: PracticeEvaluation;
  if (qType === "MCQ") {
    // Deterministic grading — no LLM call, so multiple-choice evaluation can
    // never be "temporarily unavailable" (same pattern as quiz MCQ).
    const expected = (qRow.correct_answer ?? "").trim();
    if (!expected) throw new Error("This practice question is missing its answer key — please start a new assignment.");
    const isCorrect = trimmed === expected;
    evaluation = {
      score: isCorrect ? 100 : 0,
      understanding_level: isCorrect ? "PROFICIENT" : "EMERGING",
      concepts_demonstrated: isCorrect ? [conceptName] : [],
      concepts_partial: [],
      missing_concepts: isCorrect ? [] : [conceptName],
      misconceptions: [],
      reasoning_quality: isCorrect ? "strong" : "weak",
      evidence_grounding: isCorrect ? "grounded" : "unsupported",
      feedback: isCorrect
        ? `Correct — "${expected}" is right.${qRow.explanation ? ` ${qRow.explanation}` : ""}`
        : `Not quite — the correct answer is "${expected}".${qRow.explanation ? ` ${qRow.explanation}` : ""}`,
      suggested_improvement: isCorrect
        ? `Lock it in: teach "${conceptName}" back in your own words.`
        : `Review "${conceptName}" in your material, then reattempt a similar question.`,
    };
    await db.from("practice_responses").update({ score: evaluation.score, evaluation }).eq("id", responseId);
  } else {
  try {
    const raw = await aiService.generateStructured<unknown>({
      systemPrompt: PRACTICE_EVALUATION_SYSTEM_PROMPT,
      userPrompt,
      schema: PracticeEvaluationSchema,
      temperature: 0.2,
      maxTokens: 1500,
    });
    const latencyMs = Date.now() - start;
    try {
      evaluation = validatePracticeEvaluationOutput(raw);
    } catch (ve) {
      // One validation retry with hint (same pattern as generation).
      const msg = ve instanceof Error ? ve.message : String(ve);
      const retryRaw = await aiService.generateStructured<unknown>({
        systemPrompt: PRACTICE_EVALUATION_SYSTEM_PROMPT,
        userPrompt: userPrompt + "\n\nPrevious output failed validation: " + msg + " — fix the JSON exactly to match the schema.",
        schema: PracticeEvaluationSchema,
        temperature: 0.2,
        maxTokens: 1500,
      });
      evaluation = validatePracticeEvaluationOutput(retryRaw);
      void latencyMs;
    }
    await logAiOperation({ userId, projectId, feature: "PRACTICE_EVALUATION", model: CHAT_MODEL_NAME, requestId, latencyMs: Date.now() - start, success: true });
    await db.from("practice_responses").update({ score: evaluation.score, evaluation }).eq("id", responseId);
  } catch (e) {
    const latencyMs = Date.now() - start;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[PRACTICE_EVALUATION ${requestId}] failed:`, errMsg);
    await logAiOperation({ userId, projectId, feature: "PRACTICE_EVALUATION", model: CHAT_MODEL_NAME, requestId, latencyMs, success: false, error: errMsg.slice(0, 2000) });
    throw new Error("Evaluation temporarily unavailable — your answer is saved. Please submit again to retry grading.");
  }
  }

  // --- Evidence extraction (deterministic; AI never writes state directly) ---
  const { data: allConcepts } = await db.from("concepts").select("id, name").eq("project_id", projectId);
  const conceptList = ((allConcepts ?? []) as Array<{ id: string; name: string }>);
  const nameById = new Map(conceptList.map((c) => [c.id, c.name]));

  const demonstrated = mapMentionsToConceptIds(evaluation.concepts_demonstrated, conceptList).filter((x) => x.conceptId !== qRow.concept_id);
  const partial = mapMentionsToConceptIds(evaluation.concepts_partial, conceptList).filter((x) => x.conceptId !== qRow.concept_id);
  const missing = mapMentionsToConceptIds(evaluation.missing_concepts, conceptList).filter((x) => x.conceptId !== qRow.concept_id);

  // Misconceptions -> attributed to primary concept unless they name another concept.
  const { upsertMisconception } = await import("@/services/misconception.service");
  for (const m of evaluation.misconceptions.slice(0, 3)) {
    try {
      const mapped = mapMentionsToConceptIds([m], conceptList)[0];
      const target = mapped ? mapped.conceptId : qRow.concept_id;
      // Only attribute to a real project concept.
      if (nameById.has(target) || target === qRow.concept_id) {
        await upsertMisconception({ projectId, conceptId: target, description: m });
      }
    } catch (e) {
      console.warn("misconception upsert skipped:", e instanceof Error ? e.message : String(e));
    }
  }

  // Knowledge-graph evidence: demonstrated/partial -> RELATED, missing -> PREREQUISITE.
  try {
    const { upsertConceptEdge } = await import("@/services/knowledge-graph.service");
    for (const d of demonstrated) {
      try {
        await upsertConceptEdge({ projectId, fromConceptId: qRow.concept_id, toConceptId: d.conceptId, relation: "RELATED" });
      } catch { /* validation (e.g. self-loop) — skip */ }
    }
    for (const p of partial) {
      try {
        await upsertConceptEdge({ projectId, fromConceptId: qRow.concept_id, toConceptId: p.conceptId, relation: "RELATED" });
      } catch { /* skip */ }
    }
    for (const m of missing) {
      try {
        // Missing idea needed to answer X is evidence X depends on it.
        await upsertConceptEdge({ projectId, fromConceptId: m.conceptId, toConceptId: qRow.concept_id, relation: "PREREQUISITE" });
      } catch { /* skip */ }
    }
  } catch {
    // graph is additive; never fail grading on it
  }

  // Mastery updates — deterministic backend formula.
  const { applyPracticeEvidence } = await import("@/services/mastery.service");
  const deltas: Array<{ conceptId: string; conceptName: string; previous: number; evidence: number; newScore: number; source: string }> = [];
  const applyOne = async (conceptId: string, evidenceScore: number, source: "primary" | "demonstrated" | "partial" | "missing") => {
    try {
      const r = await applyPracticeEvidence({ projectId, conceptId, userId, spaceId, assignmentId, questionId, evidenceScore, source });
      deltas.push({ conceptId, conceptName: nameById.get(conceptId) ?? "Unknown", previous: r.previous, evidence: r.evidence, newScore: r.newScore, source });
    } catch (e) {
      console.error("practice mastery update failed:", e instanceof Error ? e.message : String(e));
    }
  };
  await applyOne(qRow.concept_id, practiceEvidenceFor("primary", evaluation.score), "primary");
  for (const d of demonstrated) await applyOne(d.conceptId, practiceEvidenceFor("demonstrated", evaluation.score), "demonstrated");
  for (const p of partial) await applyOne(p.conceptId, practiceEvidenceFor("partial", evaluation.score), "partial");
  for (const m of missing) await applyOne(m.conceptId, practiceEvidenceFor("missing", evaluation.score), "missing");

  await emitLearningEvent({
    userId,
    spaceId,
    projectId,
    eventType: "PRACTICE_QUESTION_ANSWERED",
    entityType: "practice_response",
    entityId: responseId!,
    metadata: {
      question_id: questionId,
      assignment_id: assignmentId,
      score: evaluation.score,
      understanding: evaluation.understanding_level,
      reasoning: evaluation.reasoning_quality,
      calibration: calibrateConfidence(conf, evaluation.score),
    },
  });

  const completion = await tryCompletePracticeIfNeeded(projectId, assignmentId, userId, spaceId);
  const { data: graded } = await db.from("practice_responses").select("id, question_id, response, confidence, score, evaluation, created_at").eq("id", responseId!).single();
  const g = graded as { id: string; question_id: string; response: string; confidence: number | null; score: number | string | null; evaluation: unknown; created_at: string };
  return {
    response: { id: g.id, question_id: g.question_id, response: g.response, confidence: g.confidence, score: g.score !== null ? Number(g.score) : null, evaluation: g.evaluation as PracticeEvaluation, created_at: g.created_at },
    masteryDeltas: deltas,
    calibration: calibrateConfidence(conf, evaluation.score),
    assignmentCompleted: completion.completedNow || completion.status === "completed",
    assignmentStatus: completion.status,
    correct_answer: qType === "MCQ" ? qRow.correct_answer : null,
    explanation: qType === "MCQ" ? qRow.explanation : null,
    reference_answer: qType === "MCQ" ? null : qRow.reference_answer,
  };
}

async function fetchMasteryDeltasForQuestion(
  projectId: string,
  assignmentId: string,
  questionId: string,
  userId: string
): Promise<Array<{ conceptId: string; conceptName: string; previous: number; evidence: number; newScore: number; source: string }>> {
  void projectId;
  try {
    const db = getServiceDb();
    const { data } = await db
      .from("mastery_history")
      .select("concept_id, previous_score, new_score, reason")
      .eq("user_id", userId)
      .ilike("reason", `%practice:${assignmentId}:${questionId}%`)
      .order("created_at", { ascending: true })
      .limit(10);
    const { data: concepts } = await db.from("concepts").select("id, name").eq("project_id", projectId).in("id", ((data ?? []) as Array<{ concept_id: string }>).map((r) => r.concept_id));
    const nameById = new Map(((concepts ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    return ((data ?? []) as Array<{ concept_id: string; previous_score: number | string; new_score: number | string; reason: string }>).map((r) => ({
      conceptId: r.concept_id,
      conceptName: nameById.get(r.concept_id) ?? "Unknown",
      previous: Number(r.previous_score),
      evidence: 0,
      newScore: Number(r.new_score),
      source: /source:(\w+)/.exec(r.reason)?.[1] ?? "primary",
    }));
  } catch {
    return [];
  }
}

async function tryCompletePracticeIfNeeded(
  projectId: string,
  assignmentId: string,
  userId: string,
  spaceId: string | null
): Promise<{ completedNow: boolean; status: string }> {
  const db = await getDb();
  const { data: assignment } = await db.from("practice_assignments").select("id, status").eq("id", assignmentId).eq("project_id", projectId).eq("user_id", userId).single();
  if (!assignment) return { completedNow: false, status: "in_progress" };
  const currentStatus = (assignment as { status: string }).status;
  if (currentStatus === "completed") return { completedNow: false, status: "completed" };

  const { data: questions } = await db.from("practice_questions").select("id").eq("assignment_id", assignmentId);
  const qIds = ((questions ?? []) as Array<{ id: string }>).map((q) => q.id);
  if (qIds.length === 0) return { completedNow: false, status: currentStatus };

  const { data: responses } = await db.from("practice_responses").select("question_id, score").eq("user_id", userId).in("question_id", qIds);
  const graded = new Set(
    (((responses ?? []) as Array<{ question_id: string; score: number | string | null }>).filter((r) => r.score !== null).map((r) => r.question_id))
  );
  if (graded.size < qIds.length) return { completedNow: false, status: currentStatus };

  const summary = await buildPracticeSummary(projectId, assignmentId, userId);
  const now = new Date().toISOString();
  await db.from("practice_assignments").update({ status: "completed", completed_at: now, summary }).eq("id", assignmentId).eq("status", "in_progress");
  const { data: refreshed } = await db.from("practice_assignments").select("status").eq("id", assignmentId).single();
  const newStatus = (refreshed as { status: string } | null)?.status ?? "completed";
  if (newStatus !== "completed") return { completedNow: false, status: newStatus };

  try {
    await emitLearningEvent({
      userId,
      spaceId,
      projectId,
      eventType: "PRACTICE_COMPLETED",
      entityType: "practice_assignment",
      entityId: assignmentId,
      metadata: { question_count: qIds.length, understood: summary.understood.length, partial: summary.partial.length, misunderstood: summary.misunderstood.length },
    });
  } catch (e) {
    console.warn("PRACTICE_COMPLETED emit duplicate ignored:", e);
  }

  try {
    await inngest.send({ name: "practice/completed", data: { assignmentId, projectId, userId, spaceId } });
  } catch (e) {
    console.error("Inngest practice/completed failed, fallback direct recommendation:", e);
    setTimeout(async () => {
      try {
        const { generateRecommendationForProject } = await import("@/services/recommendation.service");
        await generateRecommendationForProject({ projectId, userId, spaceId });
      } catch (err) {
        console.error("Fallback recommendation after practice failed:", err);
      }
    }, 100);
  }

  return { completedNow: true, status: "completed" };
}

export interface PracticeSummary {
  understood: Array<{ conceptName: string; score: number }>;
  partial: Array<{ conceptName: string; score: number }>;
  misunderstood: Array<{ conceptName: string; score: number; misconceptions: string[] }>;
  conceptsImproved: Array<{ conceptId: string; conceptName: string; previous: number; current: number; delta: number }>;
  conceptsStillWeak: Array<{ conceptId: string; conceptName: string; current: number | null }>;
  calibration: { overconfident: number; underconfident: number; calibrated: number };
  recommendedNextAction: string;
  prerequisiteNotes: string[];
}

/** Deterministic session summary — the learning artifact (not just a score page). */
export async function buildPracticeSummary(
  projectId: string,
  assignmentId: string,
  userId: string
): Promise<PracticeSummary> {
  const db = await getDb();
  const { data: questions } = await db.from("practice_questions").select("id, concept_id").eq("assignment_id", assignmentId);
  const qRows = (questions ?? []) as Array<{ id: string; concept_id: string }>;
  const qToConcept = new Map(qRows.map((q) => [q.id, q.concept_id]));
  const { data: responses } = qRows.length > 0
    ? await db.from("practice_responses").select("question_id, response, confidence, score, evaluation").eq("user_id", userId).in("question_id", qRows.map((q) => q.id))
    : { data: [] as unknown[] };
  const rRows = (responses ?? []) as Array<{ question_id: string; response: string; confidence: number | null; score: number | string | null; evaluation: PracticeEvaluation | null }>;

  const { data: concepts } = await db.from("concepts").select("id, name").eq("project_id", projectId);
  const nameById = new Map(((concepts ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));

  const understood: PracticeSummary["understood"] = [];
  const partial: PracticeSummary["partial"] = [];
  const misunderstood: PracticeSummary["misunderstood"] = [];
  let overconfident = 0;
  let underconfident = 0;
  let calibrated = 0;

  for (const r of rRows) {
    const cid = qToConcept.get(r.question_id);
    const cname = (cid && nameById.get(cid)) ?? "Unknown";
    const score = r.score !== null ? Number(r.score) : 0;
    const ev = r.evaluation;
    const misc = ev?.misconceptions ?? [];
    if (score >= 70) understood.push({ conceptName: cname, score });
    else if (score >= 40) partial.push({ conceptName: cname, score });
    else misunderstood.push({ conceptName: cname, score, misconceptions: misc });
    const cal = calibrateConfidence(r.confidence, score);
    if (cal === "OVERCONFIDENT") overconfident++;
    else if (cal === "UNDERCONFIDENT") underconfident++;
    else if (cal === "CALIBRATED") calibrated++;
  }

  // Mastery movement for this assignment (first previous -> last new per concept).
  let conceptsImproved: PracticeSummary["conceptsImproved"] = [];
  let conceptsStillWeak: PracticeSummary["conceptsStillWeak"] = [];
  try {
    const svc = getServiceDb();
    const { data: hist } = await svc
      .from("mastery_history")
      .select("concept_id, previous_score, new_score")
      .eq("user_id", userId)
      .ilike("reason", `%practice:${assignmentId}%`)
      .order("created_at", { ascending: true })
      .limit(100);
    const byConcept = new Map<string, Array<{ previous_score: number | string; new_score: number | string }>>();
    for (const h of ((hist ?? []) as Array<{ concept_id: string; previous_score: number | string; new_score: number | string }>)) {
      const arr = byConcept.get(h.concept_id) ?? [];
      arr.push({ previous_score: h.previous_score, new_score: h.new_score });
      byConcept.set(h.concept_id, arr);
    }
    for (const [cid, rows] of byConcept) {
      const prev = Number(rows[0].previous_score);
      const curr = Number(rows[rows.length - 1].new_score);
      conceptsImproved.push({ conceptId: cid, conceptName: nameById.get(cid) ?? "Unknown", previous: prev, current: curr, delta: Math.round((curr - prev) * 100) / 100 });
    }
    conceptsImproved.sort((a, b) => b.delta - a.delta);

    const { data: mastery } = await svc.from("concept_mastery").select("concept_id, mastery_score").eq("project_id", projectId).eq("user_id", userId);
    const curById = new Map(((mastery ?? []) as Array<{ concept_id: string; mastery_score: number | string }>).map((m) => [m.concept_id, Number(m.mastery_score)]));
    const touched = new Set([...qToConcept.values()]);
    for (const cid of touched) {
      const cur = curById.has(cid) ? curById.get(cid)! : null;
      if (cur === null || cur < 60) conceptsStillWeak.push({ conceptId: cid, conceptName: nameById.get(cid) ?? "Unknown", current: cur });
    }
    conceptsStillWeak.sort((a, b) => (a.current ?? -1) - (b.current ?? -1));
  } catch {
    // summary degrades gracefully without mastery movement
  }

  // Prerequisite notes: weak concept whose prerequisite is also weak -> practice prereq first.
  const prerequisiteNotes: string[] = [];
  try {
    const { data: edges } = await db.from("concept_edges").select("from_concept_id, to_concept_id, relation").eq("project_id", projectId).eq("relation", "PREREQUISITE").limit(100);
    const edgeList = ((edges ?? []) as Array<{ from_concept_id: string; to_concept_id: string; relation: string }>);
    const svc = getServiceDb();
    const { data: mastery } = await svc.from("concept_mastery").select("concept_id, mastery_score").eq("project_id", projectId).eq("user_id", userId);
    const masteryMap = new Map(((mastery ?? []) as Array<{ concept_id: string; mastery_score: number | string }>).map((m) => [m.concept_id, Number(m.mastery_score)]));
    for (const w of conceptsStillWeak.slice(0, 4)) {
      const pres = edgeList.filter((e) => e.to_concept_id === w.conceptId).map((e) => e.from_concept_id);
      for (const pre of pres) {
        if ((masteryMap.get(pre) ?? 0) < 60) {
          prerequisiteNotes.push(`Practice "${nameById.get(pre) ?? "prerequisite"}" before "${w.conceptName}" — it unlocks ${w.conceptName}.`);
        }
      }
    }
  } catch {
    // best-effort
  }

  // Recommended next action — deterministic priority:
  // repeated misconception > prerequisite chain > still-weak review > application stretch > tutor.
  let recommendedNextAction: string;
  const topMis = misunderstood.find((m) => m.misconceptions.length > 0);
  if (topMis) {
    recommendedNextAction = `Reattempt "${topMis.conceptName}" — address: ${topMis.misconceptions[0].slice(0, 140)}. Then teach it back in your own words.`;
  } else if (prerequisiteNotes.length > 0) {
    recommendedNextAction = prerequisiteNotes[0];
  } else if (conceptsStillWeak.length > 0) {
    recommendedNextAction = `Review "${conceptsStillWeak[0].conceptName}" in your material, then try an application-based practice question.`;
  } else if (partial.length > 0) {
    recommendedNextAction = `Strengthen "${partial[0].conceptName}" with a scenario-based question — you are close.`;
  } else {
    recommendedNextAction = `Ask the Tutor to stretch you on "${understood[0]?.conceptName ?? "your strongest concept"}" with a teach-back challenge.`;
  }

  return {
    understood,
    partial,
    misunderstood,
    conceptsImproved,
    conceptsStillWeak,
    calibration: { overconfident, underconfident, calibrated },
    recommendedNextAction,
    prerequisiteNotes: prerequisiteNotes.slice(0, 4),
  };
}

export async function getPracticeSummary(projectId: string, assignmentId: string): Promise<PracticeSummary> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");
  const { data: assignment, error: aErr } = await db
    .from("practice_assignments")
    .select("id, summary, status")
    .eq("id", assignmentId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (aErr || !assignment) {
    throwIfPracticeTablesMissing(aErr, "practice_assignments");
    throw new Error("Practice assignment not found");
  }
  const row = assignment as { summary: PracticeSummary | null; status: string };
  if (row.summary && typeof row.summary === "object" && "understood" in row.summary) return row.summary;
  return buildPracticeSummary(projectId, assignmentId, userId);
}

// Re-export for tests that import the formula from the practice path.
export { computeNewMastery };
