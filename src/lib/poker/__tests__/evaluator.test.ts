import { describe, expect, it } from 'vitest';

import { parseCards } from '../deck';
import { compareHands, evaluate7 } from '../evaluator';
import { HandRank, PokerError } from '../types';

const hand = (text: string) => evaluate7(parseCards(text));

describe('hand categories', () => {
  it('ranks all nine categories in ascending order', () => {
    // Deliberately ordered weakest to strongest.
    const ladder: [string, HandRank, string][] = [
      ['As Kd 9h 7c 5s 3d 2c', HandRank.HIGH_CARD, 'High Card'],
      ['As Ad 9h 7c 5s 3d 2c', HandRank.PAIR, 'Pair'],
      ['As Ad 9h 9c 5s 3d 2c', HandRank.TWO_PAIR, 'Two Pair'],
      ['As Ad Ah 9c 5s 3d 2c', HandRank.THREE_OF_A_KIND, 'Three of a Kind'],
      ['9s 8d 7h 6c 5s Ad 2c', HandRank.STRAIGHT, 'Straight'],
      ['As Ks 9s 7s 5s 3d 2c', HandRank.FLUSH, 'Flush'],
      ['As Ad Ah 9c 9s 5d 2c', HandRank.FULL_HOUSE, 'Full House'],
      ['As Ad Ah Ac 9s 5d 2c', HandRank.FOUR_OF_A_KIND, 'Four of a Kind'],
      ['9s 8s 7s 6s 5s Ad 2c', HandRank.STRAIGHT_FLUSH, 'Straight Flush'],
    ];

    const evaluated = ladder.map(([cards]) => hand(cards));

    ladder.forEach(([, rank, name], index) => {
      expect(evaluated[index].rank).toBe(rank);
      expect(evaluated[index].name).toBe(name);
    });

    // Each rung must be strictly stronger than the one below it.
    for (let i = 1; i < evaluated.length; i += 1) {
      expect(compareHands(evaluated[i], evaluated[i - 1])).toBeGreaterThan(0);
    }
    expect(evaluated.map((h) => h.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('a royal flush beats a straight flush', () => {
    const royal = hand('As Ks Qs Js Ts 3d 2c');
    const straightFlush = hand('9h 8h 7h 6h 5h Ad 2c');

    expect(royal.rank).toBe(HandRank.STRAIGHT_FLUSH);
    expect(royal.name).toBe('Royal Flush');
    expect(royal.tiebreakers).toEqual([14]);

    expect(straightFlush.name).toBe('Straight Flush');
    expect(compareHands(royal, straightFlush)).toBeGreaterThan(0);
  });

  it('picks the best five out of seven', () => {
    // Two pair on board plus a set in hand — must find the full house.
    const result = hand('7c 7d 7h Kc Kd 2s 3s');
    expect(result.rank).toBe(HandRank.FULL_HOUSE);
    expect(result.tiebreakers).toEqual([7, 13]);
    expect(result.cards).toHaveLength(5);
  });

  it('plays the higher of two trips as the pair in a full house', () => {
    const result = hand('As Ad Ah Kc Kd Ks 2c');
    expect(result.rank).toBe(HandRank.FULL_HOUSE);
    expect(result.tiebreakers).toEqual([14, 13]);
  });
});

describe('straights', () => {
  it('evaluates the wheel A-2-3-4-5 as a five-high straight', () => {
    const wheel = hand('Ad 2c 3h 4s 5d 9c Kh');
    expect(wheel.rank).toBe(HandRank.STRAIGHT);
    expect(wheel.tiebreakers).toEqual([5]);

    // The wheel is the weakest straight: a six-high beats it.
    const sixHigh = hand('2c 3h 4s 5d 6c 9h Kd');
    expect(compareHands(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('does not wrap around: Q-K-A-2-3 is not a straight', () => {
    const wrap = hand('Qs Kd Ah 2c 3d 9s 8c');
    expect(wrap.rank).toBe(HandRank.HIGH_CARD);
    expect(wrap.tiebreakers).toEqual([14, 13, 12, 9, 8]);
  });

  it('does not wrap around in one suit either: K-A-2-3-4 suited is only a flush', () => {
    const wrap = hand('Ks As 2s 3s 4s 9d 8c');
    expect(wrap.rank).toBe(HandRank.FLUSH);
    expect(wrap.tiebreakers).toEqual([14, 13, 4, 3, 2]);
  });

  it('a suited wheel is a straight flush, but not a royal', () => {
    const steelWheel = hand('Ah 2h 3h 4h 5h Kd Qc');
    expect(steelWheel.rank).toBe(HandRank.STRAIGHT_FLUSH);
    expect(steelWheel.name).toBe('Straight Flush');
    expect(steelWheel.tiebreakers).toEqual([5]);

    // Lowest possible straight flush — every other one beats it.
    expect(compareHands(hand('6s 5s 4s 3s 2s Kd Qc'), steelWheel)).toBeGreaterThan(0);
    expect(compareHands(hand('As Ks Qs Js Ts 4d 3c'), steelWheel)).toBeGreaterThan(0);
  });

  it('an ace-high straight is not a wheel', () => {
    const broadway = hand('Ac Kd Qh Js Td 2c 3h');
    expect(broadway.rank).toBe(HandRank.STRAIGHT);
    expect(broadway.tiebreakers).toEqual([14]);
  });
});

describe('tiebreakers', () => {
  it('compares kickers within a category', () => {
    expect(compareHands(hand('As Ad Kh 7c 5s 3d 2c'), hand('As Ad Qh 7c 5s 3d 2c'))).toBeGreaterThan(0);
    expect(compareHands(hand('9s 9d 9h 7c 5s 3d 2c'), hand('8s 8d 8h Ac Ks 3d 2c'))).toBeGreaterThan(0);
  });

  it('returns 0 for identical hand values', () => {
    // Both players play the board.
    expect(compareHands(hand('As Ks Qd Jh Tc 2c 3d'), hand('As Ks Qd Jh Tc 4h 5s'))).toBe(0);
  });
});

describe('input validation', () => {
  it('rejects the wrong number of cards', () => {
    expect(() => hand('As Ks Qd Jh')).toThrow(PokerError);
    expect(() => evaluate7(parseCards('As Ks Qd Jh Tc 9c 8c 7c'))).toThrow(/5-7 cards/);
  });

  it('rejects duplicate cards', () => {
    expect(() => hand('As As Qd Jh Tc 9c 8d')).toThrow(/Duplicate card/);
  });
});
