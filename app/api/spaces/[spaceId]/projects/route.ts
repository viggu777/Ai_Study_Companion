import { NextResponse } from "next/server";
import { requireUserId, isAuthError, isNotFoundError } from "@/lib/auth/getCurrentUser";
import { listProjects, createProject } from "@/services/project.service";

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
    let body: { name?: unknown; description?: unknown; learning_goal?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name : "";
    if (name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const description = typeof body.description === "string" ? body.description.trim() : undefined;
    const learningGoal = typeof body.learning_goal === "string" ? body.learning_goal.trim() : undefined;
    const project = await createProject(spaceId, name.trim(), description, learningGoal);
    return NextResponse.json(project, { status: 201 });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Space not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}