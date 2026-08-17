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

export {
  applyAction,
  createTable,
  endHand,
  forfeitHand,
  getLegalActions,
  seatPlayer,
  settle,
  startHand,
  toPublicState,
  totalPot,
  type SeatAssignment,
  type StartHandOptions,
  type TableConfig,
} from './engine';

export {
  cardToString,
  createDeck,
  cryptoRandomSource,
  parseCard,
  parseCards,
  seededRandomSource,
  shuffle,
  shuffleWith,
  type RandomSource,
} from './deck';

export { compareHands, evaluate7, evaluateOmaha, handRankName, rankValue } from './evaluator';

export {
  awardPots,
  buildPots,
  payoutsFromAwards,
  potTotal,
  type PotPlayer,
} from './pot';

export {
  HandRank,
  HOLE_CARDS,
  PokerError,
  RANK_VALUE,
  RANKS,
  SUITS,
  variantForTableId,
  type Action,
  type ActionType,
  type BlindKind,
  type Card,
  type GameVariant,
  type HandEvent,
  type HandResult,
  type HandValue,
  type LegalActions,
  type PendingBlind,
  type Player,
  type PlayerStatus,
  type PokerErrorCode,
  type Pot,
  type PotAward,
  type PublicPlayer,
  type PublicSeat,
  type PublicTableState,
  type Rank,
  type RngState,
  type Seat,
  type ShowdownEntry,
  type Street,
  type Suit,
  type TableState,
} from './types';
