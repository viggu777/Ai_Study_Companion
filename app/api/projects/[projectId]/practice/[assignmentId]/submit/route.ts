import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { submitPracticeResponse } from "@/services/practice.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; assignmentId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { projectId, assignmentId } = await params;
    const rl = checkRateLimit(`practice-submit:${userId}`, 60, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const body = await request.json().catch(() => ({}));
    const questionId = (body.questionId as unknown) ?? (body.question_id as unknown) ?? "";
    const response = (body.response as unknown) ?? (body.answer as unknown) ?? "";
    const confidence = (body.confidence as unknown) ?? null;
    if (typeof questionId !== "string" || !questionId) {
      return NextResponse.json({ error: "questionId is required" }, { status: 400 });
    }
    if (!response || !String(response).trim()) return NextResponse.json({ error: "response is required" }, { status: 400 });

    const result = await submitPracticeResponse(
      projectId,
      assignmentId,
      questionId,
      String(response),
      confidence === null ? null : (confidence as number | null)
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Practice assignment not found") || msg.includes("Practice question not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("Response is required") || msg.includes("Response too long") || msg.includes("Confidence must be")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("Evaluation temporarily unavailable")) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    console.error("submitPracticeResponse failed:", e);
    return NextResponse.json({ error: msg || "Failed to submit practice response" }, { status: 500 });
  }
}
