import { NextResponse } from "next/server";
import { listProjects, createProject } from "@/services/project.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const projects = await listProjects(spaceId);
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const { name, description, learning_goal } = await request.json();
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const project = await createProject(
      spaceId,
      name.trim(),
      description?.trim(),
      learning_goal?.trim()
    );
    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}