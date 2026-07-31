import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { getBalance, adjustBalance, insertTransaction } from "@/lib/db";

const COIN_RATES: Record<string, number> = {
  BTC: 65000, ETH: 3200, USDT: 1, USDC: 1, LTC: 85, SOL: 145,
};

// Network fees in USD cents
const NETWORK_FEES: Record<string, number> = {
  BTC: 325, ETH: 320, USDT: 150, USDC: 100, LTC: 9, SOL: 4,
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
    const address: string = body.address ?? "";
    const amountUsd: number = body.amount_usd ?? 0; // cents

    if (!COIN_RATES[coin]) return NextResponse.json({ error: "Invalid coin" }, { status: 400 });
    if (!address.trim()) return NextResponse.json({ error: "Withdrawal address required" }, { status: 400 });
    if (amountUsd < 1000) return NextResponse.json({ error: "Minimum withdrawal is $10.00" }, { status: 400 });

    const balance = await getBalance(payload.userId);
    if (balance === null) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const fee = NETWORK_FEES[coin] ?? 100;
    const total = amountUsd + fee;
    if (balance < total)
      return NextResponse.json({ error: "Insufficient balance (including network fee)" }, { status: 402 });

    const rate = COIN_RATES[coin];
    const amountCrypto = (amountUsd / 100 / rate).toFixed(8);
    const txHash = genTxHash();

    const newBalance = await adjustBalance(payload.userId, -total);

    const tx = await insertTransaction({
      user_id: payload.userId,
      type: "withdraw",
      coin,
      amount_usd: amountUsd,
      amount_crypto: amountCrypto,
      address,
      status: "pending",
      tx_hash: txHash,
    });

    return NextResponse.json({ ok: true, balance: newBalance, transaction: tx });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
