import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { adjustBalance, getBalance, insertTransaction } from "@/lib/db";
import { createNotification, fmtUsd } from "@/lib/notifications";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await req.json();
    const type: string = body.type;
    const amount: number = body.amount;
    // Optional context used only to write a readable notification.
    const hand: unknown = body.hand;
    const table: unknown = body.table;

    if (type !== "win" && type !== "loss") {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (typeof amount !== "number" || amount <= 0 || !Number.isFinite(amount) || amount > 1_000_000_00) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const amountCents = Math.round(amount);

    // Tables that move real chips (buy-in on the way in, cash-out on the way
    // out) must NOT also settle each hand here: the winnings are still sitting
    // in the player's stack and would be credited a second time when they get
    // up. Those callers pass `notifyOnly` and get the notification without the
    // balance move. Callers that omit it keep the original behaviour.
    const notifyOnly = body.notifyOnly === true;

    const balance = notifyOnly
      ? await getBalance(payload.userId)
      : await adjustBalance(payload.userId, type === "win" ? amountCents : -amountCents);

    const tx = notifyOnly
      ? null
      : await insertTransaction({
          user_id: payload.userId,
          type,
          coin: "USD",
          amount_usd: amountCents,
          amount_crypto: "0",
          address: "",
          status: "completed",
          tx_hash: "",
        });

    await createNotification(
      payload.userId,
      type,
      type === "win"
        ? `🏆 You won ${fmtUsd(amountCents)}${describeHand(hand)}!`
        : `😔 You lost ${fmtUsd(amountCents)}${describeTable(table)}`
    );

    return NextResponse.json({ ok: true, balance, transaction: tx });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Hand names that already read as a quantity and so take no article. */
const NO_ARTICLE = /^(One|Two|Three|Four|Five) /;

/** ` with a Full House` / ` with Two Pair` — empty when the client sent nothing. */
function describeHand(hand: unknown): string {
  if (typeof hand !== "string") return "";
  const clean = hand.replace(/[^\w ,'-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return "";
  return NO_ARTICLE.test(clean) ? ` with ${clean}` : ` with a ${clean}`;
}

/** ` at Table #4821` — empty when the client sent nothing. */
function describeTable(table: unknown): string {
  const n = Number(table);
  return Number.isInteger(n) && n > 0 ? ` at Table #${n}` : "";
}
