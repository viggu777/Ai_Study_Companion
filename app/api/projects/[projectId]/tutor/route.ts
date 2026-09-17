import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { askTutor, getTutorHistory } from "@/services/tutor.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const history = await getTutorHistory(projectId);
    return NextResponse.json(history);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: "Failed to fetch tutor history" }, { status: 500 });
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
    const question = (body.question as string) ?? (body.q as string) ?? "";
    if (!question.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });
    const rl = checkRateLimit(`tutor:${userId}`, 20, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const result = await askTutor(projectId, question);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("Question is required") || msg.includes("too long")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("Tutor POST failed:", e);
    return NextResponse.json({ error: msg || "Tutor request failed" }, { status: 500 });
  }
}
