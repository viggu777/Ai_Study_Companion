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

export async function listAdminProjects(opts: {
  q?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<{ id: string; name: string; description: string | null; user_id: string; space_id: string; created_at: string }>> {
  const db = getServiceDb();
  let query = db.from("projects").select("id, name, description, user_id, space_id, created_at").order("created_at", { ascending: false });
  if (opts.q) query = query.ilike("name", `%${opts.q}%`);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.limit) query = query.limit(opts.limit);
  if (opts.offset) query = query.range(opts.offset, (opts.offset + (opts.limit ?? 20) - 1));
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
