"use strict";
/**
 * Core domain types for the no-limit Texas Hold'em engine.
 *
 * SECURITY: `TableState` contains secrets (hole cards, deck order, RNG seed).
 * It must never leave the server. Use `toPublicState()` before sending
 * anything to a client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PokerError = exports.HandRank = exports.RANK_VALUE = exports.RANKS = exports.SUITS = void 0;
exports.SUITS = ['c', 'd', 'h', 's'];
exports.RANKS = [
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'T',
    'J',
    'Q',
    'K',
    'A',
];
/** Numeric strength of each rank. Ace is high (14); the wheel treats it as 1. */
exports.RANK_VALUE = {
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
};
// ---------------------------------------------------------------------------
// Hand evaluation
// ---------------------------------------------------------------------------
var HandRank;
(function (HandRank) {
    HandRank[HandRank["HIGH_CARD"] = 1] = "HIGH_CARD";
    HandRank[HandRank["PAIR"] = 2] = "PAIR";
    HandRank[HandRank["TWO_PAIR"] = 3] = "TWO_PAIR";
    HandRank[HandRank["THREE_OF_A_KIND"] = 4] = "THREE_OF_A_KIND";
    HandRank[HandRank["STRAIGHT"] = 5] = "STRAIGHT";
    HandRank[HandRank["FLUSH"] = 6] = "FLUSH";
    HandRank[HandRank["FULL_HOUSE"] = 7] = "FULL_HOUSE";
    HandRank[HandRank["FOUR_OF_A_KIND"] = 8] = "FOUR_OF_A_KIND";
    HandRank[HandRank["STRAIGHT_FLUSH"] = 9] = "STRAIGHT_FLUSH";
})(HandRank || (exports.HandRank = HandRank = {}));
/** Typed error thrown for every illegal action or illegal transition. */
class PokerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'PokerError';
        this.code = code;
    }
}
exports.PokerError = PokerError;
//# sourceMappingURL=types.js.map