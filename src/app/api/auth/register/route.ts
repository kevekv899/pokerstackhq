import { NextRequest, NextResponse } from "next/server";
import { toPublicUser, findExistingUser, createUser } from "@/lib/db";
import { hashPassword, signToken, cookieOptions, COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, email, password } = body as Record<string, string>;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!username?.trim() || !email?.trim() || !password) {
      return NextResponse.json(
        { error: "Username, email, and password are required." },
        { status: 400 }
      );
    }
    if (username.trim().length < 3 || username.trim().length > 20) {
      return NextResponse.json(
        { error: "Username must be 3–20 characters." },
        { status: 400 }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    // ── Check uniqueness ──────────────────────────────────────────────────────
    const existing = await findExistingUser(email.trim(), username.trim());
    if (existing) {
      return NextResponse.json(
        { error: "Email or username already taken." },
        { status: 409 }
      );
    }

    // ── Create user ───────────────────────────────────────────────────────────
    const hash = await hashPassword(password);
    const user = await createUser(
      username.trim(),
      email.trim().toLowerCase(),
      hash
    );

    // ── Issue JWT ─────────────────────────────────────────────────────────────
    const token = await signToken({
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    const res = NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
    res.cookies.set(COOKIE_NAME, token, cookieOptions());
    return res;
  } catch (err) {
    console.error("[register]", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
