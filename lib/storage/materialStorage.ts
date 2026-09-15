import { getDb, getServiceDb } from "@/lib/db/supabase";

const BUCKET = "materials";

export async function uploadPdf(
  path: string,
  buffer: Buffer,
  mimeType: string
) {
  const db = await getDb();
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
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
