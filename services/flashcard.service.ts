import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { aiService, CHAT_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import {
  FLASHCARD_SYSTEM_PROMPT,
  FlashcardGenerationSchema,
  buildFlashcardUserPrompt,
  validateFlashcardOutput,
  type Flashcard,
} from "@/ai/flashcards";
import { selectAdaptiveConcepts } from "@/services/quiz.service";

const DEFAULT_FLASHCARD_COUNT = 10;
const MAX_FLASHCARD_COUNT = 20;

export interface FlashcardWithConcept extends Flashcard {
  concept_name: string;
}

/**
 * Generate flashcards from the project's weakest concepts (same adaptive
 * selection as quizzes). On-demand — no persistence, so no migration needed.
 * Returns validated structured cards; never raw LLM text.
 */
export async function generateFlashcards(
  projectId: string,
  options?: { count?: number }
): Promise<{ cards: FlashcardWithConcept[] }> {
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

  const count = Math.max(1, Math.min(options?.count ?? DEFAULT_FLASHCARD_COUNT, MAX_FLASHCARD_COUNT));

  // Weakest-first adaptive selection (mastery + mistakes + trend + recency).
  const selected = await selectAdaptiveConcepts(projectId, userId, count);

  const userPrompt = buildFlashcardUserPrompt({
    projectName,
    concepts: selected.map((s) => ({ concept_id: s.id, name: s.name, description: s.description })),
  });

  const requestId = crypto.randomUUID();
  const start = Date.now();
  let raw: unknown;
  try {
    raw = await aiService.generateStructured<unknown>({
      systemPrompt: FLASHCARD_SYSTEM_PROMPT,
      userPrompt,
      schema: FlashcardGenerationSchema,
      temperature: 0.4,
      maxTokens: 2500,
    });
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
      const retryRaw = await aiService.generateStructured<unknown>({
        systemPrompt: FLASHCARD_SYSTEM_PROMPT,
        userPrompt: userPrompt + "\n\nPrevious output failed validation: " + msg + " — fix the JSON exactly to match the schema.",
        schema: FlashcardGenerationSchema,
        temperature: 0.3,
        maxTokens: 2500,
      });
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
  });

  const nameById = new Map(selected.map((s) => [s.id, s.name]));
  return {
    cards: validated!.cards.map((c) => ({ ...c, concept_name: nameById.get(c.concept_id) ?? "Unknown" })),
  };
}
