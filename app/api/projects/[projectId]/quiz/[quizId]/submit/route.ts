import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { submitAnswer } from "@/services/quiz.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; quizId: string }> }
) {
  try {
    await requireUserId();
    const { projectId, quizId } = await params;
    const body = await request.json().catch(() => ({}));
    const questionId = (body.questionId as string) ?? (body.question_id as string) ?? (body.question_id as string);
    const response = (body.response as string) ?? (body.answer as string) ?? "";
    if (!questionId) return NextResponse.json({ error: "questionId is required" }, { status: 400 });
    if (!response || !String(response).trim()) return NextResponse.json({ error: "response is required" }, { status: 400 });

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
