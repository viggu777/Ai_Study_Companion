/**
 * Concept-name normalization + duplicate grouping helpers.
 *
 * Why this exists: processMaterial() used to append up to 8 fresh concept
 * rows on EVERY run (retry, re-upload, embedding-model reindex) with no
 * delete and no dedupe, so reprocessed materials showed repeated topics on
 * the Concepts page. New inserts are now replace-not-append (see
 * services/material.service.ts) and scripts/dedupe-concepts.ts merges the
 * backlog. Both share these pure helpers — unit-tested in
 * tests/unit/concept-dedupe.test.ts.
 */

/** Normalize a concept name for duplicate comparison: case, diacritics, punctuation and whitespace insensitive. Pure. */
export function normalizeConceptName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9\s]/g, " ") // punctuation/symbols -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** Group key for one material's concepts: same project + same source material + same normalized name. Pure. */
export function conceptDedupeKey(projectId: string, sourceMaterialId: string | null, name: string): string {
  return `${projectId}||${sourceMaterialId ?? "NULL"}||${normalizeConceptName(name)}`;
}

export interface DupeGroup<T> {
  key: string;
  items: T[];
}

/** Group rows by dedupe key, returning only groups with >1 member (real duplicates). Pure. */
export function findDuplicateGroups<T extends { project_id: string; source_material_id: string | null; name: string }>(
  rows: T[]
): DupeGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    if (!normalizeConceptName(r.name)) continue; // blank names can't be compared — leave alone
    const key = conceptDedupeKey(r.project_id, r.source_material_id, r.name);
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  const out: DupeGroup<T>[] = [];
  for (const [key, items] of byKey) {
    if (items.length > 1) out.push({ key, items });
  }
  // Deterministic order for reports/tests: biggest groups first, then key.
  out.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
  return out;
}

export interface CanonicalCandidate {
  id: string;
  created_at: string;
}

/**
 * Pick the surviving concept of a duplicate group: most quiz questions wins
 * (preserves the most evidence history), tie-break oldest first for
 * stability. Pure.
 */
export function pickCanonicalConcept<T extends CanonicalCandidate>(
  items: T[],
  questionCountById: Map<string, number> | Record<string, number>
): T {
  const countOf = (id: string): number =>
    questionCountById instanceof Map ? (questionCountById.get(id) ?? 0) : (questionCountById[id] ?? 0);
  return (
    [...items].sort(
      (a, b) => countOf(b.id) - countOf(a.id) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    )[0] ?? items[0]
  );
}

/**
 * Filter a fresh extraction batch: drop blank names, within-batch dupes, and
 * names matching already-kept concepts. Returns the rows to insert. Pure.
 */
export function filterFreshConcepts<T extends { name: string }>(fresh: T[], keptNames: Iterable<string>): T[] {
  const kept = new Set<string>();
  for (const n of keptNames) {
    const k = normalizeConceptName(n);
    if (k) kept.add(k);
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of fresh) {
    const key = normalizeConceptName(c.name);
    if (!key || seen.has(key) || kept.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
