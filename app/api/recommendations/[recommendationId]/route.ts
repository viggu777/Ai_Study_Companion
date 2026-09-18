import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUserId } from "@/lib/auth/getCurrentUser";
import { updateRecommendationStatus } from "@/services/recommendation.service";

const VALID_STATUSES = ["COMPLETED", "DISMISSED", "ACTIVE"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recommendationId: string }> }
) {
  try {
    await requireUserId();
    const { recommendationId } = await params;
    let body: { status?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { status } = body;
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    await updateRecommendationStatus(
      recommendationId,
      status as "COMPLETED" | "DISMISSED" | "ACTIVE"
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
