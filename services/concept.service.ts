import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { aiService, CHAT_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import {
  SUBCONCEPT_SYSTEM_PROMPT,
  SubConceptSchema,
  buildSubConceptUserPrompt,
  validateSubConceptOutput,
  type SubConcept,
} from "@/ai/concepts";
import { getGrowthAnalysis } from "@/services/growth.service";

export interface ConceptWithMeta {
  conceptId: string;
  conceptName: string;
  description: string | null;
  sourceMaterialId: string | null;
  materialName: string | null;
  currentScore: number | null;
  previousScore: number | null;
  trend: "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";
  historyCount: number;
  questionCount: number;
}

/**
 * List concepts with mastery + material names + question counts.
 * Thin service — route handlers stay thin per architecture.
 */
export async function listConceptsWithMeta(projectId: string): Promise<ConceptWithMeta[]> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");

  const growth = await getGrowthAnalysis(projectId);

  const [matsRes, quizzesRes] = await Promise.all([
    db.from("materials").select("id, filename").eq("project_id", projectId).eq("user_id", userId),
    db.from("quizzes").select("id").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
  ]);
  const nameById = new Map<string, string>();
  for (const m of ((matsRes.data ?? []) as Array<{ id: string; filename: string }>)) nameById.set(m.id, m.filename);

  // Question counts per concept from recent quizzes (best-effort, 0 on failure).
  const questionCountByConcept = new Map<string, number>();
  try {
    const quizIds = ((quizzesRes.data ?? []) as Array<{ id: string }>).map((q) => q.id);
    if (quizIds.length > 0) {
      const { data: qs } = await db.from("questions").select("concept_id").in("quiz_id", quizIds);
      for (const q of ((qs ?? []) as Array<{ concept_id: string }>)) {
        questionCountByConcept.set(q.concept_id, (questionCountByConcept.get(q.concept_id) ?? 0) + 1);
      }
    }
  } catch {
    // counts stay 0
  }

  return growth.map((g) => ({
    conceptId: g.conceptId,
    conceptName: g.conceptName,
    description: g.description,
    sourceMaterialId: g.sourceMaterialId,
    materialName: g.sourceMaterialId ? (nameById.get(g.sourceMaterialId) ?? null) : null,
    currentScore: g.currentScore,
    previousScore: g.previousScore,
    trend: g.trend,
    historyCount: g.historyCount,
    questionCount: questionCountByConcept.get(g.conceptId) ?? 0,
  }));
}

/**
 * Generate sub-concepts for one concept on demand (no persistence).
 * Evidence: concept description + top chunks mentioning the concept name.
 */
export async function generateSubConcepts(projectId: string, conceptId: string): Promise<{ subconcepts: SubConcept[] }> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");

  const { data: concept, error: cErr } = await db
    .from("concepts")
    .select("id, name, description")
    .eq("id", conceptId)
    .eq("project_id", projectId)
    .single();
  if (cErr || !concept) throw new Error("Concept not found");
  const row = concept as { id: string; name: string; description: string | null };

  // Best-effort evidence: chunks from this project mentioning concept words.
  let evidence: string[] = [];
  try {
    const keywords = row.name.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    if (keywords.length > 0) {
      const orFilter = keywords.map((k) => `content.ilike.%${k}%`).join(",");
      const { data: chunks } = await db
        .from("chunks")
        .select("content")
        .eq("project_id", projectId)
        .or(orFilter)
        .limit(4);
      evidence = ((chunks ?? []) as Array<{ content: string }>).map((c) => c.content);
    }
  } catch {
    evidence = [];
  }

  const userPrompt = buildSubConceptUserPrompt({
    conceptName: row.name,
    conceptDescription: row.description,
    evidence,
  });

  const requestId = crypto.randomUUID();
  const start = Date.now();
  try {
    const raw = await aiService.generateStructured<unknown>({
      systemPrompt: SUBCONCEPT_SYSTEM_PROMPT,
      userPrompt,
      schema: SubConceptSchema,
      temperature: 0.4,
      maxTokens: 1500,
    });
    const validated = validateSubConceptOutput(raw);
    await logAiOperation({
      userId,
      projectId,
      feature: "SUBCONCEPT_GENERATION",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs: Date.now() - start,
      success: true,
    });
    return validated;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logAiOperation({
      userId,
      projectId,
      feature: "SUBCONCEPT_GENERATION",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs: Date.now() - start,
      success: false,
      error: errMsg.slice(0, 2000),
    });
    throw new Error(`Sub-concept generation failed: ${errMsg}`);
  }
}
