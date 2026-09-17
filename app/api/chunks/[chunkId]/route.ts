import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { getDb } from "@/lib/db/supabase";

/**
 * GET /api/chunks/[chunkId] — single chunk excerpt for the tutor source panel.
 * Ownership: chunk.project_id must belong to the caller (never trust ids alone).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chunkId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { chunkId } = await params;
    const db = await getDb();
    const { data: chunk, error } = await db
      .from("chunks")
      .select("id, content, page_number, material_id, project_id")
      .eq("id", chunkId)
      .single();
    if (error || !chunk) return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
    const typed = chunk as { id: string; content: string; page_number: number; material_id: string; project_id: string };
    const { data: proj } = await db.from("projects").select("id").eq("id", typed.project_id).eq("user_id", userId).single();
    if (!proj) return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
    const { data: mat } = await db.from("materials").select("filename").eq("id", typed.material_id).maybeSingle();
    return NextResponse.json({
      id: typed.id,
      content: typed.content,
      page: typed.page_number,
      materialId: typed.material_id,
      materialName: (mat as { filename: string } | null)?.filename ?? "Unknown file",
      projectId: typed.project_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg || "Failed to fetch chunk" }, { status: 500 });
  }
}
