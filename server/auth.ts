/**
 * Session token verification for the WebSocket handshake.
 *
 * The Next.js app signs its own `ps_token` cookie (see `src/lib/auth.ts`) —
 * HS256 over `TextEncoder().encode(process.env.JWT_SECRET)`, carrying
 * `{ userId, username, email }`. This module verifies exactly that, so the two
 * halves of the app share one identity and one secret.
 *
 * SECURITY: this is the real gate on a connection. The origin check in
 * `origin.ts` is a convenience filter that any non-browser client can spoof;
 * this one runs unconditionally and there is no path around it.
 */

import { jwtVerify } from 'jose';

export interface GameIdentity {
  /**
   * The engine keys players by string, while the app mints a numeric `userId`.
   * Normalised here so one player is one id everywhere downstream.
   */
  id: string;
  name: string;
}

/** Turns the raw secret into the key material `src/lib/auth.ts` signs with. */
export function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Returns the identity carried by a valid `ps_token`, or null for anything
 * else — wrong signature, expired, malformed, or missing a usable `userId`.
 * Callers treat null as "close the socket"; it never throws.
 */
export async function verifySessionToken(
  token: unknown,
  secret: Uint8Array,
): Promise<GameIdentity | null> {
  if (typeof token !== 'string' || token.length === 0) return null;

  try {
    // `jwtVerify` enforces `exp` itself. Pinning the algorithm keeps a token
    // from talking us into verifying it a different (weaker) way.
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    const rawId = payload.userId;
    if (typeof rawId !== 'number' && typeof rawId !== 'string') return null;
    if (typeof rawId === 'number' && !Number.isFinite(rawId)) return null;

    const id = String(rawId).trim();
    if (id.length === 0) return null;

    const name = typeof payload.username === 'string' && payload.username.length > 0
      ? payload.username
      : id;

    return { id, name };
  } catch {
    // An invalid or expired token is routine, not an incident — no logging.
    return null;
  }
}
