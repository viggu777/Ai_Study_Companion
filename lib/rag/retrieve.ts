/**
 * Retrieval — phase 07
 * Project-scoped pgvector search with explicit insufficient-evidence handling.
 *
 * Flow: validate ownership → embed query → cosine-similarity search
 * filtered by project_id → threshold filter → top-K.
 */

import { getDb } from "@/lib/db/supabase";
import { aiService, EMBEDDING_MODEL_NAME, estimateCost } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";

/**
 * Cosine similarity threshold for relevance.
 * Chunks below this similarity are considered not relevant.
 * Named constant per spec — not an inline magic number.
 * Kept at 0.25 after the Gemini migration (gemini-embedding-001, 768d):
 * conservative enough to avoid false negatives while still filtering
 * truly irrelevant queries. Same threshold as the previous bge-small setup.
 */
export const RELEVANCE_THRESHOLD = 0.25;

/** Default number of chunks to return when caller doesn't specify K */
export const DEFAULT_TOP_K = 5;

/**
 * R35 — in-memory query-embedding cache (prototype-safe).
 * Keyed by normalized query hash + embedding model/dimension so a model
 * change never reuses stale vectors. TTL ~10 min, bounded size.
 * Per-instance only (same caveat as the in-memory rate limiter).
  * Streaming stays deferred (regression risk — see local-only extra-docs/).
 */
import { createHash } from "node:crypto";
import { getActiveEmbeddingInfo } from "@/lib/ai/AIService";

const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE_MAX = 200;
const embeddingCache = new Map<string, { embedding: number[]; expires: number }>();

export function buildEmbeddingCacheKey(query: string): string {
  const info = getActiveEmbeddingInfo();
  const norm = query.trim().toLowerCase().replace(/\s+/g, " ");
  const h = createHash("sha256").update(norm).digest("hex");
  return `${info.model}:${info.dimension}:${h}`;
}

export function getCachedQueryEmbedding(query: string): number[] | null {
  const key = buildEmbeddingCacheKey(query);
  const hit = embeddingCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    embeddingCache.delete(key);
    return null;
  }
  return hit.embedding;
}

export function setCachedQueryEmbedding(query: string, embedding: number[]): void {
  const key = buildEmbeddingCacheKey(query);
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest) embeddingCache.delete(oldest);
  }
  embeddingCache.set(key, { embedding, expires: Date.now() + EMBEDDING_CACHE_TTL_MS });
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

export interface RetrievedChunk {
  id: string;
  material_id: string;
  project_id: string;
  content: string;
  page_number: number;
  chunk_index: number;
  similarity: number;
  metadata?: Record<string, unknown> | null;
}

export type RetrieveResult =
  | { status: "success"; chunks: RetrievedChunk[] }
  | { status: "insufficient_evidence"; chunks: RetrievedChunk[]; reason: string };

export interface RetrieveOptions {
  projectId: string;
  userId: string;
  query: string;
  topK?: number;
  threshold?: number;
}

/**
 * Extract short letter-digit codes (e.g. "5a" from "Session5a_qa.pdf" or
 * "questions5a") used to match a user question to an uploaded filename.
 * Only digits + the single following letter count, so "5a" in the query
 * matches "5a" in the filename even inside longer tokens ("5aqa").
 * Matched on equality only — "5a" never matches "5b".
 */
export function extractFileCodes(text: string): string[] {
  const codes = text.toLowerCase().match(/\d+[a-z]/g) ?? [];
  return [...new Set(codes)];
}

/** File stems the question appears to name, e.g. "questions5a" ~ "Session5a_qa.pdf". */
export function matchMaterialByName(
  query: string,
  materials: Array<{ id: string; filename: string }>
): string | null {
  const qCodes = extractFileCodes(query);
  if (qCodes.length === 0) return null;
  const qNorm = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const m of materials) {
    const stem = m.filename.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]/g, "");
    if (!stem) continue;
    // Direct stem containment either way ("session5a" in query or vice versa)
    if (qNorm.includes(stem) || stem.includes(qNorm)) return m.id;
    // Shared letter-digit code ("5a" in both "questions5a" and "session5aqa")
    const mCodes = extractFileCodes(stem);
    if (qCodes.some((c) => mCodes.includes(c))) return m.id;
  }
  return null;
}

/**
 * Balance ranked chunks across materials so every material with relevant
 * chunks is represented in the final top-K (round-robin). Without this, a
 * 12-chunk PDF permanently outranks a 4-chunk PDF on generic queries and the
 * small file is never cited. Single-material projects are unaffected.
 * A user-named material (filename match) goes first — still threshold-filtered.
 */
export function balanceChunks(
  ranked: RetrievedChunk[],
  topK: number,
  boostedMaterialId: string | null
): RetrievedChunk[] {
  if (ranked.length <= topK && !boostedMaterialId) return ranked;
  const byMaterial = new Map<string, RetrievedChunk[]>();
  for (const c of ranked) {
    const list = byMaterial.get(c.material_id) ?? [];
    list.push(c);
    byMaterial.set(c.material_id, list);
  }
  const orderedKeys = [...byMaterial.keys()].sort((a, b) => {
    if (a === boostedMaterialId) return -1;
    if (b === boostedMaterialId) return 1;
    // Otherwise keep global similarity order: compare each group's best chunk
    return (byMaterial.get(b)?.[0]?.similarity ?? 0) - (byMaterial.get(a)?.[0]?.similarity ?? 0);
  });
  const out: RetrievedChunk[] = [];
  let round = 0;
  for (;;) {
    let added = false;
    for (const key of orderedKeys) {
      const list = byMaterial.get(key);
      if (list && round < list.length && out.length < topK) {
        out.push(list[round]);
        added = true;
      }
    }
    if (!added || out.length >= topK) break;
    round++;
  }
  return out;
}

/**
 * Project-scoped retrieval.
 * - Validates project ownership (WHERE id = projectId AND user_id = userId)
 * - Embeds query via AIService (Gemini gemini-embedding-001, 768 dims — same
 *   model/config as document chunks)
 * - Runs pgvector cosine similarity search filtered by project_id
 * - Balances chunks across materials (round-robin) + boosts a user-named file
 * - Returns top-K above threshold, or insufficient_evidence if none qualify
 */
export async function retrieve(params: RetrieveOptions): Promise<RetrieveResult> {
  const { projectId, userId, query, topK = DEFAULT_TOP_K, threshold = RELEVANCE_THRESHOLD } = params;

  if (!query || !query.trim()) {
    return {
      status: "insufficient_evidence",
      chunks: [],
      reason: "Empty query — no search performed",
    };
  }

  const db = await getDb();

  // 1. Validate project ownership
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (projErr || !project) {
    throw new Error("Project not found");
  }

  // 2. Embed query via AIService — log as EMBEDDING feature (phase 15: exactly one ai_operations row per call, including failure)
  // R28: thread usage + cost; R35: in-memory embedding cache for identical queries.
  let queryEmbedding: number[];
  {
    const requestId = crypto.randomUUID();
    const t0 = Date.now();
    let logged = false;
    try {
      const cached = getCachedQueryEmbedding(query.trim());
      const { vectors: embeddings, usage } = cached
        ? { vectors: [cached], usage: { inputTokens: 0, outputTokens: 0 } }
        : await aiService.generateEmbeddingWithUsage({ input: query.trim() });
      const latencyMs = Date.now() - t0;
      queryEmbedding = embeddings[0];
      if (!cached) setCachedQueryEmbedding(query.trim(), queryEmbedding);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        await logAiOperation({
          userId,
          projectId,
          feature: "EMBEDDING",
          model: EMBEDDING_MODEL_NAME,
          requestId,
          latencyMs,
          success: false,
          error: "Failed to generate query embedding: empty result",
        });
        logged = true;
        throw new Error("Failed to generate query embedding");
      }
      await logAiOperation({
        userId,
        projectId,
        feature: "EMBEDDING",
        model: EMBEDDING_MODEL_NAME,
        requestId,
        latencyMs,
        success: true,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        estimatedCost: cached ? 0 : estimateCost(EMBEDDING_MODEL_NAME, usage),
      });
      logged = true;
    } catch (e) {
      if (!logged) {
        const latencyMs = Date.now() - t0;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[EMBEDDING ${requestId}] retrieve embedding failed:`, errMsg);
        try {
          await logAiOperation({
            userId,
            projectId,
            feature: "EMBEDDING",
            model: EMBEDDING_MODEL_NAME,
            requestId,
            latencyMs,
            success: false,
            error: errMsg.slice(0, 2000),
          });
        } catch {}
      }
      throw e;
    }
  }

  // 3. READY materials: used to size over-fetching and to detect a
  // user-named file ("what is in questions5a pdf" ~ Session5a_qa.pdf).
  // Ownership already validated above; scoped by project_id + user_id.
  const { data: readyMats } = await db
    .from("materials")
    .select("id, filename")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("status", "READY");
  const readyList = (readyMats ?? []) as Array<{ id: string; filename: string }>;
  const boostedMaterialId = matchMaterialByName(query.trim(), readyList);
  // Over-fetch so every material has candidates to balance across.
  const overFetch = Math.min(Math.max(topK * Math.max(readyList.length, 1), topK), 100);

  // 4. pgvector cosine-similarity search via RPC
  // RPC: match_chunks(query_embedding vector(768), match_project_id uuid, match_threshold float, match_count int)
  // Returns rows with similarity = 1 - (embedding <=> query_embedding)
  const { data, error } = await db.rpc("match_chunks", {
    query_embedding: queryEmbedding as unknown as string,
    match_project_id: projectId,
    match_threshold: threshold,
    match_count: overFetch,
  });

  if (error) {
    // Fallback: if RPC not yet migrated, try direct query using raw SQL via supabase's postgrest?
    // For robustness, attempt client-side fallback by fetching chunks and computing similarity in JS
    // (only for small datasets; not for production scale but ensures dev works before migration)
    console.error("match_chunks RPC failed, attempting fallback:", error.message);
    return await fallbackRetrieve(db, projectId, queryEmbedding, topK, threshold, boostedMaterialId);
  }

  const ranked = (data ?? []) as RetrievedChunk[];

  if (ranked.length === 0) {
    return {
      status: "insufficient_evidence",
      chunks: [],
      reason: "No chunks above relevance threshold for this project/query",
    };
  }

  const chunks = balanceChunks(ranked, topK, boostedMaterialId);

  return { status: "success", chunks };
}

/**
 * Fallback retrieval when match_chunks RPC is not yet deployed.
 * Fetches chunks for project and computes cosine similarity in JS.
 * Correct but not scalable — intended only as dev fallback.
 */
async function fallbackRetrieve(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  projectId: string,
  queryEmbedding: number[],
  topK: number,
  threshold: number,
  boostedMaterialId: string | null = null
): Promise<RetrieveResult> {
  const { data: rows, error } = await db
    .from("chunks")
    .select("id, material_id, project_id, content, page_number, chunk_index, embedding, metadata")
    .eq("project_id", projectId)
    .limit(100);

  if (error) {
    throw new Error(`Fallback retrieval failed: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    return {
      status: "insufficient_evidence",
      chunks: [],
      reason: "No chunks found for this project",
    };
  }

  const ranked: RetrievedChunk[] = rows
    .map((row: { id: string; material_id: string; project_id: string; content: string; page_number: number; chunk_index: number; embedding: number[] | string; metadata: Record<string, unknown> | null }) => {
      // embedding may come back as string "[0.1,0.2]" from pgvector
      let emb: number[];
      if (typeof row.embedding === "string") {
        try {
          emb = JSON.parse(row.embedding);
        } catch {
          return null;
        }
      } else if (Array.isArray(row.embedding)) {
        emb = row.embedding as number[];
      } else {
        return null;
      }
      const similarity = cosineSimilarity(queryEmbedding, emb);
      return {
        id: row.id,
        material_id: row.material_id,
        project_id: row.project_id,
        content: row.content,
        page_number: row.page_number,
        chunk_index: row.chunk_index,
        similarity,
        metadata: row.metadata,
      } as RetrievedChunk;
    })
    .filter((x: RetrievedChunk | null): x is RetrievedChunk => x !== null)
    .filter((c: RetrievedChunk) => c.similarity > threshold)
    .sort((a: RetrievedChunk, b: RetrievedChunk) => b.similarity - a.similarity);

  if (ranked.length === 0) {
    return {
      status: "insufficient_evidence",
      chunks: [],
      reason: "No chunks above relevance threshold for this project/query",
    };
  }

  const scored = balanceChunks(ranked, topK, boostedMaterialId);

  return { status: "success", chunks: scored };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] ?? 0);
    normA += a[i] * a[i];
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
