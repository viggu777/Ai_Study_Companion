import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { retrieve } from "@/lib/rag/retrieve";
import { aiService, CHAT_MODEL_NAME, estimateCost } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import {
  CONVERSATION_SUMMARY_MAX_CHARS,
  ConversationSummarySchema,
  INSUFFICIENT_EVIDENCE_RESPONSE,
  SUMMARY_SYSTEM_PROMPT,
  TUTOR_SYSTEM_PROMPT,
  TutorResponseSchema,
  buildSummaryUserPrompt,
  buildTutorUserPrompt,
  filterCitationsToEvidence,
  formatConversationSummaryText,
  validateConversationSummary,
  validateTutorResponse,
  type TutorResponse,
} from "@/ai/tutor";

const CONVERSATION_WINDOW_SIZE = 6;

/**
 * Duplicate-submit window — an identical question in the same conversation
 * within this long after the previous one reuses the existing reply.
 * Pure comparison helper below is unit-tested (tests/unit/job-guards.test.ts).
 */
export const TUTOR_DEDUP_WINDOW_MS = 30_000;

export function isWithinDedupWindow(createdAt: string, nowMs: number, windowMs: number = TUTOR_DEDUP_WINDOW_MS): boolean {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t < windowMs;
}

/** Persistent-summary tuning — lightweight by design, exported for tests. */
export const SUMMARY_MIN_MESSAGES = 8;
export const SUMMARY_REFRESH_GAP = 6;
export const SUMMARY_MAX_OLDER_TURNS = 30;
export const SUMMARY_LLM_MAX_TOKENS = 600;

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
  // Return oldest-first for context; only real dialogue turns (defensive
  // against any future special roles). Summary lives on conversations.
  return ((data ?? []) as Array<{ role: string; content: string }>)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .reverse();
}

/* ------------------------------------------------------------------ */
/* Persistent conversation summary (Task 3)                            */
/*                                                                     */
/* Rolling concise summary persisted on conversations.summary so older */
/* useful context survives beyond CONVERSATION_WINDOW_SIZE. Summary +  */
/* recent window are both sent to the Tutor; summary never replaces    */
/* recent messages, is never evidence, and is never instructions.      */
/* ------------------------------------------------------------------ */

export interface ConversationSummaryState {
  summary: string | null;
  updatedAt: string | null;
  messageCount: number;
}

/**
 * Pure trigger decision — exported for unit tests.
 * - Short conversations (total < MIN) never summarize.
 * - Otherwise refresh when at least REFRESH_GAP new messages arrived
 *   since the last summary (or when there is no summary yet).
 */
export function shouldRefreshSummary(totalMessages: number, summarizedUpTo: number): boolean {
  if (totalMessages < SUMMARY_MIN_MESSAGES) return false;
  if (summarizedUpTo <= 0) return true;
  return totalMessages - summarizedUpTo >= SUMMARY_REFRESH_GAP;
}

/**
 * Pure slice helper — everything outside the recent window is eligible
 * for summarization; capped to the most recent MAX_OLDER_TURNS so the
 * summarizer prompt stays bounded for very long conversations.
 */
export function selectOlderMessagesForSummary<T>(messagesOldestFirst: T[], windowSize: number, maxOlder: number = SUMMARY_MAX_OLDER_TURNS): T[] {
  if (messagesOldestFirst.length <= windowSize) return [];
  const older = messagesOldestFirst.slice(0, messagesOldestFirst.length - windowSize);
  return older.slice(Math.max(0, older.length - maxOlder));
}

/** Load persisted summary with project/user isolation. Never throws. */
async function getSummaryState(
  conversationId: string,
  projectId: string,
  userId: string
): Promise<ConversationSummaryState | null> {
  try {
    await requireConversation(conversationId, projectId, userId);
    const db = await getDb();
    const { data, error } = await db
      .from("conversations")
      .select("summary, summary_updated_at, summary_message_count")
      .eq("id", conversationId)
      .single();
    if (error || !data) return null;
    const row = data as { summary?: string | null; summary_updated_at?: string | null; summary_message_count?: number | null };
    return {
      summary: typeof row.summary === "string" && row.summary.trim() ? row.summary.slice(0, CONVERSATION_SUMMARY_MAX_CHARS) : null,
      updatedAt: row.summary_updated_at ?? null,
      messageCount: typeof row.summary_message_count === "number" ? row.summary_message_count : 0,
    };
  } catch (e) {
    // Missing migration / transient DB error → treat as "no summary yet".
    // Tutoring must continue with just the recent window.
    console.error("getSummaryState failed (continuing without summary):", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Best-effort rolling-summary refresh. Reads older turns beyond the recent
 * window + previous summary, asks the LLM for a concise structured summary,
 * validates it, and persists it scoped to this conversation.
 * Never throws — failures only log so tutoring is unaffected.
 */
export async function maybeRefreshConversationSummary(
  conversationId: string,
  projectId: string,
  userId: string
): Promise<string | null> {
  try {
    await requireConversation(conversationId, projectId, userId);
    const db = await getDb();

    const { data: convo } = await db
      .from("conversations")
      .select("summary, summary_updated_at, summary_message_count")
      .eq("id", conversationId)
      .single();
    const prevRow = (convo ?? {}) as { summary?: string | null; summary_message_count?: number | null };
    const previousSummary = typeof prevRow.summary === "string" ? prevRow.summary : null;
    const summarizedUpTo = typeof prevRow.summary_message_count === "number" ? prevRow.summary_message_count : 0;

    const { data: all } = await db
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    const turns = ((all ?? []) as Array<{ role: string; content: string }>).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    const total = turns.length;
    if (!shouldRefreshSummary(total, summarizedUpTo)) return previousSummary?.trim() ? previousSummary : null;

    const older = selectOlderMessagesForSummary(turns, CONVERSATION_WINDOW_SIZE);
    if (older.length === 0) return previousSummary?.trim() ? previousSummary : null;

    const requestId = crypto.randomUUID();
    const start = Date.now();
    let summaryText: string;
    try {
      const { data: raw, usage } = await aiService.generateStructuredWithUsage<{ summary: string; keyTopics: string[] }>({
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        userPrompt: buildSummaryUserPrompt({ olderMessages: older, previousSummary }),
        schema: ConversationSummarySchema,
        temperature: 0.2,
        maxTokens: SUMMARY_LLM_MAX_TOKENS,
      });
      const validated = validateConversationSummary(raw);
      summaryText = formatConversationSummaryText(validated);
      await logAiOperation({
        userId,
        projectId,
        feature: "CONVERSATION_SUMMARY",
        requestId,
        latencyMs: Date.now() - start,
        success: true,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        estimatedCost: estimateCost(CHAT_MODEL_NAME, usage),
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[SUMMARY ${requestId}] refresh failed:`, errMsg);
      try {
        await logAiOperation({
          userId,
          projectId,
          feature: "CONVERSATION_SUMMARY",
          requestId,
          latencyMs: Date.now() - start,
          success: false,
          error: errMsg.slice(0, 2000),
        });
      } catch {}
      return previousSummary?.trim() ? previousSummary : null;
    }

    try {
      await db
        .from("conversations")
        .update({
          summary: summaryText,
          summary_updated_at: new Date().toISOString(),
          summary_message_count: total,
        })
        .eq("id", conversationId)
        .eq("project_id", projectId)
        .eq("user_id", userId);
    } catch (e) {
      // e.g. migration not yet applied — log and keep serving from memory.
      console.error("Persisting conversation summary failed (non-fatal):", e instanceof Error ? e.message : String(e));
    }
    return summaryText;
  } catch (e) {
    console.error("maybeRefreshConversationSummary failed (non-fatal):", e instanceof Error ? e.message : String(e));
    return null;
  }
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
  // File inventory so the tutor can answer "do you have X pdf / list my files".
  // This is metadata, not evidence — content answers still need citations.
  const { data: mats } = await db
    .from("materials")
    .select("filename, status, page_count")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (mats && mats.length > 0) {
    const inv = (mats as Array<{ filename: string; status: string; page_count: number | null }>)
      .map((m) => `${m.filename} (${m.status}${m.page_count ? `, ${m.page_count} pages` : ""})`)
      .join("; ");
    parts.push(`Available materials: ${inv}`);
  }
  // Recent mistakes in THIS project — concrete assessment context so the
  // tutor can proactively target what the student actually got wrong
  // (best-effort; never blocks tutoring on failure).
  const mistakes = await getRecentMistakes(projectId, userId).catch(() => null);
  if (mistakes) parts.push(mistakes);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Last few incorrect answers in this project, formatted as tutor context:
 * question stem + student's answer + correct answer + concept name.
 * Scoped to the project via questions → quizzes; capped and truncated so
 * the prompt stays bounded. Returns null when there is nothing to show.
 */
async function getRecentMistakes(projectId: string, userId: string): Promise<string | null> {
  const db = await getDb();
  const { data: wrong } = await db
    .from("answers")
    .select("question_id, response, score, created_at")
    .eq("user_id", userId)
    .or("is_correct.eq.false,and(score.not.is.null,score.lt.60)")
    .order("created_at", { ascending: false })
    .limit(20);
  const wrongRows = (wrong ?? []) as Array<{ question_id: string; response: string; score: number | string | null; created_at: string }>;
  if (wrongRows.length === 0) return null;

  const qIds = [...new Set(wrongRows.map((a) => a.question_id))];
  const { data: questions } = await db
    .from("questions")
    .select("id, quiz_id, question, correct_answer, concept_id")
    .in("id", qIds);
  const qRows = (questions ?? []) as Array<{ id: string; quiz_id: string; question: string; correct_answer: string; concept_id: string }>;
  if (qRows.length === 0) return null;

  const { data: quizzes } = await db
    .from("quizzes")
    .select("id")
    .eq("project_id", projectId)
    .in("id", [...new Set(qRows.map((q) => q.quiz_id))]);
  const projectQuizIds = new Set(((quizzes ?? []) as Array<{ id: string }>).map((q) => q.id));
  const inProject = qRows.filter((q) => projectQuizIds.has(q.quiz_id));
  if (inProject.length === 0) return null;

  const { data: concepts } = await db
    .from("concepts")
    .select("id, name")
    .in("id", [...new Set(inProject.map((q) => q.concept_id))]);
  const nameById = new Map(((concepts ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));

  const qById = new Map(inProject.map((q) => [q.id, q]));
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);
  const lines: string[] = [];
  for (const a of wrongRows) {
    const q = qById.get(a.question_id);
    if (!q) continue;
    lines.push(
      `- Q: ${clip(q.question.replace(/\s+/g, " "), 140)} | your answer: ${clip(a.response.replace(/\s+/g, " "), 120)} | correct: ${clip(q.correct_answer.replace(/\s+/g, " "), 120)} (concept: ${nameById.get(q.concept_id) ?? "unknown"})`
    );
    if (lines.length >= 5) break;
  }
  if (lines.length === 0) return null;
  return `Recent mistakes in this project (proactively address these misconceptions when relevant):\n${lines.join("\n")}`;
}

async function requireProjectSpace(projectId: string, userId: string): Promise<string | null> {
  const db = await getDb();
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, space_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");
  return (project as { space_id: string | null }).space_id ?? null;
}

async function requireConversation(
  conversationId: string,
  projectId: string,
  userId: string
): Promise<void> {
  const db = await getDb();
  const { data, error } = await db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("Conversation not found");
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  exchangeCount: number;
  created_at: string;
  updated_at: string;
  isPinned: boolean;
  pinnedAt: string | null;
}

/** Auto-generated title from the first user message (truncated). */
function titleFromMessages(
  messages: Array<{ role: string; content: string }>
): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New conversation";
  const text = first.content.replace(/\s+/g, " ").trim();
  if (!text) return "New conversation";
  return text.length > 60 ? text.slice(0, 60).trimEnd() + "…" : text;
}

/**
 * List past conversations for the Chats panel — most recent first, with
 * auto-generated titles and exchange counts. Pinned conversations sort first.
 */
export async function listConversations(projectId: string): Promise<ConversationSummary[]> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  await requireProjectSpace(projectId, userId);

  // Select pin columns when the 013 migration has run; fall back gracefully
  // on DBs where it hasn't (treat everything as unpinned).
  let convos: Array<{ id: string; created_at: string; updated_at: string; is_pinned?: boolean | null; pinned_at?: string | null }> | null = null;
  try {
    const { data, error } = await db
      .from("conversations")
      .select("id, created_at, updated_at, is_pinned, pinned_at")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    convos = (data ?? []) as Array<{ id: string; created_at: string; updated_at: string; is_pinned?: boolean | null; pinned_at?: string | null }>;
  } catch {
    const { data, error } = await db
      .from("conversations")
      .select("id, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Failed to list conversations");
    convos = (data ?? []) as Array<{ id: string; created_at: string; updated_at: string }>;
  }
  const list = convos ?? [];
  if (list.length === 0) return [];

  const ids = list.map((c) => c.id);
  const { data: msgs } = await db
    .from("messages")
    .select("conversation_id, role, content, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: true })
    .limit(2000);
  const byConvo = new Map<string, Array<{ role: string; content: string }>>();
  for (const m of (msgs ?? []) as Array<{ conversation_id: string; role: string; content: string }>) {
    const arr = byConvo.get(m.conversation_id) ?? [];
    arr.push({ role: m.role, content: m.content });
    byConvo.set(m.conversation_id, arr);
  }

  return list.map((c) => {
    const cm = byConvo.get(c.id) ?? [];
    const assistantCount = cm.filter((m) => m.role === "assistant").length;
    const userCount = cm.filter((m) => m.role === "user").length;
    return {
      id: c.id,
      title: titleFromMessages(cm),
      messageCount: cm.length,
      exchangeCount: Math.min(assistantCount, userCount) || assistantCount || userCount,
      created_at: c.created_at,
      updated_at: c.updated_at,
      isPinned: (c as { is_pinned?: boolean | null }).is_pinned === true,
      pinnedAt: (c as { pinned_at?: string | null }).pinned_at ?? null,
    };
  });
}

/** Start a fresh (empty) conversation — powers the "New Chat" button. */
export async function createConversation(projectId: string): Promise<{ id: string }> {
  const userId = await getCurrentUserId();
  const db = await getDb();
  await requireProjectSpace(projectId, userId);
  const { data: created, error } = await db
    .from("conversations")
    .insert({ project_id: projectId, user_id: userId })
    .select("id")
    .single();
  if (error || !created) throw new Error("Failed to create conversation");
  return { id: (created as { id: string }).id };
}

/** Delete a conversation and its messages (cascade). Scoped to project + user. */
export async function deleteConversation(projectId: string, conversationId: string): Promise<void> {
  const userId = await getCurrentUserId();
  await requireConversation(conversationId, projectId, userId);
  const db = await getDb();
  const { error } = await db
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error("Failed to delete conversation");
}

/** Pin / unpin a conversation so it stays on top of the Chats panel. */
export async function setConversationPinned(
  projectId: string,
  conversationId: string,
  pinned: boolean
): Promise<{ id: string; isPinned: boolean }> {
  const userId = await getCurrentUserId();
  await requireConversation(conversationId, projectId, userId);
  const db = await getDb();
  const patch = pinned
    ? { is_pinned: true, pinned_at: new Date().toISOString() }
    : { is_pinned: false, pinned_at: null };
  const { error } = await db
    .from("conversations")
    .update(patch)
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error("Failed to update conversation");
  return { id: conversationId, isPinned: pinned };
}

/**
 * Main tutor entry — authenticate → ownership → retrieve → LLM (or insufficient) → validate → persist
 */
export async function askTutor(
  projectId: string,
  question: string,
  conversationId?: string | null
): Promise<TutorResponse & { conversationId: string }> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  // Validate project ownership + get spaceId for events
  const spaceId = await requireProjectSpace(projectId, userId);

  const trimmed = question.trim();
  if (!trimmed) throw new Error("Question is required");
  if (trimmed.length > 2000) throw new Error("Question too long");

  if (conversationId) await requireConversation(conversationId, projectId, userId);
  const activeConversationId = conversationId ?? (await getOrCreateConversation(projectId, userId));
  const conversationIdResolved: string = activeConversationId;

  // Idempotency: rapid duplicate submits (double-click, network retry) ask
  // the identical question in the same conversation within a short window.
  // Return the existing assistant reply instead of generating a second one.
  try {
    const { data: recentUser } = await db
      .from("messages")
      .select("id, content, created_at")
      .eq("conversation_id", conversationIdResolved)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(5);
    const dup = ((recentUser ?? []) as Array<{ id: string; content: string; created_at: string }>).find(
      (m) => m.content === trimmed && isWithinDedupWindow(m.created_at, Date.now())
    );
    if (dup) {
      const { data: reply } = await db
        .from("messages")
        .select("content")
        .eq("conversation_id", conversationIdResolved)
        .eq("role", "assistant")
        .gt("created_at", dup.created_at)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (reply) {
        try {
          const parsed = JSON.parse((reply as { content: string }).content) as TutorResponse;
          // Validate shape — a corrupt row falls through and regenerates.
          validateTutorResponse(parsed);
          return { ...parsed, conversationId: conversationIdResolved };
        } catch {
          // fall through to normal generation
        }
      }
    }
  } catch {
    // Dedup is best-effort — never block tutoring on it.
  }

  // Persist user message + emit TUTOR_MESSAGE_SENT
  const { data: userMsg, error: userMsgErr } = await db
    .from("messages")
    .insert({ conversation_id: conversationIdResolved, role: "user", content: trimmed, citations: null })
    .select()
    .single();
  if (userMsgErr) throw new Error("Failed to persist user message");

  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationIdResolved);
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
    return await persistInsufficient(conversationIdResolved, projectId, userId, spaceId, trimmed, "Retrieval error — please try again shortly.");
  }

  if (retrieveResult.status === "insufficient_evidence") {
    // Skip LLM call, return fixed response per spec, persist it
    return await persistInsufficient(
      conversationIdResolved,
      projectId,
      userId,
      spaceId,
      trimmed,
      retrieveResult.reason
    );
  }

  // Compose context: persistent summary + bounded window + retrieved chunks + learning context.
  // Summary and window are fetched in parallel; summary failure is non-fatal
  // (tutoring continues with just the recent window).
  const [windowMessages, summaryState, learningContext] = await Promise.all([
    getConversationWindow(conversationIdResolved, CONVERSATION_WINDOW_SIZE),
    getSummaryState(conversationIdResolved, projectId, userId),
    getLearningContext(projectId, userId),
  ]);
  const conversationSummary = summaryState?.summary ?? null;

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
    conversationSummary,
  });

  // Call AIService.generateStructured with observability logging
  const requestId = crypto.randomUUID();
  const start = Date.now();
  let tutorResponse: TutorResponse;
  try {
    const { data: raw, usage } = await aiService.generateStructuredWithUsage<TutorResponse>({
      systemPrompt: TUTOR_SYSTEM_PROMPT,
      userPrompt,
      schema: TutorResponseSchema,
      temperature: 0.3,
      maxTokens: 1500,
    });
    const latencyMs = Date.now() - start;
    // Server-side validation before persisting: shape first, then drop any
    // citation that does not point at a chunk retrieved for this question.
    tutorResponse = filterCitationsToEvidence(
      validateTutorResponse(raw),
      new Set(retrieveResult.chunks.map((c) => c.id))
    );
    await logAiOperation({
      userId,
      projectId,
      feature: "TUTOR",
      model: CHAT_MODEL_NAME,
      requestId,
      latencyMs,
      success: true,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      estimatedCost: estimateCost(CHAT_MODEL_NAME, usage),
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
    return await persistAssistant(conversationIdResolved, projectId, userId, spaceId, fallback);
  }

  const result = await persistAssistant(conversationIdResolved, projectId, userId, spaceId, tutorResponse);
  // Best-effort rolling-summary refresh so older context survives beyond the
  // bounded window. Never blocks the answer on failure.
  await maybeRefreshConversationSummary(conversationIdResolved, projectId, userId);
  return result;
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
  // Tutor exchanges are learning tasks too — keep an ACTIVE next-step around
  // without slowing the answer. Throttled inside (fresh ACTIVE <15 min reused).
  void import("@/services/recommendation.service")
    .then((m) => m.refreshRecommendationAfterTask({ projectId, userId, spaceId, trigger: "tutor/response" }))
    .catch((e) => console.warn("Tutor recommendation refresh skipped:", e instanceof Error ? e.message : String(e)));
  return { ...response, conversationId };
}

export async function getTutorHistory(projectId: string, conversationId?: string | null) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  if (projErr || !project) throw new Error("Project not found");

  if (conversationId) await requireConversation(conversationId, projectId, userId);

  const { data: convo } = conversationId
    ? { data: { id: conversationId } }
    : await db
        .from("conversations")
        .select("id")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (!convo) return { conversationId: null, messages: [] as Array<{ id: string; role: string; content: string; citations: unknown; created_at: string }>, summary: null as string | null, summaryUpdatedAt: null as string | null };

  const resolvedId = (convo as { id: string }).id;
  const [{ data: messages }, summaryState] = await Promise.all([
    db
      .from("messages")
      .select("id, role, content, citations, created_at")
      .eq("conversation_id", resolvedId)
      .order("created_at", { ascending: true })
      .limit(100),
    getSummaryState(resolvedId, projectId, userId),
  ]);

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

  return {
    conversationId: resolvedId,
    messages: parsed,
    summary: summaryState?.summary ?? null,
    summaryUpdatedAt: summaryState?.updatedAt ?? null,
  };
}
