import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { adjustBalance, insertTransaction } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { finalChips } = await req.json();
    if (typeof finalChips !== "number" || finalChips < 0 || !Number.isFinite(finalChips)) {
      return NextResponse.json({ error: "Invalid finalChips" }, { status: 400 });
    }

    const amountCents = Math.round(finalChips * 100);
    const balance = await adjustBalance(payload.userId, amountCents);

    await insertTransaction({
      user_id: payload.userId,
      type: "cashout",
      coin: "USD",
      amount_usd: amountCents,
      amount_crypto: "0",
      address: "",
      status: "completed",
      tx_hash: "",
    });

    return NextResponse.json({ ok: true, balance });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
