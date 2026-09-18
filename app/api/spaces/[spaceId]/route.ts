import { NextResponse } from "next/server";
import { requireUserId, isAuthError, isNotFoundError } from "@/lib/auth/getCurrentUser";
import { getSpace, updateSpace, deleteSpace } from "@/services/project.service";

async function parseJson(request: Request): Promise<{ body: Record<string, unknown> | null; error: string | null }> {
  try {
    return { body: (await request.json()) as Record<string, unknown>, error: null };
  } catch {
    return { body: null, error: "Invalid JSON body" };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    await requireUserId();
    const { spaceId } = await params;
    const space = await getSpace(spaceId);
    if (!space) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(space);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to get space" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    await requireUserId();
    const { spaceId } = await params;
    const { body, error: jsonError } = await parseJson(request);
    if (jsonError || !body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const name = str(body.name);
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const space = await updateSpace(spaceId, name.trim(), str(body.description)?.trim());
    return NextResponse.json(space);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Space not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to update space" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    await requireUserId();
    const { spaceId } = await params;
    await deleteSpace(spaceId);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Space not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete space" }, { status: 500 });
  }
}