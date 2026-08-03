import { applyAction, createTable } from '../engine';
import { cardToString, createDeck, parseCard } from '../deck';
import type { Card, TableState } from '../types';

export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;

/**
 * Builds a table with `stacks.length` seats, one player per seat
 * (`p0`, `p1`, …), button on seat 0 unless told otherwise.
 */
export function makeTable(stacks: number[], buttonIndex = 0): TableState {
  return createTable({
    tableId: 'test-table',
    seatCount: stacks.length,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    buttonIndex,
    players: stacks.map((stack, index) => ({
      seatIndex: index,
      id: `p${index}`,
      name: `Player ${index}`,
      stack,
    })),
  });
}

/**
 * Arranges a deck so that the players receive exactly `hands` and the board
 * runs out as `board`.
 *
 * `hands` is in *dealing* order — the first entry goes to the first seat left
 * of the button, not to seat 0. Burn cards and the remaining stub are filled
 * in from whatever is left of a fresh deck.
 */
export function stackedDeck(hands: string[][], board: string[] = []): Card[] {
  const used = new Set<string>();
  const take = (text: string): Card => {
    const card = parseCard(text);
    used.add(cardToString(card));
    return card;
  };

  const holes = hands.map((hand) => hand.map(take));
  const boardCards = board.map(take);
  const stub = createDeck().filter((card) => !used.has(cardToString(card)));

  let stubIndex = 0;
  const burn = (): Card => stub[stubIndex++];

  const deck: Card[] = [];
  for (let round = 0; round < 2; round += 1) {
    for (const hand of holes) deck.push(hand[round]);
  }
  if (boardCards.length >= 3) deck.push(burn(), boardCards[0], boardCards[1], boardCards[2]);
  if (boardCards.length >= 4) deck.push(burn(), boardCards[3]);
  if (boardCards.length >= 5) deck.push(burn(), boardCards[4]);
  deck.push(...stub.slice(stubIndex));

  return deck;
}

/** Posts every outstanding blind, in order. */
export function postBlinds(state: TableState): TableState {
  let next = state;
  while (next.pendingBlinds.length > 0) {
    const blind = next.pendingBlinds[0];
    next = applyAction(next, { type: 'POST_BLIND', playerId: blind.playerId });
  }
  return next;
}

/** Looks a player up by id. Throws if they are not seated. */
export function playerOf(state: TableState, id: string) {
  const player = state.seats.find((seat) => seat.player?.id === id)?.player;
  if (!player) throw new Error(`No player ${id}`);
  return player;
}

/** Convenience: chips currently in front of every player, keyed by id. */
export function stacksOf(state: TableState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const seat of state.seats) {
    if (seat.player) out[seat.player.id] = seat.player.stack;
  }
  return out;
}
