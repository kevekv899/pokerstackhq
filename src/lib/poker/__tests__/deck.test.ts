import { describe, expect, it } from 'vitest';

import {
  cardToString,
  createDeck,
  cryptoRandomSource,
  parseCard,
  parseCards,
  seededRandomSource,
  shuffle,
} from '../deck';
import { PokerError } from '../types';

describe('createDeck', () => {
  it('returns 52 distinct cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardToString)).size).toBe(52);
  });
});

describe('shuffle', () => {
  it('is a permutation of the deck and leaves the input untouched', () => {
    const deck = createDeck();
    const snapshot = deck.map(cardToString);
    const shuffled = shuffle(deck, 'seed-1');

    expect(deck.map(cardToString)).toEqual(snapshot);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(cardToString))).toEqual(new Set(snapshot));
  });

  it('is deterministic for a given seed and differs across seeds', () => {
    const a = shuffle(createDeck(), 'hand-42').map(cardToString);
    const b = shuffle(createDeck(), 'hand-42').map(cardToString);
    const c = shuffle(createDeck(), 'hand-43').map(cardToString);

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).not.toEqual(createDeck().map(cardToString));
  });

  it('uses the CSPRNG when no seed is supplied', () => {
    const a = shuffle(createDeck()).map(cardToString);
    const b = shuffle(createDeck()).map(cardToString);
    // Collision odds here are 1 in 52!, so this is a safe assertion.
    expect(a).not.toEqual(b);
  });
});

describe('random sources', () => {
  it('stays inside the requested bound', () => {
    const seeded = seededRandomSource('bounds');
    for (let i = 0; i < 500; i += 1) {
      const value = seeded(52);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(52);
    }
  });

  it('covers the whole range roughly evenly', () => {
    const seeded = seededRandomSource('distribution');
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i += 1) counts[seeded(6)] += 1;
    for (const count of counts) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('rejects nonsense bounds', () => {
    expect(() => seededRandomSource('x')(0)).toThrow(PokerError);
    expect(() => cryptoRandomSource(-1)).toThrow(PokerError);
  });
});

describe('card notation', () => {
  it('round-trips', () => {
    expect(cardToString(parseCard('As'))).toBe('As');
    expect(parseCards('As Kd 7h')).toEqual([
      { rank: 'A', suit: 's' },
      { rank: 'K', suit: 'd' },
      { rank: '7', suit: 'h' },
    ]);
  });

  it('rejects junk', () => {
    expect(() => parseCard('Zx')).toThrow(PokerError);
  });
});
