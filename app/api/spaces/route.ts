import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { listSpaces, createSpace } from "@/services/project.service";
import { parseSpaceBody } from "@/lib/validation/schemas";

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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = parseSpaceBody(body);
    if (!parsed.ok || !parsed.data) {
      return NextResponse.json({ error: parsed.error ?? "Invalid body" }, { status: 400 });
    }
    const space = await createSpace(parsed.data.name, parsed.data.description);
    return NextResponse.json(space, { status: 201 });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create space" }, { status: 500 });
  }
}