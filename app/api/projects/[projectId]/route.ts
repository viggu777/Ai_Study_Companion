import { NextResponse } from "next/server";
import { requireUserId, isAuthError, isNotFoundError } from "@/lib/auth/getCurrentUser";
import { getProject, updateProject, deleteProject } from "@/services/project.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to get project" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
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
    const project = await updateProject(projectId, {
      name: name.trim(),
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      learning_goal: typeof body.learning_goal === "string" ? body.learning_goal.trim() : undefined,
    });
    return NextResponse.json(project);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    await deleteProject(projectId);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isNotFoundError(e)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}