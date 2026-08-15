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

    // Moving money is opt-in, and deliberately so.
    //
    // A table that takes a buy-in on the way in and returns chips at cash-out
    // has already accounted for the win: it is sitting in the player's stack.
    // Settling here as well pays it twice. That is the shape of every caller
    // today, so the safe behaviour is the default and a caller that genuinely
    // wants the balance moved has to say so. Forgetting the flag under-reports
    // a balance, which is visible and recoverable; the old default silently
    // doubled real money.
    const settleBalance = body.settleBalance === true;

    const balance = settleBalance
      ? await adjustBalance(payload.userId, type === "win" ? amountCents : -amountCents)
      : await getBalance(payload.userId);

    // Without a balance there is no meaningful reply, and returning null would
    // have the client render the player's balance as $0.00.
    if (balance === null) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const tx = settleBalance
      ? await insertTransaction({
          user_id: payload.userId,
          type,
          coin: "USD",
          amount_usd: amountCents,
          amount_crypto: "0",
          address: "",
          status: "completed",
          tx_hash: "",
        })
      : null;

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
