#!/usr/bin/env node
/**
 * Database migration runner — `npm run migrate`.
 *
 * Applies db/schema/*.sql in filename order with tracking, so deploys and
 * fresh clones never need copy-paste in the Supabase SQL Editor:
 *
 *   npm run migrate          apply pending migrations (idempotent, safe to re-run)
 *   npm run migrate -- --check   list pending migrations without applying
 *
 * How it works:
 *  - Connects via DATABASE_URL (direct Postgres, .env.local). The Supabase
 *    JS client cannot run DDL, so this uses the `pg` driver instead.
 *  - Tracks applied files in schema_migrations(version PRIMARY KEY).
 *  - Each file runs inside one transaction (BEGIN/COMMIT). Multi-statement
 *    files (incl. $$ function bodies) are sent as a single simple-protocol
 *    query — no naive `;` splitting.
 *  - First run against a manually-built DB baselines instead of re-running:
 *    if schema_migrations is empty but tables already exist, versions up to
 *    the detected state are MARKED applied (never re-executed — re-running
 *    006 would wipe chunks). Only genuinely pending files run.
 *
 * Exit codes: 0 ok (nothing or all applied), 1 error, 2 --check with pending.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "db", "schema");

/** "007_practice.sql" from "007_practice.sql" or a full path. Pure. */
export function migrationVersion(filename) {
  return path.basename(filename);
}

/** Sort migration files deterministically by filename (001_... -> 007_...). Pure. */
export function sortMigrationFiles(files) {
  return [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/** Minimal .env parser (KEY=VALUE, # comments, quoted values). Pure. */
export function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/** Load .env then .env.local (Next.js precedence), never overriding real env. */
function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = parseDotEnv(fs.readFileSync(p, "utf8"));
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch (e) {
      console.warn(`Warning: could not parse ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function buildClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — copy .env.example to .env.local and fill in the direct Postgres connection string, then re-run."
    );
  }
  const needsSSL = /sslmode=require|supabase\.co|supabase\.com/i.test(connectionString);
  return new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
    ...(needsSSL ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS ok",
    [table]
  );
  return rows[0]?.ok === true;
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS ok",
    [table, column]
  );
  return rows[0]?.ok === true;
}

async function chunksVectorDim(client) {
  try {
    const { rows } = await client.query(
      `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
       WHERE attrelid='public.chunks'::regclass AND attname='embedding'`
    );
    const t = rows[0]?.t ?? "";
    const m = /\((\d+)\)/.exec(t);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Evidence that the Gemini 2 migration (012) already ran on a manually-built
 * DB: EMBEDDING logs written with the gemini-embedding-2 model, or materials
 * parked with the 012 FAILED marker. Without evidence, 012 stays pending so
 * stale gemini-embedding-001 vectors are purged (correct — the two models use
 * incompatible embedding spaces even though both are 768d).
 */
async function hasGemini2Evidence(client) {
  try {
    const { rows } = await client.query(
      `SELECT EXISTS(SELECT 1 FROM ai_operations WHERE feature='EMBEDDING' AND model LIKE '%gemini-embedding-2%') AS ok`
    );
    if (rows[0]?.ok === true) return true;
  } catch {
    // ai_operations missing — treat as no evidence
  }
  try {
    const { rows } = await client.query(
      `SELECT EXISTS(SELECT 1 FROM materials WHERE processing_error ILIKE '%gemini-embedding-2%') AS ok`
    );
    if (rows[0]?.ok === true) return true;
  } catch {
    // materials missing — caller already verified spaces exists, so ignore
  }
  return false;
}

/**
 * Detect the state of a manually-built DB (no schema_migrations yet) and
 * return the versions to baseline-mark as already applied. Returns null when
 * the DB is fresh (apply everything) or too old to baseline safely.
 *
 * Built explicitly per feature (never "all except X") so newly added
 * migrations default to pending instead of being silently skipped.
 */
export async function detectBaseline(client, files) {
  const versions = files.map(migrationVersion);
  const has = (v) => versions.includes(v);
  if (!(await tableExists(client, "spaces"))) return null; // fresh DB
  const applied = [];
  const push = (v) => {
    if (has(v) && !applied.includes(v)) applied.push(v);
  };
  // 001–006 core: Gemini-1-shaped DB (768d vectors + conversation summary).
  const dim = await chunksVectorDim(client);
  const hasSummary = await columnExists(client, "conversations", "summary");
  if (!(hasSummary && dim === 768)) {
    return "TOO_OLD";
  }
  for (const v of [
    "001_initial_schema.sql",
    "002_retrieve.sql",
    "003_storage.sql",
    "004_embeddings_384.sql",
    "005_conversation_summary.sql",
    "006_embeddings_gemini_768.sql",
  ]) {
    push(v);
  }
  // 007–009 practice chain (each gated on the column the next migration adds).
  if (await tableExists(client, "practice_assignments")) {
    push("007_practice.sql");
    if (!(await columnExists(client, "practice_questions", "question_type"))) {
      return applied; // at 007: 008+ pending
    }
    push("008_practice_mcq.sql");
    if (!(await columnExists(client, "practice_questions", "acceptable_answers"))) {
      return applied; // at 008: 009+ pending
    }
    push("009_practice_sections.sql");
  }
  // 010–011 material columns (independent of the practice chain).
  if (await columnExists(client, "materials", "file_hash")) push("010_material_dedup.sql");
  if (await columnExists(client, "materials", "file_size")) push("011_material_file_size.sql");
  // 012 Gemini 2: same VECTOR(768) size, new embedding space — only baseline
  // when there is positive evidence it already ran (see hasGemini2Evidence).
  if (has("012_embeddings_gemini2_768.sql") && (await hasGemini2Evidence(client))) {
    push("012_embeddings_gemini2_768.sql");
  }
  // 013 conversation pinning (independent additive column).
  if (await columnExists(client, "conversations", "is_pinned")) push("013_conversation_pinning.sql");
  return applied;
}

async function applyFile(client, file) {
  const sql = fs.readFileSync(file, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [
      migrationVersion(file),
    ]);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already aborted — report the original error
    }
    throw e;
  }
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  loadEnv();

  const files = sortMigrationFiles(
    fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".sql")).map((f) => path.join(SCHEMA_DIR, f))
  );
  if (files.length === 0) throw new Error(`No .sql files found in ${SCHEMA_DIR}`);

  const client = buildClient();
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));

    if (applied.size === 0) {
      const baseline = await detectBaseline(client, files);
      if (baseline === "TOO_OLD") {
        throw new Error(
          "This database predates the 006 embeddings migration and has no migration history. " +
            "Apply db/schema/001..006 in order via the Supabase SQL Editor first, then re-run `npm run migrate`."
        );
      }
      if (baseline && baseline.length > 0) {
        console.log(`Baselining manually-built DB — marking applied: ${baseline.join(", ")}`);
        for (const v of baseline) {
          await client.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [v]);
        }
        for (const v of baseline) applied.add(v);
      }
    }

    const pending = files.filter((f) => !applied.has(migrationVersion(f)));
    if (pending.length === 0) {
      console.log(`Up to date — ${files.length} migration(s) applied, none pending.`);
      return 0;
    }
    console.log(`Pending migrations: ${pending.map(migrationVersion).join(", ")}`);
    if (checkOnly) return 2;

    for (const file of pending) {
      const v = migrationVersion(file);
      process.stdout.write(`Applying ${v}... `);
      await applyFile(client, file);
      console.log("ok");
    }
    console.log(`Done — ${pending.length} migration(s) applied.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
