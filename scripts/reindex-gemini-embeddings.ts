#!/usr/bin/env tsx
/**
 * Re-index materials with Gemini Embedding 2 (gemini-embedding-2, 768d).
 *
 * Safe migration path — never mixes old-model vectors with Gemini 2 vectors:
 *  1. Apply db/schema/012_embeddings_gemini2_768.sql in Supabase SQL Editor
 *     (or `npm run migrate`) — purges stale chunks (gemini-embedding-001 and
 *     older), parks affected materials as FAILED.
 *  2. Run: npx tsx scripts/reindex-gemini-embeddings.ts [--dry-run] [--limit N]
 *     — resets FAILED materials parked by the embedding migration back to
 *     QUEUED and reprocesses each via processMaterial() (same Gemini 2
 *     model/config + instruction prefixes as queries: chunks stored as
 *     `title: {filename} | text: ...`). Chunk IDs are regenerated; chunk
 *     metadata (filename, page_number, chunk_index) and PDFs in Storage are
 *     preserved.
 *  3. New uploads automatically use Gemini 2 — no further action.
 *
 * Safety properties:
 *  - Matches BOTH the 001 marker ('gemini-embedding-001') and the 2 marker
 *    ('gemini-embedding-2'), so partially migrated estates converge.
 *  - Repeatable: re-running only picks up still-FAILED parked rows.
 *  - No duplicates: processMaterial() deletes a material's stale chunks
 *    before inserting fresh ones, and the claim guard makes concurrent
 *    workers a safe no-op.
 *  - Materials stuck in PROCESSING (crashed worker) are NOT auto-claimed —
 *    use Retry in the UI for those (it resets to QUEUED first).
 *
 * Requires: GEMINI_API_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { loadEnvConfig } from "@next/env";
import { getServiceDb } from "../lib/db/supabase";
import { processMaterial } from "../services/material.service";
import { getActiveEmbeddingInfo } from "../lib/ai/AIService";

// tsx scripts don't auto-load .env.local like `next dev` does — load it explicitly
// so GEMINI_API_KEY + SUPABASE keys resolve when run via `npx tsx ...`.
loadEnvConfig(process.cwd());

const EXPECTED_MODEL = "gemini-embedding-2";
// Markers parked by the 006 (Embedding 1) and 012 (Embedding 2) migrations.
// Matching both lets one script converge estates migrated at either step.
const MIGRATION_MARKERS = ["gemini-embedding-001", "gemini-embedding-2"];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Number.POSITIVE_INFINITY;

  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY — set it in .env.local (https://aistudio.google.com/apikey).");
    process.exit(1);
  }
  const info = getActiveEmbeddingInfo();
  console.log(`Embedding: ${info.provider} ${info.model} (${info.dimension}d)`);
  if (info.provider !== "gemini" || info.model !== EXPECTED_MODEL || info.dimension !== 768) {
    console.error(`Unexpected embedding config — expected gemini/${EXPECTED_MODEL}/768. Check GEMINI_* env.`);
    process.exit(1);
  }

  const db = getServiceDb();
  // Supabase .or() with ilike: match either migration marker.
  const orFilter = MIGRATION_MARKERS.map((m) => `processing_error.ilike.%${m}%`).join(",");
  const { data, error } = await db
    .from("materials")
    .select("id, filename, status, processing_error")
    .eq("status", "FAILED")
    .or(orFilter)
    .order("created_at", { ascending: true })
    .limit(Number.isFinite(limit) ? (limit as number) : 1000);
  if (error) throw new Error(`Failed to list materials: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; filename: string; status: string; processing_error: string | null }>;
  console.log(`Found ${rows.length} FAILED material(s) pending Gemini 2 re-index${dryRun ? " (dry-run)" : ""}.`);
  for (const r of rows) console.log(`  - ${r.id} ${r.filename}`);

  if (dryRun) return;
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    // Reset to QUEUED so the concurrency guard in processMaterial() can claim it.
    const { error: resetErr } = await db
      .from("materials")
      .update({ status: "QUEUED", processing_error: null, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (resetErr) {
      console.error(`  ✗ ${r.id} reset failed: ${resetErr.message}`);
      failed++;
      continue;
    }
    try {
      await processMaterial(r.id);
      console.log(`  ✓ ${r.id} re-embedded`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${r.id} re-embed failed: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }
  console.log(`\nDone: ${ok} ok, ${failed} failed. Verify: chunks.embedding dim = 768, materials.status = READY.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
