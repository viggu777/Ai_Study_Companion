import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { generateFlashcards } from "@/services/flashcard.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const count = typeof body.count === "number" ? body.count : undefined;
    const level = typeof body.level === "string" ? body.level : undefined;
    const materialId = typeof body.materialId === "string" && body.materialId.trim() ? body.materialId.trim() : undefined;
    const conceptIds = Array.isArray(body.conceptIds)
      ? body.conceptIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0).slice(0, 20)
      : undefined;
    // Same cost class as quiz generation — 5/min per user.
    const rl = checkRateLimit(`flashcards-generate:${userId}`, 5, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const result = await generateFlashcards(projectId, { count, level, materialId, conceptIds });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (
      msg.includes("No concepts") ||
      msg.includes("No selected") ||
      msg.includes("not found in this project") ||
      msg.includes("must belong") ||
      msg.includes("pick at least one") ||
      msg.includes("still be processing")
    )
      return NextResponse.json({ error: msg }, { status: 400 });
    console.error("Flashcard generation failed:", e);
    return NextResponse.json({ error: msg || "Flashcard generation failed" }, { status: 500 });
  }
}
