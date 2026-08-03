import { createHash, randomInt } from 'node:crypto';

import { PokerError, RANKS, SUITS, type Card } from './types';

/**
 * Draws a uniformly distributed integer in `[0, maxExclusive)`.
 *
 * Never backed by `Math.random`: the unseeded source is `crypto.randomInt`,
 * and the seeded source is a SHA-256 counter stream with rejection sampling.
 */
export type RandomSource = (maxExclusive: number) => number;

/** CSPRNG-backed source. Used whenever no seed is supplied. */
export const cryptoRandomSource: RandomSource = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new PokerError('INVALID_AMOUNT', `Bad random bound: ${maxExclusive}`);
  }
  return randomInt(maxExclusive);
};

/**
 * Deterministic source derived from `seed`. Same seed always yields the same
 * sequence, so hands can be replayed and tests are reproducible.
 */
export function seededRandomSource(seed: string | number): RandomSource {
  const key = String(seed);
  let block = Buffer.alloc(0);
  let offset = 0;
  let counter = 0;

  const nextByte = (): number => {
    if (offset >= block.length) {
      block = createHash('sha256').update(`${key}#${counter}`).digest();
      counter += 1;
      offset = 0;
    }
    const byte = block[offset];
    offset += 1;
    return byte;
  };

  return (maxExclusive) => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new PokerError('INVALID_AMOUNT', `Bad random bound: ${maxExclusive}`);
    }
    // Rejection sampling over a full 32-bit word keeps the draw unbiased.
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    for (;;) {
      const value =
        nextByte() * 0x1000000 +
        nextByte() * 0x10000 +
        nextByte() * 0x100 +
        nextByte();
      if (value < limit) return value % maxExclusive;
    }
  };
}

/** A fresh, ordered 52-card deck. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle. Returns a new array; `deck` is not mutated.
 *
 * @param seed Optional. When provided the shuffle is deterministic; when
 *             omitted it draws from `crypto.randomInt`.
 */
export function shuffle(
  deck: readonly Card[],
  seed?: string | number | null,
): Card[] {
  const random =
    seed === undefined || seed === null
      ? cryptoRandomSource
      : seededRandomSource(seed);
  return shuffleWith(deck, random);
}

/** Fisher-Yates shuffle against an explicit random source. */
export function shuffleWith(deck: readonly Card[], random: RandomSource): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** `"As"`, `"Th"` … — compact card notation, handy for logs and tests. */
export function cardToString(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** Parses compact notation such as `"As"` back into a `Card`. */
export function parseCard(text: string): Card {
  const rank = text.slice(0, -1).toUpperCase() as Card['rank'];
  const suit = text.slice(-1).toLowerCase() as Card['suit'];
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new PokerError('INVALID_CARDS', `Not a card: "${text}"`);
  }
  return { rank, suit };
}

/** Parses a space-separated list such as `"As Kd 7h"`. */
export function parseCards(text: string): Card[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(parseCard);
}
