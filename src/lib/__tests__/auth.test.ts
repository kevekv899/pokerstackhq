/**
 * The game-server token is the one token this app hands to page JavaScript, so
 * its lifetime is the thing that limits the damage if it leaks. These tests pin
 * it to five minutes and prove the game server still accepts it — the whole
 * point of minting rather than echoing the session cookie.
 */

import { describe, expect, it, vi } from "vitest";

// `src/lib/auth.ts` reads JWT_SECRET once at module load, so it has to be set
// before the dynamic import below evaluates.
process.env.JWT_SECRET = "game-token-test-secret";

const { signGameToken, signToken, GAME_TOKEN_TTL } = await import("../auth");
const { encodeSecret, verifySessionToken } = await import("../../../server/auth.js");

const SECRET = encodeSecret(process.env.JWT_SECRET);

const FIVE_MINUTES = 5 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

const USER = { userId: 42, username: "kevin", email: "kevin@example.com" };

/** Reads the claims without verifying — we are asserting on `exp`/`iat` here. */
function claimsOf(token: string): Record<string, number | string> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("signGameToken", () => {
  it("expires in five minutes, not seven days", async () => {
    const claims = claimsOf(await signGameToken(USER));

    expect(typeof claims.iat).toBe("number");
    expect(typeof claims.exp).toBe("number");
    expect((claims.exp as number) - (claims.iat as number)).toBe(FIVE_MINUTES);
    expect(GAME_TOKEN_TTL).toBe("5m");
  });

  it("is dramatically shorter-lived than the session cookie", async () => {
    const game = claimsOf(await signGameToken(USER));
    const session = claimsOf(await signToken(USER));

    const gameSpan = (game.exp as number) - (game.iat as number);
    const sessionSpan = (session.exp as number) - (session.iat as number);

    expect(sessionSpan).toBe(SEVEN_DAYS);
    expect(gameSpan).toBeLessThan(sessionSpan);
    // Guards against a future edit quietly widening it back out.
    expect(gameSpan).toBeLessThanOrEqual(FIVE_MINUTES);
  });

  it("carries the same identity claims as the session token", async () => {
    const claims = claimsOf(await signGameToken(USER));

    expect(claims.userId).toBe(42);
    expect(claims.username).toBe("kevin");
    expect(claims.email).toBe("kevin@example.com");
  });

  it("is accepted by the game server's verifier unchanged", async () => {
    // The point of same-secret/same-claims: the server needed no change at all.
    const token = await signGameToken(USER);

    expect(await verifySessionToken(token, SECRET)).toEqual({ id: "42", name: "kevin" });
  });

  it("is still accepted just before the five minutes are up", async () => {
    const token = await signGameToken(USER);
    const expiry = (claimsOf(token).exp as number) * 1000;

    // Fake timers, not a Date.now stub: jose reads the clock via `new Date()`.
    vi.useFakeTimers();
    vi.setSystemTime(expiry - 2000);
    try {
      expect(await verifySessionToken(token, SECRET)).toEqual({ id: "42", name: "kevin" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is rejected by the game server once the five minutes are up", async () => {
    const token = await signGameToken(USER);
    const expiry = (claimsOf(token).exp as number) * 1000;

    // Step past the expiry rather than waiting five real minutes. A 7-day
    // token would sail straight through this.
    vi.useFakeTimers();
    vi.setSystemTime(expiry + 2000);
    try {
      expect(await verifySessionToken(token, SECRET)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
