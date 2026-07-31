import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { adjustBalance } from "@/lib/db";
import { createNotification, fmtUsd } from "@/lib/notifications";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { amount, name } = await req.json();
    if (typeof amount !== "number" || amount <= 0 || amount > 1_000_000_00) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const balance = await adjustBalance(payload.userId, amount);

    // Optional tournament name, so the notification can name the event the
    // player actually won rather than a generic one.
    // `&` is kept — real event names use it ("9-Player Sit & Go"). Stripped
    // characters can leave double spaces behind, so collapse runs afterwards.
    const title = typeof name === "string"
      ? name.replace(/[^\w ,'&#-]/g, "").replace(/\s+/g, " ").trim().slice(0, 48)
      : "";

    await createNotification(
      payload.userId,
      "tournament",
      title
        ? `🎯 You won ${fmtUsd(Math.round(amount))} in ${title}!`
        : `🎯 You won ${fmtUsd(Math.round(amount))} in a tournament!`
    );

    return NextResponse.json({ balance });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
