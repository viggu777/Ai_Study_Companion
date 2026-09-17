import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { deleteMaterial } from "@/services/material.service";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ materialId: string }> }
) {
  try {
    await requireUserId();
    const { materialId } = await params;
    const result = await deleteMaterial(materialId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg || "Failed to delete material" }, { status: 500 });
  }
}
