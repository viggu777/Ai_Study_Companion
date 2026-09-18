import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { generateQuiz, listQuizzes } from "@/services/quiz.service";
import { parseQuizGenerateBody } from "@/lib/validation/schemas";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const quizzes = await listQuizzes(projectId);
    return NextResponse.json({ quizzes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to list quizzes" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = parseQuizGenerateBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error ?? "Invalid body" }, { status: 400 });
    }
    const count = parsed.data?.count;
    const conceptIds = parsed.data?.conceptIds;
    const materialIds = parsed.data?.materialIds;
    // Quiz generation costs an LLM call — 5/min per user (double-clicks are
    // also absorbed by the idempotency guard in generateQuiz).
    const rl = checkRateLimit(`quiz-generate:${userId}`, 5, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const result = await generateQuiz(projectId, { count, conceptIds, materialIds });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("No concepts")) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("Quiz generation failed:", e);
    return NextResponse.json({ error: msg || "Quiz generation failed" }, { status: 500 });
  }
}
