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
    // Same cost class as quiz generation — 5/min per user.
    const rl = checkRateLimit(`flashcards-generate:${userId}`, 5, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const result = await generateFlashcards(projectId, { count });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("No concepts")) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("Flashcard generation failed:", e);
    return NextResponse.json({ error: msg || "Flashcard generation failed" }, { status: 500 });
  }
}
