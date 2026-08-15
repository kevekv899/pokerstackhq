/**
 * Omaha's one rule: a hand is exactly two hole cards plus exactly three board
 * cards. Not "at least", not "at most".
 *
 * That is the rule players get wrong, and it is the rule a Hold'em evaluator
 * silently breaks — `evaluate7` would happily play four board cards plus one
 * from your hand and call it a flush. Each test below pins a case where the
 * two rulesets disagree, and asserts the *Omaha* answer.
 */

import { describe, expect, it } from 'vitest';

import { compareHands, evaluate7, evaluateOmaha } from '../evaluator';
import { createTable, startHand, toPublicState } from '../engine';
import { parseCards } from '../deck';
import { HandRank, PokerError, type Card, type HandValue } from '../types';

const hand = (s: string) => parseCards(s);

/**
 * Best five cards ignoring Omaha's two/three split — i.e. what you would get
 * if the hand were scored like Hold'em. Used only to show that the rule is
 * doing real work: every case below scores strictly higher this way.
 */
function naiveBest(hole: Card[], board: Card[]): HandValue {
  const all = [...hole, ...board];
  let best: HandValue | null = null;
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++)
      for (let c = b + 1; c < all.length; c++)
        for (let d = c + 1; d < all.length; d++)
          for (let e = d + 1; e < all.length; e++) {
            const five = evaluate7([all[a], all[b], all[c], all[d], all[e]]);
            if (best === null || compareHands(five, best) > 0) best = five;
          }
  return best as HandValue;
}

describe('evaluateOmaha — the two-card rule', () => {
  it('is NOT a flush when only one hole card matches four board hearts', () => {
    // Board is four hearts. In Hold'em the single Ah plays and it is a flush.
    // In Omaha a flush needs two hearts from the hand, and there is only one.
    const board = hand('Kh 9h 4h 2h 7s');
    const hole = hand('Ah Ks Qc Jd');

    expect(naiveBest(hole, board).rank).toBe(HandRank.FLUSH);

    const omaha = evaluateOmaha(hole, board);
    expect(omaha.rank).not.toBe(HandRank.FLUSH);
    // Nothing on this board pairs anything else, so the Ks/Kh pair is the lot.
    expect(omaha.rank).toBe(HandRank.PAIR);
    expect(omaha.tiebreakers[0]).toBe(13);
  });

  it('IS a flush once a second hole card shares the suit', () => {
    const board = hand('Kh 9h 4h 2h 7s');
    const hole = hand('Ah Qh Kc Jd');

    const omaha = evaluateOmaha(hole, board);
    expect(omaha.rank).toBe(HandRank.FLUSH);
    // Ace-high flush: Ah and Qh from the hand, three hearts off the board.
    expect(omaha.tiebreakers[0]).toBe(14);
  });

  it('rejects a straight that would need three hole cards', () => {
    // 5-6-7 in the hand with 8-9 on the board is a straight in Hold'em, but
    // playing three hole cards is illegal in Omaha.
    const board = hand('8d 9c Kh 3s 2h');
    const hole = hand('5s 6d 7h Ac');

    expect(naiveBest(hole, board).rank).toBe(HandRank.STRAIGHT);
    expect(evaluateOmaha(hole, board).rank).not.toBe(HandRank.STRAIGHT);
  });

  it('rejects a straight that would need only one hole card', () => {
    // Board has 9-T-J-Q. One K completes it in Hold'em; Omaha needs a second
    // card from the hand and none of the others fit the run.
    const board = hand('9c Td Jh Qs 2c');
    const hole = hand('Kd 4h 3s 2d');

    expect(naiveBest(hole, board).rank).toBe(HandRank.STRAIGHT);

    const omaha = evaluateOmaha(hole, board);
    // Kd + one of 4h/3s/2d cannot make the straight; the 2d pairs the board.
    expect(omaha.rank).not.toBe(HandRank.STRAIGHT);
    expect(omaha.rank).toBe(HandRank.PAIR);
  });

  it('allows a straight that uses exactly two hole cards', () => {
    const board = hand('9c Td Jh 2s 4c');
    const hole = hand('Kd Qh 3s 7d');

    const omaha = evaluateOmaha(hole, board);
    expect(omaha.rank).toBe(HandRank.STRAIGHT);
    expect(omaha.tiebreakers[0]).toBe(13); // King-high straight
  });

  it('cannot play the board — four board cards plus one hole card is illegal', () => {
    // A board that is already a straight flush. In Hold'em everyone chops it;
    // in Omaha you must break it with two of your own cards.
    const board = hand('5h 6h 7h 8h 9h');
    const hole = hand('Ac Kd Qs Jc');

    expect(naiveBest(hole, board).rank).toBe(HandRank.STRAIGHT_FLUSH);

    const omaha = evaluateOmaha(hole, board);
    expect(omaha.rank).not.toBe(HandRank.STRAIGHT_FLUSH);
    expect(omaha.rank).not.toBe(HandRank.FLUSH);
    // Best available is the board's three-card run extended by nothing useful,
    // so it comes down to high cards.
    expect(omaha.rank).toBe(HandRank.HIGH_CARD);
  });

  it('rejects quads that would need three hole cards', () => {
    // Three aces in the hand plus one on the board is four of a kind in
    // Hold'em. Omaha can only ever play two of them.
    const board = hand('Ah 7d 3c 9s 2h');
    const hole = hand('Ac Ad As Kh');

    expect(naiveBest(hole, board).rank).toBe(HandRank.FOUR_OF_A_KIND);

    const omaha = evaluateOmaha(hole, board);
    expect(omaha.rank).toBe(HandRank.THREE_OF_A_KIND);
    expect(omaha.tiebreakers[0]).toBe(14);
  });

  it('finds the best legal combination, not the first one', () => {
    // A flush is available but so is a full house; the full house is higher and
    // must be the one returned.
    const board = hand('Kh Kd 9h 9c 2h');
    const hole = hand('Ah Qh Kc 9d');

    const omaha = evaluateOmaha(hole, board);
    // Kc + 9d with Kh/Kd/9h etc. makes kings full of nines.
    expect(omaha.rank).toBe(HandRank.FULL_HOUSE);
  });

  it('scores a pair from the hand against the board correctly', () => {
    const board = hand('2c 7d Th Js 4h');
    const hole = hand('Ac Ad 5s 6h');

    const omaha = evaluateOmaha(hole, board);
    expect(omaha.rank).toBe(HandRank.PAIR);
    expect(omaha.tiebreakers[0]).toBe(14); // aces
  });

  it('refuses to evaluate before the flop', () => {
    // With fewer than three board cards there is no legal five-card hand, and
    // guessing one would invent a result.
    expect(() => evaluateOmaha(hand('Ac Ad 5s 6h'), hand('2c 7d'))).toThrow(PokerError);
    expect(() => evaluateOmaha(hand('Ac Ad'), [])).toThrow(PokerError);
  });

  it('refuses fewer than two hole cards', () => {
    expect(() => evaluateOmaha(hand('Ac'), hand('2c 7d Th'))).toThrow(PokerError);
  });
});

describe('an Omaha table', () => {
  const players = [
    { seatIndex: 0, id: 'A', name: 'Alice', stack: 1000 },
    { seatIndex: 1, id: 'B', name: 'Bob', stack: 1000 },
  ];

  it('deals four hole cards, where Hold’em deals two', () => {
    const omaha = startHand(
      createTable({ tableId: 'o', variant: 'OMAHA', seatCount: 2, smallBlind: 5, bigBlind: 10, players }),
    );
    for (const seat of omaha.seats) {
      expect(seat.player?.holeCards).toHaveLength(4);
    }

    const holdem = startHand(
      createTable({ tableId: 'h', seatCount: 2, smallBlind: 5, bigBlind: 10, players }),
    );
    for (const seat of holdem.seats) {
      expect(seat.player?.holeCards).toHaveLength(2);
    }
  });

  it('deals every player a distinct card', () => {
    const state = startHand(
      createTable({ tableId: 'o', variant: 'OMAHA', seatCount: 6, smallBlind: 5, bigBlind: 10,
        players: Array.from({ length: 6 }, (_, i) => ({
          seatIndex: i, id: `P${i}`, name: `P${i}`, stack: 1000,
        })) }),
    );

    // Six players x four cards is 24 of the 52 — the deck must cover it
    // without repeating itself.
    const dealt = state.seats.flatMap((s) => s.player?.holeCards ?? []);
    expect(dealt).toHaveLength(24);
    expect(new Set(dealt.map((c) => `${c.rank}${c.suit}`)).size).toBe(24);
  });

  it('defaults to Hold’em when no variant is given', () => {
    expect(createTable({ tableId: 'h', seatCount: 2, smallBlind: 5, bigBlind: 10 }).variant)
      .toBe('HOLDEM');
  });

  it('tells the client which rules it is playing', () => {
    const state = createTable({ tableId: 'o', variant: 'OMAHA', seatCount: 2, smallBlind: 5, bigBlind: 10, players });
    expect(toPublicState(state, 'A').variant).toBe('OMAHA');
  });
});
