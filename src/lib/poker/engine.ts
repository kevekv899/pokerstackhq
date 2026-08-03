import { createDeck, shuffle } from './deck';
import { evaluate7 } from './evaluator';
import { awardPots, buildPots, payoutsFromAwards, potTotal } from './pot';
import {
  PokerError,
  type Action,
  type Card,
  type HandValue,
  type LegalActions,
  type PendingBlind,
  type Player,
  type PublicSeat,
  type PublicTableState,
  type Seat,
  type ShowdownEntry,
  type Street,
  type TableState,
} from './types';

const BETTING_STREETS: readonly Street[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface SeatAssignment {
  seatIndex: number;
  id: string;
  name: string;
  stack: number;
}

export interface TableConfig {
  tableId: string;
  seatCount: number;
  smallBlind: number;
  bigBlind: number;
  /** SECRET. Table-level seed; each hand derives `${seed}#${handId}` from it. */
  seed?: string | null;
  buttonIndex?: number;
  players?: readonly SeatAssignment[];
}

/** Builds an empty table sitting in `WAITING`. */
export function createTable(config: TableConfig): TableState {
  const seats: Seat[] = Array.from({ length: config.seatCount }, (_, index) => ({
    index,
    player: null,
  }));

  const state: TableState = {
    tableId: config.tableId,
    handId: 0,
    street: 'WAITING',
    seats,
    buttonIndex: config.buttonIndex ?? 0,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    board: [],
    deck: [],
    burned: [],
    rng: { seed: config.seed ?? null, handSeed: null },
    actingIndex: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    lastAggressorIndex: null,
    pendingBlinds: [],
    pots: [],
    history: [],
    result: null,
  };

  for (const assignment of config.players ?? []) {
    seatPlayerInPlace(state, assignment);
  }
  return state;
}

/** Seats a player. Returns a new state; `state` is not mutated. */
export function seatPlayer(state: TableState, assignment: SeatAssignment): TableState {
  const next = clone(state);
  seatPlayerInPlace(next, assignment);
  return next;
}

function seatPlayerInPlace(state: TableState, assignment: SeatAssignment): void {
  const seat = state.seats[assignment.seatIndex];
  if (!seat) {
    throw new PokerError('ILLEGAL_ACTION', `No seat ${assignment.seatIndex}`);
  }
  if (seat.player) {
    throw new PokerError('ILLEGAL_ACTION', `Seat ${assignment.seatIndex} is taken`);
  }
  if (findSeatOf(state, assignment.id)) {
    throw new PokerError('ILLEGAL_ACTION', `${assignment.id} is already seated`);
  }
  seat.player = {
    id: assignment.id,
    name: assignment.name,
    stack: assignment.stack,
    status: assignment.stack > 0 ? 'ACTIVE' : 'SITTING_OUT',
    holeCards: [],
    betThisRound: 0,
    totalCommitted: 0,
    hasActed: false,
    revealed: false,
  };
}

// ---------------------------------------------------------------------------
// Hand lifecycle
// ---------------------------------------------------------------------------

export interface StartHandOptions {
  /**
   * Exact seed for this hand's shuffle. Overrides the table seed. Omit for a
   * `crypto.randomInt`-backed shuffle (unless the table itself is seeded).
   */
  seed?: string | number | null;
  buttonIndex?: number;
  /**
   * Test / replay hook: deal from this exact deck instead of shuffling. The
   * deck is consumed from the front.
   */
  deck?: readonly Card[];
}

/**
 * Deals a new hand: `WAITING` -> `PREFLOP`.
 *
 * The blinds are *not* posted automatically — the state comes back with
 * `pendingBlinds` queued, and the only legal action until they are cleared is
 * `POST_BLIND` from the player at the head of that queue.
 */
export function startHand(state: TableState, options: StartHandOptions = {}): TableState {
  if (state.street !== 'WAITING') {
    throw new PokerError(
      'WRONG_STREET',
      `Cannot start a hand from ${state.street}; finish the current hand first`,
    );
  }

  const next = clone(state);
  next.handId = state.handId + 1;
  next.street = 'PREFLOP';
  next.board = [];
  next.burned = [];
  next.pots = [];
  next.history = [];
  next.result = null;
  next.currentBet = 0;
  next.minRaise = next.bigBlind;
  next.lastAggressorIndex = null;

  for (const seat of next.seats) {
    const player = seat.player;
    if (!player) continue;
    player.holeCards = [];
    player.betThisRound = 0;
    player.totalCommitted = 0;
    player.hasActed = false;
    player.revealed = false;
    player.status =
      player.status === 'SITTING_OUT' || player.stack <= 0 ? 'SITTING_OUT' : 'ACTIVE';
  }

  const dealtIn = next.seats.filter((s) => s.player?.status === 'ACTIVE');
  if (dealtIn.length < 2) {
    throw new PokerError(
      'NOT_ENOUGH_PLAYERS',
      `Need at least 2 players with chips, have ${dealtIn.length}`,
    );
  }

  // Normalise the button onto an occupied, dealt-in seat.
  let button = options.buttonIndex ?? next.buttonIndex;
  if (next.seats[button]?.player?.status !== 'ACTIVE') {
    button = nextSeatWhere(next, button, (p) => p.status === 'ACTIVE') ?? button;
  }
  next.buttonIndex = button;

  const handSeed =
    options.seed !== undefined && options.seed !== null
      ? String(options.seed)
      : next.rng.seed !== null
        ? `${next.rng.seed}#${next.handId}`
        : null;
  next.rng.handSeed = handSeed;
  next.deck = options.deck ? options.deck.slice() : shuffle(createDeck(), handSeed);

  // Heads-up: the button posts the small blind. Otherwise blinds sit to the
  // left of the button as usual.
  const smallBlindIndex =
    dealtIn.length === 2
      ? button
      : (nextSeatWhere(next, button, (p) => p.status === 'ACTIVE') as number);
  const bigBlindIndex = nextSeatWhere(
    next,
    smallBlindIndex,
    (p) => p.status === 'ACTIVE',
  ) as number;

  // Two cards each, one at a time, starting to the left of the button.
  for (let round = 0; round < 2; round += 1) {
    let seatIndex = button;
    for (let dealt = 0; dealt < dealtIn.length; dealt += 1) {
      seatIndex = nextSeatWhere(next, seatIndex, (p) => p.status === 'ACTIVE') as number;
      const card = next.deck.shift();
      if (!card) throw new PokerError('INVALID_CARDS', 'Deck exhausted while dealing');
      (next.seats[seatIndex].player as Player).holeCards.push(card);
    }
  }

  next.pendingBlinds = [
    blindFor(next, smallBlindIndex, 'SMALL', next.smallBlind),
    blindFor(next, bigBlindIndex, 'BIG', next.bigBlind),
  ];
  next.actingIndex = smallBlindIndex;
  next.history.push({ street: 'PREFLOP', playerId: null, type: 'DEAL' });

  return next;
}

function blindFor(
  state: TableState,
  seatIndex: number,
  kind: PendingBlind['kind'],
  amount: number,
): PendingBlind {
  const player = state.seats[seatIndex].player as Player;
  return { seatIndex, playerId: player.id, kind, amount: Math.min(amount, player.stack) };
}

/**
 * The single reducer. Validates `action` against `state` and returns the next
 * state. Throws `PokerError` on anything illegal. Never mutates `state`.
 */
export function applyAction(state: TableState, action: Action): TableState {
  const next = clone(state);

  if (action.type === 'POST_BLIND') {
    postBlind(next, action);
    return next;
  }

  const { seatIndex, player } = requireTurn(next, action.playerId);

  switch (action.type) {
    case 'FOLD':
      player.status = 'FOLDED';
      player.hasActed = true;
      record(next, player.id, 'FOLD');
      break;

    case 'CHECK': {
      if (player.betThisRound !== next.currentBet) {
        throw new PokerError(
          'ILLEGAL_ACTION',
          `Cannot check facing a bet of ${next.currentBet}`,
        );
      }
      player.hasActed = true;
      record(next, player.id, 'CHECK');
      break;
    }

    case 'CALL': {
      const toCall = next.currentBet - player.betThisRound;
      if (toCall <= 0) {
        throw new PokerError('ILLEGAL_ACTION', 'Nothing to call — check instead');
      }
      const amount = Math.min(toCall, player.stack);
      commit(player, amount);
      player.hasActed = true;
      record(next, player.id, 'CALL', amount);
      break;
    }

    case 'BET': {
      if (next.currentBet > 0) {
        throw new PokerError('ILLEGAL_ACTION', 'Facing a bet — raise instead');
      }
      const to = requireAmount(action);
      const maxTo = player.betThisRound + player.stack;
      if (to > maxTo) {
        throw new PokerError('INSUFFICIENT_CHIPS', `Cannot bet ${to}, stack is ${player.stack}`);
      }
      const isAllIn = to === maxTo;
      if (to < next.bigBlind && !isAllIn) {
        throw new PokerError(
          'BELOW_MIN_BET',
          `Minimum opening bet is ${next.bigBlind}, got ${to}`,
        );
      }
      commit(player, to - player.betThisRound);
      player.hasActed = true;
      applyAggression(next, seatIndex, to, to >= next.bigBlind);
      record(next, player.id, 'BET', to);
      break;
    }

    case 'RAISE': {
      if (next.currentBet === 0) {
        throw new PokerError('ILLEGAL_ACTION', 'Nothing to raise — bet instead');
      }
      if (player.hasActed) {
        throw new PokerError(
          'BETTING_NOT_REOPENED',
          'Betting was not reopened for you — you may only call or fold',
        );
      }
      const to = requireAmount(action);
      const maxTo = player.betThisRound + player.stack;
      if (to > maxTo) {
        throw new PokerError('INSUFFICIENT_CHIPS', `Cannot raise to ${to}, max is ${maxTo}`);
      }
      if (to <= next.currentBet) {
        throw new PokerError(
          'INVALID_AMOUNT',
          `Raise must exceed the current bet of ${next.currentBet}`,
        );
      }
      const minTo = next.currentBet + next.minRaise;
      const isAllIn = to === maxTo;
      if (to < minTo && !isAllIn) {
        throw new PokerError('BELOW_MIN_RAISE', `Minimum raise is to ${minTo}, got ${to}`);
      }
      commit(player, to - player.betThisRound);
      player.hasActed = true;
      applyAggression(next, seatIndex, to, to >= minTo);
      record(next, player.id, 'RAISE', to);
      break;
    }

    case 'ALL_IN': {
      if (player.stack <= 0) {
        throw new PokerError('INSUFFICIENT_CHIPS', 'No chips left to push');
      }
      const to = player.betThisRound + player.stack;
      commit(player, player.stack);
      player.hasActed = true;
      if (to > next.currentBet) {
        const minTo = next.currentBet === 0 ? next.bigBlind : next.currentBet + next.minRaise;
        applyAggression(next, seatIndex, to, to >= minTo);
      }
      record(next, player.id, 'ALL_IN', to);
      break;
    }

    default: {
      const exhaustive: never = action.type;
      throw new PokerError('ILLEGAL_ACTION', `Unknown action ${String(exhaustive)}`);
    }
  }

  advance(next, seatIndex);
  return next;
}

/**
 * `SHOWDOWN` -> `PAYOUT`. Moves the awarded chips into the winners' stacks.
 * Split out so a caller can render the reveal before the pot slides across.
 */
export function settle(state: TableState): TableState {
  if (state.street !== 'SHOWDOWN') {
    throw new PokerError('WRONG_STREET', `settle() requires SHOWDOWN, got ${state.street}`);
  }
  const next = clone(state);
  creditPayouts(next);
  next.street = 'PAYOUT';
  next.history.push({ street: 'PAYOUT', playerId: null, type: 'PAYOUT' });
  return next;
}

/**
 * `PAYOUT` -> `WAITING`. Clears the hand, moves the button, and sits out
 * anyone who busted.
 */
export function endHand(state: TableState): TableState {
  if (state.street !== 'PAYOUT') {
    throw new PokerError('WRONG_STREET', `endHand() requires PAYOUT, got ${state.street}`);
  }
  const next = clone(state);
  next.street = 'WAITING';
  next.actingIndex = null;
  next.board = [];
  next.deck = [];
  next.burned = [];
  next.pendingBlinds = [];
  next.currentBet = 0;
  next.minRaise = next.bigBlind;
  next.lastAggressorIndex = null;

  for (const seat of next.seats) {
    const player = seat.player;
    if (!player) continue;
    player.holeCards = [];
    player.betThisRound = 0;
    player.totalCommitted = 0;
    player.hasActed = false;
    player.revealed = false;
    player.status = player.stack > 0 ? 'ACTIVE' : 'SITTING_OUT';
  }

  const nextButton = nextSeatWhere(next, next.buttonIndex, (p) => p.status === 'ACTIVE');
  if (nextButton !== null) next.buttonIndex = nextButton;

  return next;
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

function postBlind(state: TableState, action: Action): void {
  const pending = state.pendingBlinds[0];
  if (!pending) {
    throw new PokerError('ILLEGAL_ACTION', 'No blind is due');
  }
  if (pending.playerId !== action.playerId) {
    throw new PokerError(
      'NOT_YOUR_TURN',
      `${pending.playerId} owes the ${pending.kind.toLowerCase()} blind, not ${action.playerId}`,
    );
  }
  const player = state.seats[pending.seatIndex].player as Player;
  const amount = Math.min(pending.amount, player.stack);
  if (action.amount !== undefined && action.amount !== amount) {
    throw new PokerError('INVALID_AMOUNT', `Blind is ${amount}, got ${action.amount}`);
  }

  commit(player, amount);
  // A blind is forced, not an action: the big blind keeps the option to raise
  // when the action comes back around, so `hasActed` stays false.
  state.currentBet = Math.max(state.currentBet, player.betThisRound);
  state.pendingBlinds.shift();
  record(state, player.id, 'POST_BLIND', amount);

  if (state.pendingBlinds.length > 0) {
    state.actingIndex = state.pendingBlinds[0].seatIndex;
    return;
  }
  advance(state, pending.seatIndex);
}

function requireTurn(
  state: TableState,
  playerId: string,
): { seatIndex: number; player: Player } {
  if (!BETTING_STREETS.includes(state.street)) {
    throw new PokerError('WRONG_STREET', `No betting is open on ${state.street}`);
  }
  if (state.pendingBlinds.length > 0) {
    throw new PokerError(
      'BLIND_REQUIRED',
      `${state.pendingBlinds[0].playerId} must post the blind first`,
    );
  }
  if (state.actingIndex === null) {
    throw new PokerError('ILLEGAL_ACTION', 'Nobody is to act');
  }
  const player = state.seats[state.actingIndex]?.player;
  if (!player) {
    throw new PokerError('ILLEGAL_ACTION', 'Nobody is to act');
  }
  if (player.id !== playerId) {
    throw new PokerError('NOT_YOUR_TURN', `It is ${player.id}'s turn, not ${playerId}'s`);
  }
  if (player.status !== 'ACTIVE') {
    throw new PokerError('PLAYER_CANNOT_ACT', `${playerId} is ${player.status}`);
  }
  return { seatIndex: state.actingIndex, player };
}

function requireAmount(action: Action): number {
  const amount = action.amount;
  if (amount === undefined || !Number.isInteger(amount) || amount <= 0) {
    throw new PokerError(
      'INVALID_AMOUNT',
      `${action.type} needs a positive whole "to" amount, got ${String(amount)}`,
    );
  }
  return amount;
}

function commit(player: Player, amount: number): void {
  if (amount < 0 || amount > player.stack) {
    throw new PokerError(
      'INSUFFICIENT_CHIPS',
      `Cannot commit ${amount}, stack is ${player.stack}`,
    );
  }
  player.stack -= amount;
  player.betThisRound += amount;
  player.totalCommitted += amount;
  if (player.stack === 0) player.status = 'ALL_IN';
}

/**
 * Records a bet/raise. `reopens` is false for an all-in that falls short of a
 * full raise: the amount to call still goes up, but players who have already
 * acted keep `hasActed`, so they can only call or fold — the betting is not
 * reopened for them.
 */
function applyAggression(
  state: TableState,
  seatIndex: number,
  to: number,
  reopens: boolean,
): void {
  const increment = to - state.currentBet;
  state.currentBet = to;
  if (!reopens) return;

  state.minRaise = increment;
  state.lastAggressorIndex = seatIndex;
  for (const seat of state.seats) {
    if (seat.index === seatIndex) continue;
    if (seat.player?.status === 'ACTIVE') seat.player.hasActed = false;
  }
}

function record(
  state: TableState,
  playerId: string | null,
  type: Action['type'] | 'DEAL' | 'STREET' | 'SHOWDOWN' | 'PAYOUT',
  amount?: number,
): void {
  state.history.push({ street: state.street, playerId, type, amount });
}

// ---------------------------------------------------------------------------
// Round / street progression
// ---------------------------------------------------------------------------

function advance(state: TableState, fromIndex: number): void {
  if (contenders(state).length <= 1) {
    endWithoutShowdown(state);
    return;
  }

  const nextIndex = nextToAct(state, fromIndex);
  if (nextIndex !== null) {
    state.actingIndex = nextIndex;
    return;
  }

  closeBettingRound(state);
  runOut(state);
}

/**
 * The round is over once every player who can still act has acted since the
 * last full raise *and* matched the current bet — which is exactly the
 * condition under which nobody is left to act.
 */
function nextToAct(state: TableState, fromIndex: number): number | null {
  const count = state.seats.length;
  for (let step = 1; step <= count; step += 1) {
    const seat = state.seats[(fromIndex + step) % count];
    const player = seat.player;
    if (!player || player.status !== 'ACTIVE') continue;
    if (!player.hasActed || player.betThisRound < state.currentBet) return seat.index;
  }
  return null;
}

function closeBettingRound(state: TableState): void {
  returnUncalledBet(state);
  for (const seat of state.seats) {
    if (!seat.player) continue;
    seat.player.betThisRound = 0;
    seat.player.hasActed = false;
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.lastAggressorIndex = null;
  state.pots = buildPots(players(state));
}

/**
 * Hands back the slice of a bet nobody could cover. Without this the chips
 * would sit in a pot only their owner is eligible for.
 */
function returnUncalledBet(state: TableState): void {
  let top: Player | null = null;
  let topBet = 0;
  let secondBet = 0;

  for (const seat of state.seats) {
    const player = seat.player;
    if (!player || player.betThisRound <= 0) continue;
    if (player.betThisRound > topBet) {
      secondBet = topBet;
      topBet = player.betThisRound;
      top = player;
    } else if (player.betThisRound > secondBet) {
      secondBet = player.betThisRound;
    }
  }

  if (!top || topBet <= secondBet) return;
  const refund = topBet - secondBet;
  top.stack += refund;
  top.betThisRound -= refund;
  top.totalCommitted -= refund;
  if (top.status === 'ALL_IN' && top.stack > 0) top.status = 'ACTIVE';
}

/** Deals whatever streets are left and stops at the next betting decision. */
function runOut(state: TableState): void {
  for (;;) {
    if (contenders(state).length <= 1) {
      endWithoutShowdown(state);
      return;
    }
    if (state.street === 'RIVER') {
      goToShowdown(state);
      return;
    }

    dealNextStreet(state);

    const canAct = players(state).filter((p) => p.status === 'ACTIVE').length;
    if (canAct >= 2) {
      const first = nextToAct(state, state.buttonIndex);
      if (first !== null) {
        state.actingIndex = first;
        return;
      }
    }
    // Everyone left is all-in (or only one player can act): keep dealing.
  }
}

function dealNextStreet(state: TableState): void {
  const draw = (): Card => {
    const card = state.deck.shift();
    if (!card) throw new PokerError('INVALID_CARDS', 'Deck exhausted');
    return card;
  };

  switch (state.street) {
    case 'PREFLOP':
      state.street = 'FLOP';
      state.burned.push(draw());
      state.board.push(draw(), draw(), draw());
      break;
    case 'FLOP':
      state.street = 'TURN';
      state.burned.push(draw());
      state.board.push(draw());
      break;
    case 'TURN':
      state.street = 'RIVER';
      state.burned.push(draw());
      state.board.push(draw());
      break;
    default:
      throw new PokerError('WRONG_STREET', `Cannot deal past ${state.street}`);
  }
  state.actingIndex = null;
  record(state, null, 'STREET');
}

// ---------------------------------------------------------------------------
// Hand resolution
// ---------------------------------------------------------------------------

function endWithoutShowdown(state: TableState): void {
  returnUncalledBet(state);
  for (const seat of state.seats) {
    if (seat.player) seat.player.betThisRound = 0;
  }

  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.lastAggressorIndex = null;
  state.pots = buildPots(players(state));
  const awards = awardPots(state.pots, new Map(), oddChipOrder(state));

  state.result = {
    handId: state.handId,
    wentToShowdown: false,
    pots: awards,
    payouts: payoutsFromAwards(awards),
    showdown: null,
  };
  state.actingIndex = null;
  state.street = 'PAYOUT';
  creditPayouts(state);
  record(state, null, 'PAYOUT');
}

function goToShowdown(state: TableState): void {
  state.street = 'SHOWDOWN';
  state.actingIndex = null;

  const strengths = new Map<string, HandValue | null>();
  const entries: ShowdownEntry[] = [];

  for (const player of contenders(state)) {
    player.revealed = true;
    const hand = evaluate7([...player.holeCards, ...state.board]);
    strengths.set(player.id, hand);
    entries.push({
      playerId: player.id,
      holeCards: player.holeCards.map((c) => ({ ...c })),
      hand,
    });
  }

  state.pots = buildPots(players(state));
  const awards = awardPots(state.pots, strengths, oddChipOrder(state));

  state.result = {
    handId: state.handId,
    wentToShowdown: true,
    pots: awards,
    payouts: payoutsFromAwards(awards),
    showdown: entries,
  };
  record(state, null, 'SHOWDOWN');
}

function creditPayouts(state: TableState): void {
  const payouts = state.result?.payouts;
  if (!payouts) return;
  for (const seat of state.seats) {
    const player = seat.player;
    if (!player) continue;
    const won = payouts[player.id];
    if (won) player.stack += won;
  }
}

/** Player ids clockwise from the first seat left of the button. */
function oddChipOrder(state: TableState): string[] {
  const order: string[] = [];
  const count = state.seats.length;
  for (let step = 1; step <= count; step += 1) {
    const seat = state.seats[(state.buttonIndex + step) % count];
    if (seat.player) order.push(seat.player.id);
  }
  return order;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** What `playerId` may legally do right now, or null if it is not their turn. */
export function getLegalActions(state: TableState, playerId: string): LegalActions | null {
  const empty: LegalActions = {
    playerId,
    canFold: false,
    canCheck: false,
    canCall: false,
    callAmount: 0,
    canBet: false,
    minBet: 0,
    canRaise: false,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    canAllIn: false,
    allInTo: 0,
    canPostBlind: false,
    blindAmount: 0,
  };

  const pending = state.pendingBlinds[0];
  if (pending) {
    if (pending.playerId !== playerId) return null;
    const player = state.seats[pending.seatIndex].player as Player;
    return { ...empty, canPostBlind: true, blindAmount: Math.min(pending.amount, player.stack) };
  }

  if (!BETTING_STREETS.includes(state.street) || state.actingIndex === null) return null;
  const player = state.seats[state.actingIndex]?.player;
  if (!player || player.id !== playerId || player.status !== 'ACTIVE') return null;

  const toCall = state.currentBet - player.betThisRound;
  const maxRaiseTo = player.betThisRound + player.stack;

  return {
    playerId,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && player.stack > 0,
    callAmount: Math.min(Math.max(toCall, 0), player.stack),
    canBet: state.currentBet === 0 && player.stack > 0,
    minBet: Math.min(state.bigBlind, maxRaiseTo),
    canRaise:
      state.currentBet > 0 &&
      !player.hasActed &&
      player.stack > 0 &&
      maxRaiseTo > state.currentBet,
    minRaiseTo: Math.min(state.currentBet + state.minRaise, maxRaiseTo),
    maxRaiseTo,
    canAllIn: player.stack > 0,
    allInTo: maxRaiseTo,
    canPostBlind: false,
    blindAmount: 0,
  };
}

/** Chips in collected pots plus chips wagered in the current, open round. */
export function totalPot(state: TableState): number {
  const live = players(state).reduce((sum, p) => sum + p.betThisRound, 0);
  return potTotal(state.pots) + live;
}

// ---------------------------------------------------------------------------
// Public projection — the only thing a client may ever receive
// ---------------------------------------------------------------------------

/**
 * Projects `state` down to what `viewerId` is allowed to see.
 *
 * The deck, the burn pile and the RNG seed are dropped entirely. Hole cards
 * are returned for the viewer only, plus any opponent who was revealed at
 * showdown. Everyone else's cards come back as null.
 *
 * This is built field by field on purpose — never spread `TableState` here,
 * or a future secret field leaks to the client by default.
 */
export function toPublicState(state: TableState, viewerId: string): PublicTableState {
  const showdownReached = state.street === 'SHOWDOWN' || state.street === 'PAYOUT';

  const seats: PublicSeat[] = state.seats.map((seat) => {
    const player = seat.player;
    if (!player) return { index: seat.index, player: null };

    const isViewer = player.id === viewerId;
    const visible =
      isViewer || (showdownReached && player.revealed && player.status !== 'FOLDED');

    return {
      index: seat.index,
      player: {
        id: player.id,
        name: player.name,
        seatIndex: seat.index,
        stack: player.stack,
        status: player.status,
        betThisRound: player.betThisRound,
        totalCommitted: player.totalCommitted,
        hasCards: player.holeCards.length > 0,
        holeCards: visible ? player.holeCards.map((c) => ({ ...c })) : null,
        isViewer,
      },
    };
  });

  const actingPlayer =
    state.actingIndex === null ? null : (state.seats[state.actingIndex]?.player ?? null);

  return {
    tableId: state.tableId,
    handId: state.handId,
    street: state.street,
    buttonIndex: state.buttonIndex,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    board: state.board.map((c) => ({ ...c })),
    seats,
    actingIndex: state.actingIndex,
    actingPlayerId: actingPlayer?.id ?? null,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    pots: state.pots.map((pot) => ({
      amount: pot.amount,
      eligiblePlayerIds: pot.eligiblePlayerIds.slice(),
    })),
    totalPot: totalPot(state),
    history: state.history.map((event) => ({ ...event })),
    result: state.result ? structuredClone(state.result) : null,
    viewerId,
    legalActions: getLegalActions(state, viewerId),
  };
}

// ---------------------------------------------------------------------------
// Small internals
// ---------------------------------------------------------------------------

function clone(state: TableState): TableState {
  return structuredClone(state);
}

function players(state: TableState): Player[] {
  return state.seats.map((s) => s.player).filter((p): p is Player => p !== null);
}

/** Players still in the hand: not folded, not sitting out. */
function contenders(state: TableState): Player[] {
  return players(state).filter((p) => p.status === 'ACTIVE' || p.status === 'ALL_IN');
}

function findSeatOf(state: TableState, playerId: string): Seat | undefined {
  return state.seats.find((s) => s.player?.id === playerId);
}

function nextSeatWhere(
  state: TableState,
  fromIndex: number,
  predicate: (player: Player) => boolean,
): number | null {
  const count = state.seats.length;
  for (let step = 1; step <= count; step += 1) {
    const seat = state.seats[(fromIndex + step) % count];
    if (seat.player && predicate(seat.player)) return seat.index;
  }
  return null;
}
