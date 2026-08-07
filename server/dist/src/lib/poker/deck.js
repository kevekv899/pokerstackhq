"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cryptoRandomSource = void 0;
exports.seededRandomSource = seededRandomSource;
exports.createDeck = createDeck;
exports.shuffle = shuffle;
exports.shuffleWith = shuffleWith;
exports.cardToString = cardToString;
exports.parseCard = parseCard;
exports.parseCards = parseCards;
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
/** CSPRNG-backed source. Used whenever no seed is supplied. */
const cryptoRandomSource = (maxExclusive) => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new types_1.PokerError('INVALID_AMOUNT', `Bad random bound: ${maxExclusive}`);
    }
    return (0, node_crypto_1.randomInt)(maxExclusive);
};
exports.cryptoRandomSource = cryptoRandomSource;
/**
 * Deterministic source derived from `seed`. Same seed always yields the same
 * sequence, so hands can be replayed and tests are reproducible.
 */
function seededRandomSource(seed) {
    const key = String(seed);
    let block = Buffer.alloc(0);
    let offset = 0;
    let counter = 0;
    const nextByte = () => {
        if (offset >= block.length) {
            block = (0, node_crypto_1.createHash)('sha256').update(`${key}#${counter}`).digest();
            counter += 1;
            offset = 0;
        }
        const byte = block[offset];
        offset += 1;
        return byte;
    };
    return (maxExclusive) => {
        if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
            throw new types_1.PokerError('INVALID_AMOUNT', `Bad random bound: ${maxExclusive}`);
        }
        // Rejection sampling over a full 32-bit word keeps the draw unbiased.
        const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
        for (;;) {
            const value = nextByte() * 0x1000000 +
                nextByte() * 0x10000 +
                nextByte() * 0x100 +
                nextByte();
            if (value < limit)
                return value % maxExclusive;
        }
    };
}
/** A fresh, ordered 52-card deck. */
function createDeck() {
    const deck = [];
    for (const suit of types_1.SUITS) {
        for (const rank of types_1.RANKS) {
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
function shuffle(deck, seed) {
    const random = seed === undefined || seed === null
        ? exports.cryptoRandomSource
        : seededRandomSource(seed);
    return shuffleWith(deck, random);
}
/** Fisher-Yates shuffle against an explicit random source. */
function shuffleWith(deck, random) {
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
function cardToString(card) {
    return `${card.rank}${card.suit}`;
}
/** Parses compact notation such as `"As"` back into a `Card`. */
function parseCard(text) {
    const rank = text.slice(0, -1).toUpperCase();
    const suit = text.slice(-1).toLowerCase();
    if (!types_1.RANKS.includes(rank) || !types_1.SUITS.includes(suit)) {
        throw new types_1.PokerError('INVALID_CARDS', `Not a card: "${text}"`);
    }
    return { rank, suit };
}
/** Parses a space-separated list such as `"As Kd 7h"`. */
function parseCards(text) {
    return text
        .split(/\s+/)
        .filter(Boolean)
        .map(parseCard);
}
//# sourceMappingURL=deck.js.map