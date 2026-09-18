import { NextResponse } from "next/server";
import { requireUserId, isAuthError, isNotFoundError } from "@/lib/auth/getCurrentUser";
import { getChunkExcerpt } from "@/services/chunk.service";

/**
 * GET /api/chunks/[chunkId] — single chunk excerpt for the tutor source panel.
 * Ownership is enforced in the service (chunk.project_id must belong to caller).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chunkId: string }> }
) {
  try {
    await requireUserId();
    const { chunkId } = await params;
    const excerpt = await getChunkExcerpt(chunkId);
    return NextResponse.json(excerpt);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg || "Failed to fetch chunk" }, { status: 500 });
  }
}
