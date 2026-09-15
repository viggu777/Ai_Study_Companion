import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { retrieve } from "@/lib/rag/retrieve";
import { aiService, CHAT_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import {
  INSUFFICIENT_EVIDENCE_RESPONSE,
  TUTOR_SYSTEM_PROMPT,
  TutorResponseSchema,
  buildTutorUserPrompt,
  validateTutorResponse,
  type TutorResponse,
} from "@/ai/tutor";

const CONVERSATION_WINDOW_SIZE = 6;

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

async function getOrCreateConversation(projectId: string, userId: string): Promise<string> {
  const db = await getDb();
  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await db
    .from("conversations")
    .insert({ project_id: projectId, user_id: userId })
    .select()
    .single();
  if (error || !created) throw new Error("Failed to create conversation");
  return (created as { id: string }).id;
}

async function getConversationWindow(conversationId: string, limit: number) {
  const db = await getDb();
  const { data } = await db
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  // Return oldest-first for context
  return (data ?? []).reverse() as Array<{ role: string; content: string }>;
}

async function getLearningContext(projectId: string, userId: string): Promise<string | undefined> {
  const db = await getDb();
  const { data: project } = await db.from("projects").select("learning_goal").eq("id", projectId).eq("user_id", userId).single();
  const { data: concepts } = await db.from("concepts").select("name").eq("project_id", projectId).limit(10);
  const { data: mastery } = await db
    .from("concept_mastery")
    .select("mastery_score, concept_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("mastery_score", { ascending: true })
    .limit(5);

  const parts: string[] = [];
  if (project && (project as { learning_goal?: string | null }).learning_goal) {
    parts.push(`Learning goal: ${(project as { learning_goal: string }).learning_goal}`);
  }
  if (concepts && concepts.length > 0) {
    parts.push(`Concepts: ${concepts.map((c: { name: string }) => c.name).join(", ")}`);
  }
  if (mastery && mastery.length > 0) {
    const weak = mastery
      .filter((m: { mastery_score: number }) => Number(m.mastery_score) < 60)
      .map((m: { mastery_score: number; concept_id: string }) => `concept:${m.concept_id.slice(0, 8)}(${m.mastery_score})`)
      .join(", ");
    if (weak) parts.push(`Weak concepts: ${weak}`);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Main tutor entry — authenticate → ownership → retrieve → LLM (or insufficient) → validate → persist
 */
export async function askTutor(projectId: string, question: string): Promise<TutorResponse & { conversationId: string }> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  // Validate project ownership + get spaceId for events
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, space_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");
  const spaceId = (project as { space_id: string }).space_id;

  const trimmed = question.trim();
  if (!trimmed) throw new Error("Question is required");
  if (trimmed.length > 2000) throw new Error("Question too long");

  const conversationId = await getOrCreateConversation(projectId, userId);

  // Persist user message + emit TUTOR_MESSAGE_SENT
  const { data: userMsg, error: userMsgErr } = await db
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content: trimmed, citations: null })
    .select()
    .single();
  if (userMsgErr) throw new Error("Failed to persist user message");

  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  await emitLearningEvent({
    userId,
    spaceId,
    projectId,
    eventType: "TUTOR_MESSAGE_SENT",
    entityType: "message",
    entityId: (userMsg as { id: string }).id,
    metadata: { question: trimmed.slice(0, 500) },
  });

  // Retrieve evidence (project-scoped, threshold-filtered)
  let retrieveResult;
  try {
    retrieveResult = await retrieve({ projectId, userId, query: trimmed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Project not found")) throw e;
    // Retrieval failure (e.g., embedding API down) → treat as insufficient but log
    console.error("Retrieve failed:", msg);
    return await persistInsufficient(conversationId, projectId, userId, spaceId, trimmed, "Retrieval error — please try again shortly.");
  }

  if (retrieveResult.status === "insufficient_evidence") {
    // Skip LLM call, return fixed response per spec, persist it
    return await persistInsufficient(
      conversationId,
      projectId,
      userId,
      spaceId,
      trimmed,
      retrieveResult.reason
    );
  }

  // Compose context: bounded window + retrieved chunks + learning context
  const windowMessages = await getConversationWindow(conversationId, CONVERSATION_WINDOW_SIZE);
  const learningContext = await getLearningContext(projectId, userId);

  // Need material names for citations — chunks currently lack filename; fetch materials map
  const materialIds = [...new Set(retrieveResult.chunks.map((c) => c.material_id))];
  const { data: mats } = await db.from("materials").select("id, filename").in("id", materialIds);
  const nameMap = new Map<string, string>();
  for (const m of (mats ?? []) as Array<{ id: string; filename: string }>) nameMap.set(m.id, m.filename);

  const evidence = retrieveResult.chunks.map((c) => ({
    materialId: c.material_id,
    materialName: nameMap.get(c.material_id) ?? "Unknown material",
    page: c.page_number,
    chunkId: c.id,
    content: c.content,
    similarity: c.similarity,
  }));

  const userPrompt = buildTutorUserPrompt({
    question: trimmed,
    evidence,
    conversationWindow: windowMessages,
    learningContext,
  });

  // Call AIService.generateStructured with observability logging
  const requestId = crypto.randomUUID();
  const start = Date.now();
  let tutorResponse: TutorResponse;
  try {
    const raw = await aiService.generateStructured<TutorResponse>({
      systemPrompt: TUTOR_SYSTEM_PROMPT,
      userPrompt,
      schema: TutorResponseSchema,
      temperature: 0.3,
      maxTokens: 1500,
    });
    const latencyMs = Date.now() - start;
    // Server-side validation before persisting
    tutorResponse = validateTutorResponse(raw);
    await logAiOperation({
      userId,
      projectId,
      feature: "TUTOR",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs,
      success: true,
    });
  } catch (e) {
    const latencyMs = Date.now() - start;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[TUTOR ${requestId}] LLM failed:`, errMsg);
    await logAiOperation({
      userId,
      projectId,
      feature: "TUTOR",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs,
      success: false,
      error: errMsg.slice(0, 2000),
    });
    // Safe fallback — insufficient evidence style but explains error, still persist
    const fallback: TutorResponse = {
      answer: "I encountered an error generating a grounded answer right now. Please try again shortly. Your question was saved and I'll use your uploaded materials when I retry.",
      confidence: "low",
      grounded: false,
      citations: [],
      followUpSuggestion: "Try rephrasing or retry in a few seconds.",
    };
    return await persistAssistant(conversationId, projectId, userId, spaceId, fallback);
  }

  return await persistAssistant(conversationId, projectId, userId, spaceId, tutorResponse);
}

async function persistInsufficient(
  conversationId: string,
  projectId: string,
  userId: string,
  spaceId: string | null,
  question: string,
  reason: string
): Promise<TutorResponse & { conversationId: string }> {
  const db = await getDb();
  const response: TutorResponse = {
    ...INSUFFICIENT_EVIDENCE_RESPONSE,
    // Keep fixed answer, but include reason in metadata if needed
  };
  // Persist assistant message with grounded=false
  const { data: msg } = await db
    .from("messages")
    .insert({ conversation_id: conversationId, role: "assistant", content: JSON.stringify(response), citations: [] })
    .select()
    .single();
  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  // Log as successful insufficient path (no LLM call, so no ai_operations row per spec — skip LLM logging)
  await emitLearningEvent({
    userId,
    spaceId,
    projectId,
    eventType: "TUTOR_RESPONSE_GENERATED",
    entityType: "message",
    entityId: (msg as { id: string } | null)?.id ?? conversationId,
    metadata: { grounded: false, confidence: "low", reason, question: question.slice(0, 500) },
  });
  return { ...response, conversationId };
}

async function persistAssistant(
  conversationId: string,
  projectId: string,
  userId: string,
  spaceId: string | null,
  response: TutorResponse
): Promise<TutorResponse & { conversationId: string }> {
  const db = await getDb();
  const { data: msg } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: JSON.stringify(response),
      citations: response.citations,
    })
    .select()
    .single();
  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  await emitLearningEvent({
    userId,
    spaceId,
    projectId,
    eventType: "TUTOR_RESPONSE_GENERATED",
    entityType: "message",
    entityId: (msg as { id: string } | null)?.id ?? conversationId,
    metadata: { grounded: response.grounded, confidence: response.confidence, citations: response.citations.length },
  });
  return { ...response, conversationId };
}

export async function getTutorHistory(projectId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");

  const { data: convo } = await db
    .from("conversations")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!convo) return { conversationId: null, messages: [] as Array<{ id: string; role: string; content: string; citations: unknown; created_at: string }> };

  const { data: messages } = await db
    .from("messages")
    .select("id, role, content, citations, created_at")
    .eq("conversation_id", (convo as { id: string }).id)
    .order("created_at", { ascending: true })
    .limit(100);

  // Parse assistant JSON for display while keeping raw
  const parsed = (messages ?? []).map((m: { id: string; role: string; content: string; citations: unknown; created_at: string }) => {
    if (m.role === "assistant") {
      try {
        const j = JSON.parse(m.content) as TutorResponse;
        return { ...m, parsed: j };
      } catch {
        return { ...m, parsed: null as unknown as TutorResponse | null };
      }
    }
    return { ...m, parsed: null as unknown as TutorResponse | null };
  });

  return { conversationId: (convo as { id: string }).id, messages: parsed };
}
