import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { getPracticeSummary } from "@/services/practice.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assignmentId: string }> }
) {
  try {
    await requireUserId();
    const { projectId, assignmentId } = await params;
    const summary = await getPracticeSummary(projectId, assignmentId);
    return NextResponse.json({ summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Practice assignment not found") || msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("007_practice")) return NextResponse.json({ error: msg }, { status: 503 });
    return NextResponse.json({ error: msg || "Failed to load practice summary" }, { status: 500 });
  }
}
