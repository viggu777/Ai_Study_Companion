import { NextResponse } from "next/server";
import { generateQuiz, listQuizzes } from "@/services/quiz.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const quizzes = await listQuizzes(projectId);
    return NextResponse.json({ quizzes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to list quizzes" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const count = typeof body.count === "number" ? body.count : undefined;
    const result = await generateQuiz(projectId, { count });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("No concepts")) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("Quiz generation failed:", e);
    return NextResponse.json({ error: msg || "Quiz generation failed" }, { status: 500 });
  }
}
