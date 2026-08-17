/**
 * Core domain types for the no-limit Texas Hold'em engine.
 *
 * SECURITY: `TableState` contains secrets (hole cards, deck order, RNG seed).
 * It must never leave the server. Use `toPublicState()` before sending
 * anything to a client.
 */

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Suit = 'c' | 'd' | 'h' | 's';

export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];

export const RANKS: readonly Rank[] = [
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
export const RANK_VALUE: Readonly<Record<Rank, number>> = {
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

export enum HandRank {
  HIGH_CARD = 1,
  PAIR = 2,
  TWO_PAIR = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FLUSH = 6,
  FULL_HOUSE = 7,
  FOUR_OF_A_KIND = 8,
  STRAIGHT_FLUSH = 9,
}

export interface HandValue {
  /** Category of the hand, 1 (high card) through 9 (straight flush). */
  rank: HandRank;
  /**
   * Category-relative kickers, most significant first. Two hands of the same
   * `rank` are compared by walking this array left to right.
   */
  tiebreakers: number[];
  /** Human readable description, e.g. "Royal Flush", "Full House". */
  name: string;
  /** The best five cards making up the hand. */
  cards: Card[];
}

// ---------------------------------------------------------------------------
// Players and seats
// ---------------------------------------------------------------------------

export type PlayerStatus =
  /** Dealt in and still able to act. */
  | 'ACTIVE'
  /** Dealt in, has folded this hand. */
  | 'FOLDED'
  /** Dealt in, has no chips behind; cannot act again this hand. */
  | 'ALL_IN'
  /** Seated but not dealt in this hand. */
  | 'SITTING_OUT';

export interface Player {
  id: string;
  name: string;
  /** Chips behind (not yet wagered). */
  stack: number;
  status: PlayerStatus;
  /** SECRET — never expose to anyone but this player. */
  holeCards: Card[];
  /** Chips wagered during the current betting round. */
  betThisRound: number;
  /** Chips wagered across the whole hand (drives side pot construction). */
  totalCommitted: number;
  /**
   * Whether this player has acted since the last full (betting-reopening)
   * raise. A short all-in deliberately does not clear this for players who
   * have already acted, which is what stops them re-raising.
   */
  hasActed: boolean;
  /** True once the hand reached showdown and this player's cards were shown. */
  revealed: boolean;
}

export interface Seat {
  index: number;
  player: Player | null;
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

export interface Pot {
  amount: number;
  /** Players who may win this pot (folded players are excluded). */
  eligiblePlayerIds: string[];
}

export interface PotAward {
  potIndex: number;
  amount: number;
  eligiblePlayerIds: string[];
  winners: { playerId: string; amount: number }[];
}

// ---------------------------------------------------------------------------
// Streets and actions
// ---------------------------------------------------------------------------

/**
 * Which rules a table runs. The difference is exactly two things: how many
 * hole cards are dealt, and whether a hand must use exactly two of them.
 */
export type GameVariant = 'HOLDEM' | 'OMAHA';

/** Hole cards dealt per player, per variant. */
export const HOLE_CARDS: Readonly<Record<GameVariant, number>> = {
  HOLDEM: 2,
  OMAHA: 4,
};

/**
 * Which rules the table with this id runs.
 *
 * The one definition of the convention, because two sides depend on it and
 * must not drift: the server decides a room's variant from its id (a client is
 * never allowed to name it — see `roomFor` in server/rooms.ts), and a table
 * page must therefore join an id that resolves to the variant it is drawn for.
 * A page joining an id this reads as HOLDEM gets two hole cards, whatever the
 * page thinks it is rendering.
 */
export function variantForTableId(tableId: string): GameVariant {
  return tableId.toLowerCase().startsWith('omaha') ? 'OMAHA' : 'HOLDEM';
}

export type Street =
  | 'WAITING'
  | 'PREFLOP'
  | 'FLOP'
  | 'TURN'
  | 'RIVER'
  | 'SHOWDOWN'
  | 'PAYOUT';

export type ActionType =
  | 'FOLD'
  | 'CHECK'
  | 'CALL'
  | 'BET'
  | 'RAISE'
  | 'ALL_IN'
  | 'POST_BLIND';

export interface Action {
  type: ActionType;
  playerId: string;
  /**
   * For BET and RAISE this is the *total* size of the player's bet for the
   * round ("raise to"), not the increment. Ignored by FOLD/CHECK/CALL/ALL_IN.
   * For POST_BLIND it is optional and validated against the required blind.
   */
  amount?: number;
}

export type BlindKind = 'SMALL' | 'BIG';

export interface PendingBlind {
  seatIndex: number;
  playerId: string;
  kind: BlindKind;
  amount: number;
}

// ---------------------------------------------------------------------------
// History and results
// ---------------------------------------------------------------------------

export interface HandEvent {
  street: Street;
  playerId: string | null;
  type: ActionType | 'DEAL' | 'STREET' | 'SHOWDOWN' | 'PAYOUT';
  amount?: number;
}

export interface ShowdownEntry {
  playerId: string;
  holeCards: Card[];
  hand: HandValue;
}

export interface HandResult {
  handId: number;
  wentToShowdown: boolean;
  pots: PotAward[];
  /** Net chips returned to each player from the pots, keyed by player id. */
  payouts: Record<string, number>;
  /** Null when the hand ended without a showdown. */
  showdown: ShowdownEntry[] | null;
}

// ---------------------------------------------------------------------------
// Table state
// ---------------------------------------------------------------------------

export interface RngState {
  /**
   * SECRET. When set, every deck is shuffled deterministically from
   * `${seed}#${handId}` so hands can be replayed. When null, the shuffle uses
   * `crypto.randomInt`.
   */
  seed: string | null;
  /** SECRET. The exact seed used for the current hand, for replay/audit. */
  handSeed: string | null;
}

export interface TableState {
  tableId: string;
  /** Which rules this table runs; fixed for the life of the table. */
  variant: GameVariant;
  handId: number;
  street: Street;
  seats: Seat[];
  buttonIndex: number;
  smallBlind: number;
  bigBlind: number;
  board: Card[];
  /** SECRET — remaining undealt cards, in order. */
  deck: Card[];
  /** SECRET — burn cards. */
  burned: Card[];
  /** SECRET — RNG seed material. */
  rng: RngState;
  /** Seat index of the player to act, or null when nobody may act. */
  actingIndex: number | null;
  /** Highest per-player wager in the current round. */
  currentBet: number;
  /** Size of the last full raise; the minimum increment for the next raise. */
  minRaise: number;
  lastAggressorIndex: number | null;
  /** Blinds that still have to be posted before the hand can proceed. */
  pendingBlinds: PendingBlind[];
  /** Pots as of the last completed betting round. */
  pots: Pot[];
  history: HandEvent[];
  result: HandResult | null;
}

// ---------------------------------------------------------------------------
// Public (client-safe) projections
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  name: string;
  seatIndex: number;
  stack: number;
  status: PlayerStatus;
  betThisRound: number;
  totalCommitted: number;
  /** True if the player is holding cards this hand. */
  hasCards: boolean;
  /** Populated only for the viewer, or for revealed hands at showdown. */
  holeCards: Card[] | null;
  isViewer: boolean;
}

export interface PublicSeat {
  index: number;
  player: PublicPlayer | null;
}

export interface LegalActions {
  playerId: string;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call; 0 when there is nothing to call. */
  callAmount: number;
  canBet: boolean;
  /** Smallest legal BET "to" amount. */
  minBet: number;
  canRaise: boolean;
  /** Smallest legal RAISE "to" amount. */
  minRaiseTo: number;
  /** Largest legal BET/RAISE "to" amount (i.e. the player's all-in size). */
  maxRaiseTo: number;
  canAllIn: boolean;
  allInTo: number;
  canPostBlind: boolean;
  blindAmount: number;
}

export interface PublicTableState {
  tableId: string;
  variant: GameVariant;
  handId: number;
  street: Street;
  buttonIndex: number;
  smallBlind: number;
  bigBlind: number;
  board: Card[];
  seats: PublicSeat[];
  actingIndex: number | null;
  actingPlayerId: string | null;
  currentBet: number;
  minRaise: number;
  pots: Pot[];
  /** Pots plus chips wagered in the current, uncollected round. */
  totalPot: number;
  history: HandEvent[];
  result: HandResult | null;
  viewerId: string;
  /** Non-null only when it is the viewer's turn. */
  legalActions: LegalActions | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PokerErrorCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_STREET'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_CANNOT_ACT'
  | 'ILLEGAL_ACTION'
  | 'INVALID_AMOUNT'
  | 'BELOW_MIN_RAISE'
  | 'BELOW_MIN_BET'
  | 'INSUFFICIENT_CHIPS'
  | 'BETTING_NOT_REOPENED'
  | 'BLIND_REQUIRED'
  | 'NOT_ENOUGH_PLAYERS'
  | 'INVALID_CARDS';

/** Typed error thrown for every illegal action or illegal transition. */
export class PokerError extends Error {
  readonly code: PokerErrorCode;

  constructor(code: PokerErrorCode, message: string) {
    super(message);
    this.name = 'PokerError';
    this.code = code;
  }
}
