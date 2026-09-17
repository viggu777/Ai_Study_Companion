import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUserId } from "@/lib/auth/getCurrentUser";
import { getDb } from "@/lib/db/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const userId = await requireUserId();
    const db = await getDb();
    const { data: proj } = await db.from("projects").select("id").eq("id", projectId).eq("user_id", userId).single();
    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data, error } = await db
      .from("recommendations")
      .select("id, title, action_items, status, created_at")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ recommendations: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isAuthError(e) || msg.includes("not authenticated") || msg.includes("No session")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
