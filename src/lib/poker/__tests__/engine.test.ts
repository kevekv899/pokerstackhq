import { describe, expect, it } from 'vitest';

import {
  applyAction,
  endHand,
  getLegalActions,
  settle,
  startHand,
  totalPot,
} from '../engine';
import { cardToString } from '../deck';
import { PokerError, type TableState } from '../types';
import { makeTable, postBlinds, playerOf, stackedDeck, stacksOf } from './fixtures';

/** Runs a hand to its conclusion and returns the settled `PAYOUT` state. */
const finish = (state: TableState): TableState =>
  state.street === 'SHOWDOWN' ? settle(state) : state;

describe('hand setup', () => {
  it('deals two cards to every dealt-in player and queues the blinds', () => {
    const state = startHand(makeTable([1000, 1000, 1000]));

    expect(state.street).toBe('PREFLOP');
    expect(state.handId).toBe(1);
    for (const seat of state.seats) {
      expect(seat.player?.holeCards).toHaveLength(2);
    }
    // 52 - 6 dealt
    expect(state.deck).toHaveLength(46);

    expect(state.pendingBlinds.map((b) => [b.playerId, b.kind, b.amount])).toEqual([
      ['p1', 'SMALL', 5],
      ['p2', 'BIG', 10],
    ]);
    expect(state.actingIndex).toBe(1);
  });

  it('refuses to deal with fewer than two players holding chips', () => {
    expect(() => startHand(makeTable([1000, 0]))).toThrow(PokerError);
    expect(() => startHand(makeTable([1000, 0]))).toThrow(/at least 2 players/);
  });

  it('will not deal a second hand on top of a live one', () => {
    const state = startHand(makeTable([1000, 1000]));
    expect(() => startHand(state)).toThrow(/Cannot start a hand from PREFLOP/);
  });

  it('rejects everything but POST_BLIND until the blinds are up', () => {
    const state = startHand(makeTable([1000, 1000, 1000]));
    expect(() => applyAction(state, { type: 'FOLD', playerId: 'p1' })).toThrow(
      /must post the blind first/,
    );
    expect(() => applyAction(state, { type: 'POST_BLIND', playerId: 'p2' })).toThrow(
      PokerError,
    );
  });

  it('puts the button on the small blind heads-up and gives it first action preflop', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000])));
    expect(playerOf(state, 'p0').betThisRound).toBe(5); // button posts the small blind
    expect(playerOf(state, 'p1').betThisRound).toBe(10);
    expect(state.actingIndex).toBe(0); // …and acts first
  });

  it('gives the button last action postflop heads-up', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000])));
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });

    expect(state.street).toBe('FLOP');
    expect(state.actingIndex).toBe(1); // the non-button acts first
  });
});

describe('purity', () => {
  it('never mutates the state passed in', () => {
    const before = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    const snapshot = JSON.stringify(before);

    const after = applyAction(before, { type: 'FOLD', playerId: 'p0' });

    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).not.toBe(before);
    expect(playerOf(before, 'p0').status).toBe('ACTIVE');
    expect(playerOf(after, 'p0').status).toBe('FOLDED');
  });

  it('throws before touching anything when the action is illegal', () => {
    const before = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    const snapshot = JSON.stringify(before);

    expect(() => applyAction(before, { type: 'CHECK', playerId: 'p1' })).toThrow(PokerError);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('action legality', () => {
  it('rejects actions out of turn', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    expect(state.actingIndex).toBe(0);
    try {
      applyAction(state, { type: 'CALL', playerId: 'p1' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PokerError);
      expect((error as PokerError).code).toBe('NOT_YOUR_TURN');
    }
  });

  it('will not let a player check into a bet', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    expect(() => applyAction(state, { type: 'CHECK', playerId: 'p0' })).toThrow(
      /Cannot check facing a bet/,
    );
  });

  it('enforces the minimum opening bet postflop', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000])));
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });

    expect(state.street).toBe('FLOP');
    try {
      applyAction(state, { type: 'BET', playerId: 'p1', amount: 4 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PokerError).code).toBe('BELOW_MIN_BET');
    }
    expect(() => applyAction(state, { type: 'BET', playerId: 'p1', amount: 10 })).not.toThrow();
  });

  it('enforces the minimum raise', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    // Preflop the minimum open raise is one big blind on top of the blind.
    expect(() => applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 19 })).toThrow(
      /Minimum raise is to 20/,
    );
    expect(() => applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 20 })).not.toThrow();

    // After a raise to 40, the next raise has to be to at least 70.
    state = applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 40 });
    expect(state.minRaise).toBe(30);
    expect(() => applyAction(state, { type: 'RAISE', playerId: 'p1', amount: 60 })).toThrow(
      /Minimum raise is to 70/,
    );
    expect(() => applyAction(state, { type: 'RAISE', playerId: 'p1', amount: 70 })).not.toThrow();
  });

  it('rejects a bet or raise larger than the stack', () => {
    const state = postBlinds(startHand(makeTable([100, 1000, 1000])));
    try {
      applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 500 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PokerError).code).toBe('INSUFFICIENT_CHIPS');
    }
  });

  it('requires BET rather than RAISE when there is nothing to call', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000])));
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });

    expect(() => applyAction(state, { type: 'RAISE', playerId: 'p1', amount: 50 })).toThrow(
      /Nothing to raise/,
    );
    expect(() => applyAction(state, { type: 'BET', playerId: 'p1', amount: 50 })).not.toThrow();
  });
});

describe('the big blind option', () => {
  it('lets the big blind raise after everyone limps', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });

    // Action is back on the big blind even though they already have 10 in.
    expect(state.actingIndex).toBe(2);
    const options = getLegalActions(state, 'p2');
    expect(options?.canCheck).toBe(true);
    expect(options?.canRaise).toBe(true);
    expect(options?.minRaiseTo).toBe(20);

    state = applyAction(state, { type: 'CHECK', playerId: 'p2' });
    expect(state.street).toBe('FLOP');
    expect(totalPot(state)).toBe(30);
  });
});

describe('short all-in does not reopen the betting', () => {
  it('locks out a raise from players who already acted', () => {
    // p2 is short: they can only push 130 into a bet of 100.
    let state = postBlinds(startHand(makeTable([1000, 1000, 130])));

    state = applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 100 });
    expect(state.minRaise).toBe(90);
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });

    state = applyAction(state, { type: 'ALL_IN', playerId: 'p2' });
    expect(playerOf(state, 'p2').status).toBe('ALL_IN');
    // The bet to call went up…
    expect(state.currentBet).toBe(130);
    // …but 130 is short of the 190 a full raise needed, so the minimum raise
    // increment is untouched and nobody's action is reopened.
    expect(state.minRaise).toBe(90);

    expect(state.actingIndex).toBe(0);
    const options = getLegalActions(state, 'p0');
    expect(options?.canRaise).toBe(false);
    expect(options?.canCall).toBe(true);
    expect(options?.callAmount).toBe(30);

    try {
      applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 300 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PokerError).code).toBe('BETTING_NOT_REOPENED');
    }

    // Calling and folding are still available, and the round closes normally.
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    expect(getLegalActions(state, 'p1')?.canRaise).toBe(false);
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });

    expect(state.street).toBe('FLOP');
    expect(totalPot(state)).toBe(390);
  });

  it('still lets a player who has not acted yet raise over a short all-in', () => {
    // p1 (the small blind) is the short stack; p2 has not acted when they push.
    let state = postBlinds(startHand(makeTable([1000, 130, 1000, 1000])));

    state = applyAction(state, { type: 'RAISE', playerId: 'p3', amount: 100 });
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p1' });

    expect(state.currentBet).toBe(130);
    expect(state.minRaise).toBe(90);

    // p2 posted the big blind but has not acted, so their option is intact.
    expect(state.actingIndex).toBe(2);
    const options = getLegalActions(state, 'p2');
    expect(options?.canRaise).toBe(true);
    expect(options?.minRaiseTo).toBe(220);

    state = applyAction(state, { type: 'RAISE', playerId: 'p2', amount: 320 });
    // A full raise reopens the action for everyone still in.
    expect(state.minRaise).toBe(190);
    expect(getLegalActions(state, 'p3')?.canRaise).toBe(true);
  });

  it('a full all-in raise does reopen the betting', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000, 300])));

    state = applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 100 });
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });
    // 300 clears the 190 threshold, so this is a full raise.
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p2' });

    expect(state.currentBet).toBe(300);
    expect(state.minRaise).toBe(200);
    expect(getLegalActions(state, 'p0')?.canRaise).toBe(true);
  });
});

describe('everyone folds to the big blind', () => {
  it('awards the pot uncontested with no showdown', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000])));

    state = applyAction(state, { type: 'FOLD', playerId: 'p0' });
    state = applyAction(state, { type: 'FOLD', playerId: 'p1' });

    expect(state.street).toBe('PAYOUT');
    expect(state.result?.wentToShowdown).toBe(false);
    expect(state.result?.showdown).toBeNull();
    expect(state.board).toHaveLength(0);
    expect(state.actingIndex).toBeNull();

    // The big blind's uncalled 5 comes back, then they take the 10-chip pot.
    expect(state.result?.pots).toEqual([
      { potIndex: 0, amount: 10, eligiblePlayerIds: ['p2'], winners: [{ playerId: 'p2', amount: 10 }] },
    ]);
    expect(state.result?.payouts).toEqual({ p2: 10 });
    expect(stacksOf(state)).toEqual({ p0: 1000, p1: 995, p2: 1005 });

    // Nobody's cards were shown.
    for (const seat of state.seats) {
      expect(seat.player?.revealed).toBe(false);
    }
  });

  it('moves the button and resets for the next hand', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    state = applyAction(state, { type: 'FOLD', playerId: 'p0' });
    state = applyAction(state, { type: 'FOLD', playerId: 'p1' });

    state = endHand(state);
    expect(state.street).toBe('WAITING');
    expect(state.buttonIndex).toBe(1);
    for (const seat of state.seats) {
      expect(seat.player?.holeCards).toEqual([]);
      expect(seat.player?.totalCommitted).toBe(0);
      expect(seat.player?.status).toBe('ACTIVE');
    }

    state = startHand(state);
    expect(state.handId).toBe(2);
    expect(state.pendingBlinds.map((b) => b.playerId)).toEqual(['p2', 'p0']);
  });

  it('sits out anyone who busted', () => {
    // p0 is all-in preflop and loses; p1 has them covered.
    const deck = stackedDeck(
      // Dealing order heads-up is p1 first, then p0 (the button).
      [['As', 'Ad'], ['2c', '7d']],
      ['Ah', 'Kd', 'Qc', '9s', '4h'],
    );
    let state = postBlinds(startHand(makeTable([100, 1000]), { deck }));
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p0' });
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });
    state = endHand(finish(state));

    expect(playerOf(state, 'p0').stack).toBe(0);
    expect(playerOf(state, 'p0').status).toBe('SITTING_OUT');
    expect(() => startHand(state)).toThrow(/at least 2 players/);
  });
});

describe('split pots', () => {
  it('chops evenly between identical hands', () => {
    // Both players end up playing the board.
    const deck = stackedDeck(
      [['4h', '5s'], ['2c', '3d']], // heads-up dealing order: p1, then p0
      ['As', 'Ks', 'Qd', 'Jh', 'Tc'],
    );
    let state = postBlinds(startHand(makeTable([1000, 1000]), { deck }));

    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });
    for (const street of ['FLOP', 'TURN', 'RIVER'] as const) {
      expect(state.street).toBe(street);
      state = applyAction(state, { type: 'CHECK', playerId: 'p1' });
      state = applyAction(state, { type: 'CHECK', playerId: 'p0' });
    }

    expect(state.street).toBe('SHOWDOWN');
    expect(state.result?.wentToShowdown).toBe(true);
    expect(state.result?.showdown?.map((entry) => entry.hand.name)).toEqual([
      'Straight',
      'Straight',
    ]);
    expect(state.result?.pots[0].amount).toBe(20);
    expect(state.result?.pots[0].winners).toHaveLength(2);
    expect(state.result?.payouts).toEqual({ p0: 10, p1: 10 });

    state = settle(state);
    expect(state.street).toBe('PAYOUT');
    expect(stacksOf(state)).toEqual({ p0: 1000, p1: 1000 });
  });

  it('gives the odd chip to the first player left of the button', () => {
    // p1 folds their small blind, which makes the pot odd; p0 and p2 chop it.
    const deck = stackedDeck(
      [['6c', '7d'], ['4h', '5s'], ['2c', '3d']], // dealing order: p1, p2, p0
      ['As', 'Ks', 'Qd', 'Jh', 'Tc'],
    );
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000]), { deck }));

    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'FOLD', playerId: 'p1' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p2' });
    for (const street of ['FLOP', 'TURN', 'RIVER'] as const) {
      expect(state.street).toBe(street);
      state = applyAction(state, { type: 'CHECK', playerId: 'p2' });
      state = applyAction(state, { type: 'CHECK', playerId: 'p0' });
    }

    expect(state.street).toBe('SHOWDOWN');
    // 10 (p0) + 5 (p1, folded) + 10 (p2) = 25 — it will not divide in two.
    expect(state.result?.pots).toHaveLength(1);
    expect(state.result?.pots[0].amount).toBe(25);
    // The button is on seat 0, so seat 1 is first in line — and seat 1 folded,
    // which puts seat 2 (p2) ahead of p0 for the leftover chip.
    expect(state.result?.pots[0].winners).toEqual([
      { playerId: 'p2', amount: 13 },
      { playerId: 'p0', amount: 12 },
    ]);

    state = settle(state);
    expect(stacksOf(state)).toEqual({ p0: 1002, p1: 995, p2: 1003 });
  });
});

describe('side pots', () => {
  it('builds three pots from a three-way all-in with three different stacks', () => {
    // Stacks 100 / 200 / 300, with a fourth player covering the biggest.
    // Board: 2c 7d 9h Js 4s — everyone flops a set, in descending order.
    const deck = stackedDeck(
      [
        ['9s', '9d'], // p1 — trip nines
        ['7s', '7h'], // p2 — trip sevens
        ['2h', '2d'], // p3 — trip twos
        ['Jh', 'Jd'], // p0 — trip jacks, the winner
      ],
      ['2c', '7d', '9h', 'Js', '4s'],
    );
    let state = postBlinds(startHand(makeTable([100, 200, 300, 300]), { deck }));

    state = applyAction(state, { type: 'ALL_IN', playerId: 'p3' });
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p0' });
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p1' });
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p2' });

    expect(state.street).toBe('SHOWDOWN');
    expect(state.board).toHaveLength(5);
    expect(state.board.map(cardToString)).toEqual(['2c', '7d', '9h', 'Js', '4s']);

    expect(state.pots).toEqual([
      // 100 apiece from all four.
      { amount: 400, eligiblePlayerIds: ['p0', 'p1', 'p2', 'p3'] },
      // p0 was tapped out at 100, so they cannot reach this one.
      { amount: 300, eligiblePlayerIds: ['p1', 'p2', 'p3'] },
      // Only the two 300-chip stacks got this high.
      { amount: 200, eligiblePlayerIds: ['p2', 'p3'] },
    ]);

    // Main pot to the best hand overall, then each side pot to the best hand
    // among the players who could reach it.
    expect(state.result?.payouts).toEqual({ p0: 400, p1: 300, p2: 200 });

    state = settle(state);
    expect(stacksOf(state)).toEqual({ p0: 400, p1: 300, p2: 200, p3: 0 });
    // Chips are conserved.
    expect(Object.values(stacksOf(state)).reduce((a, b) => a + b, 0)).toBe(900);
  });

  it('returns the uncalled portion of an over-bet', () => {
    // p0 has p1 covered; p1 can only call for 200 of p0's 500 push.
    const deck = stackedDeck(
      [['2c', '7d'], ['As', 'Ad']],
      ['Ah', 'Kd', 'Qc', '9s', '4h'],
    );
    let state = postBlinds(startHand(makeTable([1000, 200]), { deck }));

    state = applyAction(state, { type: 'RAISE', playerId: 'p0', amount: 500 });
    state = applyAction(state, { type: 'ALL_IN', playerId: 'p1' });

    expect(state.street).toBe('SHOWDOWN');
    // Only 200 apiece is live; p0's other 300 was handed straight back.
    expect(state.pots).toEqual([{ amount: 400, eligiblePlayerIds: ['p0', 'p1'] }]);
    expect(playerOf(state, 'p0').totalCommitted).toBe(200);
    expect(playerOf(state, 'p0').stack).toBe(800);

    state = settle(state);
    // p0's trip aces beat p1's ace high.
    expect(stacksOf(state)).toEqual({ p0: 1200, p1: 0 });
  });

  it('runs the board out when everyone left is all-in', () => {
    const deck = stackedDeck(
      [['2c', '7d'], ['As', 'Ad']],
      ['Ah', 'Kd', 'Qc', '9s', '4h'],
    );
    let state = postBlinds(startHand(makeTable([200, 200]), { deck }));

    state = applyAction(state, { type: 'ALL_IN', playerId: 'p0' });
    expect(state.street).toBe('PREFLOP');
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });

    // No further action is possible, so the engine deals straight to the river.
    expect(state.street).toBe('SHOWDOWN');
    expect(state.board.map(cardToString)).toEqual(['Ah', 'Kd', 'Qc', '9s', '4h']);
    expect(state.actingIndex).toBeNull();
  });
});

describe('street progression', () => {
  it('walks WAITING -> PREFLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN -> PAYOUT -> WAITING', () => {
    // Dealing order heads-up is p1 first, then p0: p1 gets the aces.
    const deck = stackedDeck(
      [['As', 'Ad'], ['4h', '5s']],
      ['2c', '7d', '9h', 'Js', '3c'],
    );
    let state = makeTable([1000, 1000]);
    expect(state.street).toBe('WAITING');

    state = postBlinds(startHand(state, { deck }));
    expect(state.street).toBe('PREFLOP');
    expect(state.board).toHaveLength(0);

    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });
    expect(state.street).toBe('FLOP');
    expect(state.board).toHaveLength(3);
    // Betting resets between streets.
    expect(state.currentBet).toBe(0);
    expect(state.minRaise).toBe(10);
    expect(totalPot(state)).toBe(20);

    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p0' });
    expect(state.street).toBe('TURN');
    expect(state.board).toHaveLength(4);

    state = applyAction(state, { type: 'BET', playerId: 'p1', amount: 50 });
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    expect(state.street).toBe('RIVER');
    expect(state.board).toHaveLength(5);
    expect(totalPot(state)).toBe(120);

    state = applyAction(state, { type: 'CHECK', playerId: 'p1' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p0' });
    expect(state.street).toBe('SHOWDOWN');

    state = settle(state);
    expect(state.street).toBe('PAYOUT');
    // p1's aces beat p0's nothing.
    expect(stacksOf(state)).toEqual({ p0: 940, p1: 1060 });

    state = endHand(state);
    expect(state.street).toBe('WAITING');
  });

  it('refuses to settle or end a hand out of order', () => {
    const state = postBlinds(startHand(makeTable([1000, 1000])));
    expect(() => settle(state)).toThrow(/requires SHOWDOWN/);
    expect(() => endHand(state)).toThrow(/requires PAYOUT/);
  });

  it('ends the hand immediately when everyone folds on a later street', () => {
    let state = postBlinds(startHand(makeTable([1000, 1000, 1000])));
    state = applyAction(state, { type: 'CALL', playerId: 'p0' });
    state = applyAction(state, { type: 'CALL', playerId: 'p1' });
    state = applyAction(state, { type: 'CHECK', playerId: 'p2' });

    expect(state.street).toBe('FLOP');
    state = applyAction(state, { type: 'BET', playerId: 'p1', amount: 60 });
    state = applyAction(state, { type: 'FOLD', playerId: 'p2' });
    state = applyAction(state, { type: 'FOLD', playerId: 'p0' });

    expect(state.street).toBe('PAYOUT');
    expect(state.result?.wentToShowdown).toBe(false);
    // p1 gets their uncalled 60 back and takes the 30-chip preflop pot.
    expect(stacksOf(state)).toEqual({ p0: 990, p1: 1020, p2: 990 });
  });
});

describe('determinism', () => {
  it('replays the same hand from the same seed', () => {
    const table = makeTable([1000, 1000, 1000]);
    const a = startHand(table, { seed: 'replay-me' });
    const b = startHand(table, { seed: 'replay-me' });
    const c = startHand(table, { seed: 'something-else' });

    const holes = (state: TableState) =>
      state.seats.map((s) => s.player?.holeCards.map(cardToString));

    expect(holes(a)).toEqual(holes(b));
    expect(holes(a)).not.toEqual(holes(c));
    expect(a.rng.handSeed).toBe('replay-me');
  });

  it('derives a per-hand seed from a table seed', () => {
    const table = makeTable([1000, 1000]);
    table.rng.seed = 'table-seed';

    const first = startHand(table);
    expect(first.rng.handSeed).toBe('table-seed#1');
  });
});
