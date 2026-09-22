import { NextResponse } from "next/server";
import { fetchYvxInventory } from "../../../lib/stackknack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const inventory = await fetchYvxInventory();
    return NextResponse.json({
      source: "stackknack",
      ...inventory,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown inventory error";
    return NextResponse.json(
      { source: "unavailable", rows: [], error: message, fetchedAt: new Date().toISOString() },
      { status: 503 },
    );
  }
}
