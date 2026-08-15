/**
 * `/api/wallet/game-result` moves real money, so the default has to be the
 * safe one.
 *
 * Every table that calls this already accounts for a win in the player's chip
 * stack — buy-in on the way in, cash-out on the way out — so settling the hand
 * here as well pays it twice. The balance therefore moves only when a caller
 * explicitly asks, and these tests pin that default down: a request that
 * forgets the flag, or tries to smuggle it in as a string, must not touch it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const adjustBalance = vi.fn(async () => 50_000);
const getBalance = vi.fn(async () => 45_500);
const insertTransaction = vi.fn(async () => ({ id: 1 }));
// Typed with its real parameters so the assertion on the message can index
// into the recorded call.
const createNotification = vi.fn(
  async (_userId: number, _type: string, _message: string) => undefined,
);

vi.mock("@/lib/db", () => ({ adjustBalance, getBalance, insertTransaction }));
vi.mock("@/lib/notifications", () => ({
  createNotification,
  fmtUsd: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));
vi.mock("@/lib/auth", () => ({
  COOKIE_NAME: "ps_token",
  verifyToken: async () => ({ userId: 7, username: "kevin", email: "k@example.com" }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "a-valid-token" }) }),
}));

const { POST } = await import("../route");

/** The handler only ever reads `json()` off the request. */
function post(body: unknown): Promise<Response> {
  return POST({ json: async () => body } as unknown as NextRequest);
}

const WIN = { type: "win", amount: 2_000 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("game-result balance settlement", () => {
  it("does NOT move the balance when no flag is passed", async () => {
    const res = await post(WIN);

    expect(res.status).toBe(200);
    expect(adjustBalance).not.toHaveBeenCalled();
    // Nor does it write a money row for a move that never happened.
    expect(insertTransaction).not.toHaveBeenCalled();
  });

  it("still reports the real balance and notifies without moving money", async () => {
    const res = await post(WIN);
    const body = await res.json();

    expect(getBalance).toHaveBeenCalledWith(7);
    expect(body).toMatchObject({ ok: true, balance: 45_500, transaction: null });
    expect(createNotification).toHaveBeenCalledOnce();
    expect(String(createNotification.mock.calls[0][2])).toContain("$20.00");
  });

  it("moves the balance only on an explicit opt-in", async () => {
    const res = await post({ ...WIN, settleBalance: true });
    const body = await res.json();

    expect(adjustBalance).toHaveBeenCalledWith(7, 2_000);
    expect(insertTransaction).toHaveBeenCalledOnce();
    expect(body.balance).toBe(50_000);
    expect(body.transaction).not.toBeNull();
  });

  it("debits on a loss when settling", async () => {
    await post({ type: "loss", amount: 750, settleBalance: true });
    expect(adjustBalance).toHaveBeenCalledWith(7, -750);
  });

  it("treats a non-boolean flag as absent", async () => {
    // A truthy-looking `"true"` off a JSON body must not move money — only a
    // real boolean counts.
    for (const flag of ["true", 1, "yes", {}, [] as unknown]) {
      vi.clearAllMocks();
      await post({ ...WIN, settleBalance: flag });
      expect(adjustBalance, `flag ${JSON.stringify(flag)} moved the balance`).not.toHaveBeenCalled();
    }
  });

  it("rejects a bad type or amount before touching anything", async () => {
    for (const body of [
      { type: "bogus", amount: 100, settleBalance: true },
      { type: "win", amount: -5, settleBalance: true },
      { type: "win", amount: 0, settleBalance: true },
      { type: "win", amount: Number.NaN, settleBalance: true },
    ]) {
      vi.clearAllMocks();
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(adjustBalance).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    }
  });

  it("404s rather than reporting a null balance as zero", async () => {
    getBalance.mockResolvedValueOnce(null as unknown as number);

    const res = await post(WIN);

    expect(res.status).toBe(404);
    expect(adjustBalance).not.toHaveBeenCalled();
  });
});
