import { getDb, getServiceDb } from "@/lib/db/supabase";

const BUCKET = "materials";

export async function uploadPdf(
  path: string,
  buffer: Buffer,
  mimeType: string
) {
  // Server-only: use service role so uploads don't depend on storage.objects
  // RLS policies. Ownership is already validated in material.service.ts
  // (project must belong to the user) before this is called, and the
  // storage path is namespaced userId/projectId/materialId. Never call this
  // from client components — the service key must stay server-side.
  let db: ReturnType<typeof getServiceDb>;
  try {
    db = getServiceDb();
  } catch {
    db = (await getDb()) as unknown as ReturnType<typeof getServiceDb>;
  }
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) {
    if (error.message.toLowerCase().includes("bucket")) {
      throw new Error(
        `Storage upload failed: bucket "${BUCKET}" not found. Create it in Supabase Dashboard → Storage (private), or run db/schema/003_storage.sql. Original: ${error.message}`
      );
    }
    throw new Error(`Storage upload failed: ${error.message}`);
  }
}

export async function deletePdf(path: string): Promise<void> {
  // Best-effort cleanup for material deletion; missing objects are fine
  // (e.g. rows whose upload never succeeded and have no object).
  try {
    const db = getServiceDb();
    const { error } = await db.storage.from(BUCKET).remove([path]);
    if (error && !error.message.toLowerCase().includes("not found")) {
      console.error(`Storage delete failed for ${path}:`, error.message);
    }
  } catch (e) {
    console.error(`Storage delete failed for ${path}:`, e instanceof Error ? e.message : String(e));
  }
}

export async function downloadPdf(path: string): Promise<Buffer> {
  // Background jobs have no request cookies, so use service role
  let db: ReturnType<typeof getServiceDb>;
  try {
    db = getServiceDb();
  } catch {
    db = (await getDb()) as unknown as ReturnType<typeof getServiceDb>;
  }
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function buildStoragePath(userId: string, projectId: string, materialId: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${projectId}/${materialId}-${safe}`;
}
