import { NextResponse } from "next/server";
import { requireUserId, isAuthError } from "@/lib/auth/getCurrentUser";
import { getGlobalAnalytics } from "@/services/analytics.service";

export async function GET() {
  try {
    await requireUserId();
    const data = await getGlobalAnalytics();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isAuthError(e)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to fetch global analytics", details: msg }, { status: 500 });
  }
}
