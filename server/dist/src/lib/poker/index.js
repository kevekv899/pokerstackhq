"use strict";
/**
 * No-limit Texas Hold'em engine — pure TypeScript, no React, no I/O, no DB.
 *
 * Lifecycle
 *
 *   WAITING --startHand()--> PREFLOP -> FLOP -> TURN -> RIVER
 *                                |                        |
 *                                |                  goToShowdown
 *                                |                        v
 *                          (all but one fold)          SHOWDOWN
 *                                |                        |
 *                                |                    settle()
 *                                v                        v
 *                              PAYOUT <------------------ '
 *                                |
 *                            endHand()
 *                                v
 *                             WAITING
 *
 * `applyAction` drives everything in between. It advances streets, deals the
 * board and resolves the hand on its own; it stops at `SHOWDOWN` when cards
 * are shown (so a caller can render the reveal before chips move) and goes
 * straight to `PAYOUT` when the hand is won uncontested.
 *
 * SECURITY: `TableState` holds hole cards, the undealt deck and the RNG seed.
 * It is server-only. Everything sent to a client must go through
 * `toPublicState(state, viewerId)`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUITS = exports.RANKS = exports.RANK_VALUE = exports.PokerError = exports.HandRank = exports.potTotal = exports.payoutsFromAwards = exports.buildPots = exports.awardPots = exports.rankValue = exports.handRankName = exports.evaluate7 = exports.compareHands = exports.shuffleWith = exports.shuffle = exports.seededRandomSource = exports.parseCards = exports.parseCard = exports.cryptoRandomSource = exports.createDeck = exports.cardToString = exports.totalPot = exports.toPublicState = exports.startHand = exports.settle = exports.seatPlayer = exports.getLegalActions = exports.endHand = exports.createTable = exports.applyAction = void 0;
var engine_1 = require("./engine");
Object.defineProperty(exports, "applyAction", { enumerable: true, get: function () { return engine_1.applyAction; } });
Object.defineProperty(exports, "createTable", { enumerable: true, get: function () { return engine_1.createTable; } });
Object.defineProperty(exports, "endHand", { enumerable: true, get: function () { return engine_1.endHand; } });
Object.defineProperty(exports, "getLegalActions", { enumerable: true, get: function () { return engine_1.getLegalActions; } });
Object.defineProperty(exports, "seatPlayer", { enumerable: true, get: function () { return engine_1.seatPlayer; } });
Object.defineProperty(exports, "settle", { enumerable: true, get: function () { return engine_1.settle; } });
Object.defineProperty(exports, "startHand", { enumerable: true, get: function () { return engine_1.startHand; } });
Object.defineProperty(exports, "toPublicState", { enumerable: true, get: function () { return engine_1.toPublicState; } });
Object.defineProperty(exports, "totalPot", { enumerable: true, get: function () { return engine_1.totalPot; } });
var deck_1 = require("./deck");
Object.defineProperty(exports, "cardToString", { enumerable: true, get: function () { return deck_1.cardToString; } });
Object.defineProperty(exports, "createDeck", { enumerable: true, get: function () { return deck_1.createDeck; } });
Object.defineProperty(exports, "cryptoRandomSource", { enumerable: true, get: function () { return deck_1.cryptoRandomSource; } });
Object.defineProperty(exports, "parseCard", { enumerable: true, get: function () { return deck_1.parseCard; } });
Object.defineProperty(exports, "parseCards", { enumerable: true, get: function () { return deck_1.parseCards; } });
Object.defineProperty(exports, "seededRandomSource", { enumerable: true, get: function () { return deck_1.seededRandomSource; } });
Object.defineProperty(exports, "shuffle", { enumerable: true, get: function () { return deck_1.shuffle; } });
Object.defineProperty(exports, "shuffleWith", { enumerable: true, get: function () { return deck_1.shuffleWith; } });
var evaluator_1 = require("./evaluator");
Object.defineProperty(exports, "compareHands", { enumerable: true, get: function () { return evaluator_1.compareHands; } });
Object.defineProperty(exports, "evaluate7", { enumerable: true, get: function () { return evaluator_1.evaluate7; } });
Object.defineProperty(exports, "handRankName", { enumerable: true, get: function () { return evaluator_1.handRankName; } });
Object.defineProperty(exports, "rankValue", { enumerable: true, get: function () { return evaluator_1.rankValue; } });
var pot_1 = require("./pot");
Object.defineProperty(exports, "awardPots", { enumerable: true, get: function () { return pot_1.awardPots; } });
Object.defineProperty(exports, "buildPots", { enumerable: true, get: function () { return pot_1.buildPots; } });
Object.defineProperty(exports, "payoutsFromAwards", { enumerable: true, get: function () { return pot_1.payoutsFromAwards; } });
Object.defineProperty(exports, "potTotal", { enumerable: true, get: function () { return pot_1.potTotal; } });
var types_1 = require("./types");
Object.defineProperty(exports, "HandRank", { enumerable: true, get: function () { return types_1.HandRank; } });
Object.defineProperty(exports, "PokerError", { enumerable: true, get: function () { return types_1.PokerError; } });
Object.defineProperty(exports, "RANK_VALUE", { enumerable: true, get: function () { return types_1.RANK_VALUE; } });
Object.defineProperty(exports, "RANKS", { enumerable: true, get: function () { return types_1.RANKS; } });
Object.defineProperty(exports, "SUITS", { enumerable: true, get: function () { return types_1.SUITS; } });
//# sourceMappingURL=index.js.map