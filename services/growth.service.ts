import { getDb } from "@/lib/db/supabase";
import { getServiceDb } from "@/lib/db/supabase";

export type Trend = "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";

export const TREND_THRESHOLD = 5;

export function classifyTrend(previousScore: number, newScore: number): Trend {
  const delta = newScore - previousScore;
  if (delta > TREND_THRESHOLD) return "IMPROVING";
  if (delta < -TREND_THRESHOLD) return "REQUIRES_ATTENTION";
  return "STABLE";
}

export interface GrowthEntry {
  conceptId: string;
  conceptName: string;
  description: string | null;
  previousScore: number | null;
  currentScore: number | null;
  delta: number | null;
  trend: Trend;
  historyCount: number;
  /** materials row this concept was extracted from (may be null) */
  sourceMaterialId: string | null;
}

async function getProjectOwnerCheck(projectId: string, userId: string, db: Awaited<ReturnType<typeof getDb>>) {
  const { data } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
  return !!data;
}

/**
 * Reads mastery_history per concept and classifies each concept as IMPROVING/STABLE/REQUIRES_ATTENTION
 * by comparing the two most recent history points per spec: >+5 improving, <-5 requires attention, else stable.
 * If no history, uses concept_mastery directly and marks STABLE.
 * Ownership-scoped: verifies project belongs to userId.
 * Uses getDb for request-scoped RLS; falls back to service DB only when explicitly via service job (provide useServiceDb).
 */
export async function getGrowthAnalysis(
  projectId: string,
  opts?: { userId?: string; useServiceDb?: boolean }
): Promise<GrowthEntry[]> {
  let userId = opts?.userId ?? null;
  let db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>;
  if (opts?.useServiceDb) {
    db = getServiceDb();
    if (!userId) throw new Error("userId required with useServiceDb");
  } else {
    // Resolve userId from session if not provided
    if (!userId) {
      const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
      userId = await getCurrentUserId();
    }
    db = await getDb();
    const owned = await getProjectOwnerCheck(projectId, userId, db as Awaited<ReturnType<typeof getDb>>);
    if (!owned) throw new Error("Project not found");
  }

  // Fetch concepts + current mastery concurrently (independent queries)
  const typedDb = db as Awaited<ReturnType<typeof getDb>>;
  const [conceptsRes, masteryRes] = await Promise.all([
    typedDb
      .from("concepts")
      .select("id, name, description, source_material_id")
      .eq("project_id", projectId)
      .order("name", { ascending: true }),
    typedDb
      .from("concept_mastery")
      .select("concept_id, mastery_score")
      .eq("project_id", projectId)
      .eq("user_id", userId!),
  ]);
  if (conceptsRes.error) throw new Error(`Failed to fetch concepts: ${conceptsRes.error.message}`);
  const conceptRows = (conceptsRes.data ?? []) as Array<{ id: string; name: string; description: string | null; source_material_id: string | null }>;
  if (conceptRows.length === 0) return [];

  const masteryByConcept = new Map<string, number>();
  for (const r of ((masteryRes.data ?? []) as Array<{ concept_id: string; mastery_score: number | string }>)) {
    masteryByConcept.set(r.concept_id, Number(r.mastery_score));
  }

  // Fetch mastery_history: one batched query for all concepts (not N serial
  // round-trips). Rows are globally newest-first; group per concept in JS so
  // historyCount is the TRUE total (previously limit(2) per concept made every
  // count read 0-2). Trend still uses the 2 most recent points per concept.
  const { data: historyRows, error: histErr } = await typedDb
    .from("mastery_history")
    .select("concept_id, previous_score, new_score, created_at")
    .eq("user_id", userId!)
    .in("concept_id", conceptRows.map((c) => c.id))
    .order("created_at", { ascending: false })
    .limit(2000);
  if (histErr) throw new Error(`Failed to fetch mastery history: ${histErr.message}`);

  const byConcept = new Map<string, Array<{ previous_score: number | string; new_score: number | string; created_at: string }>>();
  for (const h of ((historyRows ?? []) as Array<{ concept_id: string; previous_score: number | string; new_score: number | string; created_at: string }>)) {
    const arr = byConcept.get(h.concept_id) ?? [];
    arr.push({ previous_score: h.previous_score, new_score: h.new_score, created_at: h.created_at });
    byConcept.set(h.concept_id, arr);
  }

  // For each concept, fetch mastery_history last 2 points
  const entries: GrowthEntry[] = [];
  for (let i = 0; i < conceptRows.length; i++) {
    const c = conceptRows[i];
    const h = byConcept.get(c.id) ?? [];
    const historyCount = h.length;
    const currentScore = masteryByConcept.get(c.id) ?? null;

    if (h.length === 0) {
      // No history — haven't been tested yet; current may be null or 0; trend STABLE
      entries.push({
        conceptId: c.id,
        conceptName: c.name,
        description: c.description,
        previousScore: null,
        currentScore,
        delta: null,
        trend: "STABLE",
        historyCount,
        sourceMaterialId: c.source_material_id ?? null,
      });
      continue;
    }
    if (h.length === 1) {
      // Single event — delta = new - previous of that event; previous/current from that row
      const only = h[0];
      const prev = Number(only.previous_score);
      const curr = Number(only.new_score);
      // If concept_mastery current differs from history latest (race), prefer mastery current but compute trend from history
      const trend = classifyTrend(prev, curr);
      entries.push({
        conceptId: c.id,
        conceptName: c.name,
        description: c.description,
        previousScore: prev,
        currentScore: currentScore ?? curr,
        delta: Math.round((curr - prev) * 100) / 100,
        trend,
        historyCount,
        sourceMaterialId: c.source_material_id ?? null,
      });
      continue;
    }
    // >=2: compare two most recent history points: new_score of latest vs new_score of previous
    const latest = h[0];
    const prior = h[1];
    const latestScore = Number(latest.new_score);
    const priorScore = Number(prior.new_score);
    const trend = classifyTrend(priorScore, latestScore);
    entries.push({
      conceptId: c.id,
      conceptName: c.name,
      description: c.description,
      previousScore: priorScore,
      currentScore: currentScore ?? latestScore,
      delta: Math.round((latestScore - priorScore) * 100) / 100,
      trend,
      historyCount,
      sourceMaterialId: c.source_material_id ?? null,
    });
  }

  return entries;
}
