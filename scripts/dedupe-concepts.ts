#!/usr/bin/env tsx
/**
 * Merge duplicate concepts left behind by reprocessing.
 *
 * Background: processMaterial() used to APPEND up to 8 concept rows on every
 * run (UI Retry, re-upload, embedding-model reindex via
 * scripts/reindex-gemini-embeddings.ts) with no delete and no dedupe, so
 * reprocessed materials show repeated topics on the Concepts page. New runs
 * are now replace-not-append (services/material.service.ts); this script
 * merges the backlog.
 *
 * What it does per duplicate group (same project + same source material +
 * same normalized name — see lib/concepts/normalize.ts):
 *  - picks a canonical concept (most quiz questions, tie-break oldest),
 *  - repoints questions + mastery_history to it (evidence history kept),
 *  - merges concept_mastery per user (keeps the most recently updated row),
 *  - deletes the superseded concept rows.
 *
 * Usage:
 *   npx tsx scripts/dedupe-concepts.ts [--dry-run] [--apply] [--project <id>]
 *
 * Dry-run is the default: prints what WOULD be merged, changes nothing.
 * Pass --apply to actually merge. Requires SUPABASE_SERVICE_ROLE_KEY in
 * .env.local (service DB bypasses RLS; run for all users at once).
 * Requires: SUPABASE_SERVICE_ROLE_KEY (+ NEXT_PUBLIC_SUPABASE_URL) in .env.local
 */

import { loadEnvConfig } from "@next/env";
import { getServiceDb } from "../lib/db/supabase";
import { findDuplicateGroups, pickCanonicalConcept } from "../lib/concepts/normalize";

loadEnvConfig(process.cwd());

interface ConceptRow {
  id: string;
  project_id: string;
  source_material_id: string | null;
  name: string;
  created_at: string;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  const projIdx = args.indexOf("--project");
  const projectFilter = projIdx >= 0 ? args[projIdx + 1] : null;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("Missing Supabase env — set keys in .env.local.");
    process.exit(1);
  }

  const db = getServiceDb();

  let query = db
    .from("concepts")
    .select("id, project_id, source_material_id, name, created_at")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (projectFilter) query = query.eq("project_id", projectFilter);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list concepts: ${error.message}`);
  const rows = (data ?? []) as ConceptRow[];
  console.log(`Scanned ${rows.length} concept(s)${projectFilter ? ` in project ${projectFilter}` : ""}.`);

  const groups = findDuplicateGroups(rows);
  if (groups.length === 0) {
    console.log("No duplicate groups found — nothing to do.");
    return;
  }
  const dupeRows = groups.reduce((n, g) => n + g.items.length - 1, 0);
  console.log(
    `Found ${groups.length} duplicate group(s), ${dupeRows} superseded row(s)${dryRun ? " (dry-run, no changes)" : " — APPLYING"}:`
  );

  // Material names for readable output (best-effort).
  const materialIds = [...new Set(rows.map((r) => r.source_material_id).filter((m): m is string => !!m))];
  const materialNameById = new Map<string, string>();
  if (materialIds.length > 0) {
    const { data: mats } = await db.from("materials").select("id, filename").in("id", materialIds);
    for (const m of ((mats ?? []) as Array<{ id: string; filename: string }>)) materialNameById.set(m.id, m.filename);
  }

  let mergedGroups = 0;
  let deletedRows = 0;
  let repointedQuestions = 0;

  // Extra evidence referencing concepts (all ON DELETE CASCADE — must be
  // repointed before deleting dupes, else the rows vanish with them).
  async function countRefs(ids: string[]) {
    const [pq, ed, mi] = await Promise.all([
      db.from("practice_questions").select("id", { count: "exact", head: true }).in("concept_id", ids),
      db
        .from("concept_edges")
        .select("id", { count: "exact", head: true })
        .or(`from_concept_id.in.(${ids.join(",")}),to_concept_id.in.(${ids.join(",")})`),
      db.from("misconceptions").select("id", { count: "exact", head: true }).in("concept_id", ids),
    ]);
    return {
      practice: pq.count ?? 0,
      edges: ed.count ?? 0,
      misconceptions: mi.count ?? 0,
    };
  }

  for (const g of groups) {
    const ids = g.items.map((c) => c.id);
    const { data: qs } = await db.from("questions").select("concept_id").in("concept_id", ids);
    const countById = new Map<string, number>();
    for (const q of ((qs ?? []) as Array<{ concept_id: string }>)) {
      countById.set(q.concept_id, (countById.get(q.concept_id) ?? 0) + 1);
    }
    const canonical = pickCanonicalConcept(g.items, countById);
    const dupes = g.items.filter((c) => c.id !== canonical.id);
    const matName =
      g.items[0].source_material_id != null
        ? (materialNameById.get(g.items[0].source_material_id) ?? g.items[0].source_material_id)
        : "Other / no source";
    const qTotal = ids.reduce((n, id) => n + (countById.get(id) ?? 0), 0);
    const extra = await countRefs(ids);
    const extraStr =
      extra.practice + extra.edges + extra.misconceptions > 0
        ? ` +${extra.practice}pq +${extra.edges}e +${extra.misconceptions}m`
        : "";
    console.log(
      `  - [${matName}] "${canonical.name}" ×${g.items.length} → keep ${canonical.id.slice(0, 8)} ` +
        `(${(countById.get(canonical.id) ?? 0)}q of ${qTotal}q${extraStr}), merge ${dupes.map((d) => d.id.slice(0, 8)).join(", ")}`
    );

    if (dryRun) continue;

    const dupeIds = dupes.map((d) => d.id);
    const dupeSet = new Set(dupeIds);
    // 1) Repoint evidence history to the canonical concept FIRST — deletes
    // cascade (questions/answers, mastery, practice, edges, misconceptions),
    // so repointing must precede them.
    if (qTotal > 0) {
      const { error: qErr } = await db.from("questions").update({ concept_id: canonical.id }).in("concept_id", dupeIds);
      if (qErr) {
        console.error(`    ✗ question repoint failed for group: ${qErr.message}`);
        continue;
      }
    }
    const { error: histErr } = await db.from("mastery_history").update({ concept_id: canonical.id }).in("concept_id", dupeIds);
    if (histErr) console.error(`    (non-fatal) history repoint: ${histErr.message}`);

    // 1b) Practice questions (direct FK) + related_concept_ids JSONB arrays.
    if (extra.practice > 0) {
      const { error: pqErr } = await db
        .from("practice_questions")
        .update({ concept_id: canonical.id })
        .in("concept_id", dupeIds);
      if (pqErr) console.error(`    (non-fatal) practice repoint: ${pqErr.message}`);
    }
    for (const dupeId of dupeIds) {
      const { data: relRows } = await db
        .from("practice_questions")
        .select("id, related_concept_ids")
        .contains("related_concept_ids", [dupeId])
        .limit(200);
      for (const r of ((relRows ?? []) as Array<{ id: string; related_concept_ids: unknown }>)) {
        if (!Array.isArray(r.related_concept_ids) || !r.related_concept_ids.includes(dupeId)) continue;
        const next = [...new Set((r.related_concept_ids as string[]).map((c) => (c === dupeId ? canonical.id : c)))];
        const { error: relErr } = await db.from("practice_questions").update({ related_concept_ids: next }).eq("id", r.id);
        if (relErr) console.error(`    (non-fatal) related_concept_ids rewrite: ${relErr.message}`);
      }
    }

    // 1c) Knowledge-graph edges: remap ends, drop self-loops, merge unique
    // conflicts (project, from, to, relation) by folding evidence counts.
    if (extra.edges > 0) {
      const { data: edgeRows } = await db
        .from("concept_edges")
        .select("id, project_id, from_concept_id, to_concept_id, relation, evidence_count")
        .or(`from_concept_id.in.(${ids.join(",")}),to_concept_id.in.(${ids.join(",")})`)
        .limit(500);
      for (const e of ((edgeRows ?? []) as Array<{
        id: string;
        project_id: string;
        from_concept_id: string;
        to_concept_id: string;
        relation: string;
        evidence_count: number;
      }>)) {
        const from = dupeSet.has(e.from_concept_id) ? canonical.id : e.from_concept_id;
        const to = dupeSet.has(e.to_concept_id) ? canonical.id : e.to_concept_id;
        if (from === to) {
          await db.from("concept_edges").delete().eq("id", e.id); // self-loop after merge
          continue;
        }
        if (from === e.from_concept_id && to === e.to_concept_id) continue; // untouched row
        const { data: clash } = await db
          .from("concept_edges")
          .select("id, evidence_count")
          .eq("project_id", e.project_id)
          .eq("from_concept_id", from)
          .eq("to_concept_id", to)
          .eq("relation", e.relation)
          .limit(1)
          .maybeSingle();
        const clashRow = clash as { id: string; evidence_count: number } | null;
        if (clashRow && clashRow.id !== e.id) {
          await db
            .from("concept_edges")
            .update({
              evidence_count: (clashRow.evidence_count ?? 1) + (e.evidence_count ?? 1),
              last_evidence_at: new Date().toISOString(),
            })
            .eq("id", clashRow.id);
          await db.from("concept_edges").delete().eq("id", e.id);
        } else {
          const { error: eErr } = await db.from("concept_edges").update({ from_concept_id: from, to_concept_id: to }).eq("id", e.id);
          if (eErr) console.error(`    (non-fatal) edge repoint: ${eErr.message}`);
        }
      }
    }

    // 1d) Misconceptions: repoint, folding UNIQUE(project,user,concept,
    // normalized) clashes by summing occurrences.
    if (extra.misconceptions > 0) {
      const { data: misRows } = await db
        .from("misconceptions")
        .select("id, project_id, user_id, normalized, occurrence_count, last_seen_at")
        .in("concept_id", dupeIds)
        .limit(500);
      for (const m of ((misRows ?? []) as Array<{
        id: string;
        project_id: string;
        user_id: string;
        normalized: string;
        occurrence_count: number;
        last_seen_at: string;
      }>)) {
        const { data: clash } = await db
          .from("misconceptions")
          .select("id, occurrence_count, last_seen_at")
          .eq("project_id", m.project_id)
          .eq("user_id", m.user_id)
          .eq("concept_id", canonical.id)
          .eq("normalized", m.normalized)
          .limit(1)
          .maybeSingle();
        const clashRow = clash as { id: string; occurrence_count: number; last_seen_at: string } | null;
        if (clashRow) {
          await db
            .from("misconceptions")
            .update({
              occurrence_count: (clashRow.occurrence_count ?? 1) + (m.occurrence_count ?? 1),
              last_seen_at:
                new Date(clashRow.last_seen_at) > new Date(m.last_seen_at) ? clashRow.last_seen_at : m.last_seen_at,
            })
            .eq("id", clashRow.id);
          await db.from("misconceptions").delete().eq("id", m.id);
        } else {
          const { error: mErr } = await db.from("misconceptions").update({ concept_id: canonical.id }).eq("id", m.id);
          if (mErr) console.error(`    (non-fatal) misconception repoint: ${mErr.message}`);
        }
      }
    }

    // 2) Merge concept_mastery per user: keep the most recently updated row
    // (tie: higher score), drop the rest so the UNIQUE(project,concept,user)
    // target never collides on repoint.
    const { data: mastery } = await db
      .from("concept_mastery")
      .select("id, concept_id, user_id, mastery_score, updated_at")
      .in("concept_id", ids);
    const mRows = (mastery ?? []) as Array<{
      id: string;
      concept_id: string;
      user_id: string;
      mastery_score: number | string;
      updated_at: string;
    }>;
    // If the canonical concept has no mastery row but a dupe does, move one
    // row per user onto the canonical id instead of deleting it.
    const canonUserIds = new Set(mRows.filter((m) => m.concept_id === canonical.id).map((m) => m.user_id));
    for (const m of mRows.filter((m) => m.concept_id !== canonical.id)) {
      if (!canonUserIds.has(m.user_id)) {
        await db.from("concept_mastery").update({ concept_id: canonical.id }).eq("id", m.id);
        canonUserIds.add(m.user_id);
      } else {
        await db.from("concept_mastery").delete().eq("id", m.id);
      }
    }

    // 3) Delete superseded concepts (no questions reference them anymore).
    const { error: delErr } = await db.from("concepts").delete().in("id", dupeIds);
    if (delErr) {
      console.error(`    ✗ delete failed for group: ${delErr.message}`);
      continue;
    }
    mergedGroups++;
    deletedRows += dupeIds.length;
    repointedQuestions += qTotal;
  }

  console.log(
    dryRun
      ? `\nDry-run complete — re-run with --apply to merge ${dupeRows} row(s).`
      : `\nDone: merged ${mergedGroups}/${groups.length} group(s), deleted ${deletedRows} row(s), evidence questions preserved under canonical concepts.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
