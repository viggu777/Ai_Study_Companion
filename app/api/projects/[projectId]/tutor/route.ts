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
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    const history = await getTutorHistory(projectId, conversationId);
    return NextResponse.json(history);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Conversation not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
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
    const rawQuestion = (body.question as unknown) ?? (body.q as unknown) ?? "";
    const question = typeof rawQuestion === "string" ? rawQuestion : "";
    if (!question.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });
    const rl = checkRateLimit(`tutor:${userId}`, 20, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const conversationId =
      typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : null;
    const result = await askTutor(projectId, question, conversationId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Conversation not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("Question is required") || msg.includes("too long")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("Tutor POST failed:", e);
    return NextResponse.json({ error: msg || "Tutor request failed" }, { status: 500 });
  }
}
