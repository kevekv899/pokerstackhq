import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "pokerstack-dev-secret-fallback"
);

const COOKIE_NAME = "ps_token";
const TOKEN_TTL_DAYS = 7;

/**
 * Lifetime of a game-server token. Minutes, not days: unlike the session
 * cookie this one is handed to page JavaScript so it can ride in a WebSocket
 * `auth` message, so it is scoped to just long enough to open a connection.
 */
const GAME_TOKEN_TTL = "5m";

export { COOKIE_NAME, GAME_TOKEN_TTL };

export interface TokenPayload {
  userId: number;
  username: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** A string expiry is a span added to now; a number would be an absolute time. */
async function sign(payload: TokenPayload, expiresIn: string): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return sign(payload, `${TOKEN_TTL_DAYS}d`);
}

/**
 * Mints a short-lived token for the game server's WebSocket handshake.
 *
 * Same secret, same algorithm and same claims as the session cookie — the game
 * server verifies it with the identical code path — but it expires in
 * {@link GAME_TOKEN_TTL} rather than a week, so a token lifted out of the page
 * is worth minutes instead of the whole session.
 */
export async function signGameToken(payload: TokenPayload): Promise<string> {
  return sign(payload, GAME_TOKEN_TTL);
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAge ?? TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}
