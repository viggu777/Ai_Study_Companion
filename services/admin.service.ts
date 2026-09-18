/**
 * Admin service — reads with service role (bypass RLS) after admin gate.
 * All functions assume caller already called requireAdmin().
 */
import { getServiceDb } from "@/lib/db/supabase";

export interface AdminDashboardCounts {
  userCount: number | null; // null if auth.admin unavailable
  userCountError?: string;
  projectCount: number;
  spaceCount: number;
  materialCount: number;
  conceptCount: number;
  quizCount: number;
  answerCount: number;
  aiOperationsCount: number;
  learningEventsCount: number;
}

export async function getAdminDashboardCounts(): Promise<AdminDashboardCounts> {
  const db = getServiceDb();

  // Attempt auth.users count via admin API
  let userCount: number | null = null;
  let userCountError: string | undefined;
  try {
    // Paginate to get accurate count: list first page then use total? Supabase admin API
    // returns total via headers internally; easiest: fetch with perPage 1000 and count.
    // If many users, count is approximate but sufficient for prototype.
    const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(error.message);
    // Supabase returns { users: [...] } with no explicit count; use length
    // Fallback: try to read total from pagination if available as data.users length
    const users = (data as unknown as { users: unknown[] })?.users ?? (data as unknown as unknown[] as unknown[]);
    if (Array.isArray(users)) userCount = users.length;
    else if (Array.isArray(data)) userCount = (data as unknown[]).length;
    else userCount = 0;
  } catch (e) {
    userCountError = e instanceof Error ? e.message : String(e);
    // Fallback: distinct user_id from projects/spaces
    try {
      const { data: projUsers } = await db.from("projects").select("user_id");
      const uniq = new Set<string>();
      for (const r of ((projUsers ?? []) as Array<{ user_id: string }>)) uniq.add(r.user_id);
      const { data: spaceUsers } = await db.from("spaces").select("user_id");
      for (const r of ((spaceUsers ?? []) as Array<{ user_id: string }>)) uniq.add(r.user_id);
      if (uniq.size > 0) {
        userCount = uniq.size;
        userCountError = undefined;
      }
    } catch {}
  }

  const [projectsRes, spacesRes, materialsRes, conceptsRes, quizzesRes, answersRes, aiOpsRes, eventsRes] =
    await Promise.all([
      db.from("projects").select("id", { count: "exact", head: true }),
      db.from("spaces").select("id", { count: "exact", head: true }),
      db.from("materials").select("id", { count: "exact", head: true }),
      db.from("concepts").select("id", { count: "exact", head: true }),
      db.from("quizzes").select("id", { count: "exact", head: true }),
      db.from("answers").select("id", { count: "exact", head: true }),
      db.from("ai_operations").select("id", { count: "exact", head: true }),
      db.from("learning_events").select("id", { count: "exact", head: true }),
    ]);

  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (spacesRes.error) throw new Error(spacesRes.error.message);
  if (materialsRes.error) throw new Error(materialsRes.error.message);
  if (conceptsRes.error) throw new Error(conceptsRes.error.message);
  if (quizzesRes.error) throw new Error(quizzesRes.error.message);
  if (answersRes.error) throw new Error(answersRes.error.message);
  if (aiOpsRes.error) throw new Error(aiOpsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  return {
    userCount,
    userCountError,
    projectCount: projectsRes.count ?? 0,
    spaceCount: spacesRes.count ?? 0,
    materialCount: materialsRes.count ?? 0,
    conceptCount: conceptsRes.count ?? 0,
    quizCount: quizzesRes.count ?? 0,
    answerCount: answersRes.count ?? 0,
    aiOperationsCount: aiOpsRes.count ?? 0,
    learningEventsCount: eventsRes.count ?? 0,
  };
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  projectCount: number;
  materialCount: number;
  quizCount: number;
}

export async function listAdminUsers(opts?: { perPage?: number; page?: number }): Promise<AdminUserRow[]> {
  const db = getServiceDb();
  const perPage = opts?.perPage ?? 50;
  const page = opts?.page ?? 1;

  let users: Array<{ id: string; email?: string | null; created_at?: string | null; last_sign_in_at?: string | null }> = [];
  try {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const raw = data as unknown as { users: Array<{ id: string; email?: string | null; created_at?: string | null; last_sign_in_at?: string | null }> };
    users = raw.users ?? (data as unknown as typeof users);
    if (!Array.isArray(users)) users = [];
  } catch (e) {
    // Fallback: derive users from distinct user_ids in spaces/projects
    const { data: projUsers } = await db.from("projects").select("user_id");
    const uniq = new Set<string>();
    for (const r of ((projUsers ?? []) as Array<{ user_id: string }>)) uniq.add(r.user_id);
    const { data: spaceUsers } = await db.from("spaces").select("user_id");
    for (const r of ((spaceUsers ?? []) as Array<{ user_id: string }>)) uniq.add(r.user_id);
    if (uniq.size === 0) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
    users = Array.from(uniq).map((id) => ({ id, email: null, created_at: null, last_sign_in_at: null }));
  }

  // Enrich with project/material/quiz counts per user (batch where possible)
  const userIds = users.map((u) => u.id);
  let projectCounts = new Map<string, number>();
  let materialCounts = new Map<string, number>();
  let quizCounts = new Map<string, number>();
  if (userIds.length > 0) {
    const [projRes, matRes, quizRes] = await Promise.all([
      db.from("projects").select("user_id").in("user_id", userIds),
      db.from("materials").select("user_id").in("user_id", userIds),
      db.from("quizzes").select("user_id").in("user_id", userIds),
    ]);
    for (const r of ((projRes.data ?? []) as Array<{ user_id: string }>)) projectCounts.set(r.user_id, (projectCounts.get(r.user_id) ?? 0) + 1);
    for (const r of ((matRes.data ?? []) as Array<{ user_id: string }>)) materialCounts.set(r.user_id, (materialCounts.get(r.user_id) ?? 0) + 1);
    for (const r of ((quizRes.data ?? []) as Array<{ user_id: string }>)) quizCounts.set(r.user_id, (quizCounts.get(r.user_id) ?? 0) + 1);
  }

  return users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    projectCount: projectCounts.get(u.id) ?? 0,
    materialCount: materialCounts.get(u.id) ?? 0,
    quizCount: quizCounts.get(u.id) ?? 0,
  }));
}

export interface AdminUserDetail {
  userId: string;
  email: string | null;
  created_at: string | null;
  projects: Array<{ id: string; space_id: string; name: string; description: string | null; learning_goal: string | null; created_at: string }>;
  spaces: Array<{ id: string; name: string }>;
  recentEvents: Array<{ id: string; event_type: string; entity_type: string; entity_id: string; project_id: string | null; space_id: string | null; created_at: string; metadata: unknown }>;
  assessments: {
    totalAnswers: number;
    byScore: Array<{ question_id: string; score: number | null; is_correct: boolean | null; evaluation: unknown; created_at: string }>;
    avgScore: number | null;
  };
  mastery: Array<{ concept_id: string; project_id: string; mastery_score: number; conceptName: string | null }>;
  masteryHistory: Array<{ concept_id: string; previous_score: number; new_score: number; reason: string | null; created_at: string }>;
  aiUsage: {
    totalCalls: number;
    perFeature: Record<string, number>;
    avgLatencyMs: number | null;
    errorRate: number | null;
    totalCost: number | null;
    recent: Array<{ feature: string; model: string; success: boolean; latency_ms: number; error: string | null; created_at: string }>;
  };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const db = getServiceDb();

  let email: string | null = null;
  let created_at: string | null = null;
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (!error && data?.user) {
      email = (data.user as { email?: string | null }).email ?? null;
      created_at = (data.user as { created_at?: string | null }).created_at ?? null;
    }
  } catch {}

  const [spacesRes, projectsRes, eventsRes, answersRes, masteryRes, historyRes, aiRes] = await Promise.all([
    db.from("spaces").select("id, name").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("projects").select("id, space_id, name, description, learning_goal, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("learning_events").select("id, event_type, entity_type, entity_id, project_id, space_id, created_at, metadata").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    db.from("answers").select("question_id, score, is_correct, evaluation, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    db
      .from("concept_mastery")
      .select("concept_id, project_id, mastery_score")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(100),
    db.from("mastery_history").select("concept_id, previous_score, new_score, reason, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    db.from("ai_operations").select("feature, model, success, latency_ms, error, estimated_cost, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
  ]);

  if (spacesRes.error) throw new Error(spacesRes.error.message);
  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (answersRes.error) throw new Error(answersRes.error.message);
  if (masteryRes.error) throw new Error(masteryRes.error.message);
  if (historyRes.error) throw new Error(historyRes.error.message);
  if (aiRes.error) throw new Error(aiRes.error.message);

  // Resolve concept names for mastery
  const conceptIds = Array.from(new Set(((masteryRes.data ?? []) as Array<{ concept_id: string }>).map((r) => r.concept_id)));
  let nameById = new Map<string, string>();
  if (conceptIds.length > 0) {
    const { data: concepts } = await db.from("concepts").select("id, name").in("id", conceptIds);
    for (const c of ((concepts ?? []) as Array<{ id: string; name: string }>)) nameById.set(c.id, c.name);
  }

  const answers = (answersRes.data ?? []) as Array<{ question_id: string; score: number | string | null; is_correct: boolean | null; evaluation: unknown; created_at: string }>;
  const scores = answers.map((a) => (a.score !== null ? Number(a.score) : null)).filter((v): v is number => v !== null);
  const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;

  const aiRows = (aiRes.data ?? []) as Array<{ feature: string; model: string; success: boolean; latency_ms: number | string | null; error: string | null; estimated_cost: number | string | null; created_at: string }>;
  const perFeature: Record<string, number> = {};
  let latSum = 0;
  let latCnt = 0;
  let fails = 0;
  let costSum = 0;
  let costCnt = 0;
  for (const r of aiRows) {
    perFeature[r.feature] = (perFeature[r.feature] ?? 0) + 1;
    if (r.latency_ms !== null && r.latency_ms !== undefined) {
      latSum += Number(r.latency_ms);
      latCnt++;
    }
    if (!r.success) fails++;
    if (r.estimated_cost !== null && r.estimated_cost !== undefined) {
      const v = Number(r.estimated_cost);
      if (!Number.isNaN(v)) {
        costSum += v;
        costCnt++;
      }
    }
  }

  return {
    userId,
    email,
    created_at,
    projects: (projectsRes.data ?? []) as AdminUserDetail["projects"],
    spaces: (spacesRes.data ?? []) as AdminUserDetail["spaces"],
    recentEvents: (eventsRes.data ?? []) as AdminUserDetail["recentEvents"],
    assessments: {
      totalAnswers: answers.length,
      byScore: answers.map((a) => ({ ...a, score: a.score !== null ? Number(a.score) : null })),
      avgScore,
    },
    mastery: ((masteryRes.data ?? []) as Array<{ concept_id: string; project_id: string; mastery_score: number | string }>).map((r) => ({
      concept_id: r.concept_id,
      project_id: r.project_id,
      mastery_score: Number(r.mastery_score),
      conceptName: nameById.get(r.concept_id) ?? null,
    })),
    masteryHistory: ((historyRes.data ?? []) as Array<{ concept_id: string; previous_score: number | string; new_score: number | string; reason: string | null; created_at: string }>).map((r) => ({
      concept_id: r.concept_id,
      previous_score: Number(r.previous_score),
      new_score: Number(r.new_score),
      reason: r.reason,
      created_at: r.created_at,
    })),
    aiUsage: {
      totalCalls: aiRows.length,
      perFeature,
      avgLatencyMs: latCnt > 0 ? Math.round(latSum / latCnt) : null,
      errorRate: aiRows.length > 0 ? Math.round((fails / aiRows.length) * 10000) / 10000 : null,
      totalCost: costCnt > 0 ? Math.round(costSum * 1_000_000) / 1_000_000 : null,
      recent: aiRows.slice(0, 20).map((r) => ({
        feature: r.feature,
        model: r.model,
        success: r.success,
        latency_ms: r.latency_ms !== null ? Number(r.latency_ms) : 0,
        error: r.error,
        created_at: r.created_at,
      })),
    },
  };
}

export interface AdminSpaceRow {
  id: string;
  name: string;
  description: string | null;
  user_id: string;
  created_at: string;
  projectCount: number;
}

export async function listAdminSpaces(opts: {
  q?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminSpaceRow[]> {
  const db = getServiceDb();
  let query = db.from("spaces").select("id, name, description, user_id, created_at").order("created_at", { ascending: false });
  if (opts.q) query = query.ilike("name", `%${opts.q}%`);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const spaces = (data ?? []) as Array<{ id: string; name: string; description: string | null; user_id: string; created_at: string }>;
  if (spaces.length === 0) return [];
  const { data: projects } = await db.from("projects").select("space_id").in("space_id", spaces.map((s) => s.id));
  const counts = new Map<string, number>();
  for (const p of ((projects ?? []) as Array<{ space_id: string }>)) {
    counts.set(p.space_id, (counts.get(p.space_id) ?? 0) + 1);
  }
  return spaces.map((s) => ({ ...s, projectCount: counts.get(s.id) ?? 0 }));
}

export async function listAdminProjects(opts: {
  q?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<{ id: string; name: string; description: string | null;   user_id: string; space_id: string; created_at: string }>> {
  const db = getServiceDb();
  let query = db.from("projects").select("id, name, description, user_id, space_id, created_at").order("created_at", { ascending: false });
  if (opts.q) query = query.ilike("name", `%${opts.q}%`);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string; description: string | null; user_id: string; space_id: string; created_at: string }>;
}

export interface AdminActivityFilters {
  userId?: string;
  spaceId?: string;
  projectId?: string;
  eventType?: string;
  from?: string; // ISO
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listAdminActivity(
  filters: AdminActivityFilters
): Promise<Array<{ id: string; user_id: string; space_id: string | null; project_id: string | null; event_type: string; entity_type: string; entity_id: string; metadata: unknown; created_at: string }>> {
  const db = getServiceDb();
  let q = db.from("learning_events").select("id, user_id, space_id, project_id, event_type, entity_type, entity_id, metadata, created_at").order("created_at", { ascending: false });
  if (filters.userId) q = q.eq("user_id", filters.userId);
  if (filters.spaceId) q = q.eq("space_id", filters.spaceId);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.eventType) q = q.eq("event_type", filters.eventType);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  q = q.range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; user_id: string; space_id: string | null; project_id: string | null; event_type: string; entity_type: string; entity_id: string; metadata: unknown; created_at: string }>;
}

export interface AdminAiUsage {
  totalCalls: number;
  perFeature: Record<string, number>;
  perModel: Record<string, number>;
  avgLatencyMs: number | null;
  errorRate: number | null;
  totalCost: number | null;
  totalTokensIn: number | null;
  totalTokensOut: number | null;
  recentFailures: Array<{ id: string; feature: string; model: string; error: string | null; created_at: string }>;
}

export async function getAdminAiUsage(): Promise<AdminAiUsage> {
  const db = getServiceDb();
  const { data, error } = await db.from("ai_operations").select("id, feature, model, latency_ms, success, estimated_cost, tokens_in, tokens_out, error, created_at").order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    feature: string;
    model: string;
    latency_ms: number | string | null;
    success: boolean;
    estimated_cost: number | string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    error: string | null;
    created_at: string;
  }>;
  const totalCalls = rows.length;
  const perFeature: Record<string, number> = {};
  const perModel: Record<string, number> = {};
  let latSum = 0;
  let latCnt = 0;
  let fails = 0;
  let costSum = 0;
  let costCnt = 0;
  let tokensInSum = 0;
  let tokensOutSum = 0;
  let tokensInCnt = 0;
  let tokensOutCnt = 0;
  const recentFailures: AdminAiUsage["recentFailures"] = [];
  for (const r of rows) {
    perFeature[r.feature] = (perFeature[r.feature] ?? 0) + 1;
    perModel[r.model] = (perModel[r.model] ?? 0) + 1;
    if (r.latency_ms !== null) {
      latSum += Number(r.latency_ms);
      latCnt++;
    }
    if (!r.success) {
      fails++;
      if (recentFailures.length < 10) recentFailures.push({ id: r.id, feature: r.feature, model: r.model, error: r.error, created_at: r.created_at });
    }
    if (r.estimated_cost !== null && r.estimated_cost !== undefined) {
      const v = Number(r.estimated_cost);
      if (!Number.isNaN(v)) {
        costSum += v;
        costCnt++;
      }
    }
    if (r.tokens_in !== null && r.tokens_in !== undefined) {
      tokensInSum += Number(r.tokens_in);
      tokensInCnt++;
    }
    if (r.tokens_out !== null && r.tokens_out !== undefined) {
      tokensOutSum += Number(r.tokens_out);
      tokensOutCnt++;
    }
  }
  return {
    totalCalls,
    perFeature,
    perModel,
    avgLatencyMs: latCnt > 0 ? Math.round(latSum / latCnt) : null,
    errorRate: totalCalls > 0 ? Math.round((fails / totalCalls) * 10000) / 10000 : null,
    totalCost: costCnt > 0 ? Math.round(costSum * 1_000_000) / 1_000_000 : null,
    totalTokensIn: tokensInCnt > 0 ? tokensInSum : null,
    totalTokensOut: tokensOutCnt > 0 ? tokensOutSum : null,
    recentFailures,
  };
}

export interface AdminJobHealth {
  recentEvents: Array<{ id: string; event_type: string; created_at: string; metadata: unknown }>;
  aiTotal: number;
  aiFailures: number;
}

/**
 * Job health proxy: recent job-tied learning_events + ai_operations failure tallies.
 * Caller must have passed requireAdmin(); uses service role.
 */
export async function getAdminJobHealth(): Promise<AdminJobHealth> {
  const db = getServiceDb();
  const { data, error } = await db
    .from("learning_events")
    .select("id, event_type, created_at, metadata")
    .in("event_type", ["MATERIAL_READY", "MATERIAL_FAILED", "MATERIAL_PROCESSING_STARTED", "MATERIAL_UPLOADED", "QUIZ_COMPLETED", "MASTERY_UPDATED", "RECOMMENDATION_GENERATED"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  let aiTotal = 0;
  let aiFailures = 0;
  try {
    const { data: ops } = await db.from("ai_operations").select("success").order("created_at", { ascending: false }).limit(200);
    aiTotal = (ops ?? []).length;
    aiFailures = ((ops ?? []) as Array<{ success: boolean }>).filter((r) => !r.success).length;
  } catch {
    // best-effort tally; events table above is the primary signal
  }

  return {
    recentEvents: (data ?? []) as AdminJobHealth["recentEvents"],
    aiTotal,
    aiFailures,
  };
}

/* ------------------------------------------------------------------ */
/* System Health (Task 2) — lightweight, admin-only, server-side only. */
/* Every check is real (live query / config presence / short-timeout    */
/* probe) and never returns secret values — only presence + labels.     */
/* Individual checks degrade to `unknown` instead of throwing so one    */
/* failing dependency never blanks the whole page.                      */
/* ------------------------------------------------------------------ */

export type HealthCheckStatus = "ok" | "degraded" | "not_configured" | "unknown";

export interface HealthCheck {
  key: "database" | "storage" | "chat" | "embeddings" | "jobs";
  label: string;
  status: HealthCheckStatus;
  /** Human-readable detail — never contains secret values. */
  detail: string;
  latencyMs?: number | null;
}

export type OverallHealth = "HEALTHY" | "DEGRADED";

export interface AdminSystemHealth {
  overall: OverallHealth;
  checkedAt: string;
  chatProvider: "mercury" | "meta" | "none";
  chatModel: string | null;
  embeddingProvider: "gemini";
  embeddingModel: string;
  checks: HealthCheck[];
  aiFailureCount24h: number | null;
  materialFailedCount24h: number | null;
  recentAiFailures: Array<{ id: string; feature: string; model: string; error: string | null; created_at: string }>;
  failedMaterials: Array<{ id: string; filename: string; processing_error: string | null; created_at: string }>;
}

const HEALTH_TIMEOUT_MS = 4000;
const HEALTH_WINDOW_HOURS = 24;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Pure aggregation for tests: DEGRADED when the database is not ok, when
 * storage/chat/embeddings report degraded, or when chat was never
 * configured. `not_configured` jobs (Inngest keys) and `unknown` probes do
 * not flip the overall state on their own — the page surfaces them with
 * their own badge so an admin can tell "cannot check" from "failing".
 */
export function computeOverallStatus(
  checks: Array<Pick<HealthCheck, "key" | "status">>
): OverallHealth {
  const byKey = new Map(checks.map((c) => [c.key, c.status]));
  if (byKey.get("database") !== "ok") return "DEGRADED";
  if (byKey.get("storage") === "degraded") return "DEGRADED";
  if (byKey.get("chat") === "degraded" || byKey.get("chat") === "not_configured") return "DEGRADED";
  if (byKey.get("embeddings") === "degraded") return "DEGRADED";
  return "HEALTHY";
}

async function checkDatabase(): Promise<HealthCheck> {
  const t0 = Date.now();
  try {
    const db = getServiceDb();
    const { error } = await withTimeout(
      db.from("projects").select("id", { count: "exact", head: true }) as unknown as Promise<{ error: { message: string } | null }>,
      HEALTH_TIMEOUT_MS,
      "Database query"
    );
    if (error) {
      return { key: "database", label: "Database", status: "degraded", detail: `Query failed: ${error.message.slice(0, 200)}`, latencyMs: Date.now() - t0 };
    }
    return { key: "database", label: "Database", status: "ok", detail: "Supabase Postgres reachable (live count query).", latencyMs: Date.now() - t0 };
  } catch (e) {
    return { key: "database", label: "Database", status: "unknown", detail: `Check could not run: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, latencyMs: null };
  }
}

async function checkStorage(): Promise<HealthCheck> {
  const t0 = Date.now();
  try {
    const db = getServiceDb();
    const { error } = await withTimeout(db.storage.from("materials").list("", { limit: 1 }), HEALTH_TIMEOUT_MS, "Storage check");
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("bucket") && msg.includes("not found")) {
        return { key: "storage", label: "Storage", status: "degraded", detail: 'Bucket "materials" not found — create it (private) or run db/schema/003_storage.sql.', latencyMs: Date.now() - t0 };
      }
      return { key: "storage", label: "Storage", status: "degraded", detail: `Storage check failed: ${error.message.slice(0, 200)}`, latencyMs: Date.now() - t0 };
    }
    return { key: "storage", label: "Storage", status: "ok", detail: 'Bucket "materials" reachable (live list probe).', latencyMs: Date.now() - t0 };
  } catch (e) {
    return { key: "storage", label: "Storage", status: "unknown", detail: `Check could not run: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, latencyMs: null };
  }
}

function checkChatConfig(): HealthCheck {
  const mercuryKey = process.env.MERCURY_API_KEY || process.env.INCEPTION_API_KEY;
  const metaKey = process.env.META_API_KEY;
  if (mercuryKey) {
    return { key: "chat", label: "AI chat", status: "ok", detail: `Mercury configured (model ${process.env.MERCURY_CHAT_MODEL || "mercury-2.5"}). Configuration check only — no live call, no cost.` };
  }
  if (metaKey) {
    return { key: "chat", label: "AI chat", status: "ok", detail: "Meta Llama API configured (model Llama-4-Maverick-17B-128E-Instruct-FP8). Configuration check only — no live call, no cost." };
  }
  return { key: "chat", label: "AI chat", status: "not_configured", detail: "No chat provider key set (MERCURY_API_KEY or META_API_KEY). Tutor, quiz, and recommendations will fail." };
}

async function checkEmbeddings(): Promise<HealthCheck> {
  const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
  const dim = process.env.GEMINI_EMBEDDING_DIM || "768";
  if (!process.env.GEMINI_API_KEY) {
    return { key: "embeddings", label: "Embeddings", status: "not_configured", detail: "GEMINI_API_KEY is not set. Retrieval will fail — set it in .env.local (see .env.example)." };
  }
  return { key: "embeddings", label: "Embeddings", status: "ok", detail: `Gemini embeddings configured (model ${model}, ${dim}d). Configuration check only — no live call, no cost.` };
}

async function checkJobs(): Promise<HealthCheck> {
  const hasEventKey = !!process.env.INNGEST_EVENT_KEY;
  const hasSigningKey = !!process.env.INNGEST_SIGNING_KEY;
  const configured = hasEventKey && hasSigningKey;
  try {
    const db = getServiceDb();
    const windowStart = new Date(Date.now() - HEALTH_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { count, error } = await withTimeout(
      db.from("learning_events").select("id", { count: "exact", head: true }).gte("created_at", windowStart) as unknown as Promise<{ count: number | null; error: { message: string } | null }>,
      HEALTH_TIMEOUT_MS,
      "Jobs signal query"
    );
    if (error) {
      return { key: "jobs", label: "Background jobs", status: "unknown", detail: `Event signal unreadable: ${error.message.slice(0, 160)}`, latencyMs: null };
    }
    const suffix = configured
      ? `Inngest keys set; ${count ?? 0} learning events in the last ${HEALTH_WINDOW_HOURS}h.`
      : `INNGEST_EVENT_KEY/SIGNING_KEY not set — running on direct-call fallback (local dev mode); ${count ?? 0} learning events in the last ${HEALTH_WINDOW_HOURS}h.`;
    return { key: "jobs", label: "Background jobs", status: configured ? "ok" : "not_configured", detail: suffix };
  } catch (e) {
    return { key: "jobs", label: "Background jobs", status: "unknown", detail: `Check could not run: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, latencyMs: null };
  }
}

/**
 * Lightweight system health for the admin dashboard. Caller must have
 * passed requireAdmin(); uses the service role server-side only.
 * Never throws for a single failing dependency — checks settle
 * independently and failures render as their own status badge.
 */
export async function getAdminSystemHealth(): Promise<AdminSystemHealth> {
  const embeddingProvider = "gemini" as const;
  const mercuryKey = process.env.MERCURY_API_KEY || process.env.INCEPTION_API_KEY;
  const metaKey = process.env.META_API_KEY;
  const chatProvider = mercuryKey ? ("mercury" as const) : metaKey ? ("meta" as const) : ("none" as const);
  const chatModel = chatProvider === "mercury" ? process.env.MERCURY_CHAT_MODEL || "mercury-2.5" : chatProvider === "meta" ? "Llama-4-Maverick-17B-128E-Instruct-FP8" : null;

  const [database, storage, embeddings, jobs] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkEmbeddings(),
    checkJobs(),
  ]);
  const chat = checkChatConfig();
  const checks: HealthCheck[] = [database, storage, chat, embeddings, jobs];

  let aiFailureCount24h: number | null = null;
  let materialFailedCount24h: number | null = null;
  let recentAiFailures: AdminSystemHealth["recentAiFailures"] = [];
  let failedMaterials: AdminSystemHealth["failedMaterials"] = [];
  try {
    const db = getServiceDb();
    const windowStart = new Date(Date.now() - HEALTH_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    // Note: supabase builders are thenables with builder-flavored types, so
    // cast each to the resolved shape before the timeout race.
    type CountResult = { count: number | null; error: { message: string } | null };
    type AiFailRows = { data: Array<{ id: string; feature: string; model: string; error: string | null; created_at: string }> | null; error: { message: string } | null };
    type FailedMatRows = { data: Array<{ id: string; filename: string; processing_error: string | null; created_at: string }> | null; error: { message: string } | null };
    const [aiFailRes, matFailRes, recentFailRes, failedMatRes] = await Promise.all([
      withTimeout(
        db.from("ai_operations").select("id", { count: "exact", head: true }).eq("success", false).gte("created_at", windowStart) as unknown as Promise<CountResult>,
        HEALTH_TIMEOUT_MS,
        "AI failure count"
      ).catch(() => null),
      withTimeout(
        db.from("learning_events").select("id", { count: "exact", head: true }).eq("event_type", "MATERIAL_FAILED").gte("created_at", windowStart) as unknown as Promise<CountResult>,
        HEALTH_TIMEOUT_MS,
        "Material failure count"
      ).catch(() => null),
      withTimeout(
        db.from("ai_operations").select("id, feature, model, error, created_at").eq("success", false).order("created_at", { ascending: false }).limit(10) as unknown as Promise<AiFailRows>,
        HEALTH_TIMEOUT_MS,
        "Recent AI failures"
      ).catch(() => null),
      withTimeout(
        db.from("materials").select("id, filename, processing_error, created_at").eq("status", "FAILED").order("created_at", { ascending: false }).limit(10) as unknown as Promise<FailedMatRows>,
        HEALTH_TIMEOUT_MS,
        "Failed materials"
      ).catch(() => null),
    ]);
    if (aiFailRes && !aiFailRes.error && typeof aiFailRes.count === "number") aiFailureCount24h = aiFailRes.count;
    if (matFailRes && !matFailRes.error && typeof matFailRes.count === "number") materialFailedCount24h = matFailRes.count;
    if (recentFailRes && !recentFailRes.error) {
      recentAiFailures = ((recentFailRes.data ?? []) as Array<{ id: string; feature: string; model: string; error: string | null; created_at: string }>).map((r) => ({
        ...r,
        error: r.error ? r.error.slice(0, 300) : null,
      }));
    }
    if (failedMatRes && !failedMatRes.error) {
      failedMaterials = ((failedMatRes.data ?? []) as Array<{ id: string; filename: string; processing_error: string | null; created_at: string }>).map((r) => ({
        ...r,
        processing_error: r.processing_error ? r.processing_error.slice(0, 300) : null,
      }));
    }
  } catch {
    // Failure tallies are best-effort; the five checks above are the signal.
  }

  return {
    overall: computeOverallStatus(checks),
    checkedAt: new Date().toISOString(),
    chatProvider,
    chatModel,
    embeddingProvider,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    checks,
    aiFailureCount24h,
    materialFailedCount24h,
    recentAiFailures,
    failedMaterials,
  };
}

