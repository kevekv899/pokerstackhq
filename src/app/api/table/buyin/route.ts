import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { getBalance, adjustBalance, insertTransaction } from "@/lib/db";

const BUYIN_CENTS = 20000; // $200.00

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const balance = await getBalance(payload.userId);
    if (balance === null) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (balance < BUYIN_CENTS) {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 402 });
    }

    const newBalance = await adjustBalance(payload.userId, -BUYIN_CENTS);

    await insertTransaction({
      user_id: payload.userId,
      type: "buyin",
      coin: "USD",
      amount_usd: BUYIN_CENTS,
      amount_crypto: "0",
      address: "",
      status: "completed",
      tx_hash: "",
    });

    return NextResponse.json({ ok: true, balance: newBalance });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
