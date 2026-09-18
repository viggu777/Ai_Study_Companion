import { getDb, getServiceDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { inngest } from "@/lib/jobs/client";
import { buildStoragePath, downloadPdf, uploadPdf } from "@/lib/storage/materialStorage";
import { chunkPlainText, chunkText } from "@/lib/rag/chunker";
import { aiService, CHAT_MODEL_NAME, EMBEDDING_DIM, EMBEDDING_MODEL_NAME, estimateCost } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";
import { extractImageText, isImageFile, normalizeImageMime } from "@/lib/ocr/imageOcr";
import { extractScannedPdfText, joinSegmentsForPrompt } from "@/lib/ocr/scannedPdfOcr";
import { createHash } from "node:crypto";
import {
  MAX_MATERIALS_PER_USER,
  MAX_STORAGE_BYTES_PER_USER,
} from "@/lib/validation/schemas";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (PDFs and images)

/**
 * SHA-256 hex of the raw file bytes. Used for duplicate-upload detection:
 * the same file uploaded twice to the same project reuses the existing row
 * instead of creating a duplicate row + duplicate background job.
 * Pure — unit-tested in tests/unit/material-dedup.test.ts.
 */
export function computeFileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Statuses a background worker may atomically claim for processing.
 * Uploads create QUEUED rows; retry resets to QUEUED; FAILED rows are
 * claimable so a direct-fallback worker can pick up work even if the
 * retry event is lost. READY (done) and PROCESSING (owned by a live
 * worker) are never claimable — this is the concurrency guard.
 * Pure — unit-tested in tests/unit/job-guards.test.ts.
 */
export const CLAIMABLE_MATERIAL_STATUSES = ["QUEUED", "FAILED"] as const;

export function canClaimMaterialStatus(status: string): boolean {
  return (CLAIMABLE_MATERIAL_STATUSES as readonly string[]).includes(status);
}

async function emitLearningEvent(params: {
  userId: string;
  spaceId?: string | null;
  projectId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  const { error } = await db.from("learning_events").insert({
    user_id: params.userId,
    space_id: params.spaceId ?? null,
    project_id: params.projectId ?? null,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    metadata: params.metadata ?? null,
  });
  if (error) console.error("Failed to emit learning event:", error);
}

function isPdf(mimeType: string, filename: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (filename.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

function resolveUploadKind(
  mimeType: string,
  filename: string
): { kind: "pdf" | "image"; mime: string } | null {
  if (isPdf(mimeType, filename)) return { kind: "pdf", mime: "application/pdf" };
  const imgMime = normalizeImageMime(mimeType, filename);
  if (imgMime) return { kind: "image", mime: imgMime };
  return null;
}

export async function uploadMaterial(
  projectId: string,
  file: File
): Promise<{ id: string; status: string; duplicate?: boolean }> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  // Ownership check: project must belong to user
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, space_id, user_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");

  // Validate PDF-or-image + size (synchronous, return 400-style error before DB write)
  const rawMime = file.type || "";
  const kind = resolveUploadKind(rawMime, file.name);
  if (!kind) {
    throw new Error("Only PDF or image files are allowed (pdf, png, jpg, jpeg, webp)");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large — max ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  if (file.size === 0) throw new Error("File is empty");

  // R33 per-user quota: count + storage-byte cap (over-quota → 429-style error).
  // file_size column ships in 011_material_file_size.sql — pre-migration DBs
  // fall back to count-only so upload still works.
  try {
    const { data: existing, error: quotaErr } = await db
      .from("materials")
      .select("id, file_size")
      .eq("user_id", userId);
    if (!quotaErr && existing) {
      const rows = existing as Array<{ id: string; file_size?: number | null }>;
      if (rows.length >= MAX_MATERIALS_PER_USER) {
        const e = new Error(
          `Upload quota exceeded — max ${MAX_MATERIALS_PER_USER} materials per user`
        );
        (e as Error & { status?: number }).status = 429;
        throw e;
      }
      const hasSizeCol = rows.length === 0 || rows.some((r) => "file_size" in r);
      if (hasSizeCol) {
        const used = rows.reduce(
          (sum, r) => sum + (typeof r.file_size === "number" ? r.file_size : 0),
          0
        );
        if (used + file.size > MAX_STORAGE_BYTES_PER_USER) {
          const e = new Error(
            `Storage quota exceeded — max ${Math.round(MAX_STORAGE_BYTES_PER_USER / 1024 / 1024)} MB per user`
          );
          (e as Error & { status?: number }).status = 429;
          throw e;
        }
      }
    }
  } catch (e) {
    if ((e as Error & { status?: number }).status === 429) throw e;
    // quota lookup failed (e.g. RLS/column) — proceed without quota block.
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = computeFileHash(buffer);

  // Duplicate-upload guard: same bytes already in this project → reuse the
  // existing row instead of creating a duplicate row + duplicate background
  // job. Scoped by (project_id, file_hash); cross-project re-uploads are
  // allowed (each project keeps its own knowledge). FAILED duplicates are
  // returned as-is so the user can Retry on the original row. The file_hash
  // column ships in 010_material_dedup.sql — if the DB predates it, the
  // lookup/insert falls back gracefully and upload still works.
  try {
    const { data: dup, error: dupErr } = await db
      .from("materials")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("file_hash", fileHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!dupErr && dup) {
      const existing = dup as { id: string; status: string };
      return { id: existing.id, status: existing.status, duplicate: true };
    }
  } catch {
    // file_hash column missing (010 not applied yet) — proceed without dedup.
  }

  if (kind.kind === "pdf") {
    // Quick PDF header validation (avoid storing non-PDF that spoofs mime)
    if (!buffer.slice(0, 5).toString().startsWith("%PDF")) {
      // Still allow but background job will fail → FAILED; for immediate feedback we treat as allowed
      // but we will not reject here to let FAILED path be tested via corrupted file
    }
  }

  // Create materials row with QUEUED
  let material: { id: string } | null = null;
  {
    const withHash = await db
      .from("materials")
      .insert({
        project_id: projectId,
        user_id: userId,
        filename: file.name,
        storage_path: "pending", // placeholder, updated after upload
        mime_type: kind.mime,
        status: "QUEUED",
        file_hash: fileHash,
        file_size: file.size,
      })
      .select()
      .single();
    if (!withHash.error && withHash.data) {
      material = withHash.data as { id: string };
    } else {
      const msg = withHash.error?.message ?? "";
      // Pre-010/011 DBs have no file_hash/file_size column — retry without them.
      if (msg.includes("file_hash") || msg.includes("file_size")) {
        const fallback = await db
          .from("materials")
          .insert({
            project_id: projectId,
            user_id: userId,
            filename: file.name,
            storage_path: "pending",
            mime_type: kind.mime,
            status: "QUEUED",
          })
          .select()
          .single();
        if (fallback.error || !fallback.data)
          throw new Error(fallback.error?.message ?? "Failed to create material");
        material = fallback.data as { id: string };
      } else {
        throw new Error(msg || "Failed to create material");
      }
    }
  }
  if (!material) throw new Error("Failed to create material");

  const storagePath = buildStoragePath(userId, projectId, material.id, file.name);

  try {
    await uploadPdf(storagePath, buffer, kind.mime);
  } catch (e) {
    // Mark FAILED immediately if storage upload fails
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .from("materials")
      .update({ storage_path: storagePath, status: "FAILED", processing_error: msg, updated_at: new Date().toISOString() })
      .eq("id", material.id)
      .eq("user_id", userId);
    await emitLearningEvent({
      userId,
      spaceId: project.space_id,
      projectId,
      eventType: "MATERIAL_FAILED",
      entityType: "material",
      entityId: material.id,
      metadata: { filename: file.name, error: msg },
    });
    throw new Error(msg);
  }

  await db
    .from("materials")
    .update({ storage_path: storagePath, updated_at: new Date().toISOString() })
    .eq("id", material.id)
    .eq("user_id", userId);

  await emitLearningEvent({
    userId,
    spaceId: project.space_id,
    projectId,
    eventType: "MATERIAL_UPLOADED",
    entityType: "material",
    entityId: material.id,
    metadata: { filename: file.name, storage_path: storagePath },
  });

  // Trigger background job. On Vercel serverless a setTimeout fallback never
  // runs after the response is sent (function frozen), which used to leave
  // materials stuck in QUEUED forever when Inngest delivery failed (missing /
  // mismatched INNGEST_* keys, app not synced) → 0 chunks → tutor
  // "insufficient evidence" + empty concepts. So on send failure, process
  // inline within this request (route sets maxDuration=60). The claim guard
  // in processMaterial keeps this safe if Inngest later delivers anyway.
  try {
    await inngest.send({
      name: "material/uploaded",
      data: { materialId: material.id, projectId, userId, spaceId: project.space_id },
    });
  } catch (e) {
    console.error("Inngest send failed, processing inline within request:", e);
    await processMaterial(material.id);
  }

  // Also attempt direct fallback after short delay even if Inngest succeeded, but only if Inngest dev server not present
  // For prototype we ensure processing happens even without Inngest dashboard: the Inngest function will also run via /api/inngest
  // No-op: Inngest will handle when available

  return { id: material.id, status: "QUEUED" };
}

export async function listMaterials(projectId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (projErr || !project) throw new Error("Project not found");

  const { data, error } = await db
    .from("materials")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getMaterial(materialId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data, error } = await db
    .from("materials")
    .select("*")
    .eq("id", materialId)
    .eq("user_id", userId)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data;
}

export async function retryMaterial(materialId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: mat, error } = await db
    .from("materials")
    .select("id, project_id, user_id")
    .eq("id", materialId)
    .eq("user_id", userId)
    .single();
  if (error || !mat) throw new Error("Material not found");

  const { data: project } = await db.from("projects").select("space_id").eq("id", mat.project_id).single();

  await db
    .from("materials")
    .update({ status: "QUEUED", processing_error: null, updated_at: new Date().toISOString() })
    .eq("id", materialId)
    .eq("user_id", userId);

  try {
    await inngest.send({
      name: "material/uploaded",
      data: { materialId, projectId: mat.project_id, userId, spaceId: project?.space_id ?? null },
    });
  } catch (e) {
    console.error("Retry Inngest send failed, will still process inline:", e);
  }
  // Retry always processes inline within this request (route sets
  // maxDuration=60). This heals rows stuck in QUEUED when Inngest accepted
  // the event but has no synced function running — the case where send
  // succeeds yet nothing ever processes. The claim guard in processMaterial
  // makes a late Inngest delivery a safe no-op.
  await processMaterial(materialId);
  return { id: materialId, status: "QUEUED" as const };
}

export async function deleteMaterial(materialId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();
  const { data: mat, error } = await db
    .from("materials")
    .select("id, project_id, storage_path")
    .eq("id", materialId)
    .eq("user_id", userId)
    .single();
  if (error || !mat) throw new Error("Material not found");

  // Remove the stored object best-effort (missing objects are fine —
  // e.g. rows whose upload never succeeded), then delete the row.
  // Chunks cascade-delete via FK. Concepts sourced from this material that
  // were never quizzed are deleted too — otherwise they linger as
  // source_material_id=NULL orphans and pollute quiz selection,
  // recommendations and mastery. Concepts WITH quiz references are kept
  // (evidence history) and their source is SET NULL by FK.
  const { deletePdf } = await import("@/lib/storage/materialStorage");
  if (mat.storage_path && mat.storage_path !== "pending") {
    await deletePdf(mat.storage_path);
  }
  try {
    const { data: ownConcepts } = await db.from("concepts").select("id").eq("project_id", (mat as { project_id: string }).project_id).eq("source_material_id", materialId);
    const ownIds = ((ownConcepts ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (ownIds.length > 0) {
      const { data: refQs } = await db.from("questions").select("concept_id").in("concept_id", ownIds);
      const referenced = new Set(((refQs ?? []) as Array<{ concept_id: string }>).map((q) => q.concept_id));
      const unreferenced = ownIds.filter((id) => !referenced.has(id));
      if (unreferenced.length > 0) {
        await db.from("concept_mastery").delete().in("concept_id", unreferenced);
        await db.from("mastery_history").delete().in("concept_id", unreferenced);
        await db.from("concepts").delete().in("id", unreferenced);
      }
    }
  } catch (e) {
    console.error("Concept cleanup on material delete failed (non-fatal):", e);
  }
  const { error: delErr } = await db
    .from("materials")
    .delete()
    .eq("id", materialId)
    .eq("user_id", userId);
  if (delErr) throw new Error(delErr.message);
  return { id: materialId };
}

/**
 * Background processing — steps per architecture:
 * 1. PROCESSING, 2. Extract text (preserve pages), 3. Chunk, 4. Embed, 5. Extract concepts, 6. READY, 7. FAILED on error
 * Callable from Inngest function or direct fallback / retry endpoint.
 */
export async function processMaterial(materialId: string) {
  const db = getServiceDb();

  // Fetch material (needs user_id to preserve ownership context for background job)
  const { data: material, error: matErr } = await db
    .from("materials")
    .select("id, project_id, user_id, storage_path, filename, mime_type, status")
    .eq("id", materialId)
    .single();
  if (matErr || !material) throw new Error(`Material not found: ${materialId}`);

  const userId = material.user_id as string;
  const projectId = material.project_id as string;

  // Fetch project for space_id
  const { data: project } = await db.from("projects").select("space_id").eq("id", projectId).single();
  const spaceId = project?.space_id ?? null;

  // Idempotency: if already READY, skip
  if ((material as { status?: string }).status === "READY") return;

  // Concurrency guard: atomically claim the job. Upload creates QUEUED rows
  // and retry resets to QUEUED, so only those states are claimable — if two
  // workers (Inngest + direct fallback, double retry) race, exactly one wins
  // the conditional update and the loser returns without duplicating chunks.
  const { data: claimed } = await db
    .from("materials")
    .update({ status: "PROCESSING", updated_at: new Date().toISOString() })
    .eq("id", materialId)
    .in("status", [...CLAIMABLE_MATERIAL_STATUSES])
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) return;

  // Page count of the source PDF, when known — assigned during extraction
  // so the failure path can persist it too (e.g. scanned PDFs).
  let numPages: number | null = null;

  // Use service DB directly for background events (no request cookies)
  await db.from("learning_events").insert({
    user_id: userId,
    space_id: spaceId,
    project_id: projectId,
    event_type: "MATERIAL_PROCESSING_STARTED",
    entity_type: "material",
    entity_id: materialId,
    metadata: null,
  });

  try {
    // 2. Extract text (PRD §5: normal text, tables, images, diagrams, scanned pages)
    // - Images → free offline OCR (sharp + tesseract.js), page 1.
    // - PDFs → pdf-parse fast path; empty result means scanned/image-only
    //   pages → render to PNG (pdfjs + napi canvas) + OCR per page.
    const buffer = await downloadPdf(material.storage_path);
    const storedMime = ((material as { mime_type?: string }).mime_type ?? "") as string;
    const storedName = (material.filename ?? "") as string;
    const isImage = isImageFile(storedMime, storedName);

    let text: string;
    let extractionMethod = "pdf-text";
    // Page-accurate segments for OCR paths (real page numbers → citations).
    let ocrSegments: { text: string; pageNumber: number }[] | null = null;
    if (isImage) {
      const ocr = await extractImageText(buffer);
      text = ocr.text;
      numPages = 1;
      extractionMethod = "image-ocr";
      ocrSegments = [{ text, pageNumber: 1 }];
    } else {
      const extracted = await extractPdfText(buffer);
      text = extracted.text;
      numPages = extracted.numPages;
      if (!text || text.trim().length < 20) {
        // Scanned / image-only PDF — render pages and OCR them.
        // Page-cap / render errors throw actionable messages (caught below → FAILED).
        const scanned = await extractScannedPdfText(buffer);
        numPages = scanned.numPages;
        ocrSegments = scanned.segments;
        text = ocrSegments.map((s) => s.text).join("\n\n");
        extractionMethod = "scanned-pdf-ocr";
      }
    }

    if (!text || text.trim().length < 20) {
      if (isImage) {
        throw new Error(
          "No readable text found in this image. Try a clearer photo/screenshot with printed text (handwriting and blurry photos often fail with free OCR)."
        );
      }
      throw new Error(
        numPages != null && numPages > 0
          ? `No readable text found in this PDF (${numPages} page${numPages === 1 ? "" : "s"}), even with OCR. It may be blank, handwritten, or too blurry for free OCR — try clearer scans or upload key pages as PNG/JPG images.`
          : "No extractable text found in PDF"
      );
    }

    // 3. Chunk — OCR paths use real per-page segments so chunk.page_number
    // matches the source page (citations stay traceable); text PDFs keep the
    // existing estimated-split behavior.
    const chunks = ocrSegments ? chunkText(ocrSegments) : chunkPlainText(text, numPages);
    if (chunks.length === 0) throw new Error("Chunking produced no chunks");

    // Prompt window for concept extraction (same 8000-char budget either way).
    const conceptSourceText = ocrSegments ? joinSegmentsForPrompt(ocrSegments) : text.slice(0, 8000);

    // 4. Embed each chunk via AIService (Gemini 2 — same model/config as
    // queries: chunks stored as `title: {filename} | text: ...`, queries as
    // `task: search result | query: ...`) — each call logs EMBEDDING per phase 15
    const contents = chunks.map((c) => c.content);
    // Gemini embedContent supports batching; send in batches of 20 to avoid payload/rate limits.
    // (gemini-embedding-2 needs one Content object per input inside the batch —
    // handled in AIService — otherwise the batch collapses to one vector.)
    const batchSize = 20;
    const embeddings: number[][] = [];
    for (let i = 0; i < contents.length; i += batchSize) {
      const batch = contents.slice(i, i + batchSize);
      const requestId = crypto.randomUUID();
      const t0 = Date.now();
      try {
        const { vectors: embs, usage } = await aiService.generateEmbeddingWithUsage({
          input: batch,
          purpose: "document",
          title: material.filename as string,
        });
        const latencyMs = Date.now() - t0;
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
          estimatedCost: estimateCost(EMBEDDING_MODEL_NAME, usage),
        });
        embeddings.push(...embs);
      } catch (e) {
        const latencyMs = Date.now() - t0;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[EMBEDDING ${requestId}] material chunk embedding failed batch ${i / batchSize}:`, errMsg);
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
        throw e;
      }
    }
    if (embeddings.length !== chunks.length) throw new Error("Embedding count mismatch");

    // Verify dimension matches schema (Gemini 2, 768; AIService already
    // throws on mismatch — this is a second, explicit gate before insert).
    if (embeddings[0]?.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding dimension ${embeddings[0]?.length} does not match schema (${EMBEDDING_DIM}). ` +
          `Run db/schema/012_embeddings_gemini2_768.sql and use one embedding model at a time.`
      );
    }

    // 4b. Store chunks with embeddings
    // Retry safety: remove stale chunks from a previous failed attempt so a
    // retry never duplicates content.
    await db.from("chunks").delete().eq("material_id", materialId);
    const rows = chunks.map((c, idx) => ({
      material_id: materialId,
      project_id: projectId,
      content: c.content,
      page_number: c.page_number,
      chunk_index: c.chunk_index,
      embedding: embeddings[idx],
      metadata: { filename: material.filename },
    }));
    // Insert in batches to avoid hitting row limit
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error: insErr } = await db.from("chunks").insert(batch);
      if (insErr) throw new Error(`Failed to insert chunks: ${insErr.message}`);
    }

    // 5. Extract concepts via AIService (structured) — logs CONCEPT_EXTRACTION per phase 15 (including failure)
    let concepts: { name: string; description: string }[] = [];
    {
      const requestId = crypto.randomUUID();
      const t0 = Date.now();
      try {
        const { data: result, usage } = await aiService.generateStructuredWithUsage<{ concepts: { name: string; description: string }[] }>({
          systemPrompt:
            "You are a concept extractor. From the document text, extract up to 8 distinct key concepts as { name, description }. Names should be concise (2-5 words), descriptions one sentence. Return JSON { concepts: [...] } only, no extra keys.",
          userPrompt: `Document (first 8000 chars):\n${conceptSourceText}\n\nReturn JSON with key "concepts".`,
          schema: { concepts: "array" },
          temperature: 0.2,
          maxTokens: 1500,
        });
        const latencyMs = Date.now() - t0;
        await logAiOperation({
          userId,
          projectId,
          feature: "CONCEPT_EXTRACTION",
          model: CHAT_MODEL_NAME,
          requestId,
          latencyMs,
          success: true,
          tokensIn: usage.inputTokens,
          tokensOut: usage.outputTokens,
          estimatedCost: estimateCost(CHAT_MODEL_NAME, usage),
        });
        const raw = (result as unknown as { concepts: unknown }).concepts;
        if (Array.isArray(raw)) {
          concepts = raw
            .filter((c): c is { name: string; description: string } => {
              return (
                typeof c === "object" &&
                c !== null &&
                typeof (c as Record<string, unknown>).name === "string" &&
                typeof (c as Record<string, unknown>).description === "string"
              );
            })
            .slice(0, 8);
        }
      } catch (e) {
        const latencyMs = Date.now() - t0;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[CONCEPT_EXTRACTION ${requestId}] failed:`, errMsg);
        await logAiOperation({
          userId,
          projectId,
          feature: "CONCEPT_EXTRACTION",
          model: CHAT_MODEL_NAME,
          requestId,
          latencyMs,
          success: false,
          error: errMsg.slice(0, 2000),
        });
        console.error("Concept extraction failed (non-fatal):", e);
        concepts = [];
      }
    }

    if (concepts.length > 0) {
      const conceptRows = concepts.map((c) => ({
        project_id: projectId,
        name: c.name,
        description: c.description,
        source_material_id: materialId,
      }));
      for (const row of conceptRows) {
        const { error: cErr } = await db.from("concepts").insert(row);
        if (cErr) console.error("Concept insert failed:", cErr);
      }
    }

    // Update page_count and READY
    await db
      .from("materials")
      .update({ status: "READY", page_count: numPages, updated_at: new Date().toISOString() })
      .eq("id", materialId);

    await db.from("learning_events").insert({
      user_id: userId,
      space_id: spaceId,
      project_id: projectId,
      event_type: "MATERIAL_READY",
      entity_type: "material",
      entity_id: materialId,
      metadata: { page_count: numPages, chunks: chunks.length, concepts: concepts.length, extraction_method: extractionMethod },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Material ${materialId} processing failed:`, msg);
    await db
      .from("materials")
      .update({
        status: "FAILED",
        processing_error: msg.slice(0, 2000),
        // numPages may be known even when extraction yielded no text
        // (e.g. scanned PDFs) — keep it so the UI can show page info.
        ...(typeof numPages === "number" ? { page_count: numPages } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", materialId);
    await db.from("learning_events").insert({
      user_id: userId,
      space_id: spaceId,
      project_id: projectId,
      event_type: "MATERIAL_FAILED",
      entity_type: "material",
      entity_id: materialId,
      metadata: { error: msg },
    });
  }
}

async function extractPdfText(buffer: Buffer): Promise<{ text: string; numPages: number }> {
  // pdf-parse's package entry (index.js) runs a debug block on ESM import
  // (`!module.parent` is true under ESM) that reads ./test/data/*.pdf and
  // throws ENOENT. Import the inner lib file directly to avoid it.
  // Verified: import('pdf-parse') -> ENOENT, import('pdf-parse/lib/pdf-parse.js') -> ok.
  try {
    const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as
      | { default: (data: Buffer) => Promise<{ text: string; numpages: number }> }
      | ((data: Buffer) => Promise<{ text: string; numpages: number }>);
    const pdfParse =
      typeof mod === "function" ? mod : mod.default;
    const data = await pdfParse(buffer);
    return { text: data.text ?? "", numPages: data.numpages ?? 1 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`PDF text extraction failed: ${msg}`);
  }
}
