"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankValue = rankValue;
exports.evaluate7 = evaluate7;
exports.compareHands = compareHands;
exports.handRankName = handRankName;
const types_1 = require("./types");
const HAND_NAMES = {
    [types_1.HandRank.HIGH_CARD]: 'High Card',
    [types_1.HandRank.PAIR]: 'Pair',
    [types_1.HandRank.TWO_PAIR]: 'Two Pair',
    [types_1.HandRank.THREE_OF_A_KIND]: 'Three of a Kind',
    [types_1.HandRank.STRAIGHT]: 'Straight',
    [types_1.HandRank.FLUSH]: 'Flush',
    [types_1.HandRank.FULL_HOUSE]: 'Full House',
    [types_1.HandRank.FOUR_OF_A_KIND]: 'Four of a Kind',
    [types_1.HandRank.STRAIGHT_FLUSH]: 'Straight Flush',
};
/** Numeric value of a card's rank (2-14, ace high). */
function rankValue(card) {
    return types_1.RANK_VALUE[card.rank];
}
/**
 * Finds the highest straight among a set of rank values.
 *
 * Returns the value of the straight's top card, or null. The wheel
 * (A-2-3-4-5) is supported by treating the ace as 1, and it reports a high of
 * 5. Straights never wrap: Q-K-A-2-3 is not a straight, because the ace is
 * only ever the top or the bottom of a run, never a bridge between them.
 */
function findStraightHigh(values) {
    const present = new Set(values);
    if (present.has(14))
        present.add(1); // ace plays low for the wheel
    const distinct = Array.from(present).sort((a, b) => b - a);
    let run = 1;
    for (let i = 1; i < distinct.length; i += 1) {
        if (distinct[i] === distinct[i - 1] - 1) {
            run += 1;
            if (run >= 5)
                return distinct[i] + 4;
        }
        else {
            run = 1;
        }
    }
    return null;
}
/** Picks the five cards forming a straight with the given top card. */
function straightCards(cards, high) {
    const wanted = high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4];
    return wanted.map((value) => {
        const card = cards.find((c) => rankValue(c) === value);
        /* istanbul ignore next — guaranteed present by findStraightHigh */
        if (!card)
            throw new types_1.PokerError('INVALID_CARDS', 'Straight card missing');
        return card;
    });
}
function assertValid(cards) {
    if (cards.length < 5 || cards.length > 7) {
        throw new types_1.PokerError('INVALID_CARDS', `evaluate7 needs 5-7 cards, received ${cards.length}`);
    }
    const seen = new Set();
    for (const card of cards) {
        const key = `${card.rank}${card.suit}`;
        if (seen.has(key)) {
            throw new types_1.PokerError('INVALID_CARDS', `Duplicate card: ${key}`);
        }
        seen.add(key);
    }
}
/**
 * Evaluates the best five-card hand out of 5, 6 or 7 cards.
 *
 * The returned `rank`/`tiebreakers` pair is totally ordered — compare two
 * results with `compareHands`. A royal flush is a straight flush with a
 * tiebreaker of 14, so it beats every other straight flush; only its `name`
 * differs.
 */
function evaluate7(cards) {
    assertValid(cards);
    const sorted = cards.slice().sort((a, b) => rankValue(b) - rankValue(a));
    const values = sorted.map(rankValue);
    // Rank multiplicities, highest rank first within each multiplicity class.
    const counts = new Map();
    for (const card of sorted) {
        const group = counts.get(rankValue(card));
        if (group)
            group.push(card);
        else
            counts.set(rankValue(card), [card]);
    }
    const groups = Array.from(counts.entries())
        .map(([value, group]) => ({ value, group }))
        .sort((a, b) => b.group.length - a.group.length || b.value - a.value);
    const bySuit = new Map();
    for (const card of sorted) {
        const group = bySuit.get(card.suit);
        if (group)
            group.push(card);
        else
            bySuit.set(card.suit, [card]);
    }
    const flushCards = Array.from(bySuit.values()).find((g) => g.length >= 5);
    // 9 — straight flush (and its royal special case)
    if (flushCards) {
        const sfHigh = findStraightHigh(flushCards.map(rankValue));
        if (sfHigh !== null) {
            return {
                rank: types_1.HandRank.STRAIGHT_FLUSH,
                tiebreakers: [sfHigh],
                name: sfHigh === 14 ? 'Royal Flush' : HAND_NAMES[types_1.HandRank.STRAIGHT_FLUSH],
                cards: straightCards(flushCards, sfHigh),
            };
        }
    }
    const quads = groups.filter((g) => g.group.length === 4);
    const trips = groups.filter((g) => g.group.length === 3);
    const pairs = groups.filter((g) => g.group.length === 2);
    const kickersExcluding = (excluded, count) => sorted.filter((c) => !excluded.includes(rankValue(c))).slice(0, count);
    // 8 — four of a kind
    if (quads.length > 0) {
        const quad = quads[0];
        const kicker = kickersExcluding([quad.value], 1);
        return {
            rank: types_1.HandRank.FOUR_OF_A_KIND,
            tiebreakers: [quad.value, ...kicker.map(rankValue)],
            name: HAND_NAMES[types_1.HandRank.FOUR_OF_A_KIND],
            cards: [...quad.group, ...kicker],
        };
    }
    // 7 — full house (a second set of trips can play as the pair)
    if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
        const trip = trips[0];
        const pair = pairs.length > 0 && (trips.length < 2 || pairs[0].value > trips[1].value)
            ? pairs[0]
            : trips[1];
        return {
            rank: types_1.HandRank.FULL_HOUSE,
            tiebreakers: [trip.value, pair.value],
            name: HAND_NAMES[types_1.HandRank.FULL_HOUSE],
            cards: [...trip.group, ...pair.group.slice(0, 2)],
        };
    }
    // 6 — flush
    if (flushCards) {
        const best = flushCards.slice(0, 5);
        return {
            rank: types_1.HandRank.FLUSH,
            tiebreakers: best.map(rankValue),
            name: HAND_NAMES[types_1.HandRank.FLUSH],
            cards: best,
        };
    }
    // 5 — straight
    const straightHigh = findStraightHigh(values);
    if (straightHigh !== null) {
        return {
            rank: types_1.HandRank.STRAIGHT,
            tiebreakers: [straightHigh],
            name: HAND_NAMES[types_1.HandRank.STRAIGHT],
            cards: straightCards(sorted, straightHigh),
        };
    }
    // 4 — three of a kind
    if (trips.length > 0) {
        const trip = trips[0];
        const kickers = kickersExcluding([trip.value], 2);
        return {
            rank: types_1.HandRank.THREE_OF_A_KIND,
            tiebreakers: [trip.value, ...kickers.map(rankValue)],
            name: HAND_NAMES[types_1.HandRank.THREE_OF_A_KIND],
            cards: [...trip.group, ...kickers],
        };
    }
    // 3 — two pair
    if (pairs.length >= 2) {
        const [high, low] = pairs;
        const kicker = kickersExcluding([high.value, low.value], 1);
        return {
            rank: types_1.HandRank.TWO_PAIR,
            tiebreakers: [high.value, low.value, ...kicker.map(rankValue)],
            name: HAND_NAMES[types_1.HandRank.TWO_PAIR],
            cards: [...high.group, ...low.group, ...kicker],
        };
    }
    // 2 — one pair
    if (pairs.length === 1) {
        const pair = pairs[0];
        const kickers = kickersExcluding([pair.value], 3);
        return {
            rank: types_1.HandRank.PAIR,
            tiebreakers: [pair.value, ...kickers.map(rankValue)],
            name: HAND_NAMES[types_1.HandRank.PAIR],
            cards: [...pair.group, ...kickers],
        };
    }
    // 1 — high card
    const best = sorted.slice(0, 5);
    return {
        rank: types_1.HandRank.HIGH_CARD,
        tiebreakers: best.map(rankValue),
        name: HAND_NAMES[types_1.HandRank.HIGH_CARD],
        cards: best,
    };
}
/**
 * Orders two evaluated hands. Positive when `a` wins, negative when `b` wins,
 * 0 for an exact tie (a split pot).
 */
function compareHands(a, b) {
    if (a.rank !== b.rank)
        return a.rank - b.rank;
    const length = Math.max(a.tiebreakers.length, b.tiebreakers.length);
    for (let i = 0; i < length; i += 1) {
        const left = a.tiebreakers[i] ?? 0;
        const right = b.tiebreakers[i] ?? 0;
        if (left !== right)
            return left - right;
    }
    return 0;
}
/** Canonical display name for a hand category. */
function handRankName(rank) {
    return HAND_NAMES[rank];
}
//# sourceMappingURL=evaluator.js.map