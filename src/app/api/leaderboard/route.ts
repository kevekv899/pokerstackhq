import { NextResponse } from "next/server";
import { getLeaderboard, getPlatformStats } from "@/lib/db";

// The leaderboard is live data — never serve a cached/prerendered response.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [leaderboard, stats] = await Promise.all([
      getLeaderboard(10),
      getPlatformStats(),
    ]);
    return NextResponse.json(
      { leaderboard, stats },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
