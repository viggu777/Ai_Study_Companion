import { NextResponse } from "next/server";
import { requireUserId, isAuthError, isNotFoundError } from "@/lib/auth/getCurrentUser";
import { listProjects, createProject } from "@/services/project.service";
import { parseProjectBody } from "@/lib/validation/schemas";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    await requireUserId();
    const { spaceId } = await params;
    const projects = await listProjects(spaceId);
    return NextResponse.json(projects);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Space not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    await requireUserId();
    const { spaceId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = parseProjectBody(body);
    if (!parsed.ok || !parsed.data) {
      return NextResponse.json({ error: parsed.error ?? "Invalid body" }, { status: 400 });
    }
    const project = await createProject(spaceId, parsed.data.name, parsed.data.description, parsed.data.learning_goal);
    return NextResponse.json(project, { status: 201 });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Space not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}