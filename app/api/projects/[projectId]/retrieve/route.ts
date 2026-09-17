import { NextResponse } from "next/server";
import { isAuthError, requireUserId } from "@/lib/auth/getCurrentUser";
import { retrieve, DEFAULT_TOP_K, RELEVANCE_THRESHOLD } from "@/lib/rag/retrieve";

/**
 * GET /api/projects/[projectId]/retrieve?q=...&k=5&threshold=0.25
 * Manual test endpoint usable via curl/Postman.
 * Returns retrieved chunks with scores, or insufficient_evidence.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? searchParams.get("query") ?? "";
    const kRaw = searchParams.get("k");
    const tRaw = searchParams.get("threshold");
    const topK = kRaw ? Math.min(20, Math.max(1, parseInt(kRaw, 10) || DEFAULT_TOP_K)) : DEFAULT_TOP_K;
    const threshold = tRaw ? parseFloat(tRaw) : RELEVANCE_THRESHOLD;

    if (!query.trim()) {
      return NextResponse.json({ error: "Missing query param ?q=" }, { status: 400 });
    }

    const result = await retrieve({ projectId, userId, query, topK, threshold });

    // Include threshold/topK in response for verification
    return NextResponse.json({
      ...result,
      meta: { projectId, query, topK, threshold },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Retrieve failed" }, { status: 500 });
  }
}

/**
 * POST /api/projects/[projectId]/retrieve  { query, topK?, threshold? }
 * Alternative JSON body form for longer queries.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const userId = await requireUserId();
    const body = await request.json().catch(() => ({}));
    const query = (body.query as string) ?? "";
    const topK = body.topK ? Math.min(20, Math.max(1, Number(body.topK) || DEFAULT_TOP_K)) : DEFAULT_TOP_K;
    const threshold = body.threshold != null ? Number(body.threshold) : RELEVANCE_THRESHOLD;

    if (!query.trim()) return NextResponse.json({ error: "Missing query" }, { status: 400 });

    const result = await retrieve({ projectId, userId, query, topK, threshold });
    return NextResponse.json({ ...result, meta: { projectId, query, topK, threshold } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Retrieve failed" }, { status: 500 });
  }
}
