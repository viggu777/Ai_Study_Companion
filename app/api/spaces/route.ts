import { NextResponse } from "next/server";
import { listSpaces, createSpace } from "@/services/project.service";

export async function GET() {
  try {
    const spaces = await listSpaces();
    return NextResponse.json(spaces);
  } catch {
    return NextResponse.json({ error: "Failed to list spaces" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, description } = await request.json();
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const space = await createSpace(name.trim(), description?.trim());
    return NextResponse.json(space, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create space" }, { status: 500 });
  }
}