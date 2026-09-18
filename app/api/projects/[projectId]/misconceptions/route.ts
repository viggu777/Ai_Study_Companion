import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { listMisconceptions } from "@/services/misconception.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const misconceptions = await listMisconceptions(projectId);
    return NextResponse.json({ misconceptions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to list misconceptions" }, { status: 500 });
  }
}
