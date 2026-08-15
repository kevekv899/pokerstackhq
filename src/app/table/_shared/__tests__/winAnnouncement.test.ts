/**
 * The announcement is what the player is *told* they won, so it has to agree
 * with what the server actually paid: every winner, their real share, and a
 * hand name only when there was a hand to show.
 */

import { describe, expect, it } from "vitest";

import { announcementSummary, buildAnnouncement, winningsByPlayer } from "../winAnnouncement";
import type { HandResult, PublicSeat, PublicTableState } from "@/lib/poker/types";

function seat(index: number, id: string | null, isViewer = false): PublicSeat {
  if (!id) return { index, player: null };
  return {
    index,
    player: {
      id,
      name: id === "hero" ? "Kevin" : `Player ${id.toUpperCase()}`,
      seatIndex: index,
      stack: 500,
      status: "ACTIVE",
      betThisRound: 0,
      totalCommitted: 0,
      hasCards: true,
      holeCards: null,
      isViewer,
    },
  };
}

function tableWith(seats: PublicSeat[], viewerId = "hero"): PublicTableState {
  return {
    tableId: 't', variant: 'HOLDEM', handId: 7, street: 'PAYOUT', buttonIndex: 0,
    smallBlind: 5, bigBlind: 10, board: [], seats,
    actingIndex: null, actingPlayerId: null, currentBet: 0, minRaise: 10,
    pots: [], totalPot: 0, history: [], result: null,
    viewerId, legalActions: null,
  };
}

/** One pot, one winner. */
function soloPot(playerId: string, amount: number): HandResult["pots"][number] {
  return {
    potIndex: 0,
    amount,
    eligiblePlayerIds: [playerId],
    winners: [{ playerId, amount }],
  };
}

const SEATS = [seat(0, "hero", true), seat(1, "a"), seat(2, "b")];

describe("buildAnnouncement", () => {
  it("announces the viewer's own win with the hand they showed down", () => {
    const result: HandResult = {
      handId: 7,
      wentToShowdown: true,
      pots: [soloPot("hero", 240)],
      payouts: { hero: 240 },
      showdown: [
        {
          playerId: "hero",
          holeCards: [],
          hand: { rank: 7, tiebreakers: [], name: "Full House, Kings over Nines", cards: [] },
        },
      ],
    };

    const a = buildAnnouncement(tableWith(SEATS), result);

    expect(a.viewerWon).toBe(true);
    expect(a.winners).toHaveLength(1);
    expect(a.winners[0]).toMatchObject({
      playerId: "hero",
      name: "You",
      isViewer: true,
      amount: 240,
      hand: "Full House, Kings over Nines",
      seatIndex: 0,
    });
  });

  it("names no hand when the pot was uncontested", () => {
    // Everyone folded, so `showdown` is null — there is nothing to name, and
    // inventing one would claim cards the player never showed.
    const result: HandResult = {
      handId: 7,
      wentToShowdown: false,
      pots: [soloPot("hero", 30)],
      payouts: { hero: 30 },
      showdown: null,
    };

    const a = buildAnnouncement(tableWith(SEATS), result);

    expect(a.winners[0].hand).toBeNull();
    expect(a.winners[0].amount).toBe(30);
    expect(announcementSummary(a)).toBe("You win $30");
  });

  it("reports someone else's win without claiming it for the viewer", () => {
    const result: HandResult = {
      handId: 7,
      wentToShowdown: false,
      pots: [soloPot("a", 85)],
      payouts: { a: 85 },
      showdown: null,
    };

    const a = buildAnnouncement(tableWith(SEATS), result);

    expect(a.viewerWon).toBe(false);
    expect(a.winners[0]).toMatchObject({ name: "Player A", isViewer: false, amount: 85 });
    expect(announcementSummary(a)).toBe("Player A wins $85");
  });

  it("lists every winner of a split pot, largest share first", () => {
    const result: HandResult = {
      handId: 7,
      wentToShowdown: true,
      pots: [
        {
          potIndex: 0,
          amount: 300,
          eligiblePlayerIds: ["hero", "a", "b"],
          winners: [
            { playerId: "a", amount: 100 },
            { playerId: "hero", amount: 150 },
            { playerId: "b", amount: 50 },
          ],
        },
      ],
      payouts: { hero: 150, a: 100, b: 50 },
      showdown: [
        { playerId: "hero", holeCards: [], hand: { rank: 5, tiebreakers: [], name: "Straight", cards: [] } },
        { playerId: "a", holeCards: [], hand: { rank: 5, tiebreakers: [], name: "Straight", cards: [] } },
        { playerId: "b", holeCards: [], hand: { rank: 5, tiebreakers: [], name: "Straight", cards: [] } },
      ],
    };

    const a = buildAnnouncement(tableWith(SEATS), result);

    expect(a.winners.map((w) => [w.name, w.amount])).toEqual([
      ["You", 150],
      ["Player A", 100],
      ["Player B", 50],
    ]);
    expect(a.viewerWon).toBe(true);
  });

  it("sums a player's share across side pots into one line", () => {
    // Winning the main and a side pot is one win to a player, not two.
    const result: HandResult = {
      handId: 7,
      wentToShowdown: true,
      pots: [
        { potIndex: 0, amount: 90, eligiblePlayerIds: ["hero", "a"], winners: [{ playerId: "hero", amount: 90 }] },
        { potIndex: 1, amount: 60, eligiblePlayerIds: ["hero"], winners: [{ playerId: "hero", amount: 60 }] },
      ],
      payouts: { hero: 150 },
      showdown: [
        { playerId: "hero", holeCards: [], hand: { rank: 2, tiebreakers: [], name: "One Pair", cards: [] } },
      ],
    };

    const a = buildAnnouncement(tableWith(SEATS), result);

    expect(a.winners).toHaveLength(1);
    expect(a.winners[0].amount).toBe(150);
  });

  it("still names a winner who has already left their seat", () => {
    // The overlay outlives the hand: by the time it is on screen the winner
    // may have been unseated, and it must not render "Player undefined".
    const seatsAfterLeaving = [seat(0, "hero", true), seat(1, null), seat(2, "b")];
    const result: HandResult = {
      handId: 7,
      wentToShowdown: false,
      pots: [soloPot("a", 40)],
      payouts: { a: 40 },
      showdown: null,
    };

    const a = buildAnnouncement(tableWith(seatsAfterLeaving), result);

    expect(a.winners[0].name).toBe("Player");
    expect(a.winners[0].seatIndex).toBeNull();
  });

  it("captures the viewer's seat so chips have somewhere to fly", () => {
    const a = buildAnnouncement(tableWith(SEATS), {
      handId: 7, wentToShowdown: false, pots: [soloPot("hero", 10)],
      payouts: { hero: 10 }, showdown: null,
    });

    expect(a.viewerSeatIndex).toBe(0);
    expect(a.seatCount).toBe(3);
  });

  it("ignores zero-value awards", () => {
    const result: HandResult = {
      handId: 7,
      wentToShowdown: false,
      pots: [{ potIndex: 0, amount: 0, eligiblePlayerIds: ["a"], winners: [{ playerId: "a", amount: 0 }] }],
      payouts: {},
      showdown: null,
    };

    expect(buildAnnouncement(tableWith(SEATS), result).winners).toEqual([]);
  });
});

describe("winningsByPlayer", () => {
  it("aggregates across pots", () => {
    const totals = winningsByPlayer({
      handId: 1,
      wentToShowdown: true,
      pots: [
        { potIndex: 0, amount: 50, eligiblePlayerIds: [], winners: [{ playerId: "x", amount: 30 }, { playerId: "y", amount: 20 }] },
        { potIndex: 1, amount: 15, eligiblePlayerIds: [], winners: [{ playerId: "x", amount: 15 }] },
      ],
      payouts: {},
      showdown: null,
    });

    expect(totals.get("x")).toBe(45);
    expect(totals.get("y")).toBe(20);
  });
});
