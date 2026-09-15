import { NextResponse } from "next/server";
import { askTutor, getTutorHistory } from "@/services/tutor.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const history = await getTutorHistory(projectId);
    return NextResponse.json(history);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: "Failed to fetch tutor history" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const question = (body.question as string) ?? (body.q as string) ?? "";
    if (!question.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });
    const result = await askTutor(projectId, question);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("Question is required") || msg.includes("too long")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("Tutor POST failed:", e);
    return NextResponse.json({ error: msg || "Tutor request failed" }, { status: 500 });
  }
}
