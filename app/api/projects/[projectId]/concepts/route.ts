import { NextResponse } from "next/server";
import { isAuthError, requireUserId } from "@/lib/auth/getCurrentUser";
import { listConceptsWithMeta } from "@/services/concept.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // Explicit auth (previously relied on the service's redirect-based guard).
    await requireUserId();
    const { projectId } = await params;
    const concepts = await listConceptsWithMeta(projectId);
    return NextResponse.json({ concepts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to list concepts" }, { status: 500 });
  }
}
