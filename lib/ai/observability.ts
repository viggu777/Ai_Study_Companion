/**
 * Observability — ai_operations logging (architecture §15)
 * Every AIService call writes exactly one row, including on failure.
 */

import { getDb, getServiceDb } from "@/lib/db/supabase";
import { CHAT_MODEL_NAME } from "./AIService";

export type AiFeature =
  | "TUTOR"
  | "CONVERSATION_SUMMARY"
  | "EMBEDDING"
  | "QUIZ_GENERATION"
  | "OPEN_ENDED_EVALUATION"
  | "CONCEPT_EXTRACTION"
  | "RECOMMENDATION"
  | "FLASHCARD_GENERATION"
  | "SUBCONCEPT_GENERATION"
  | "PRACTICE_GENERATION"
  | "PRACTICE_EVALUATION";

export async function logAiOperation(params: {
  userId: string;
  projectId?: string | null;
  feature: AiFeature;
  model?: string;
  requestId?: string;
  latencyMs: number;
  success: boolean;
  tokensIn?: number | null;
  tokensOut?: number | null;
  estimatedCost?: number | null;
  error?: string | null;
}) {
  const requestId = params.requestId ?? crypto.randomUUID();
  const model = params.model ?? CHAT_MODEL_NAME;
  const row = {
    user_id: params.userId,
    project_id: params.projectId ?? null,
    feature: params.feature,
    model,
    request_id: requestId,
    latency_ms: params.latencyMs,
    success: params.success,
    tokens_in: params.tokensIn ?? null,
    tokens_out: params.tokensOut ?? null,
    estimated_cost: params.estimatedCost ?? null,
    error: params.error ?? null,
  };
  try {
    const db = await getDb();
    const { error } = await db.from("ai_operations").insert(row);
    if (error) {
      console.error(`Failed to log ai_operations [${requestId} feature=${params.feature}] via getDb:`, error);
      // Fallback to service DB (e.g. background jobs without cookie session)
      try {
        const svc = getServiceDb();
        const { error: svcErr } = await svc.from("ai_operations").insert(row);
        if (svcErr) console.error(`Failed to log ai_operations [${requestId}] via service DB fallback:`, svcErr);
        else return requestId;
      } catch (fallbackErr) {
        console.error(`logAiOperation service fallback exception [${requestId}]:`, fallbackErr);
      }
    } else {
      return requestId;
    }
  } catch (e) {
    console.error(`logAiOperation exception [${requestId} feature=${params.feature}]:`, e);
    // Try service DB as last resort for background contexts
    try {
      const svc = getServiceDb();
      const { error: svcErr } = await svc.from("ai_operations").insert(row);
      if (svcErr) console.error(`Failed to log ai_operations [${requestId}] via service DB after exception:`, svcErr);
      else return requestId;
    } catch (svcEx) {
      console.error(`logAiOperation service fallback exception [${requestId}]:`, svcEx);
    }
    return null;
  }
  return requestId;
}
