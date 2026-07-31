import { NextRequest, NextResponse } from "next/server";
import { updateAvatar } from "@/lib/db";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";

const ALLOWED_AVATARS = ["😎","🤠","👑","🎩","🦈","🐯","🦁","🐺","🦊","🐻","🐼","🐸","🦅","🃏","💀","🤑"];

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { avatar } = await req.json() as { avatar: string };
  if (!ALLOWED_AVATARS.includes(avatar)) {
    return NextResponse.json({ error: "Invalid avatar." }, { status: 400 });
  }

  await updateAvatar(payload.userId, avatar);

  return NextResponse.json({ ok: true });
}
