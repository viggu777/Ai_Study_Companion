import { NextResponse } from "next/server";
import { retryMaterial } from "@/services/material.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ materialId: string }> }
) {
  try {
    const { materialId } = await params;
    const result = await retryMaterial(materialId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: "Failed to retry material" }, { status: 500 });
  }
}
