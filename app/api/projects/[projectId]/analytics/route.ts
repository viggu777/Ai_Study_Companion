import { NextResponse } from "next/server";
import { getProjectAnalytics } from "@/services/analytics.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const data = await getProjectAnalytics(projectId);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Project not found")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to fetch analytics", details: msg }, { status: 500 });
  }
}
