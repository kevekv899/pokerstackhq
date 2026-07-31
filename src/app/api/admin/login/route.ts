import { NextRequest, NextResponse } from "next/server";
import {
  checkAdminPassword,
  signAdminToken,
  isAdminRequest,
  adminCookieOptions,
  ADMIN_COOKIE,
} from "@/lib/admin-auth";

/** GET — lets the page ask "am I already unlocked?" without re-prompting. */
export async function GET(req: NextRequest) {
  return NextResponse.json({ authed: await isAdminRequest(req) });
}

/** POST — exchanges the admin password for an httpOnly session cookie. */
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    if (!(await checkAdminPassword(password))) {
      // Uniform message and status: no distinction between "missing" and
      // "wrong", nothing to probe.
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = await signAdminToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
    return res;
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** DELETE — clears the admin session. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", adminCookieOptions(0));
  return res;
}
