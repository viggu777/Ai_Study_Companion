/**
 * Retrieval — phase 07
 * Project-scoped pgvector search with explicit insufficient-evidence handling.
 *
 * Flow: validate ownership → embed query → cosine-similarity search
 * filtered by project_id → threshold filter → top-K.
 */

import { getDb } from "@/lib/db/supabase";
import { aiService, EMBEDDING_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";

/**
 * Cosine similarity threshold for relevance.
 * Chunks below this similarity are considered not relevant.
 * Named constant per spec — not an inline magic number.
 * nomic-embed-text-v1.5 typically yields 0.5-0.9 for related content,
 * 0.2-0.5 for unrelated; 0.25 is conservative to avoid false negatives
 * while still filtering truly irrelevant queries.
 */
export const RELEVANCE_THRESHOLD = 0.25;

/** Default number of chunks to return when caller doesn't specify K */
export const DEFAULT_TOP_K = 5;

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
 * Project-scoped retrieval.
 * - Validates project ownership (WHERE id = projectId AND user_id = userId)
 * - Embeds query via AIService (Groq nomic-embed-text-v1.5, 768 dims)
 * - Runs pgvector cosine similarity search filtered by project_id
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
  let queryEmbedding: number[];
  {
    const requestId = crypto.randomUUID();
    const t0 = Date.now();
    let logged = false;
    try {
      const embeddings = await aiService.generateEmbedding({ input: query.trim() });
      const latencyMs = Date.now() - t0;
      queryEmbedding = embeddings[0];
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

  // 3. pgvector cosine-similarity search via RPC
  // RPC: match_chunks(query_embedding vector(768), match_project_id uuid, match_threshold float, match_count int)
  // Returns rows with similarity = 1 - (embedding <=> query_embedding)
  const { data, error } = await db.rpc("match_chunks", {
    query_embedding: queryEmbedding as unknown as string,
    match_project_id: projectId,
    match_threshold: threshold,
    match_count: topK,
  });

  if (error) {
    // Fallback: if RPC not yet migrated, try direct query using raw SQL via supabase's postgrest?
    // For robustness, attempt client-side fallback by fetching chunks and computing similarity in JS
    // (only for small datasets; not for production scale but ensures dev works before migration)
    console.error("match_chunks RPC failed, attempting fallback:", error.message);
    return await fallbackRetrieve(db, projectId, queryEmbedding, topK, threshold);
  }

  const chunks = (data ?? []) as RetrievedChunk[];

  if (chunks.length === 0) {
    return {
      status: "insufficient_evidence",
      chunks: [],
      reason: "No chunks above relevance threshold for this project/query",
    };
  }

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
  threshold: number
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

  const scored: RetrievedChunk[] = rows
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
    .sort((a: RetrievedChunk, b: RetrievedChunk) => b.similarity - a.similarity)
    .slice(0, topK);

  if (scored.length === 0) {
    return {
      status: "insufficient_evidence",
      chunks: [],
      reason: "No chunks above relevance threshold for this project/query",
    };
  }

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
