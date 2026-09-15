import { NextResponse } from "next/server";
import { getGlobalAnalytics } from "@/services/analytics.service";

export async function GET() {
  try {
    const data = await getGlobalAnalytics();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Failed to fetch global analytics", details: msg }, { status: 500 });
  }
}
