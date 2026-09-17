import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { getQuizWithAnswers, getQuizWithQuestions } from "@/services/quiz.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; quizId: string }> }
) {
  try {
    await requireUserId();
    const { projectId, quizId } = await params;
    const url = new URL(request.url);
    const includeAnswers = url.searchParams.get("answers") === "1" || url.searchParams.get("includeAnswers") === "true";
    if (includeAnswers) {
      const withAns = await getQuizWithAnswers(projectId, quizId);
      return NextResponse.json({ quiz: withAns.quiz, questions: withAns.questions, answers: withAns.answersList });
    }
    const result = await getQuizWithQuestions(projectId, quizId);
    try {
    await requireUserId();
      const withAns = await getQuizWithAnswers(projectId, quizId);
      return NextResponse.json({ ...result, answers: withAns.answersList });
    } catch {
      return NextResponse.json({ ...result, answers: [] });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Quiz not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg || "Failed to fetch quiz" }, { status: 500 });
  }
}
