import { NextResponse } from "next/server";
import { fetchYvxInventory } from "../../../lib/stackknack";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await fetchYvxInventory();
    return NextResponse.json({ source: "stackknack", rows, fetchedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown inventory error";
    return NextResponse.json({ source: "unavailable", rows: [], error: message, fetchedAt: new Date().toISOString() }, { status: 503 });
  }
}
