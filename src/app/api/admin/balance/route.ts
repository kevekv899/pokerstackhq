import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { adminAdjustBalance, logActivity } from "@/lib/admin-db";
import { insertTransaction } from "@/lib/db";

const MAX_ADJUSTMENT = 10_000_000; // $100,000 in cents, per action

/**
 * Manual credit/debit of a user's balance.
 *
 * `delta` is signed cents: positive credits, negative debits. Every adjustment
 * also writes a transaction row, so operator-created money shows up in the
 * user's own wallet history rather than appearing from nowhere.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId, delta } = await req.json();

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    if (!Number.isInteger(delta) || delta === 0) {
      return NextResponse.json({ error: "Delta must be a non-zero integer (cents)" }, { status: 400 });
    }
    if (Math.abs(delta) > MAX_ADJUSTMENT) {
      return NextResponse.json(
        { error: `Adjustment exceeds the ${MAX_ADJUSTMENT / 100} limit` },
        { status: 400 }
      );
    }

    const result = await adminAdjustBalance(userId, delta);
    if (!result) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // `applied` can differ from `delta` when a debit was clamped at zero — log
    // and record what actually moved.
    const { applied, balance, username } = result;

    if (applied !== 0) {
      await insertTransaction({
        user_id: userId,
        type: applied > 0 ? "admin_credit" : "admin_debit",
        coin: "USD",
        amount_usd: Math.abs(applied),
        status: "completed",
      });
    }

    await logActivity(
      userId,
      applied >= 0 ? "admin_credit" : "admin_debit",
      `${username} adjusted by ${(applied / 100).toFixed(2)} → balance ${(balance / 100).toFixed(2)}`
    );

    return NextResponse.json({ ok: true, balance, applied, requested: delta });
  } catch (err) {
    console.error("admin/balance failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
