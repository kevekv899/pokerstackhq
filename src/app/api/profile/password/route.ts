import { NextRequest, NextResponse } from "next/server";
import { getUserById, updatePassword } from "@/lib/db";
import { verifyToken, verifyPassword, hashPassword, COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { currentPassword, newPassword } = await req.json() as Record<string, string>;
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Both fields are required." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  const user = await getUserById(payload.userId);
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });

  const newHash = await hashPassword(newPassword);
  await updatePassword(user.id, newHash);

  return NextResponse.json({ message: "Password updated successfully." });
}
