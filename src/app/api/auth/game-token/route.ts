import { NextRequest, NextResponse } from "next/server";
import { verifyToken, signGameToken, COOKIE_NAME } from "@/lib/auth";

/**
 * Issues a short-lived token for the game server's WebSocket handshake.
 *
 * The game server authenticates over a WebSocket, which cannot carry the
 * httpOnly session cookie, so the client has to send a token in the `auth`
 * message itself (see `src/lib/useGameSocket.ts`). That means putting one
 * somewhere page JavaScript can read it — which is exactly what httpOnly was
 * preventing.
 *
 * So this mints a *new* token rather than handing back `ps_token`: same secret,
 * same algorithm and same claims, so the server verifies it identically, but
 * valid for five minutes instead of a week. If one is lifted out of the page it
 * buys minutes, not the whole session. The session cookie itself never leaves
 * the server.
 *
 * The hook fetches a fresh one on every connect and reconnect, so the short
 * lifetime costs nothing — auth happens once per socket, at open.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const payload = await verifyToken(cookie);
  if (!payload) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Rebuilt claim by claim rather than spread, so no timestamps or stray
  // claims from the session cookie ride along into the new token.
  const token = await signGameToken({
    userId: payload.userId,
    username: payload.username,
    email: payload.email,
  });

  return NextResponse.json(
    { token },
    // Never let a shared cache or the browser's bfcache hold a token.
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
