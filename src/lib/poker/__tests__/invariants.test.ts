import { describe, expect, it } from 'vitest';

import { seededRandomSource, type RandomSource } from '../deck';
import { applyAction, endHand, getLegalActions, settle, startHand } from '../engine';
import { potTotal } from '../pot';
import type { Action, TableState } from '../types';
import { makeTable, stacksOf } from './fixtures';

/** Picks a uniformly random legal action for whoever is to act. */
function randomAction(state: TableState, rand: RandomSource): Action {
  const blind = state.pendingBlinds[0];
  if (blind) return { type: 'POST_BLIND', playerId: blind.playerId };

  const acting = state.seats[state.actingIndex as number].player;
  if (!acting) throw new Error('nobody to act');
  const legal = getLegalActions(state, acting.id);
  if (!legal) throw new Error(`no legal actions for ${acting.id}`);

  const playerId = acting.id;
  const options: Action[] = [];
  if (legal.canFold) options.push({ type: 'FOLD', playerId });
  if (legal.canCheck) options.push({ type: 'CHECK', playerId });
  if (legal.canCall) options.push({ type: 'CALL', playerId });
  if (legal.canAllIn) options.push({ type: 'ALL_IN', playerId });

  // Anything from the minimum legal size up to the whole stack is fair game.
  if (legal.canBet) {
    const span = legal.maxRaiseTo - legal.minBet + 1;
    options.push({ type: 'BET', playerId, amount: legal.minBet + rand(span) });
  }
  if (legal.canRaise) {
    const span = legal.maxRaiseTo - legal.minRaiseTo + 1;
    options.push({ type: 'RAISE', playerId, amount: legal.minRaiseTo + rand(span) });
  }

  return options[rand(options.length)];
}

/** Plays one hand out with random legal actions, returning the PAYOUT state. */
function playHand(state: TableState, rand: RandomSource, seed: string): TableState {
  let current = startHand(state, { seed });
  for (let step = 0; current.street !== 'PAYOUT'; step += 1) {
    expect(step).toBeLessThan(400); // the hand must terminate
    if (current.street === 'SHOWDOWN') {
      current = settle(current);
      break;
    }
    current = applyAction(current, randomAction(current, rand));
  }
  return current;
}

const chipsInPlay = (state: TableState) =>
  Object.values(stacksOf(state)).reduce((sum, stack) => sum + stack, 0);

describe('random play invariants', () => {
  for (const seatCount of [2, 3, 4, 6]) {
    it(`conserves chips and always terminates with ${seatCount} players`, () => {
      const rand = seededRandomSource(`fuzz-${seatCount}`);
      // Uneven stacks, so side pots come up often.
      const stacks = Array.from({ length: seatCount }, (_, i) => 2000 + i * 137);
      let table = makeTable(stacks);
      const startingChips = chipsInPlay(table);

      let handsPlayed = 0;
      for (let hand = 0; hand < 60; hand += 1) {
        const withChips = table.seats.filter((s) => (s.player?.stack ?? 0) > 0).length;
        if (withChips < 2) break;

        const settled = playHand(table, rand, `fuzz-${seatCount}-${hand}`);
        handsPlayed += 1;

        // Nobody ends up owing chips, and none appear from nowhere.
        for (const seat of settled.seats) {
          expect(seat.player?.stack).toBeGreaterThanOrEqual(0);
        }
        expect(chipsInPlay(settled)).toBe(startingChips);

        // Every chip that went into a pot came back out of one.
        const result = settled.result;
        expect(result).not.toBeNull();
        const paid = Object.values(result?.payouts ?? {}).reduce((a, b) => a + b, 0);
        expect(paid).toBe(potTotal(settled.pots));

        const committed = settled.seats.reduce(
          (sum, seat) => sum + (seat.player?.totalCommitted ?? 0),
          0,
        );
        expect(potTotal(settled.pots)).toBe(committed);

        // A hand that got to showdown reveals exactly the players still in it.
        if (result?.wentToShowdown) {
          const contenders = settled.seats.filter(
            (s) => s.player?.status === 'ACTIVE' || s.player?.status === 'ALL_IN',
          );
          expect(result.showdown).toHaveLength(contenders.length);
          expect(settled.board).toHaveLength(5);
        } else {
          expect(result?.showdown).toBeNull();
        }

        table = endHand(settled);
        expect(table.street).toBe('WAITING');
      }

      // Random play busts people quickly, so this floor is deliberately low —
      // it only proves the WAITING -> … -> WAITING loop actually round-trips.
      expect(handsPlayed).toBeGreaterThan(1);
    });
  }

  it('only ever ends a hand with one contender left or a full board', () => {
    const rand = seededRandomSource('board-check');
    let table = makeTable([500, 500, 500]);

    for (let hand = 0; hand < 40; hand += 1) {
      if (table.seats.filter((s) => (s.player?.stack ?? 0) > 0).length < 2) break;
      const settled = playHand(table, rand, `board-${hand}`);

      const contenders = settled.seats.filter(
        (s) => s.player?.status === 'ACTIVE' || s.player?.status === 'ALL_IN',
      ).length;
      expect(contenders === 1 || settled.board.length === 5).toBe(true);

      table = endHand(settled);
    }
  });
});
