import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { aiService, CHAT_MODEL_NAME, estimateCost } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import {
  FLASHCARD_SYSTEM_PROMPT,
  FlashcardGenerationSchema,
  buildFlashcardUserPrompt,
  clampFlashcardLevel,
  validateFlashcardOutput,
  type Flashcard,
  type FlashcardLevel,
} from "@/ai/flashcards";
import { selectAdaptiveConcepts } from "@/services/quiz.service";

const DEFAULT_FLASHCARD_COUNT = 10;
const MAX_FLASHCARD_COUNT = 20;

export interface FlashcardWithConcept extends Flashcard {
  concept_name: string;
}

export interface FlashcardOptions {
  count?: number;
  level?: unknown;
  /** Restrict the deck to concepts from one material. */
  materialId?: string;
  /** Explicit concept selection (learner-picked). Takes precedence over materialId/adaptive. */
  conceptIds?: string[];
}

/**
 * Generate flashcards.
 *
 * Selection precedence (best UX = explicit concept picks grouped by material):
 *   1. conceptIds (explicit picks) — generate exactly those, in given order.
 *   2. materialId — weakest-first adaptive selection scoped to that material.
 *   3. default — weakest-first adaptive selection across the project.
 *
 * On-demand — no persistence, so no migration needed.
 * Returns validated structured cards; never raw LLM text.
 */
export async function generateFlashcards(
  projectId: string,
  options?: FlashcardOptions
): Promise<{ cards: FlashcardWithConcept[]; level: FlashcardLevel }> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");
  const projectName = (project as { name: string }).name;

  const level = clampFlashcardLevel(options?.level);
  const count = Math.max(1, Math.min(options?.count ?? DEFAULT_FLASHCARD_COUNT, MAX_FLASHCARD_COUNT));

  const requestedConceptIds = Array.from(
    new Set((options?.conceptIds ?? []).filter((id) => typeof id === "string" && id.trim()))
  );
  const materialId = typeof options?.materialId === "string" && options.materialId.trim() ? options.materialId.trim() : undefined;

  type SelectedConcept = { id: string; name: string; description: string | null };
  let selected: SelectedConcept[];

  if (requestedConceptIds.length > 0) {
    // Explicit learner selection — validate ownership, preserve given order.
    const { data: rows, error: cErr } = await db
      .from("concepts")
      .select("id, name, description, source_material_id, project_id")
      .eq("project_id", projectId)
      .in("id", requestedConceptIds);
    if (cErr) throw new Error("Failed to load selected concepts");
    const byId = new Map(((rows ?? []) as Array<SelectedConcept & { source_material_id: string | null }>).map((r) => [r.id, r]));
    const missing = requestedConceptIds.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new Error("Some selected concepts were not found in this project");
    if (materialId) {
      const outside = requestedConceptIds.filter((id) => byId.get(id)?.source_material_id !== materialId);
      if (outside.length > 0) throw new Error("Selected concepts must belong to the chosen material");
    }
    const ordered = requestedConceptIds
      .map((id) => byId.get(id)!)
      .map(({ id, name, description }) => ({ id, name, description }));
    // Respect the deck-size stepper: explicit picks beyond `count` are trimmed
    // (UI sends count >= picks, but deep-links may not).
    selected = ordered.slice(0, Math.min(count, MAX_FLASHCARD_COUNT));
    if (selected.length === 0) throw new Error("No concepts selected — pick at least one concept");
  } else {
    if (materialId) {
      // Verify the material belongs to this project first for a clear error.
      const { data: mat, error: matErr } = await db
        .from("materials")
        .select("id")
        .eq("id", materialId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (matErr || !mat) throw new Error("Selected material not found in this project");
      // Adaptive weakest-first, scoped to the material's concepts.
      const { data: matConcepts } = await db
        .from("concepts")
        .select("id")
        .eq("project_id", projectId)
        .eq("source_material_id", materialId);
      const ids = ((matConcepts ?? []) as Array<{ id: string }>).map((c) => c.id);
      if (ids.length === 0) throw new Error("No concepts found for the selected material — it may still be processing");
      // Reuse the shared adaptive scorer, then keep only this material's concepts.
      const ranked = await selectAdaptiveConcepts(projectId, userId, Math.max(count, ids.length));
      const inMaterial = ranked.filter((c) => ids.includes(c.id));
      // selectAdaptiveConcepts prefers sourced concepts, so inMaterial covers
      // the normal case; fall back to raw rows if scoring excluded them.
      if (inMaterial.length > 0) {
        selected = inMaterial.slice(0, count).map(({ id, name, description }) => ({ id, name, description }));
      } else {
        const { data: fallback } = await db
          .from("concepts")
          .select("id, name, description")
          .eq("project_id", projectId)
          .eq("source_material_id", materialId)
          .limit(count);
        selected = ((fallback ?? []) as SelectedConcept[]).slice(0, count);
      }
      if (selected.length === 0) throw new Error("No concepts found for the selected material — it may still be processing");
    } else {
      // Default: weakest-first adaptive selection (mastery + mistakes + trend + recency).
      const adaptive = await selectAdaptiveConcepts(projectId, userId, count);
      selected = adaptive.map(({ id, name, description }) => ({ id, name, description }));
    }
  }

  const userPrompt = buildFlashcardUserPrompt({
    projectName,
    concepts: selected.map((s) => ({ concept_id: s.id, name: s.name, description: s.description })),
    level,
  });

  const requestId = crypto.randomUUID();
  const start = Date.now();
  let raw: unknown;
  let lastUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    const res = await aiService.generateStructuredWithUsage<unknown>({
      systemPrompt: FLASHCARD_SYSTEM_PROMPT,
      userPrompt,
      schema: FlashcardGenerationSchema,
      temperature: 0.4,
      maxTokens: 2500,
    });
    raw = res.data;
    lastUsage = res.usage;
  } catch (e) {
    const latencyMs = Date.now() - start;
    const errMsg = e instanceof Error ? e.message : String(e);
    await logAiOperation({
      userId,
      projectId,
      feature: "FLASHCARD_GENERATION",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs,
      success: false,
      error: errMsg.slice(0, 2000),
    });
    throw new Error(`Flashcard generation failed: ${errMsg}`);
  }

  const expectedIds = selected.map((s) => s.id);
  let validated;
  try {
    validated = validateFlashcardOutput(raw, expectedIds);
  } catch (e) {
    // Retry once with validation feedback, same pattern as quiz generation.
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const retryRes = await aiService.generateStructuredWithUsage<unknown>({
        systemPrompt: FLASHCARD_SYSTEM_PROMPT,
        userPrompt: userPrompt + "\n\nPrevious output failed validation: " + msg + " — fix the JSON exactly to match the schema.",
        schema: FlashcardGenerationSchema,
        temperature: 0.3,
        maxTokens: 2500,
      });
      const retryRaw = retryRes.data;
      lastUsage = retryRes.usage;
      validated = validateFlashcardOutput(retryRaw, expectedIds);
    } catch (retryErr) {
      const rMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      await logAiOperation({
        userId,
        projectId,
        feature: "FLASHCARD_GENERATION",
        model: CHAT_MODEL_NAME,
        requestId,
        latencyMs: Date.now() - start,
        success: false,
        error: rMsg.slice(0, 2000),
      });
      throw new Error(`Flashcard validation failed after retry: ${rMsg}`);
    }
  }

  await logAiOperation({
    userId,
    projectId,
    feature: "FLASHCARD_GENERATION",
    model: CHAT_MODEL_NAME,
    requestId,
    latencyMs: Date.now() - start,
    success: true,
    tokensIn: lastUsage.inputTokens,
    tokensOut: lastUsage.outputTokens,
    estimatedCost: estimateCost(CHAT_MODEL_NAME, lastUsage),
  });

  const nameById = new Map(selected.map((s) => [s.id, s.name]));
  return {
    cards: validated!.cards.map((c) => ({ ...c, concept_name: nameById.get(c.concept_id) ?? "Unknown" })),
    level,
  };
}
