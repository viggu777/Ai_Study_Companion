import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUserId } from "@/lib/auth/getCurrentUser";
import { listRecommendations } from "@/services/recommendation.service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const recommendations = await listRecommendations(projectId);
    return NextResponse.json({ recommendations });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
