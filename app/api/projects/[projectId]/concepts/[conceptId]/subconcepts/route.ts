import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { checkRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";
import { generateSubConcepts } from "@/services/concept.service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; conceptId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { projectId, conceptId } = await params;
    const rl = checkRateLimit(`subconcepts:${userId}`, 10, 60_000);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);
    const result = await generateSubConcepts(projectId, conceptId);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Concept not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error("Sub-concept generation failed:", e);
    return NextResponse.json({ error: msg || "Sub-concept generation failed" }, { status: 500 });
  }
}
