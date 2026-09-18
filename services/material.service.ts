import { getDb, getServiceDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { inngest } from "@/lib/jobs/client";
import { buildStoragePath, downloadPdf, uploadPdf } from "@/lib/storage/materialStorage";
import { chunkPlainText } from "@/lib/rag/chunker";
import { aiService, CHAT_MODEL_NAME, EMBEDDING_DIM, EMBEDDING_MODEL_NAME } from "@/lib/ai/AIService";
import { logAiOperation } from "@/lib/ai/observability";

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

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

export async function uploadMaterial(
  projectId: string,
  file: File
): Promise<{ id: string; status: string }> {
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

  // Validate PDF + size (synchronous, return 400-style error before DB write)
  const mimeType = file.type || "application/pdf";
  if (!isPdf(mimeType, file.name)) {
    throw new Error("Only PDF files are allowed");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(`File too large — max ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  }
  if (file.size === 0) throw new Error("File is empty");

  const buffer = Buffer.from(await file.arrayBuffer());
  // Quick PDF header validation (avoid storing non-PDF that spoofs mime)
  if (!buffer.slice(0, 5).toString().startsWith("%PDF")) {
    // Still allow but background job will fail → FAILED; for immediate feedback we treat as allowed
    // but we will not reject here to let FAILED path be tested via corrupted file
  }

  // Create materials row with QUEUED
  const { data: material, error: matErr } = await db
    .from("materials")
    .insert({
      project_id: projectId,
      user_id: userId,
      filename: file.name,
      storage_path: "pending", // placeholder, updated after upload
      mime_type: "application/pdf",
      status: "QUEUED",
    })
    .select()
    .single();
  if (matErr || !material) throw new Error(matErr?.message ?? "Failed to create material");

  const storagePath = buildStoragePath(userId, projectId, material.id, file.name);

  try {
    await uploadPdf(storagePath, buffer, "application/pdf");
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
    .select("id, project_id, user_id, storage_path, filename, status")
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
    // 2. Extract text
    const buffer = await downloadPdf(material.storage_path);
    const extracted = await extractPdfText(buffer);
    const text = extracted.text;
    numPages = extracted.numPages;

    if (!text || text.trim().length < 20) {
      // Empty extraction + real pages almost always means a scanned /
      // image-only PDF. We have no OCR yet, so fail with an actionable
      // message instead of a generic error.
      throw new Error(
        numPages > 0
          ? `No extractable text found in this PDF (${numPages} page${numPages === 1 ? "" : "s"}). It looks like a scanned or image-only document, and OCR is not supported yet. Please upload a PDF with selectable text.`
          : "No extractable text found in PDF"
      );
    }

    // 3. Chunk
    const chunks = chunkPlainText(text, numPages);
    if (chunks.length === 0) throw new Error("Chunking produced no chunks");

    // 4. Embed each chunk via AIService (Gemini — same model/config as queries) — each call logs EMBEDDING per phase 15
    const contents = chunks.map((c) => c.content);
    // Gemini embedContent supports batching; send in batches of 20 to avoid payload/rate limits
    const batchSize = 20;
    const embeddings: number[][] = [];
    for (let i = 0; i < contents.length; i += batchSize) {
      const batch = contents.slice(i, i + batchSize);
      const requestId = crypto.randomUUID();
      const t0 = Date.now();
      try {
        const embs = await aiService.generateEmbedding({ input: batch });
        const latencyMs = Date.now() - t0;
        await logAiOperation({
          userId,
          projectId,
          feature: "EMBEDDING",
          model: EMBEDDING_MODEL_NAME,
          requestId,
          latencyMs,
          success: true,
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

    // Verify dimension matches schema (Gemini 768; AIService already
    // throws on mismatch — this is a second, explicit gate before insert).
    if (embeddings[0]?.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding dimension ${embeddings[0]?.length} does not match schema (${EMBEDDING_DIM}). ` +
          `Run db/schema/006_embeddings_gemini_768.sql and use one embedding model at a time.`
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
        const result = await aiService.generateStructured<{ concepts: { name: string; description: string }[] }>({
          systemPrompt:
            "You are a concept extractor. From the document text, extract up to 8 distinct key concepts as { name, description }. Names should be concise (2-5 words), descriptions one sentence. Return JSON { concepts: [...] } only, no extra keys.",
          userPrompt: `Document (first 8000 chars):\n${text.slice(0, 8000)}\n\nReturn JSON with key "concepts".`,
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
      metadata: { page_count: numPages, chunks: chunks.length, concepts: concepts.length },
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
