import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { adjustBalance, insertTransaction } from "@/lib/db";
import { createNotification, fmtUsd } from "@/lib/notifications";

const COIN_RATES: Record<string, number> = {
  BTC: 65000, ETH: 3200, USDT: 1, USDC: 1, LTC: 85, SOL: 145,
};

function genTxHash(): string {
  const hex = "0123456789abcdef";
  let h = "0x";
  for (let i = 0; i < 64; i++) h += hex[Math.floor(Math.random() * 16)];
  return h;
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await req.json();
    const coin: string = body.coin ?? "BTC";
    const amountUsd: number = body.amount_usd ?? 10000; // cents, default $100

    if (!COIN_RATES[coin]) return NextResponse.json({ error: "Invalid coin" }, { status: 400 });
    if (amountUsd < 100 || amountUsd > 10_000_000)
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

    const rate = COIN_RATES[coin];
    const amountCrypto = (amountUsd / 100 / rate).toFixed(8);
    const txHash = genTxHash();

    const balance = await adjustBalance(payload.userId, amountUsd);

    const tx = await insertTransaction({
      user_id: payload.userId,
      type: "deposit",
      coin,
      amount_usd: amountUsd,
      amount_crypto: amountCrypto,
      address: "",
      status: "completed",
      tx_hash: txHash,
    });

    await createNotification(
      payload.userId,
      "deposit",
      `✅ Deposit of ${fmtUsd(amountUsd)} ${coin} confirmed`
    );

    return NextResponse.json({ ok: true, balance, transaction: tx });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
