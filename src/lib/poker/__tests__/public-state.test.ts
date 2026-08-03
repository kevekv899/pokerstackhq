import { describe, expect, it } from 'vitest';

import { applyAction, settle, startHand, toPublicState } from '../engine';
import { cardToString } from '../deck';
import type { PublicTableState, TableState } from '../types';
import { makeTable, postBlinds, stackedDeck } from './fixtures';

const holeCardsSeenBy = (view: PublicTableState, playerId: string) =>
  view.seats.find((seat) => seat.player?.id === playerId)?.player?.holeCards;

describe('toPublicState', () => {
  it('never carries the deck, the burn pile or the RNG seed', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000, 1000]), { seed: 'leak-check' }));
    const view = toPublicState(state, 'p0');

    expect(view).not.toHaveProperty('deck');
    expect(view).not.toHaveProperty('burned');
    expect(view).not.toHaveProperty('rng');

    // Belt and braces: nothing in the serialised payload mentions the seed,
    // and no undealt card appears anywhere in it however deeply nested.
    expect(JSON.stringify(view)).not.toContain('leak-check');
    const undealt = new Set(state.deck.map(cardToString));
    expect(collectCards(view).filter((card) => undealt.has(card))).toEqual([]);
  });

  it("shows the viewer their own cards and no one else's", () => {
    const state = postBlinds(startHand(makeTable([1000, 1000, 1000])));

    const asP0 = toPublicState(state, 'p0');
    expect(holeCardsSeenBy(asP0, 'p0')).toHaveLength(2);
    expect(holeCardsSeenBy(asP0, 'p1')).toBeNull();
    expect(holeCardsSeenBy(asP0, 'p2')).toBeNull();

    const asP1 = toPublicState(state, 'p1');
    expect(holeCardsSeenBy(asP1, 'p1')).toHaveLength(2);
    expect(holeCardsSeenBy(asP1, 'p0')).toBeNull();

    // The two views disagree about exactly one thing: whose cards are visible.
    expect(holeCardsSeenBy(asP0, 'p0')).not.toEqual(holeCardsSeenBy(asP1, 'p1'));
  });

  it('still hides opponents from an observer who is not seated', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000])));
    const view = toPublicState(state, 'railbird');

    for (const seat of view.seats) {
      expect(seat.player?.holeCards).toBeNull();
      expect(seat.player?.hasCards).toBe(true);
      expect(seat.player?.isViewer).toBe(false);
    }
    expect(view.legalActions).toBeNull();
  });

  it("reveals showdown hands, but never a folded player's", () => {
    // p1 folds; p0 and p2 go to showdown.
    const deck = stackedDeck(
      [['6c', '7d'], ['4h', '5s'], ['Ac', 'Ad']], // dealing order: p1, p2, p0
      ['As', 'Ks', 'Qd', 'Jh', '3c'],
    );
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000]), { deck }));

    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'FOLD', playerId: 'p1' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p2' });
    for (let i = 0; i < 3; i += 1) {
      state = applyAction(state, { type: 'CHECK', playerId: 'p2' });
      state = applyAction(state, { type: 'CHECK', playerId: 'p0' });
    }
    expect(state.street).toBe('SHOWDOWN');

    const view = toPublicState(settle(state), 'p1');
    expect(holeCardsSeenBy(view, 'p0')?.map(cardToString)).toEqual(['Ac', 'Ad']);
    expect(holeCardsSeenBy(view, 'p2')?.map(cardToString)).toEqual(['4h', '5s']);
    // p1 is the viewer here, so they see their own mucked cards — but an
    // opponent must not.
    const opponentView = toPublicState(settle(state), 'p0');
    expect(holeCardsSeenBy(opponentView, 'p1')).toBeNull();
  });

  it('only offers legal actions to the player whose turn it is', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    expect(state.actingIndex).toBe(0);

    const acting = toPublicState(state, 'p0').legalActions;
    expect(acting).not.toBeNull();
    expect(acting?.canFold).toBe(true);
    expect(acting?.canCheck).toBe(false);
    expect(acting?.canCall).toBe(true);
    expect(acting?.callAmount).toBe(10);
    expect(acting?.canBet).toBe(false);
    expect(acting?.canRaise).toBe(true);
    expect(acting?.minRaiseTo).toBe(20);
    expect(acting?.maxRaiseTo).toBe(1000);

    expect(toPublicState(state, 'p1').legalActions).toBeNull();
  });

  it('offers POST_BLIND while a blind is outstanding', () => {
    const state = startHand(makeTable([1000, 1000, 1000]));
    const view = toPublicState(state, 'p1');

    expect(view.legalActions?.canPostBlind).toBe(true);
    expect(view.legalActions?.blindAmount).toBe(5);
    expect(view.legalActions?.canFold).toBe(false);
    expect(toPublicState(state, 'p2').legalActions).toBeNull();
  });

  it('reports the pot including chips still out in front of players', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    expect(toPublicState(state, 'p0').totalPot).toBe(15);
  });
});

/** Every card mentioned anywhere in a public view, as `"As"`-style strings. */
function collectCards(view: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (typeof record.rank === 'string' && typeof record.suit === 'string') {
        found.push(`${record.rank}${record.suit}`);
        return;
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(view);
  return found;
}

/** Sanity check that the helper above actually finds cards. */
describe('collectCards helper', () => {
  it('walks nested structures', () => {
    const state: TableState = postBlinds(startHand(makeTable([1000, 1000])));
    expect(collectCards(toPublicState(state, 'p0')).length).toBe(2);
  });
});
