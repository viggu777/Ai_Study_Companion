import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { classifyTrend } from "@/services/growth.service";

export const ACTIVE_PROJECT_WINDOW_DAYS = 7;

export interface ProjectAnalytics {
  projectId: string;
  learningActivity: {
    tutorSessions: number; // conversations count
    quizAttempts: number;
    questionsAnswered: number;
    tutorMessagesSent: number; // learning_events TUTOR_MESSAGE_SENT
  };
  assessment: {
    totalAnswers: number;
    averageScore: number | null; // avg across all answers with score
    averageOpenEndedScore: number | null; // avg where evaluation not null
    accuracy: number | null; // is_correct true / total where is_correct not null, 0..100
    accuracyOverTime: Array<{ date: string; accuracy: number | null; avgScore: number | null; count: number }>;
    mcqCount: number;
    openEndedCount: number;
  };
  mastery: {
    perConcept: Array<{ conceptId: string; name: string; mastery: number | null }>;
    avgMastery: number | null;
    improvingCount: number;
    stableCount: number;
    requiresAttentionCount: number;
    totalConcepts: number;
  };
  aiActivity: {
    totalCalls: number;
    perFeature: Record<string, number>;
    avgLatencyMs: number | null;
    errorRate: number | null; // 0..1
  };
  recentEventsCount: number;
}

export interface GlobalAnalytics {
  totalProjects: number;
  activeProjects: number; // activity in last N days
  activeWindowDays: number;
  totalQuizAttempts: number;
  totalQuestionsAnswered: number;
  totalTutorInteractions: number; // learning_events TUTOR_MESSAGE_SENT + TUTOR_RESPONSE_GENERATED or messages count; we use learning_events
  avgMastery: number | null; // avg across all concept_mastery
  totalConcepts: number;
  aiUsage: {
    totalCalls: number;
    perFeature: Record<string, number>;
    avgLatencyMs: number | null;
    errorRate: number | null;
    totalEstimatedCost: number | null;
  };
}

async function verifyProjectOwnership(projectId: string, userId: string): Promise<{ spaceId: string }> {
  const db = await getDb();
  const { data, error } = await db.from("projects").select("id, space_id").eq("id", projectId).eq("user_id", userId).single();
  if (error || !data) throw new Error("Project not found");
  return { spaceId: (data as { space_id: string }).space_id };
}

export async function getProjectAnalytics(projectId: string): Promise<ProjectAnalytics> {
  const userId = await getCurrentUserId();
  await verifyProjectOwnership(projectId, userId);
  const db = await getDb();

  // Parallel base queries
  const [
    conversationsRes,
    quizzesRes,
    conceptsRes,
    masteryRes,
    aiOpsRes,
    learningEventsRes,
  ] = await Promise.all([
    db.from("conversations").select("id", { count: "exact" }).eq("project_id", projectId).eq("user_id", userId),
    db.from("quizzes").select("id, created_at", { count: "exact" }).eq("project_id", projectId).eq("user_id", userId),
    db.from("concepts").select("id, name").eq("project_id", projectId),
    db.from("concept_mastery").select("concept_id, mastery_score, updated_at").eq("project_id", projectId).eq("user_id", userId),
    db.from("ai_operations").select("feature, latency_ms, success, estimated_cost").eq("project_id", projectId).eq("user_id", userId),
    db.from("learning_events").select("id, event_type, created_at").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
  ]);

  if (conversationsRes.error) throw new Error(conversationsRes.error.message);
  if (quizzesRes.error) throw new Error(quizzesRes.error.message);

  const tutorSessions = conversationsRes.count ?? (Array.isArray(conversationsRes.data) ? conversationsRes.data.length : 0);
  const quizAttempts = quizzesRes.count ?? (Array.isArray(quizzesRes.data) ? quizzesRes.data.length : 0);
  const quizIds = ((quizzesRes.data ?? []) as Array<{ id: string }>).map((q) => q.id);

  // Questions answered: need to join via questions
  let questionsAnswered = 0;
  let totalAnswers = 0;
  let answerRows: Array<{ question_id: string; is_correct: boolean | null; score: number | string | null; evaluation: unknown; created_at: string }> = [];
  let questionsForProject: Array<{ id: string; concept_id: string }> = [];

  if (quizIds.length > 0) {
    const { data: questions } = await db.from("questions").select("id, concept_id").in("quiz_id", quizIds);
    questionsForProject = (questions ?? []) as Array<{ id: string; concept_id: string }>;
    const questionIds = questionsForProject.map((q) => q.id);
    if (questionIds.length > 0) {
      const { data: answers, error: ansErr } = await db
        .from("answers")
        .select("question_id, is_correct, score, evaluation, created_at")
        .eq("user_id", userId)
        .in("question_id", questionIds)
        .order("created_at", { ascending: true });
      if (ansErr) throw new Error(ansErr.message);
      answerRows = (answers ?? []) as typeof answerRows;
      questionsAnswered = answerRows.length;
      totalAnswers = answerRows.length;
    }
  }

  // Assessment breakdown
  let averageScore: number | null = null;
  let averageOpenEndedScore: number | null = null;
  let accuracy: number | null = null;
  let mcqCount = 0;
  let openEndedCount = 0;

  if (answerRows.length > 0) {
    const scores = answerRows.map((a) => (a.score !== null ? Number(a.score) : null)).filter((v): v is number => v !== null);
    if (scores.length > 0) averageScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;

    const openEndedScores = answerRows
      .filter((a) => a.evaluation !== null)
      .map((a) => (a.score !== null ? Number(a.score) : null))
      .filter((v): v is number => v !== null);
    if (openEndedScores.length > 0) averageOpenEndedScore = Math.round((openEndedScores.reduce((a, b) => a + b, 0) / openEndedScores.length) * 100) / 100;
    openEndedCount = openEndedScores.length;
    mcqCount = answerRows.length - openEndedCount; // approximate: those without evaluation are MCQ; for manual count this aligns with grading path

    // More precise mcq distinction: is_correct not null and evaluation null
    // but keep count as above for display
    const accCandidates = answerRows.filter((a) => a.is_correct !== null);
    if (accCandidates.length > 0) {
      const correct = accCandidates.filter((a) => a.is_correct === true).length;
      accuracy = Math.round((correct / accCandidates.length) * 10000) / 100; // percent 0..100 with 2 decimals
    }
  }

  // Accuracy over time: group by date (YYYY-MM-DD) by answer.created_at
  const grouped = new Map<string, Array<{ is_correct: boolean | null; score: number | null }>>();
  for (const a of answerRows) {
    const date = (a.created_at ?? "").slice(0, 10) || "unknown";
    const arr = grouped.get(date) ?? [];
    arr.push({ is_correct: a.is_correct, score: a.score !== null ? Number(a.score) : null });
    grouped.set(date, arr);
  }
  const accuracyOverTime = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const total = rows.length;
      const accRows = rows.filter((r) => r.is_correct !== null);
      const acc = accRows.length > 0 ? Math.round((accRows.filter((r) => r.is_correct).length / accRows.length) * 10000) / 100 : null;
      const scores = rows.map((r) => r.score).filter((v): v is number => v !== null);
      const avg = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
      return { date, accuracy: acc, avgScore: avg, count: total };
    })
    .slice(-14); // last 14 days max

  // Mastery per concept
  const concepts = (conceptsRes.data ?? []) as Array<{ id: string; name: string }>;
  const masteryRows = (masteryRes.data ?? []) as Array<{ concept_id: string; mastery_score: number | string }>;
  const masteryByConcept = new Map<string, number>();
  for (const m of masteryRows) masteryByConcept.set(m.concept_id, Number(m.mastery_score));
  const perConcept = concepts.map((c) => ({
    conceptId: c.id,
    name: c.name,
    mastery: masteryByConcept.has(c.id) ? masteryByConcept.get(c.id)! : null,
  }));
  let avgMastery: number | null = null;
  if (masteryRows.length > 0) {
    const vals = masteryRows.map((r) => Number(r.mastery_score));
    avgMastery = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  // Trend counts via growth logic: compare last 2 mastery_history points per concept
  let improvingCount = 0;
  let stableCount = 0;
  let requiresAttentionCount = 0;
  // Fetch history last 2 per concept (bounded, do N+1 queries but concepts small; alternative: fetch all history for project)
  // To keep consistent with spec's threshold 5, reuse same logic as growth.service
  if (concepts.length > 0) {
    for (const c of concepts) {
      const { data: hist } = await db
        .from("mastery_history")
        .select("previous_score, new_score, created_at")
        .eq("concept_id", c.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(2);
      const h = (hist ?? []) as Array<{ previous_score: number | string; new_score: number | string }>;
      let trend: ReturnType<typeof classifyTrend>;
      if (h.length === 0) {
        // No history — check mastery value: null or <60 considered requires? But for analytics we mirror growth: STABLE if no history
        // However weak detection for mastery summary: if mastery null or <60, counts as weak for UI hint
        // Keep trend STABLE for this classification
        trend = "STABLE";
      } else if (h.length === 1) {
        const prev = Number(h[0].previous_score);
        const curr = Number(h[0].new_score);
        trend = classifyTrend(prev, curr);
      } else {
        const latest = Number(h[0].new_score);
        const prior = Number(h[1].new_score);
        trend = classifyTrend(prior, latest);
      }
      if (trend === "IMPROVING") improvingCount++;
      else if (trend === "REQUIRES_ATTENTION") requiresAttentionCount++;
      else stableCount++;
    }
  }

  // AI activity scoped to project
  const aiRows = (aiOpsRes.data ?? []) as Array<{ feature: string; latency_ms: number | null; success: boolean; estimated_cost: number | string | null }>;
  const totalCalls = aiRows.length;
  const perFeature: Record<string, number> = {};
  let latencySum = 0;
  let latencyCount = 0;
  let failures = 0;
  for (const r of aiRows) {
    perFeature[r.feature] = (perFeature[r.feature] ?? 0) + 1;
    if (r.latency_ms !== null) {
      latencySum += Number(r.latency_ms);
      latencyCount++;
    }
    if (!r.success) failures++;
  }
  const avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : null;
  const errorRate = totalCalls > 0 ? Math.round((failures / totalCalls) * 10000) / 10000 : null;

  // Tutor messages sent via learning_events
  const leRows = (learningEventsRes.data ?? []) as Array<{ event_type: string }>;
  // Need accurate count for tutorMessagesSent: query count for that type if not all fetched (limit 100 may truncate)
  // So do a precise count query if needed
  let tutorMessagesSent = leRows.filter((r) => r.event_type === "TUTOR_MESSAGE_SENT").length;
  // If truncated, fetch full count (cheap)
  if (leRows.length === 100) {
    const { count } = await db.from("learning_events").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("user_id", userId).eq("event_type", "TUTOR_MESSAGE_SENT");
    if (count !== null) tutorMessagesSent = count;
  }
  const recentEventsCount = learningEventsRes.count ?? leRows.length;

  return {
    projectId,
    learningActivity: {
      tutorSessions,
      quizAttempts,
      questionsAnswered,
      tutorMessagesSent,
    },
    assessment: {
      totalAnswers,
      averageScore,
      averageOpenEndedScore,
      accuracy,
      accuracyOverTime,
      mcqCount,
      openEndedCount,
    },
    mastery: {
      perConcept,
      avgMastery,
      improvingCount,
      stableCount,
      requiresAttentionCount,
      totalConcepts: concepts.length,
    },
    aiActivity: {
      totalCalls,
      perFeature,
      avgLatencyMs,
      errorRate,
    },
    recentEventsCount,
  };
}

export async function getGlobalAnalytics(): Promise<GlobalAnalytics> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const windowStart = new Date(Date.now() - ACTIVE_PROJECT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Fetch project ids first for concept counting (concepts has no user_id, only project_id)
  const { data: projectIdRows } = await db.from("projects").select("id").eq("user_id", userId);
  const projectIds = ((projectIdRows ?? []) as Array<{ id: string }>).map((p) => p.id);

  const [projectsRes, quizzesRes, answersRes, masteryRes, aiOpsRes, activeEventsRes, tutorEventsRes] = await Promise.all([
    db.from("projects").select("id", { count: "exact" }).eq("user_id", userId),
    db.from("quizzes").select("id", { count: "exact" }).eq("user_id", userId),
    db.from("answers").select("id", { count: "exact" }).eq("user_id", userId),
    db.from("concept_mastery").select("mastery_score").eq("user_id", userId),
    db.from("ai_operations").select("feature, latency_ms, success, estimated_cost").eq("user_id", userId),
    db.from("learning_events").select("project_id").eq("user_id", userId).gte("created_at", windowStart),
    db.from("learning_events").select("id", { count: "exact", head: true }).eq("user_id", userId).in("event_type", ["TUTOR_MESSAGE_SENT", "TUTOR_RESPONSE_GENERATED"]),
  ]);

  // Total concepts via projects -> concepts (handle empty project list)
  let totalConcepts = 0;
  if (projectIds.length > 0) {
    const { count } = await db.from("concepts").select("id", { count: "exact", head: true }).in("project_id", projectIds);
    totalConcepts = count ?? 0;
  }

  // Active projects: distinct project_ids from events in window
  const activeProjectIds = new Set<string>();
  for (const r of ((activeEventsRes.data ?? []) as Array<{ project_id: string | null }>)) {
    if (r.project_id) activeProjectIds.add(r.project_id);
  }

  const totalProjects = projectsRes.count ?? (Array.isArray(projectsRes.data) ? projectsRes.data.length : 0);
  const totalQuizAttempts = quizzesRes.count ?? (Array.isArray(quizzesRes.data) ? quizzesRes.data.length : 0);
  const totalQuestionsAnswered = answersRes.count ?? (Array.isArray(answersRes.data) ? answersRes.data.length : 0);

  let totalTutorInteractions = 0;
  if (typeof tutorEventsRes.count === "number" && tutorEventsRes.count !== null) totalTutorInteractions = tutorEventsRes.count;
  else {
    const { count } = await db.from("learning_events").select("id", { count: "exact", head: true }).eq("user_id", userId).in("event_type", ["TUTOR_MESSAGE_SENT", "TUTOR_RESPONSE_GENERATED"]);
    totalTutorInteractions = count ?? 0;
  }

  // Avg mastery
  const masteryRows = (masteryRes.data ?? []) as Array<{ mastery_score: number | string }>;
  let avgMastery: number | null = null;
  if (masteryRows.length > 0) {
    const vals = masteryRows.map((r) => Number(r.mastery_score));
    avgMastery = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  // AI usage summary
  const aiRows = (aiOpsRes.data ?? []) as Array<{ feature: string; latency_ms: number | null; success: boolean; estimated_cost: number | string | null }>;
  const totalCalls = aiRows.length;
  const perFeature: Record<string, number> = {};
  let latencySum = 0;
  let latencyCount = 0;
  let failures = 0;
  let costSum = 0;
  let costCount = 0;
  for (const r of aiRows) {
    perFeature[r.feature] = (perFeature[r.feature] ?? 0) + 1;
    if (r.latency_ms !== null) {
      latencySum += Number(r.latency_ms);
      latencyCount++;
    }
    if (!r.success) failures++;
    if (r.estimated_cost !== null && r.estimated_cost !== undefined) {
      const v = Number(r.estimated_cost);
      if (!Number.isNaN(v)) {
        costSum += v;
        costCount++;
      }
    }
  }
  const avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : null;
  const errorRate = totalCalls > 0 ? Math.round((failures / totalCalls) * 10000) / 10000 : null;
  const totalEstimatedCost = costCount > 0 ? Math.round(costSum * 1000000) / 1000000 : null;

  return {
    totalProjects,
    activeProjects: activeProjectIds.size,
    activeWindowDays: ACTIVE_PROJECT_WINDOW_DAYS,
    totalQuizAttempts,
    totalQuestionsAnswered,
    totalTutorInteractions,
    avgMastery,
    totalConcepts,
    aiUsage: {
      totalCalls,
      perFeature,
      avgLatencyMs,
      errorRate,
      totalEstimatedCost,
    },
  };
}
