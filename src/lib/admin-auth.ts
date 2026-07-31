import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

/**
 * Admin panel gate.
 *
 * The password is a single shared secret with no per-operator identity, so the
 * panel is only as strong as that one string. Everything below exists to make
 * sure the string is at least checked *server-side*: the browser never sees it,
 * and every /api/admin/* route independently verifies the session cookie rather
 * than trusting the page's own "unlocked" state.
 *
 * Set ADMIN_PASSWORD in the environment to override the built-in default.
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "PokerAdmin2024";

const ADMIN_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "pokerstack-dev-secret-fallback"
);

export const ADMIN_COOKIE = "ps_admin";
const ADMIN_TTL_HOURS = 8;

/**
 * Length-independent constant-time compare.
 *
 * Hashing both sides first keeps the comparison over two equal-length digests,
 * so neither the timing nor the early return leaks the real password's length.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function checkAdminPassword(password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  return safeEqual(password, ADMIN_PASSWORD);
}

export async function signAdminToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_TTL_HOURS}h`)
    .sign(ADMIN_SECRET);
}

/** True when the request carries a valid, unexpired admin session cookie. */
export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, ADMIN_SECRET);
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export function adminCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAge ?? ADMIN_TTL_HOURS * 60 * 60,
  };
}
