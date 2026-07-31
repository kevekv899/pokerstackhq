import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { markAllNotificationsRead } from "@/lib/notifications";

/** POST /api/notifications/read — marks all of the caller's notifications read. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  try {
    const updated = await markAllNotificationsRead(payload.userId);
    return NextResponse.json({ ok: true, updated, unreadCount: 0 });
  } catch (err) {
    console.error("POST /api/notifications/read failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
