import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { getPracticeAssignmentDetail } from "@/services/practice.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assignmentId: string }> }
) {
  try {
    await requireUserId();
    const { projectId, assignmentId } = await params;
    const result = await getPracticeAssignmentDetail(projectId, assignmentId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Practice assignment not found") || msg.includes("not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg || "Failed to load practice assignment" }, { status: 500 });
  }
}
