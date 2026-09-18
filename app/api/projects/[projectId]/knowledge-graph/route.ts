import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { listConceptEdges } from "@/services/knowledge-graph.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const edges = await listConceptEdges(projectId);
    return NextResponse.json({ edges });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to list knowledge graph" }, { status: 500 });
  }
}
