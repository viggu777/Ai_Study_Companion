import { getDb, getServiceDb } from "@/lib/db/supabase";

export type EdgeRelation = "PREREQUISITE" | "RELATED" | "SUBCONCEPT";

export interface ConceptEdge {
  id: string;
  project_id: string;
  from_concept_id: string;
  to_concept_id: string;
  relation: EdgeRelation;
  confidence: number;
  evidence_count: number;
  last_evidence_at: string;
  created_at: string;
  updated_at: string;
  from_name?: string;
  to_name?: string;
}

const VALID_RELATIONS: EdgeRelation[] = ["PREREQUISITE", "RELATED", "SUBCONCEPT"];

/** Confidence after n evidences: 0.5, 0.6, 0.7 ... capped 0.95. Pure, tested. */
export function confidenceForEvidenceCount(n: number): number {
  return Math.min(0.95, Math.round((0.5 + 0.1 * Math.max(0, n - 1)) * 100) / 100);
}

/** An edge is trusted only after repeated evidence (>=2). Pure, tested. */
export function isEdgeValidated(evidenceCount: number): boolean {
  return evidenceCount >= 2;
}

async function verifyProjectOwnership(
  projectId: string,
  userId: string,
  db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>
): Promise<void> {
  const { data, error } = await (db as Awaited<ReturnType<typeof getDb>>)
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("Project not found");
}

async function verifyConceptsInProject(
  projectId: string,
  conceptIds: string[],
  db: Awaited<ReturnType<typeof getDb>> | ReturnType<typeof getServiceDb>
): Promise<void> {
  if (conceptIds.length === 0) return;
  const { data, error } = await (db as Awaited<ReturnType<typeof getDb>>)
    .from("concepts")
    .select("id")
    .eq("project_id", projectId)
    .in("id", [...new Set(conceptIds)]);
  if (error) throw new Error(error.message);
  const found = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
  for (const cid of new Set(conceptIds)) {
    if (!found.has(cid)) throw new Error("Concept not found in this project");
  }
}

/**
 * Upsert one edge. Validates: known relation, no self-loop, both concepts in
 * the same project. Repeated evidence increments evidence_count and raises
 * confidence; a single call can never create a trusted edge.
 * Idempotent per (project, from, to, relation) via UNIQUE + read-modify-write.
 */
export async function upsertConceptEdge(params: {
  projectId: string;
  fromConceptId: string;
  toConceptId: string;
  relation: EdgeRelation;
  userId?: string;
  useServiceDb?: boolean;
}): Promise<ConceptEdge> {
  const { projectId, fromConceptId, toConceptId, relation } = params;
  if (!VALID_RELATIONS.includes(relation)) throw new Error("Invalid edge relation");
  if (fromConceptId === toConceptId) throw new Error("Edge must not be a self-loop");

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
  await verifyProjectOwnership(projectId, userId!, db);
  await verifyConceptsInProject(projectId, [fromConceptId, toConceptId], db);

  const typed = db as Awaited<ReturnType<typeof getDb>>;
  const { data: existing } = await typed
    .from("concept_edges")
    .select("id, evidence_count")
    .eq("project_id", projectId)
    .eq("from_concept_id", fromConceptId)
    .eq("to_concept_id", toConceptId)
    .eq("relation", relation)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    const row = existing as { id: string; evidence_count: number };
    const next = (row.evidence_count ?? 1) + 1;
    const { data: updated, error } = await typed
      .from("concept_edges")
      .update({
        evidence_count: next,
        confidence: confidenceForEvidenceCount(next),
        last_evidence_at: now,
        updated_at: now,
      })
      .eq("id", row.id)
      .select()
      .single();
    if (error || !updated) throw new Error("Failed to update concept edge");
    return updated as ConceptEdge;
  }

  const { data: inserted, error: insErr } = await typed
    .from("concept_edges")
    .insert({
      project_id: projectId,
      from_concept_id: fromConceptId,
      to_concept_id: toConceptId,
      relation,
      confidence: confidenceForEvidenceCount(1),
      evidence_count: 1,
      last_evidence_at: now,
    })
    .select()
    .single();
  if (insErr || !inserted) {
    // Concurrent insert race — read the winner and increment once.
    const { data: race } = await typed
      .from("concept_edges")
      .select("id, evidence_count")
      .eq("project_id", projectId)
      .eq("from_concept_id", fromConceptId)
      .eq("to_concept_id", toConceptId)
      .eq("relation", relation)
      .maybeSingle();
    if (race) {
      return upsertConceptEdge({ ...params, userId: userId ?? undefined });
    }
    throw new Error("Failed to create concept edge");
  }
  return inserted as ConceptEdge;
}

/** All edges for a project with concept names for display. Ownership-checked. */
export async function listConceptEdges(projectId: string): Promise<ConceptEdge[]> {
  const { getCurrentUserId } = await import("@/lib/auth/getCurrentUser");
  const userId = await getCurrentUserId();
  const db = await getDb();
  await verifyProjectOwnership(projectId, userId, db);
  const { data, error } = await db
    .from("concept_edges")
    .select("id, project_id, from_concept_id, to_concept_id, relation, confidence, evidence_count, last_evidence_at, created_at, updated_at")
    .eq("project_id", projectId)
    .order("evidence_count", { ascending: false })
    .limit(200);
  if (error) {
    // Missing migration → empty graph, not a crash (same posture as summaries).
    if (error.message.includes("concept_edges") || error.code === "42P01") return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as ConceptEdge[];
  if (rows.length === 0) return rows;
  const ids = [...new Set(rows.flatMap((r) => [r.from_concept_id, r.to_concept_id]))];
  const { data: concepts } = await db.from("concepts").select("id, name").in("id", ids);
  const nameById = new Map(((concepts ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, from_name: nameById.get(r.from_concept_id) ?? "Unknown", to_name: nameById.get(r.to_concept_id) ?? "Unknown" }));
}

/** Prerequisites of a concept (validated-first ordering). Pure sort + filter helper. */
export function selectPrerequisitesFor(
  edges: Array<{ from_concept_id: string; to_concept_id: string; relation: string; evidence_count: number }>,
  conceptId: string
): string[] {
  return edges
    .filter((e) => e.to_concept_id === conceptId && e.relation === "PREREQUISITE")
    .sort((a, b) => b.evidence_count - a.evidence_count)
    .map((e) => e.from_concept_id);
}

/**
 * Dependency-aware helper: among a weak concept's prerequisites, return those
 * that are themselves weak (mastery < threshold). The caller should recommend
 * practicing these FIRST (Linear Regression -> Gradient Descent -> Optimization).
 * Pure — tested without DB.
 */
export function weakPrerequisitesFirst(
  weakConceptId: string,
  edges: Array<{ from_concept_id: string; to_concept_id: string; relation: string }>,
  masteryByConcept: Map<string, number>,
  threshold = 60
): string[] {
  const prereqs = edges
    .filter((e) => e.to_concept_id === weakConceptId && e.relation === "PREREQUISITE")
    .map((e) => e.from_concept_id);
  return prereqs.filter((id) => (masteryByConcept.get(id) ?? 0) < threshold);
}
