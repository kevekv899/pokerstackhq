/**
 * The data behind the win announcement.
 *
 * Split out from the table page so it can be tested without a DOM, and so the
 * overlay's *content* stays separate from its geometry — the page decides where
 * a winner's chips fly, this decides who won and what to say about it.
 *
 * Everything here is a snapshot of one server payload. It is read once, when
 * the payout arrives, because the live state moves on immediately afterwards:
 * an uncontested win goes PAYOUT -> WAITING -> next hand in a single tick.
 * Nothing here is ever a source of truth for the game.
 */

import type { HandResult, PublicTableState } from "@/lib/poker/types";

export interface WinnerLine {
  playerId: string;
  /** Already resolved to "You" for the viewer. */
  name: string;
  isViewer: boolean;
  amount: number;
  /** The hand they showed down, or null when the pot was uncontested. */
  hand: string | null;
  /** Seat they occupied when the hand was paid, or null if unknown. */
  seatIndex: number | null;
}

export interface WinAnnouncement {
  handId: number;
  winners: WinnerLine[];
  viewerWon: boolean;
  /** Both captured so chip targets survive a winner leaving mid-animation. */
  viewerSeatIndex: number | null;
  seatCount: number;
}

/**
 * Total chips each player takes from the hand, summed across side pots — one
 * player can win several, and the overlay shows a person once, not per pot.
 */
export function winningsByPlayer(result: HandResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const pot of result.pots) {
    for (const winner of pot.winners) {
      out.set(winner.playerId, (out.get(winner.playerId) ?? 0) + winner.amount);
    }
  }
  return out;
}

/** Freezes one payout payload into everything the overlay needs. */
export function buildAnnouncement(
  state: PublicTableState,
  result: HandResult,
): WinAnnouncement {
  const nameById = new Map<string, string>();
  const seatById = new Map<string, number>();
  let viewerSeatIndex: number | null = null;

  for (const seat of state.seats) {
    const player = seat.player;
    if (!player) continue;
    nameById.set(player.id, player.name);
    seatById.set(player.id, seat.index);
    if (player.isViewer) viewerSeatIndex = seat.index;
  }

  const winners: WinnerLine[] = [];
  for (const [playerId, amount] of winningsByPlayer(result)) {
    // A zero award is not a win worth announcing.
    if (amount <= 0) continue;
    const isViewer = playerId === state.viewerId;
    winners.push({
      playerId,
      name: isViewer ? "You" : (nameById.get(playerId) ?? "Player"),
      isViewer,
      amount,
      // `showdown` is null when everyone folded, which is exactly when there
      // is no hand to name.
      hand: result.showdown?.find((entry) => entry.playerId === playerId)?.hand.name ?? null,
      seatIndex: seatById.get(playerId) ?? null,
    });
  }

  // Biggest share first so a split pot reads top-down; ties broken by id to
  // keep the order stable between renders.
  winners.sort((a, b) => b.amount - a.amount || a.playerId.localeCompare(b.playerId));

  return {
    handId: result.handId,
    winners,
    viewerWon: winners.some((winner) => winner.isViewer),
    viewerSeatIndex,
    seatCount: state.seats.length,
  };
}

/** One-line summary of the same snapshot, for the chat feed. */
export function announcementSummary(announcement: WinAnnouncement): string {
  return announcement.winners
    .map((winner) => {
      const who = winner.isViewer ? "You win" : `${winner.name} wins`;
      const amount = `$${winner.amount.toLocaleString()}`;
      return winner.hand ? `${who} ${amount} with ${winner.hand}` : `${who} ${amount}`;
    })
    .join(" · ");
}
