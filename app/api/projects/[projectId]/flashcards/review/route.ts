import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { recordFlashcardReview } from "@/services/mastery.service";

/**
 * POST /api/projects/[projectId]/flashcards/review
 * Records one flashcard self-review as mastery evidence.
 *
 * Body: { concept_id: string, result: "known" | "learning", review_id?: string }
 *  - concept_id must belong to the project
 *  - result maps to deterministic evidence (known=85, learning=20) with a
 *    gentle 0.15 weight (self-reported, not graded)
 *  - review_id is a client-generated UUID per flip; replays are idempotent.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));

    const conceptId =
      typeof body.concept_id === "string" && body.concept_id.trim() ? body.concept_id.trim() : null;
    const rawResult = typeof body.result === "string" ? body.result.toLowerCase().trim() : null;
    const reviewId =
      typeof body.review_id === "string" && body.review_id.trim()
        ? body.review_id.trim().slice(0, 64)
        : undefined;

    if (!conceptId) return NextResponse.json({ error: "concept_id is required" }, { status: 400 });
    if (rawResult !== "known" && rawResult !== "learning") {
      return NextResponse.json({ error: 'result must be "known" or "learning"' }, { status: 400 });
    }

    // Spam guard: self-reports are cheap — 60 reviews/min per user is generous.
    const rl = checkRateLimit(`flashcard-review:${userId}`, 60, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

    const r = await recordFlashcardReview({
      projectId,
      conceptId,
      userId,
      result: rawResult,
      reviewId,
    });

    return NextResponse.json(
      {
        review_id: r.reviewId,
        concept_id: r.conceptId,
        result: r.result,
        previous: r.previous,
        evidence: r.evidence,
        newScore: r.newScore,
        skipped: r.skipped,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Concept not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error("Flashcard review failed:", e);
    return NextResponse.json({ error: msg || "Failed to record flashcard review" }, { status: 500 });
  }
}
