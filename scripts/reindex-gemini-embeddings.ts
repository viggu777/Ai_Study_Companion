#!/usr/bin/env tsx
/**
 * Re-index materials with Gemini embeddings (gemini-embedding-001, 768d).
 *
 * Safe migration path — never mixes old-model vectors with Gemini vectors:
 *  1. Apply db/schema/006_embeddings_gemini_768.sql in Supabase SQL Editor
 *     (purges stale chunks, parks affected materials as FAILED).
 *  2. Run: npx tsx scripts/reindex-gemini-embeddings.ts [--dry-run] [--limit N]
 *     — resets FAILED materials with a Gemini-migration message back to QUEUED
 *     and reprocesses each via processMaterial() (same Gemini model/config as
 *     queries). Chunk IDs are regenerated; chunk metadata (filename,
 *     page_number, chunk_index) and PDFs in Storage are preserved.
 *  3. New uploads automatically use Gemini — no further action.
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

const MIGRATION_MARKER = "gemini-embedding-001";

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
  if (info.provider !== "gemini" || info.dimension !== 768) {
    console.error(`Unexpected embedding config — expected gemini/${MIGRATION_MARKER}/768. Check GEMINI_* env.`);
    process.exit(1);
  }

  const db = getServiceDb();
  const { data, error } = await db
    .from("materials")
    .select("id, filename, status, processing_error")
    .eq("status", "FAILED")
    .ilike("processing_error", `%${MIGRATION_MARKER}%`)
    .order("created_at", { ascending: true })
    .limit(Number.isFinite(limit) ? (limit as number) : 1000);
  if (error) throw new Error(`Failed to list materials: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; filename: string; status: string; processing_error: string | null }>;
  console.log(`Found ${rows.length} FAILED material(s) pending Gemini re-index${dryRun ? " (dry-run)" : ""}.`);
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
