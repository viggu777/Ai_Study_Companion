import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { listSpaces, createSpace } from "@/services/project.service";

export async function GET() {
  try {
    await requireUserId();
    const spaces = await listSpaces();
    return NextResponse.json(spaces);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list spaces" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireUserId();
    const { name, description } = await request.json();
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const space = await createSpace(name.trim(), description?.trim());
    return NextResponse.json(space, { status: 201 });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create space" }, { status: 500 });
  }
}