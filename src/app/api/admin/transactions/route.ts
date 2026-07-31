import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { getAdminTransactions, getTransactionTypes } from "@/lib/admin-db";

/**
 * Transactions table plus the distinct type list that populates the filter
 * dropdown, so the filter always offers exactly the types that exist.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const type = req.nextUrl.searchParams.get("type") ?? "all";
    const [transactions, types] = await Promise.all([
      getAdminTransactions(type),
      getTransactionTypes(),
    ]);
    return NextResponse.json({ transactions, types, type });
  } catch (err) {
    console.error("admin/transactions failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
