import { getServiceDb } from "@/lib/db/supabase";

/**
 * Deterministic mastery formula — plain backend code, LLM never sets mastery.
 * new_mastery = previous * 0.7 + evidence * 0.3
 * Clamped 0..100, rounded to 2 decimals.
 */
export function computeNewMastery(previousMastery: number, latestEvidenceScore: number): number {
  const raw = previousMastery * 0.7 + latestEvidenceScore * 0.3;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 100) / 100;
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
