import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { generatePracticeAssignment, listPracticeAssignments } from "@/services/practice.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const assignments = await listPracticeAssignments(projectId);
    return NextResponse.json({ assignments });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to list practice assignments" }, { status: 500 });
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
    const count = typeof body.count === "number" ? body.count : undefined;
    // Practice generation costs an LLM call — 5/min per user (double-clicks are
    // also absorbed by the idempotency guard in generatePracticeAssignment).
    const rl = checkRateLimit(`practice-generate:${userId}`, 5, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const result = await generatePracticeAssignment(projectId, { count });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("No concepts")) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("Practice generation failed:", e);
    return NextResponse.json({ error: msg || "Practice generation failed" }, { status: 500 });
  }
}
