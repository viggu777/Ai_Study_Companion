import { NextResponse } from "next/server";
import { getSpace, updateSpace, deleteSpace } from "@/services/project.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const space = await getSpace(spaceId);
    if (!space) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(space);
  } catch {
    return NextResponse.json({ error: "Failed to get space" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { name, description } = await request.json();
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const space = await updateSpace(spaceId, name.trim(), description?.trim());
    return NextResponse.json(space);
  } catch {
    return NextResponse.json({ error: "Failed to update space" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    await deleteSpace(spaceId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete space" }, { status: 500 });
  }
}