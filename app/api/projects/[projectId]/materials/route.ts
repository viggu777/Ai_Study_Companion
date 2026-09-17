import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { listMaterials, uploadMaterial } from "@/services/material.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const materials = await listMaterials(projectId);
    return NextResponse.json(materials);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("Unauthorized") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to list materials" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireUserId();
    const { projectId } = await params;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    const result = await uploadMaterial(projectId, file);
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Project not found")) return NextResponse.json({ error: msg }, { status: 404 });
    if (msg.includes("Only PDF") || msg.includes("too large") || msg.includes("empty")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    // Storage or other failures bubble as 500 but material already marked FAILED where applicable
    return NextResponse.json({ error: msg || "Failed to upload material" }, { status: 500 });
  }
}
