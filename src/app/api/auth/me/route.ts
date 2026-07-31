import { NextRequest, NextResponse } from "next/server";
import { toPublicUser, getUserById } from "@/lib/db";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ user: null });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ user: null });

  const user = await getUserById(payload.userId);

  if (!user) return NextResponse.json({ user: null });

  return NextResponse.json({ user: toPublicUser(user) });
}
