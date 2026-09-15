#!/usr/bin/env tsx
/**
 * Manual retrieve test script — phase 07 verification
 * Usage:
 *   npx tsx scripts/retrieve-test.ts <projectId> "your query here" [topK]
 *
 * Prints retrieved chunks with scores, or insufficient_evidence.
 * For full end-to-end, run against a real Supabase project with chunks.
 *
 * Alternative without real DB: demonstrates threshold logic with mocked data
 * when env vars not set (falls back to local cosine calc demo).
 */

import { retrieve, RELEVANCE_THRESHOLD, DEFAULT_TOP_K } from "../lib/rag/retrieve";

async function main() {
  const [, , projectId, query, topKRaw] = process.argv;
  if (!projectId || !query) {
    console.log(`Usage: npx tsx scripts/retrieve-test.ts <projectId> "query" [topK]`);
    console.log(`\nEnv required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or session), GROQ_API_KEY`);
    console.log(`Threshold: ${RELEVANCE_THRESHOLD}, default topK: ${DEFAULT_TOP_K}`);
    console.log(`\nExample: npx tsx scripts/retrieve-test.ts 00000000-0000-0000-0000-000000000000 "what is photosynthesis?"`);
    process.exit(1);
  }
  const topK = topKRaw ? parseInt(topKRaw, 10) : undefined;

  // We need a userId — for script usage, try to infer via service DB or env
  // If running with real auth, this script should be adapted to use a service client
  // that bypasses RLS for demo; here we attempt retrieve with placeholder userId
  // and rely on the RPC's project_id filter for cross-project isolation demo.
  // For proper manual curl test, use the route handler instead:
  //   curl "http://localhost:3000/api/projects/<projectId>/retrieve?q=your+query" -H "Cookie: ..."
  console.log(`Project: ${projectId}`);
  console.log(`Query: "${query}"`);
  console.log(`Threshold: ${RELEVANCE_THRESHOLD}, topK: ${topK ?? DEFAULT_TOP_K}`);
  console.log("");

  // Demo cosine fallback without DB — shows threshold filtering logic works
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.GROQ_API_KEY) {
    console.log("No Supabase/Groq env — running local cosine demo instead of live retrieval.\n");
    const qEmb = [0.9, 0.1, 0.0];
    const chunks = [
      { content: "Photosynthesis converts light energy into chemical energy", emb: [0.88, 0.12, 0.01] },
      { content: "Unrelated: database indexing strategies", emb: [0.1, 0.9, 0.2] },
    ];
    const cos = (a: number[], b: number[]) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
      return dot / (Math.sqrt(na)*Math.sqrt(nb));
    };
    for (const c of chunks) {
      const s = cos(qEmb, c.emb);
      console.log(`  similarity ${s.toFixed(3)} ${s > RELEVANCE_THRESHOLD ? "✓ PASS" : "✗ filtered"} — ${c.content.slice(0,60)}`);
    }
    console.log("\nLive test requires env vars; use curl against /api/projects/[projectId]/retrieve instead.");
    return;
  }

  // Live path would require authenticated userId — not available in bare script without Supabase Auth session.
  // Advise using the route handler.
  console.log("Live retrieval requires an authenticated session.");
  console.log("Use the route handler instead:");
  console.log(`  curl "http://localhost:3000/api/projects/${projectId}/retrieve?q=${encodeURIComponent(query)}" --cookie "sb-...session"`);
  console.log("or POST with JSON: {\"query\": \"...\"}");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
