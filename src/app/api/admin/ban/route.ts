import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { setUserBanned, logActivity } from "@/lib/admin-db";

/**
 * Ban / unban a user.
 *
 * `banned` is explicit rather than a toggle so two operators acting on a stale
 * table can't flip each other's decision — both requests converge on the same
 * state instead of alternating.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId, banned } = await req.json();

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    if (typeof banned !== "boolean") {
      return NextResponse.json({ error: "Invalid banned flag" }, { status: 400 });
    }

    const result = await setUserBanned(userId, banned);
    if (!result) return NextResponse.json({ error: "User not found" }, { status: 404 });

    await logActivity(
      userId,
      banned ? "admin_ban" : "admin_unban",
      `${result.username} ${banned ? "banned" : "unbanned"} by admin`
    );

    return NextResponse.json({ ok: true, user: result });
  } catch (err) {
    console.error("admin/ban failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
