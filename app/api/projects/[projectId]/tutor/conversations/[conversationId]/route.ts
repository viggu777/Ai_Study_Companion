import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import {
  deleteConversation,
  setConversationPinned,
} from "@/services/tutor.service";

type Ctx = { params: Promise<{ projectId: string; conversationId: string }> };

/** Delete a tutor session (conversation + its messages). */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    await requireUserId();
    const { projectId, conversationId } = await params;
    await deleteConversation(projectId, conversationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Conversation not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}

/** Pin / unpin a tutor session. Body: { pinned: boolean } */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    await requireUserId();
    const { projectId, conversationId } = await params;
    const body = await request.json().catch(() => ({}));
    const pinned = (body as { pinned?: unknown }).pinned;
    if (typeof pinned !== "boolean") {
      return NextResponse.json({ error: "pinned must be a boolean" }, { status: 400 });
    }
    const result = await setConversationPinned(projectId, conversationId, pinned);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found") || msg.includes("Conversation not found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}
