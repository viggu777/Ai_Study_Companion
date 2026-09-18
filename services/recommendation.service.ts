import { getDb, getServiceDb } from "@/lib/db/supabase";
import { aiService, CHAT_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import {
  RECOMMENDATION_SYSTEM_PROMPT,
  RecommendationSchema,
  buildRecommendationUserPrompt,
  validateRecommendationOutput,
} from "@/ai/recommendation";
import { getGrowthAnalysis, type Trend } from "./growth.service";

async function emitLearningEventViaServiceDb(params: {
  userId: string;
  spaceId?: string | null;
  projectId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getServiceDb();
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

async function getProjectMeta(projectId: string, db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>) {
  const { data } = await (db as Awaited<ReturnType<typeof getDb>>)
    .from("projects")
    .select("id, name, learning_goal, space_id")
    .eq("id", projectId)
    .single();
  return data as { id: string; name: string; learning_goal: string | null; space_id: string } | null;
}

/**
 * Core generation: gathers weak concepts, mistakes, mastery, activity, materials,
 * calls LLM, validates, logs ai_operations, persists recommendations ACTIVE, emits RECOMMENDATION_GENERATED.
 * Ownership: project must belong to userId.
 */
export async function generateRecommendationForProject(params: {
  projectId: string;
  userId: string;
  spaceId?: string | null;
}): Promise<{ id: string; title: string; action_items: string[] } | null> {
  const { projectId, userId } = params;
  const spaceId = params.spaceId ?? null;
  const db = getServiceDb();

  // Verify ownership (service DB bypasses RLS, so check manually)
  const project = await getProjectMeta(projectId, db);
  if (!project) {
    console.warn("generateRecommendation: project not found", projectId);
    return null;
  }
  // If using service DB, verify user owns project
  const { data: ownerCheck } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (!ownerCheck) {
    console.warn("generateRecommendation: project not owned by user", projectId, userId);
    return null;
  }

  const effectiveSpaceId = spaceId ?? (project.space_id as string | null) ?? null;

  // Growth analysis for this user+project
  let growth: Awaited<ReturnType<typeof getGrowthAnalysis>> = [];
  try {
    growth = await getGrowthAnalysis(projectId, { userId, useServiceDb: true });
  } catch (e) {
    console.warn("Failed to get growth analysis for recommendation:", e);
    growth = [];
  }

  // Fetch concepts + mastery for weak detection
  const { data: concepts } = await db.from("concepts").select("id, name, description, source_material_id").eq("project_id", projectId);
  const conceptRows = (concepts ?? []) as Array<{ id: string; name: string; description: string | null; source_material_id: string | null }>;
  const { data: masteryRows } = await db.from("concept_mastery").select("concept_id, mastery_score").eq("project_id", projectId).eq("user_id", userId);
  const masteryMap = new Map<string, number>();
  for (const r of ((masteryRows ?? []) as Array<{ concept_id: string; mastery_score: number | string }>)) masteryMap.set(r.concept_id, Number(r.mastery_score));

  // Build weak concepts: REQUIRES_ATTENTION OR mastery <60 OR no mastery (treated 0)
  const trendByConcept = new Map<string, Trend>();
  for (const g of growth) trendByConcept.set(g.conceptId, g.trend);

  const weakConcepts = conceptRows
    .map((c) => {
      const score = masteryMap.has(c.id) ? masteryMap.get(c.id)! : 0;
      const trend = trendByConcept.get(c.id) ?? "STABLE";
      const isWeak = trend === "REQUIRES_ATTENTION" || score < 60;
      return { conceptId: c.id, name: c.name, description: c.description, masteryScore: score, trend, isWeak };
    })
    .filter((c) => c.isWeak);

  // If no weak concepts, we still generate? Spec wants recommendation when something weak; if nothing weak, skip to avoid noise
  if (weakConcepts.length === 0) {
    console.log("generateRecommendation: no weak concepts, skipping generation for", projectId);
    return null;
  }

  // Recent mistakes: last 5 answers incorrect or score <60, join to concept name
  let recentMistakes: Array<{ conceptName: string; question: string; score: number | null }> = [];
  try {
    const conceptNameById = new Map<string, string>(conceptRows.map((c) => [c.id, c.name]));
    // Get recent answers for this user's project quizzes
    const { data: quizIds } = await db.from("quizzes").select("id").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
    const qIds = (quizIds ?? []) as Array<{ id: string }>;
    if (qIds.length > 0) {
      const quizIdList = qIds.map((q) => q.id);
      const { data: qs } = await db.from("questions").select("id, concept_id, question").in("quiz_id", quizIdList);
      const qRows = (qs ?? []) as Array<{ id: string; concept_id: string; question: string }>;
      const qById = new Map<string, { concept_id: string; question: string }>(qRows.map((r) => [r.id, { concept_id: r.concept_id, question: r.question }]));
      const questionIds = qRows.map((r) => r.id);
      if (questionIds.length > 0) {
        const { data: ans } = await db
          .from("answers")
          .select("question_id, is_correct, score")
          .eq("user_id", userId)
          .in("question_id", questionIds)
          .order("created_at", { ascending: false })
          .limit(20);
        const ansRows = (ans ?? []) as Array<{ question_id: string; is_correct: boolean | null; score: number | string | null }>;
        const mistakes = ansRows.filter((a) => {
          if (a.is_correct === false) return true;
          if (a.score !== null && Number(a.score) < 60) return true;
          return false;
        });
        recentMistakes = mistakes.slice(0, 5).map((a) => {
          const q = qById.get(a.question_id);
          const conceptName = q ? (conceptNameById.get(q.concept_id) ?? "(unknown concept)") : "(unknown)";
          return { conceptName, question: q?.question ?? "(unknown question)", score: a.score !== null ? Number(a.score) : a.is_correct === false ? 0 : null };
        });
      }
    }
  } catch (e) {
    console.warn("Failed to fetch recent mistakes:", e);
  }

  // Recent activity
  let recentActivity: Array<{ eventType: string; createdAt: string; metadata?: unknown }> = [];
  try {
    const { data: events } = await db
      .from("learning_events")
      .select("event_type, created_at, metadata")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10);
    recentActivity = ((events ?? []) as Array<{ event_type: string; created_at: string; metadata: unknown }>).map((e) => ({
      eventType: e.event_type,
      createdAt: e.created_at,
      metadata: e.metadata,
    }));
  } catch (e) {
    console.warn("Failed to fetch recent activity:", e);
  }

  // Materials context: per weak concept, resolve material name + page range from chunks
  let materialsContext: Array<{ conceptName: string; materialName: string | null; materialId: string | null; pages?: string | null }> = [];
  try {
    for (const wc of weakConcepts.slice(0, 5)) {
      const concept = conceptRows.find((c) => c.id === wc.conceptId);
      let materialName: string | null = null;
      let materialId: string | null = concept?.source_material_id ?? null;
      let pages: string | null = null;
      if (materialId) {
        const { data: mat } = await db.from("materials").select("filename").eq("id", materialId).maybeSingle();
        materialName = (mat as { filename: string } | null)?.filename ?? null;
        // Fetch chunk pages range
        const { data: ch } = await db.from("chunks").select("page_number").eq("material_id", materialId).order("page_number", { ascending: true });
        const pNums = ((ch ?? []) as Array<{ page_number: number }>).map((c) => c.page_number);
        if (pNums.length > 0) {
          const min = Math.min(...pNums);
          const max = Math.max(...pNums);
          pages = min === max ? `p. ${min}` : `pp. ${min}-${max}`;
        }
      } else {
        // Try infer from any chunk for project? For weak concepts without source_material_id, try first material for project
        const { data: anyChunk } = await db.from("chunks").select("material_id, page_number").eq("project_id", projectId).limit(10);
        const ck = (anyChunk ?? []) as Array<{ material_id: string; page_number: number }>;
        if (ck.length > 0) {
          materialId = ck[0].material_id;
          const { data: mat } = await db.from("materials").select("filename").eq("id", materialId).maybeSingle();
          materialName = (mat as { filename: string } | null)?.filename ?? null;
          pages = `pp. ${Math.min(...ck.map((c) => c.page_number))}-${Math.max(...ck.map((c) => c.page_number))}`;
        }
      }
      materialsContext.push({ conceptName: wc.name, materialName, materialId, pages });
    }
  } catch (e) {
    console.warn("Failed to build materials context:", e);
  }

  // Mastery snapshot for prompt
  const masterySnapshot = growth.map((g) => ({
    conceptName: g.conceptName,
    masteryScore: g.currentScore ?? 0,
    trend: g.trend,
  }));

  const userPrompt = buildRecommendationUserPrompt({
    projectName: project.name,
    learningGoal: project.learning_goal,
    weakConcepts: weakConcepts.map((w) => ({ conceptId: w.conceptId, name: w.name, description: w.description, masteryScore: w.masteryScore, trend: w.trend })),
    recentMistakes,
    masterySnapshot,
    recentActivity,
    materialsContext,
  });

  const requestId = crypto.randomUUID();
  const t0 = Date.now();
  let raw: unknown;
  try {
    raw = await aiService.generateStructured({
      systemPrompt: RECOMMENDATION_SYSTEM_PROMPT,
      userPrompt,
      schema: RecommendationSchema,
      temperature: 0.4,
      maxTokens: 1200,
    });
  } catch (e) {
    const latency = Date.now() - t0;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[RECOMMENDATION ${requestId}] generate failed:`, errMsg);
    await logAiOperation({
      userId,
      projectId,
      feature: "RECOMMENDATION",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs: latency,
      success: false,
      error: errMsg.slice(0, 2000),
    });
    throw new Error(`Recommendation generation failed: ${errMsg}`);
  }

  let validated;
  try {
    validated = validateRecommendationOutput(raw);
  } catch (e) {
    const latency = Date.now() - t0;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[RECOMMENDATION ${requestId}] validation failed:`, errMsg);
    await logAiOperation({
      userId,
      projectId,
      feature: "RECOMMENDATION",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs: latency,
      success: false,
      error: `Validation failed: ${errMsg} raw=${JSON.stringify(raw).slice(0,500)}`,
    });
    // Retry once with correction hint per phase 09 pattern
    try {
      const retry = await aiService.generateStructured({
        systemPrompt: RECOMMENDATION_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}\n\nPrevious output failed validation: ${errMsg} — fix JSON to match schema exactly.`,
        schema: RecommendationSchema,
        temperature: 0.3,
        maxTokens: 1200,
      });
      validated = validateRecommendationOutput(retry);
      raw = retry;
    } catch (e2) {
      const e2Msg = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`Recommendation validation failed twice: ${e2Msg}`);
    }
  }

  const latency = Date.now() - t0;
  await logAiOperation({
    userId,
    projectId,
    feature: "RECOMMENDATION",
    model: CHAT_MODEL_NAME,
    requestId,
    latencyMs: latency,
    success: true,
  });

  // Persist ACTIVE
  const { data: rec, error: insErr } = await db
    .from("recommendations")
    .insert({
      project_id: projectId,
      user_id: userId,
      title: validated.title,
      action_items: validated.action_items,
      status: "ACTIVE",
    })
    .select("id, title, action_items")
    .single();

  if (insErr || !rec) throw new Error(`Failed to persist recommendation: ${insErr?.message ?? "no data"}`);

  await emitLearningEventViaServiceDb({
    userId,
    spaceId: effectiveSpaceId,
    projectId,
    eventType: "RECOMMENDATION_GENERATED",
    entityType: "recommendation",
    entityId: rec.id as string,
    metadata: { title: validated.title, weak_concepts: weakConcepts.map((w) => w.name) },
  });

  return { id: rec.id as string, title: validated.title, action_items: validated.action_items as string[] };
}

export async function listRecommendations(projectId: string): Promise<Array<{ id: string; title: string; action_items: string[]; status: string; created_at: string }>> {
  const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
  const userId = await getCurrentUserId();
  const db = await getDb();
  const owned = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (!owned.data) throw new Error("Project not found");
  const { data, error } = await db
    .from("recommendations")
    .select("id, title, action_items, status, created_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; title: string; action_items: string[]; status: string; created_at: string }>;
}

export async function updateRecommendationStatus(recommendationId: string, status: "COMPLETED" | "DISMISSED" | "ACTIVE"): Promise<void> {
  const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
  const userId = await getCurrentUserId();
  const db = await getDb();
  // NOTE: recommendations table has no space_id column (only project_id) —
  // selecting it makes PostgREST fail, which previously surfaced as a bogus
  // "Recommendation not found" on every status update. Derive space via project.
  const { data: rec, error: fetchErr } = await db.from("recommendations").select("id, project_id, title").eq("id", recommendationId).eq("user_id", userId).single();
  if (fetchErr || !rec) throw new Error("Recommendation not found");
  const typed = rec as { id: string; project_id: string; title: string };
  const { error: updErr } = await db.from("recommendations").update({ status }).eq("id", recommendationId).eq("user_id", userId);
  if (updErr) throw new Error(updErr.message);
  if (status === "COMPLETED") {
    // Need spaceId for event
    const { data: proj } = await db.from("projects").select("space_id").eq("id", typed.project_id).single();
    const spaceId = (proj as { space_id: string } | null)?.space_id ?? null;
    const svcDb = getServiceDb();
    const { error: evtErr } = await svcDb.from("learning_events").insert({
      user_id: userId,
      space_id: spaceId,
      project_id: typed.project_id,
      event_type: "RECOMMENDATION_COMPLETED",
      entity_type: "recommendation",
      entity_id: recommendationId,
      metadata: { title: typed.title, previous_status: "ACTIVE" },
    });
    if (evtErr) console.error("Failed to emit RECOMMENDATION_COMPLETED:", evtErr);
  }
}

/**
 * ACTIVE recommendations for the project hub dashboard card.
 * Ownership-checked (project must belong to caller) and scoped by user_id.
 */
export async function listActiveRecommendations(
  projectId: string,
  limit = 3
): Promise<Array<{ id: string; title: string; action_items: string[]; status: string; created_at: string }>> {
  const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
  const userId = await getCurrentUserId();
  const db = await getDb();
  const owned = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (!owned.data) throw new Error("Project not found");
  const { data, error } = await db
    .from("recommendations")
    .select("id, title, action_items, status, created_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; title: string; action_items: string[]; status: string; created_at: string }>;
}
