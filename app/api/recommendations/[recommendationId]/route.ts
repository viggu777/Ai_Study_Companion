import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUserId } from "@/lib/auth/getCurrentUser";
import { getDb, getServiceDb } from "@/lib/db/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recommendationId: string }> }
) {
  try {
    await requireUserId();
    const { recommendationId } = await params;
    const { status } = (await req.json()) as { status: string };
    if (!["COMPLETED", "DISMISSED", "ACTIVE"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const userId = await requireUserId();
    const db = await getDb();
    const { data: rec, error: fetchErr } = await db.from("recommendations").select("id, project_id, title").eq("id", recommendationId).eq("user_id", userId).single();
    if (fetchErr || !rec) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    const typed = rec as { id: string; project_id: string; title: string };
    const { error: updErr } = await db.from("recommendations").update({ status }).eq("id", recommendationId).eq("user_id", userId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    if (status === "COMPLETED") {
      const { data: proj } = await db.from("projects").select("space_id").eq("id", typed.project_id).single();
      const spaceId = (proj as { space_id: string } | null)?.space_id ?? null;
      const svc = getServiceDb();
      await svc.from("learning_events").insert({
        user_id: userId,
        space_id: spaceId,
        project_id: typed.project_id,
        event_type: "RECOMMENDATION_COMPLETED",
        entity_type: "recommendation",
        entity_id: recommendationId,
        metadata: { title: typed.title },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isAuthError(e) || msg.includes("not authenticated") || msg.includes("No session")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
