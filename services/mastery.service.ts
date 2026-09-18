import { getServiceDb } from "@/lib/db/supabase";
import { getDb } from "@/lib/db/supabase";
import { summarizeHistoryTrend } from "./growth.service";

/**
 * Deterministic mastery formula — plain backend code, LLM never sets mastery.
 * new_mastery = previous * (1 - weight) + evidence * weight
 * Clamped 0..100, rounded to 2 decimals.
 *
 * Source weights (pedagogically motivated, explainable in UI):
 *  - QUIZ / PRACTICE (graded): weight 0.3 — strong, verified evidence.
 *  - FLASHCARD (self-reported recall): weight 0.15 — gentle nudge so
 *    "Got it" can't game mastery, but consistent recall still moves it.
 */
export const MASTERY_WEIGHTS = {
  QUIZ: 0.3,
  PRACTICE: 0.3,
  FLASHCARD: 0.15,
} as const;

/** Flashcard self-report → deterministic evidence score. */
export const FLASHCARD_EVIDENCE = {
  KNOWN: 85, // "Got it" — strong recall, capped below perfect (not graded)
  LEARNING: 20, // "Still learning" — weak recall
} as const;

export function computeNewMasteryWeighted(
  previousMastery: number,
  latestEvidenceScore: number,
  weight: number = MASTERY_WEIGHTS.QUIZ
): number {
  const w = Math.max(0, Math.min(1, weight));
  const raw = previousMastery * (1 - w) + latestEvidenceScore * w;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 100) / 100;
}

export function computeNewMastery(previousMastery: number, latestEvidenceScore: number): number {
  return computeNewMasteryWeighted(previousMastery, latestEvidenceScore, MASTERY_WEIGHTS.QUIZ);
}

export function flashcardEvidenceFor(result: "known" | "learning"): number {
  return result === "known" ? FLASHCARD_EVIDENCE.KNOWN : FLASHCARD_EVIDENCE.LEARNING;
}

async function emitMasteryUpdated(params: {
  userId: string;
  spaceId: string | null;
  projectId: string;
  conceptId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getServiceDb();
  const { error } = await db.from("learning_events").insert({
    user_id: params.userId,
    space_id: params.spaceId,
    project_id: params.projectId,
    event_type: "MASTERY_UPDATED",
    entity_type: "concept",
    entity_id: params.conceptId,
    metadata: params.metadata ?? null,
  });
  if (error) console.error("Failed to emit MASTERY_UPDATED:", error);
}

/**
 * Main entry called by Inngest function (and fallback) when a quiz completes.
 * For each concept touched by the quiz:
 *  - aggregate latest_evidence_score (MCQ is_correct→100/0, OPEN_ENDED score, avg if multiple)
 *  - compute new_mastery = previous*0.7 + evidence*0.3
 *  - upsert concept_mastery (mastery_score + evidence jsonb)
 *  - insert mastery_history (previous/new/reason)
 *  - emit MASTERY_UPDATED
 *
 * Idempotent per (quizId, conceptId): if mastery_history already contains this quiz,
 * or concept_mastery evidence.quiz_id === quizId, skip.
 */
export async function updateMasteryForQuiz(params: {
  quizId: string;
  projectId: string;
  userId: string;
  spaceId?: string | null;
}): Promise<{ updated: Array<{ conceptId: string; previous: number; evidence: number; newScore: number }>; skipped: string[] }> {
  const { quizId, projectId, userId } = params;
  const spaceId = params.spaceId ?? null;
  const db = getServiceDb();

  // Fetch quiz questions for this quiz (concept linkage)
  const { data: questions, error: qErr } = await db
    .from("questions")
    .select("id, concept_id")
    .eq("quiz_id", quizId);
  if (qErr) throw new Error(`Failed to fetch questions for mastery: ${qErr.message}`);
  const qRows = (questions ?? []) as Array<{ id: string; concept_id: string }>;
  if (qRows.length === 0) return { updated: [], skipped: [] };

  // Group question ids by concept
  const byConcept = new Map<string, string[]>();
  for (const q of qRows) {
    const arr = byConcept.get(q.concept_id) ?? [];
    arr.push(q.id);
    byConcept.set(q.concept_id, arr);
  }

  const questionIds = qRows.map((q) => q.id);
  const { data: answers, error: aErr } = await db
    .from("answers")
    .select("question_id, is_correct, score")
    .eq("user_id", userId)
    .in("question_id", questionIds);
  if (aErr) throw new Error(`Failed to fetch answers for mastery: ${aErr.message}`);
  const aRows = (answers ?? []) as Array<{ question_id: string; is_correct: boolean | null; score: number | string | null }>;
  const answerByQid = new Map<string, { is_correct: boolean | null; score: number | null }>();
  for (const a of aRows) {
    answerByQid.set(a.question_id, {
      is_correct: a.is_correct,
      score: a.score !== null ? Number(a.score) : null,
    });
  }

  // Verify project ownership still valid? Not strictly needed for service DB but guard
  const updated: Array<{ conceptId: string; previous: number; evidence: number; newScore: number }> = [];
  const skipped: string[] = [];

  for (const [conceptId, qIds] of byConcept.entries()) {
    // Gather evidence scores for this concept
    const scores: number[] = [];
    const questionScores: Array<{ questionId: string; score: number }> = [];
    for (const qid of qIds) {
      const ans = answerByQid.get(qid);
      if (!ans) continue; // quiz should be completed so should exist, but skip if missing
      let s: number | null = null;
      if (ans.score !== null) s = ans.score;
      else if (ans.is_correct !== null) s = ans.is_correct ? 100 : 0;
      if (s !== null) {
        scores.push(s);
        questionScores.push({ questionId: qid, score: s });
      }
    }
    if (scores.length === 0) {
      skipped.push(conceptId);
      continue;
    }
    const evidenceScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Idempotency: check mastery_history already has this quiz for this concept
    try {
      const { data: existing } = await db
        .from("mastery_history")
        .select("id")
        .eq("concept_id", conceptId)
        .eq("user_id", userId)
        .ilike("reason", `%${quizId}%`)
        .limit(1)
        .maybeSingle();
      if (existing) {
        skipped.push(conceptId);
        continue;
      }
    } catch {
      // ignore check failure, proceed
    }

    // Also check concept_mastery evidence quiz_id
    const { data: masteryRow } = await db
      .from("concept_mastery")
      .select("id, mastery_score, evidence")
      .eq("project_id", projectId)
      .eq("concept_id", conceptId)
      .eq("user_id", userId)
      .maybeSingle();

    const typedMastery = masteryRow as { id: string; mastery_score: number | string; evidence: unknown } | null;
    const previous = typedMastery ? Number(typedMastery.mastery_score) : 0;
    const existingEvidence = typedMastery?.evidence as { quiz_id?: string } | null | undefined;
    if (existingEvidence && typeof existingEvidence === "object" && "quiz_id" in existingEvidence && existingEvidence.quiz_id === quizId) {
      skipped.push(conceptId);
      continue;
    }

    const newScore = computeNewMastery(previous, evidenceScore);

    const evidencePayload = {
      quiz_id: quizId,
      concept_id: conceptId,
      previous_score: previous,
      new_score: newScore,
      evidence_score: Math.round(evidenceScore * 100) / 100,
      question_count: qIds.length,
      question_ids: qIds,
      question_scores: questionScores,
      computed_at: new Date().toISOString(),
    };

    // Upsert concept_mastery
    if (typedMastery) {
      const { error: updErr } = await db
        .from("concept_mastery")
        .update({ mastery_score: newScore, evidence: evidencePayload, updated_at: new Date().toISOString() })
        .eq("id", typedMastery.id);
      if (updErr) {
        console.error(`Failed to update concept_mastery ${conceptId}:`, updErr);
        continue;
      }
    } else {
      const { error: insErr } = await db.from("concept_mastery").insert({
        project_id: projectId,
        concept_id: conceptId,
        user_id: userId,
        mastery_score: newScore,
        evidence: evidencePayload,
      });
      if (insErr) {
        // Handle race where concurrent insert won
        const { data: raceRow } = await db
          .from("concept_mastery")
          .select("id, mastery_score, evidence")
          .eq("project_id", projectId)
          .eq("concept_id", conceptId)
          .eq("user_id", userId)
          .maybeSingle();
        if (raceRow) {
          const raceEvidence = (raceRow as { evidence: unknown }).evidence as { quiz_id?: string } | null | undefined;
          if (raceEvidence && typeof raceEvidence === "object" && "quiz_id" in raceEvidence && (raceEvidence as { quiz_id: string }).quiz_id === quizId) {
            skipped.push(conceptId);
            continue;
          }
          // Recompute based on latest? For idempotency just skip second concurrent update
          skipped.push(conceptId);
          continue;
        }
        console.error(`Failed to insert concept_mastery ${conceptId}:`, insErr);
        continue;
      }
    }

    // Insert mastery_history
    const { error: histErr } = await db.from("mastery_history").insert({
      concept_id: conceptId,
      user_id: userId,
      previous_score: previous,
      new_score: newScore,
      reason: `quiz:${quizId} evidence:${Math.round(evidenceScore * 100) / 100} questions:${qIds.length}`,
    });
    if (histErr) {
      console.error(`Failed to insert mastery_history ${conceptId}:`, histErr);
      // Not fatal — mastery already updated, but log
    }

    await emitMasteryUpdated({
      userId,
      spaceId,
      projectId,
      conceptId,
      metadata: { quiz_id: quizId, previous_score: previous, new_score: newScore, evidence_score: evidenceScore, question_count: qIds.length },
    });

    updated.push({ conceptId, previous, evidence: Math.round(evidenceScore * 100) / 100, newScore });
  }

  return { updated, skipped };
}

/**
 * Practice evidence — deterministic single-concept update.
 * Same 0.7/0.3 formula as quizzes; the LLM only produced the evidence score.
 *
 * Evidence mapping (explainable, documented in practice.service.ts):
 *  - primary concept: evidence = evaluation score (0-100)
 *  - demonstrated secondary: 80 (learner showed this idea well)
 *  - partial secondary: 50 (shaky / incomplete)
 *  - missing secondary: min(score, 30) (absent or wrong)
 *
 * Idempotent per (questionId, conceptId): history reason embeds both, so a
 * retry / double-submit never double-applies. Callers pass a stable
 * `source` of "primary" | "demonstrated" | "partial" | "missing".
 */
export async function applyPracticeEvidence(params: {
  projectId: string;
  conceptId: string;
  userId: string;
  spaceId?: string | null;
  assignmentId: string;
  questionId: string;
  evidenceScore: number;
  source: "primary" | "demonstrated" | "partial" | "missing";
}): Promise<{ previous: number; evidence: number; newScore: number; skipped: boolean }> {
  const { projectId, conceptId, userId, assignmentId, questionId, source } = params;
  const spaceId = params.spaceId ?? null;
  const evidence = Math.max(0, Math.min(100, Math.round(params.evidenceScore * 100) / 100));
  const db = getServiceDb();

  // Idempotency: same question+concept already recorded?
  try {
    const { data: existing } = await db
      .from("mastery_history")
      .select("id")
      .eq("concept_id", conceptId)
      .eq("user_id", userId)
      .ilike("reason", `%practice:${assignmentId}:${questionId}:${conceptId}%`)
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { data: cur } = await db
        .from("concept_mastery")
        .select("mastery_score")
        .eq("project_id", projectId)
        .eq("concept_id", conceptId)
        .eq("user_id", userId)
        .maybeSingle();
      const current = cur ? Number((cur as { mastery_score: number | string }).mastery_score) : 0;
      return { previous: current, evidence, newScore: current, skipped: true };
    }
  } catch {
    // check is best-effort; proceed
  }

  const { data: masteryRow } = await db
    .from("concept_mastery")
    .select("id, mastery_score")
    .eq("project_id", projectId)
    .eq("concept_id", conceptId)
    .eq("user_id", userId)
    .maybeSingle();
  const typed = masteryRow as { id: string; mastery_score: number | string } | null;
  const previous = typed ? Number(typed.mastery_score) : 0;
  const newScore = computeNewMastery(previous, evidence);
  const evidencePayload = {
    practice_assignment_id: assignmentId,
    practice_question_id: questionId,
    concept_id: conceptId,
    source,
    previous_score: previous,
    new_score: newScore,
    evidence_score: evidence,
    computed_at: new Date().toISOString(),
  };

  if (typed) {
    const { error } = await db
      .from("concept_mastery")
      .update({ mastery_score: newScore, evidence: evidencePayload, updated_at: new Date().toISOString() })
      .eq("id", typed.id);
    if (error) throw new Error(`Failed to update mastery: ${error.message}`);
  } else {
    const { error } = await db.from("concept_mastery").insert({
      project_id: projectId,
      concept_id: conceptId,
      user_id: userId,
      mastery_score: newScore,
      evidence: evidencePayload,
    });
    if (error) {
      // Concurrent insert race — treat as skipped (winner holds the update).
      const { data: raceRow } = await db
        .from("concept_mastery")
        .select("mastery_score")
        .eq("project_id", projectId)
        .eq("concept_id", conceptId)
        .eq("user_id", userId)
        .maybeSingle();
      const current = raceRow ? Number((raceRow as { mastery_score: number | string }).mastery_score) : previous;
      return { previous, evidence, newScore: current, skipped: true };
    }
  }

  await db.from("mastery_history").insert({
    concept_id: conceptId,
    user_id: userId,
    previous_score: previous,
    new_score: newScore,
    reason: `practice:${assignmentId}:${questionId}:${conceptId} source:${source} evidence:${evidence}`,
  });

  await emitMasteryUpdated({
    userId,
    spaceId,
    projectId,
    conceptId,
    metadata: {
      practice_assignment_id: assignmentId,
      practice_question_id: questionId,
      source,
      previous_score: previous,
      new_score: newScore,
      evidence_score: evidence,
    },
  });

  return { previous, evidence, newScore, skipped: false };
}

/**
 * Flashcard evidence — deterministic single-concept update with a GENTLER
 * weight (0.15) than graded quiz/practice (0.3), because it is self-reported
 * recall, not graded assessment.
 *
 * Evidence mapping:
 *  - "known" (Got it): 85 — strong recall, capped below perfect
 *  - "learning" (Still learning): 20 — weak recall
 *
 * Idempotent per reviewId: callers pass a client-generated UUID per card flip
 * (`flashcard:<reviewId>:<conceptId>` in history reason), so retries /
 * double-clicks never double-apply. Each distinct review is distinct evidence.
 */
export async function applyFlashcardEvidence(params: {
  projectId: string;
  conceptId: string;
  userId: string;
  spaceId?: string | null;
  reviewId: string;
  result: "known" | "learning";
}): Promise<{ previous: number; evidence: number; newScore: number; skipped: boolean }> {
  const { projectId, conceptId, userId, reviewId, result } = params;
  const spaceId = params.spaceId ?? null;
  const trimmedReview = (reviewId ?? "").trim();
  if (!trimmedReview) throw new Error("reviewId is required");
  if (result !== "known" && result !== "learning") throw new Error("result must be known|learning");
  const evidence = flashcardEvidenceFor(result);
  const db = getServiceDb();

  // Verify concept belongs to project (ownership guard, cheap).
  try {
    const { data: concept } = await db
      .from("concepts")
      .select("id")
      .eq("id", conceptId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!concept) throw new Error("Concept not found in this project");
  } catch (e) {
    if (e instanceof Error && e.message.includes("Concept not found")) throw e;
    // best-effort guard — proceed on transient failures
  }

  // Idempotency: same review already recorded?
  try {
    const { data: existing } = await db
      .from("mastery_history")
      .select("id")
      .eq("concept_id", conceptId)
      .eq("user_id", userId)
      .ilike("reason", `%flashcard:${trimmedReview}%`)
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { data: cur } = await db
        .from("concept_mastery")
        .select("mastery_score")
        .eq("project_id", projectId)
        .eq("concept_id", conceptId)
        .eq("user_id", userId)
        .maybeSingle();
      const current = cur ? Number((cur as { mastery_score: number | string }).mastery_score) : 0;
      return { previous: current, evidence, newScore: current, skipped: true };
    }
  } catch {
    // check is best-effort; proceed
  }

  const { data: masteryRow } = await db
    .from("concept_mastery")
    .select("id, mastery_score")
    .eq("project_id", projectId)
    .eq("concept_id", conceptId)
    .eq("user_id", userId)
    .maybeSingle();
  const typed = masteryRow as { id: string; mastery_score: number | string } | null;
  const previous = typed ? Number(typed.mastery_score) : 0;
  const newScore = computeNewMasteryWeighted(previous, evidence, MASTERY_WEIGHTS.FLASHCARD);
  const evidencePayload = {
    flashcard_review_id: trimmedReview,
    concept_id: conceptId,
    result,
    previous_score: previous,
    new_score: newScore,
    evidence_score: evidence,
    weight: MASTERY_WEIGHTS.FLASHCARD,
    computed_at: new Date().toISOString(),
  };

  if (typed) {
    const { error } = await db
      .from("concept_mastery")
      .update({ mastery_score: newScore, evidence: evidencePayload, updated_at: new Date().toISOString() })
      .eq("id", typed.id);
    if (error) throw new Error(`Failed to update mastery: ${error.message}`);
  } else {
    const { error } = await db.from("concept_mastery").insert({
      project_id: projectId,
      concept_id: conceptId,
      user_id: userId,
      mastery_score: newScore,
      evidence: evidencePayload,
    });
    if (error) {
      const { data: raceRow } = await db
        .from("concept_mastery")
        .select("mastery_score")
        .eq("project_id", projectId)
        .eq("concept_id", conceptId)
        .eq("user_id", userId)
        .maybeSingle();
      const current = raceRow ? Number((raceRow as { mastery_score: number | string }).mastery_score) : previous;
      return { previous, evidence, newScore: current, skipped: true };
    }
  }

  await db.from("mastery_history").insert({
    concept_id: conceptId,
    user_id: userId,
    previous_score: previous,
    new_score: newScore,
    reason: `flashcard:${trimmedReview}:${conceptId} source:flashcard result:${result} evidence:${evidence}`,
  });

  await emitMasteryUpdated({
    userId,
    spaceId,
    projectId,
    conceptId,
    metadata: {
      flashcard_review_id: trimmedReview,
      result,
      previous_score: previous,
      new_score: newScore,
      evidence_score: evidence,
      weight: MASTERY_WEIGHTS.FLASHCARD,
    },
  });

  return { previous, evidence, newScore, skipped: false };
}

/**
 * Thin-service entry for POST /api/projects/[projectId]/flashcards/review.
 * Keeps the route handler thin (no direct DB in the route): validates
 * ownership via request-scoped RLS, then records flashcard evidence via the
 * service DB. Returns the mastery delta + resolved reviewId.
 */
export async function recordFlashcardReview(params: {
  projectId: string;
  conceptId: string;
  userId: string;
  result: "known" | "learning";
  reviewId?: string;
}): Promise<{
  reviewId: string;
  conceptId: string;
  result: "known" | "learning";
  previous: number;
  evidence: number;
  newScore: number;
  skipped: boolean;
}> {
  const { projectId, conceptId, userId } = params;
  const result = params.result;
  if (!conceptId?.trim()) throw new Error("concept_id is required");
  if (result !== "known" && result !== "learning") throw new Error('result must be "known" or "learning"');
  const reviewId = (params.reviewId ?? "").trim().slice(0, 64) || crypto.randomUUID();

  const db = await getDb();
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, space_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");
  const spaceId = (project as { space_id: string }).space_id;

  const r = await applyFlashcardEvidence({ projectId, conceptId: conceptId.trim(), userId, spaceId, reviewId, result });
  return { reviewId, conceptId: conceptId.trim(), result, previous: r.previous, evidence: r.evidence, newScore: r.newScore, skipped: r.skipped };
}

// ---------------------------------------------------------------------------
// Unified overview — one query set powers the redesigned Mastery page.
// Merges quiz + practice + flashcard history so learners see HOW each
// concept was mastered, not just a number.
// ---------------------------------------------------------------------------

export type MasteryTrend = "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";
export type MasterySource = "quiz" | "practice" | "flashcard";

// Bands live in lib/mastery-level (client-safe); re-exported here so existing
// `@/services/mastery.service` imports keep working unchanged.
export { masteryLevelFor, MASTERY_LEVEL_META, type MasteryLevel } from "@/lib/mastery-level";
import { masteryLevelFor, type MasteryLevel } from "@/lib/mastery-level";

/* Trend classification lives in growth.service (summarizeHistoryTrend) so
   mastery, growth, and analytics classify identically — see usage below. */

export interface MasterySourceBreakdown {
  quizCount: number;
  practiceCount: number;
  flashcardKnown: number;
  flashcardLearning: number;
  flashcardCount: number;
  totalEvents: number;
  lastSource: MasterySource | null;
  lastAt: string | null;
}

export interface MasteryHistoryPoint {
  previousScore: number;
  newScore: number;
  reason: string | null;
  createdAt: string;
  source: MasterySource | null;
}

export interface MasteryOverviewEntry {
  conceptId: string;
  conceptName: string;
  description: string | null;
  sourceMaterialId: string | null;
  materialName: string | null;
  currentScore: number | null;
  previousScore: number | null;
  delta: number | null;
  trend: MasteryTrend;
  historyCount: number;
  level: MasteryLevel;
  sources: MasterySourceBreakdown;
  sparkline: number[];
  history: MasteryHistoryPoint[];
  lastUpdatedAt: string | null;
}

export interface MasteryOverviewSummary {
  total: number;
  tested: number;
  untested: number;
  avg: number | null;
  distribution: Record<MasteryLevel, number>;
  improving: number;
  stable: number;
  attention: number;
  quizEvents: number;
  practiceEvents: number;
  flashcardReviews: number;
  flashcardKnownRate: number | null;
}

export interface MasteryOverview {
  entries: MasteryOverviewEntry[];
  summary: MasteryOverviewSummary;
}

function parseHistorySource(reason: string | null): { source: MasterySource | null; flashcardResult: "known" | "learning" | null } {
  if (!reason) return { source: null, flashcardResult: null };
  const low = reason.toLowerCase();
  if (low.startsWith("quiz:")) return { source: "quiz", flashcardResult: null };
  if (low.startsWith("practice:")) return { source: "practice", flashcardResult: null };
  if (low.startsWith("flashcard:")) {
    const m = /result:(known|learning|got_it|still_learning)/.exec(low);
    const raw = m?.[1] ?? null;
    const result = raw === "known" || raw === "got_it" ? "known" : raw ? "learning" : "learning";
    return { source: "flashcard", flashcardResult: result };
  }
  return { source: null, flashcardResult: null };
}

/**
 * Unified mastery overview for one project: current score + level + trend +
 * per-source evidence (quiz / practice / flashcards) + sparkline + recent
 * history. Single batched history fetch — no N+1.
 */
export async function getMasteryOverview(
  projectId: string,
  opts?: { userId?: string; useServiceDb?: boolean }
): Promise<MasteryOverview> {
  let userId = opts?.userId ?? null;
  let db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>;
  if (opts?.useServiceDb) {
    const { getServiceDb: svc } = await import("@/lib/db/supabase");
    db = svc();
    if (!userId) throw new Error("userId required with useServiceDb");
  } else {
    if (!userId) {
      const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
      userId = await getCurrentUserId();
    }
    db = await getDb();
    const { data: owned } = await (db as Awaited<ReturnType<typeof getDb>>)
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId!)
      .single();
    if (!owned) throw new Error("Project not found");
  }

  const typedDb = db as Awaited<ReturnType<typeof getDb>>;
  const [conceptsRes, masteryRes, materialsRes] = await Promise.all([
    typedDb
      .from("concepts")
      .select("id, name, description, source_material_id")
      .eq("project_id", projectId)
      .order("name", { ascending: true }),
    typedDb
      .from("concept_mastery")
      .select("concept_id, mastery_score, updated_at")
      .eq("project_id", projectId)
      .eq("user_id", userId!),
    typedDb.from("materials").select("id, filename").eq("project_id", projectId),
  ]);
  if (conceptsRes.error) throw new Error(`Failed to fetch concepts: ${conceptsRes.error.message}`);
  const conceptRows = (conceptsRes.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    source_material_id: string | null;
  }>;
  if (conceptRows.length === 0) {
    return {
      entries: [],
      summary: {
        total: 0, tested: 0, untested: 0, avg: null,
        distribution: { UNTESTED: 0, EMERGING: 0, DEVELOPING: 0, PROFICIENT: 0, MASTERED: 0 },
        improving: 0, stable: 0, attention: 0,
        quizEvents: 0, practiceEvents: 0, flashcardReviews: 0, flashcardKnownRate: null,
      },
    };
  }

  const masteryByConcept = new Map<string, { score: number; updatedAt: string | null }>();
  for (const r of ((masteryRes.data ?? []) as Array<{
    concept_id: string;
    mastery_score: number | string;
    updated_at?: string | null;
  }>)) {
    masteryByConcept.set(r.concept_id, { score: Number(r.mastery_score), updatedAt: r.updated_at ?? null });
  }
  const materialNameById = new Map<string, string>();
  for (const m of ((materialsRes.data ?? []) as Array<{ id: string; filename: string }>)) {
    materialNameById.set(m.id, m.filename);
  }

  const { data: historyRows, error: histErr } = await typedDb
    .from("mastery_history")
    .select("concept_id, previous_score, new_score, reason, created_at")
    .eq("user_id", userId!)
    .in("concept_id", conceptRows.map((c) => c.id))
    .order("created_at", { ascending: false })
    .limit(3000);
  if (histErr) throw new Error(`Failed to fetch mastery history: ${histErr.message}`);

  const byConcept = new Map<
    string,
    Array<{ previous_score: number | string; new_score: number | string; reason: string | null; created_at: string }>
  >();
  for (const h of ((historyRows ?? []) as Array<{
    concept_id: string;
    previous_score: number | string;
    new_score: number | string;
    reason: string | null;
    created_at: string;
  }>)) {
    const arr = byConcept.get(h.concept_id) ?? [];
    arr.push({ previous_score: h.previous_score, new_score: h.new_score, reason: h.reason, created_at: h.created_at });
    byConcept.set(h.concept_id, arr);
  }

  const entries: MasteryOverviewEntry[] = [];
  let quizEvents = 0;
  let practiceEvents = 0;
  let flashcardReviews = 0;
  let flashcardKnownTotal = 0;

  for (const c of conceptRows) {
    const h = byConcept.get(c.id) ?? [];
    const mastery = masteryByConcept.get(c.id) ?? null;
    const currentScore = mastery ? mastery.score : h.length > 0 ? Number(h[0].new_score) : null;

    // Shared rule with growth/analytics: a trend needs 2 results; a single
    // result is evidence without a trend (delta null → "New" in the UI).
    const summarized = summarizeHistoryTrend(h);
    const previousScore: number | null = summarized.previousScore;
    const delta: number | null = summarized.delta;
    const trend: MasteryTrend = summarized.trend;

    // Per-source breakdown from reason prefixes (newest-first already).
    let qCount = 0;
    let pCount = 0;
    let fKnown = 0;
    let fLearning = 0;
    let lastSource: MasterySource | null = null;
    let lastAt: string | null = h.length > 0 ? h[0].created_at : null;
    const history: MasteryHistoryPoint[] = [];
    for (let i = 0; i < h.length; i++) {
      const row = h[i];
      const parsed = parseHistorySource(row.reason);
      if (parsed.source === "quiz") qCount++;
      else if (parsed.source === "practice") pCount++;
      else if (parsed.source === "flashcard") {
        if (parsed.flashcardResult === "known") fKnown++;
        else fLearning++;
      }
      if (i === 0) lastSource = parsed.source;
      history.push({
        previousScore: Number(row.previous_score),
        newScore: Number(row.new_score),
        reason: row.reason,
        createdAt: row.created_at,
        source: parsed.source,
      });
    }
    quizEvents += qCount;
    practiceEvents += pCount;
    flashcardReviews += fKnown + fLearning;
    flashcardKnownTotal += fKnown;

    // Sparkline: oldest → newest, last 12 points.
    const sparkline = [...h]
      .reverse()
      .slice(-12)
      .map((r) => Math.round(Number(r.new_score) * 100) / 100);

    entries.push({
      conceptId: c.id,
      conceptName: c.name,
      description: c.description,
      sourceMaterialId: c.source_material_id ?? null,
      materialName: c.source_material_id ? (materialNameById.get(c.source_material_id) ?? null) : null,
      currentScore,
      previousScore,
      delta,
      trend,
      historyCount: h.length,
      level: masteryLevelFor(currentScore),
      sources: {
        quizCount: qCount,
        practiceCount: pCount,
        flashcardKnown: fKnown,
        flashcardLearning: fLearning,
        flashcardCount: fKnown + fLearning,
        totalEvents: h.length,
        lastSource,
        lastAt,
      },
      sparkline,
      history: history.slice(0, 8),
      lastUpdatedAt: mastery?.updatedAt ?? lastAt,
    });
  }

  // Weakest-first default (untested counts as -1 so gaps surface at top).
  entries.sort((a, b) => (a.currentScore ?? -1) - (b.currentScore ?? -1));

  const tested = entries.filter((e) => e.currentScore !== null);
  const avg =
    tested.length > 0
      ? Math.round((tested.reduce((s, e) => s + (e.currentScore ?? 0), 0) / tested.length) * 100) / 100
      : null;
  const distribution: Record<MasteryLevel, number> = {
    UNTESTED: 0, EMERGING: 0, DEVELOPING: 0, PROFICIENT: 0, MASTERED: 0,
  };
  for (const e of entries) distribution[e.level]++;
  const improving = entries.filter((e) => e.trend === "IMPROVING").length;
  const attention = entries.filter((e) => e.trend === "REQUIRES_ATTENTION").length;
  const stable = entries.length - improving - attention;

  return {
    entries,
    summary: {
      total: entries.length,
      tested: tested.length,
      untested: entries.length - tested.length,
      avg,
      distribution,
      improving,
      stable,
      attention,
      quizEvents,
      practiceEvents,
      flashcardReviews,
      flashcardKnownRate:
        flashcardReviews > 0 ? Math.round((flashcardKnownTotal / flashcardReviews) * 10000) / 100 : null,
    },
  };
}
