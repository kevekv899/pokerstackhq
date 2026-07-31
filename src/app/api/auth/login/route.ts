import { NextRequest, NextResponse } from "next/server";
import { toPublicUser, getUserByEmail, updateLastLogin } from "@/lib/db";
import { verifyPassword, signToken, cookieOptions, COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body as Record<string, string>;

    if (!email?.trim() || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const user = await getUserByEmail(email.trim().toLowerCase());

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Banned accounts are rejected only after the password check, so the
    // response can't be used to enumerate which accounts exist.
    if (user.banned) {
      return NextResponse.json(
        { error: "This account has been suspended. Contact support." },
        { status: 403 }
      );
    }

    // Update last_login
    await updateLastLogin(user.id);

    const token = await signToken({
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    const res = NextResponse.json({ user: toPublicUser(user) });
    res.cookies.set(COOKIE_NAME, token, cookieOptions());
    return res;
  } catch (err) {
    console.error("[login]", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
