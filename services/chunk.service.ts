import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";

export interface ChunkExcerpt {
  id: string;
  content: string;
  page: number;
  materialId: string;
  materialName: string;
  projectId: string;
}

/**
 * Single chunk excerpt for the tutor source panel.
 * Ownership: chunk.project_id must belong to the caller — missing or foreign
 * ids both surface as "Chunk not found" (404, no existence oracle).
 */
export async function getChunkExcerpt(chunkId: string): Promise<ChunkExcerpt> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data: chunk, error } = await db
    .from("chunks")
    .select("id, content, page_number, material_id, project_id")
    .eq("id", chunkId)
    .single();
  if (error || !chunk) throw new Error("Chunk not found");
  const typed = chunk as {
    id: string;
    content: string;
    page_number: number;
    material_id: string;
    project_id: string;
  };

  const { data: proj } = await db
    .from("projects")
    .select("id")
    .eq("id", typed.project_id)
    .eq("user_id", userId)
    .single();
  if (!proj) throw new Error("Chunk not found");

  const { data: mat } = await db
    .from("materials")
    .select("filename")
    .eq("id", typed.material_id)
    .maybeSingle();

  return {
    id: typed.id,
    content: typed.content,
    page: typed.page_number,
    materialId: typed.material_id,
    materialName: (mat as { filename: string } | null)?.filename ?? "Unknown file",
    projectId: typed.project_id,
  };
}
