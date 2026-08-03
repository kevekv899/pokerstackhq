import { describe, expect, it } from 'vitest';

import { parseCards } from '../deck';
import { evaluate7 } from '../evaluator';
import { awardPots, buildPots, payoutsFromAwards, potTotal, type PotPlayer } from '../pot';
import type { HandValue, PlayerStatus } from '../types';

const player = (
  id: string,
  totalCommitted: number,
  status: PlayerStatus = 'ALL_IN',
): PotPlayer => ({ id, totalCommitted, status });

const strengths = (entries: Record<string, string>): Map<string, HandValue | null> =>
  new Map(Object.entries(entries).map(([id, cards]) => [id, evaluate7(parseCards(cards))]));

describe('buildPots', () => {
  it('makes a single pot when everyone is in for the same amount', () => {
    const pots = buildPots([player('a', 100), player('b', 100), player('c', 100)]);
    expect(pots).toEqual([{ amount: 300, eligiblePlayerIds: ['a', 'b', 'c'] }]);
  });

  it('splits a three-way all-in with three different stacks into three pots', () => {
    const pots = buildPots([player('short', 100), player('mid', 200), player('big', 300)]);

    expect(pots).toEqual([
      // Everyone matched the first 100.
      { amount: 300, eligiblePlayerIds: ['short', 'mid', 'big'] },
      // Only mid and big reached 200.
      { amount: 200, eligiblePlayerIds: ['mid', 'big'] },
      // Only big reached 300.
      { amount: 100, eligiblePlayerIds: ['big'] },
    ]);
    expect(potTotal(pots)).toBe(600);
  });

  it('keeps folded players out of the eligibility list but keeps their chips', () => {
    const pots = buildPots([
      player('a', 100),
      player('folder', 100, 'FOLDED'),
      player('b', 100),
    ]);
    expect(pots).toEqual([{ amount: 300, eligiblePlayerIds: ['a', 'b'] }]);
  });

  it('rolls a layer nobody can win into the pot beneath it', () => {
    // The folder outspent both live players; that top layer is dead money.
    const pots = buildPots([
      player('a', 100),
      player('b', 100),
      player('folder', 250, 'FOLDED'),
    ]);
    expect(potTotal(pots)).toBe(450);
    expect(pots).toHaveLength(1);
    expect(pots[0]).toEqual({ amount: 450, eligiblePlayerIds: ['a', 'b'] });
  });

  it('ignores players who put nothing in', () => {
    expect(buildPots([player('a', 0, 'SITTING_OUT'), player('b', 0, 'SITTING_OUT')])).toEqual([]);
  });
});

describe('awardPots', () => {
  const order = ['a', 'b', 'c'];

  it('gives the pot to the best hand', () => {
    const pots = [{ amount: 300, eligiblePlayerIds: ['a', 'b', 'c'] }];
    const awards = awardPots(
      pots,
      strengths({
        a: 'As Ad Kh Qc 7s 2d 3h', // pair of aces
        b: 'Ks Kd Kh Qc 7s 2d 3h', // trip kings
        c: '9s 9d Kh Qc 7s 2d 3h', // pair of nines
      }),
      order,
    );

    expect(awards[0].winners).toEqual([{ playerId: 'b', amount: 300 }]);
    expect(payoutsFromAwards(awards)).toEqual({ b: 300 });
  });

  it('splits evenly between identical hands', () => {
    const pots = [{ amount: 200, eligiblePlayerIds: ['a', 'b'] }];
    const awards = awardPots(
      pots,
      // Both play the same board-driven broadway straight.
      strengths({ a: 'As Ks Qd Jh Tc 2c 3d', b: 'As Ks Qd Jh Tc 4h 5s' }),
      order,
    );

    expect(awards[0].winners).toEqual([
      { playerId: 'a', amount: 100 },
      { playerId: 'b', amount: 100 },
    ]);
  });

  it('gives an odd chip to the first player left of the button', () => {
    const pots = [{ amount: 201, eligiblePlayerIds: ['b', 'a'] }];
    // `order` is clockwise from the button, so `a` is first in line.
    const awards = awardPots(
      pots,
      strengths({ a: 'As Ks Qd Jh Tc 2c 3d', b: 'As Ks Qd Jh Tc 4h 5s' }),
      order,
    );

    expect(awards[0].winners).toEqual([
      { playerId: 'a', amount: 101 },
      { playerId: 'b', amount: 100 },
    ]);
    expect(potTotal(pots)).toBe(201);
  });

  it('spreads two odd chips across a three-way split', () => {
    const pots = [{ amount: 302, eligiblePlayerIds: ['c', 'b', 'a'] }];
    const awards = awardPots(
      pots,
      strengths({
        a: 'As Ks Qd Jh Tc 2c 3d',
        b: 'As Ks Qd Jh Tc 4h 5s',
        c: 'As Ks Qd Jh Tc 6h 7s',
      }),
      order,
    );

    expect(awards[0].winners).toEqual([
      { playerId: 'a', amount: 101 },
      { playerId: 'b', amount: 101 },
      { playerId: 'c', amount: 100 },
    ]);
  });

  it('awards side pots independently of the main pot', () => {
    const pots = buildPots([player('short', 100), player('mid', 200), player('big', 300)]);
    const awards = awardPots(
      pots,
      strengths({
        short: 'As Ad Ah Kc Qs 2d 3h', // trip aces — best hand
        mid: 'Ks Kd Kh Qc 7s 2d 3h', // trip kings
        big: '9s 9d Kh Qc 7s 2d 3h', // pair of nines
      }),
      ['short', 'mid', 'big'],
    );

    // short can only win the pot they were all-in for.
    expect(awards[0].winners).toEqual([{ playerId: 'short', amount: 300 }]);
    // mid takes the second pot; big's uncontested layer comes back to them.
    expect(awards[1].winners).toEqual([{ playerId: 'mid', amount: 200 }]);
    expect(awards[2].winners).toEqual([{ playerId: 'big', amount: 100 }]);
    expect(payoutsFromAwards(awards)).toEqual({ short: 300, mid: 200, big: 100 });
  });

  it('awards an uncontested pot without needing an evaluated hand', () => {
    const pots = buildPots([
      player('winner', 50, 'ACTIVE'),
      player('folder', 50, 'FOLDED'),
    ]);
    const awards = awardPots(pots, new Map(), ['winner', 'folder']);
    expect(payoutsFromAwards(awards)).toEqual({ winner: 100 });
  });
});
