import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { submitAnswer } from "@/services/quiz.service";
import { parseQuizSubmitBody } from "@/lib/validation/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; quizId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { projectId, quizId } = await params;
    const rl = checkRateLimit(`quiz-submit:${userId}`, 60, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const body = await request.json().catch(() => ({}));
    const parsed = parseQuizSubmitBody(body);
    if (!parsed.ok || !parsed.data) {
      return NextResponse.json({ error: parsed.error ?? "Invalid body" }, { status: 400 });
    }
    const { questionId, response } = parsed.data;

    const result = await submitAnswer(projectId, quizId, questionId, String(response));
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Quiz not found") || msg.includes("Question not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("Response is required") || msg.includes("Response too long")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("Evaluation failed")) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    console.error("submitAnswer failed:", e);
    return NextResponse.json({ error: msg || "Failed to submit answer" }, { status: 500 });
  }
}
