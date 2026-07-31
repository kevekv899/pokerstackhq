import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import {
  getAdminStats,
  getNewUsersPerDay,
  getTxVolumePerDay,
  getActivityFeed,
} from "@/lib/admin-db";

/**
 * Dashboard payload: the four stat cards, both 14-day chart series, and the
 * activity feed — one round trip so the panel refreshes atomically.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [stats, newUsers, txVolume, activity] = await Promise.all([
      getAdminStats(),
      getNewUsersPerDay(14),
      getTxVolumePerDay(14),
      getActivityFeed(20),
    ]);
    return NextResponse.json({ stats, charts: { newUsers, txVolume }, activity });
  } catch (err) {
    console.error("admin/stats failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
