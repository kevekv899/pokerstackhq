import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import {
  getNotifications,
  getUnreadNotifications,
  getUnreadCount,
} from "@/lib/notifications";

/**
 * GET /api/notifications
 *
 * Returns the newest 10 notifications plus the unread count — the bell needs
 * both at once (badge = count, dropdown = last 10 including already-read ones,
 * so the list doesn't empty itself the moment you read it).
 *
 * `?unread=1` narrows the list to unread only.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ notifications: [], unreadCount: 0 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ notifications: [], unreadCount: 0 });

  try {
    const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";

    const [notifications, unreadCount] = await Promise.all([
      unreadOnly
        ? getUnreadNotifications(payload.userId, 10)
        : getNotifications(payload.userId, 10),
      getUnreadCount(payload.userId),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    console.error("GET /api/notifications failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
