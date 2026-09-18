import { getDb, getServiceDb } from "@/lib/db/supabase";
import { normalizeMisconception, misconceptionSimilarity } from "@/ai/practice";

export interface MisconceptionRow {
  id: string;
  project_id: string;
  user_id: string;
  concept_id: string;
  concept_name?: string;
  description: string;
  occurrence_count: number;
  last_seen_at: string;
  status: string;
}

const SIMILARITY_MERGE_THRESHOLD = 0.6;

/**
 * Upsert a misconception: exact normalized match wins; otherwise a
 * token-Jaccard >= 0.6 against an ACTIVE misconception for the same
 * concept merges (same recurring pattern, slightly rephrased). Else insert.
 * Repeated sightings increment occurrence_count — that count is what boosts
 * future practice priority (not the raw low score).
 */
export async function upsertMisconception(params: {
  projectId: string;
  conceptId: string;
  description: string;
  userId?: string;
  useServiceDb?: boolean;
}): Promise<MisconceptionRow> {
  const raw = params.description.trim().slice(0, 500);
  if (!raw) throw new Error("Misconception description is required");
  const normalized = normalizeMisconception(raw);
  if (!normalized) throw new Error("Misconception description is required");

  let userId = params.userId ?? null;
  let db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>;
  if (params.useServiceDb) {
    db = getServiceDb();
    if (!userId) throw new Error("userId required with useServiceDb");
  } else {
    if (!userId) {
      const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
      userId = await getCurrentUserId();
    }
    db = await getDb();
  }
  const typed = db as Awaited<ReturnType<typeof getDb>>;

  // Ownership: project + concept must belong together to this user.
  const { data: proj } = await typed.from("projects").select("id").eq("id", params.projectId).eq("user_id", userId!).single();
  if (!proj) throw new Error("Project not found");
  const { data: concept } = await typed.from("concepts").select("id").eq("id", params.conceptId).eq("project_id", params.projectId).single();
  if (!concept) throw new Error("Concept not found in this project");

  // Exact normalized match first (UNIQUE-guarded).
  const { data: exact } = await typed
    .from("misconceptions")
    .select("id, project_id, user_id, concept_id, description, occurrence_count, last_seen_at, status")
    .eq("project_id", params.projectId)
    .eq("user_id", userId!)
    .eq("concept_id", params.conceptId)
    .eq("normalized", normalized)
    .maybeSingle();
  const now = new Date().toISOString();
  if (exact) {
    const row = exact as MisconceptionRow & { occurrence_count: number };
    const { data: bumped, error } = await typed
      .from("misconceptions")
      .update({ occurrence_count: row.occurrence_count + 1, last_seen_at: now, updated_at: now, status: "ACTIVE" })
      .eq("id", row.id)
      .select("id, project_id, user_id, concept_id, description, occurrence_count, last_seen_at, status")
      .single();
    if (error || !bumped) throw new Error("Failed to update misconception");
    return bumped as MisconceptionRow;
  }

  // Near-duplicate merge: same concept, ACTIVE, Jaccard >= threshold.
  try {
    const { data: siblings } = await typed
      .from("misconceptions")
      .select("id, description, occurrence_count")
      .eq("project_id", params.projectId)
      .eq("user_id", userId!)
      .eq("concept_id", params.conceptId)
      .eq("status", "ACTIVE")
      .limit(20);
    for (const s of ((siblings ?? []) as Array<{ id: string; description: string; occurrence_count: number }>)) {
      if (misconceptionSimilarity(s.description, raw) >= SIMILARITY_MERGE_THRESHOLD) {
        const { data: merged, error } = await typed
          .from("misconceptions")
          .update({ occurrence_count: s.occurrence_count + 1, last_seen_at: now, updated_at: now })
          .eq("id", s.id)
          .select("id, project_id, user_id, concept_id, description, occurrence_count, last_seen_at, status")
          .single();
        if (!error && merged) return merged as MisconceptionRow;
      }
    }
  } catch {
    // Merge is best-effort; fall through to insert.
  }

  const { data: inserted, error: insErr } = await typed
    .from("misconceptions")
    .insert({
      project_id: params.projectId,
      user_id: userId!,
      concept_id: params.conceptId,
      description: raw,
      normalized,
      occurrence_count: 1,
      last_seen_at: now,
      status: "ACTIVE",
    })
    .select("id, project_id, user_id, concept_id, description, occurrence_count, last_seen_at, status")
    .single();
  if (insErr || !inserted) {
    // Race on UNIQUE(normalized) — read winner and bump.
    const { data: race } = await typed
      .from("misconceptions")
      .select("id, project_id, user_id, concept_id, description, occurrence_count, last_seen_at, status")
      .eq("project_id", params.projectId)
      .eq("user_id", userId!)
      .eq("concept_id", params.conceptId)
      .eq("normalized", normalized)
      .maybeSingle();
    if (race) {
      const r = race as MisconceptionRow;
      await typed.from("misconceptions").update({ occurrence_count: r.occurrence_count + 1, last_seen_at: now, updated_at: now }).eq("id", r.id);
      return { ...r, occurrence_count: r.occurrence_count + 1, last_seen_at: now };
    }
    throw new Error("Failed to record misconception");
  }
  return inserted as MisconceptionRow;
}

/** Active misconceptions for a project (newest / most frequent first). */
export async function listMisconceptions(projectId: string, opts?: { userId?: string; useServiceDb?: boolean }): Promise<MisconceptionRow[]> {
  let userId = opts?.userId ?? null;
  let db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>;
  if (opts?.useServiceDb) {
    db = getServiceDb();
    if (!userId) throw new Error("userId required with useServiceDb");
  } else {
    if (!userId) {
      const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
      userId = await getCurrentUserId();
    }
    db = await getDb();
  }
  const typed = db as Awaited<ReturnType<typeof getDb>>;
  const { data: proj } = await typed.from("projects").select("id").eq("id", projectId).eq("user_id", userId!).single();
  if (!proj) throw new Error("Project not found");
  const { data, error } = await typed
    .from("misconceptions")
    .select("id, project_id, user_id, concept_id, description, occurrence_count, last_seen_at, status")
    .eq("project_id", projectId)
    .eq("user_id", userId!)
    .order("occurrence_count", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(50);
  if (error) {
    if (error.message.includes("misconceptions") || error.code === "42P01") return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as MisconceptionRow[];
  if (rows.length === 0) return rows;
  const { data: concepts } = await typed.from("concepts").select("id, name").in("id", [...new Set(rows.map((r) => r.concept_id))]);
  const nameById = new Map(((concepts ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, concept_name: nameById.get(r.concept_id) ?? "Unknown" }));
}
