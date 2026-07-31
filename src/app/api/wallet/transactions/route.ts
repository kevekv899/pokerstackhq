import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { getTransactions, getTransactionSummary, TransactionFilter } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const filter = (searchParams.get("type") ?? "all") as TransactionFilter;

    const [transactions, summary] = await Promise.all([
      getTransactions(payload.userId, filter),
      getTransactionSummary(payload.userId),
    ]);

    return NextResponse.json({ transactions, summary });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
