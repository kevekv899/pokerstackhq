/**
 * One Room per tableId. Owns a `TableState` in memory and is the only thing
 * allowed to touch it.
 *
 * SECURITY: `TableState` holds hole cards, the undealt deck and the RNG seed.
 * Everything that leaves this file goes through `toPublicState(state, viewerId)`
 * — see `send()`, which is the single write path to a socket. Do not add
 * another one, and do not broadcast raw state "just for debugging".
 *
 * No persistence yet: nothing here writes to Supabase.
 */

import {
  applyAction,
  createTable,
  endHand,
  getLegalActions,
  PokerError,
  seatPlayer,
  settle,
  startHand,
  toPublicState,
  type Action,
  type ActionType,
  type TableState,
} from '../src/lib/poker/index.js';
import { ActionClock } from './clock.js';

/** How long clients get to animate the reveal before chips move. */
export const SHOWDOWN_REVEAL_MS = 4000;

/** Actions a client is allowed to send. POST_BLIND is deliberately absent. */
const CLIENT_ACTIONS: ReadonlySet<string> = new Set<ActionType>([
  'FOLD',
  'CHECK',
  'CALL',
  'BET',
  'RAISE',
  'ALL_IN',
]);

/** The slice of a WebSocket the room needs. Keeps rooms testable without ws. */
export interface RoomSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RoomOptions {
  tableId: string;
  seatCount?: number;
  smallBlind?: number;
  bigBlind?: number;
  /** SECRET. Deterministic shuffles for replay/tests. Never sent to a client. */
  seed?: string | null;
  showdownRevealMs?: number;
}

export class Room {
  readonly tableId: string;
  private state: TableState;

  /** Every authenticated connection, seated or not: userId -> socket. */
  private readonly sockets = new Map<string, RoomSocket>();
  /** Seated players: userId -> seat index. */
  private readonly seats = new Map<string, number>();
  /** Seated mid-hand, waiting to be dealt in on the next hand. */
  private readonly waiting = new Set<string>();
  /** Asked to leave while a hand was live; unseated once it finishes. */
  private readonly leaving = new Set<string>();

  private readonly clock = new ActionClock();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly showdownRevealMs: number;
  /** True between reaching SHOWDOWN and finishing the hand — actions are refused. */
  private settling = false;

  constructor(options: RoomOptions) {
    this.tableId = options.tableId;
    this.showdownRevealMs = options.showdownRevealMs ?? SHOWDOWN_REVEAL_MS;
    this.state = createTable({
      tableId: options.tableId,
      seatCount: options.seatCount ?? 6,
      smallBlind: options.smallBlind ?? 5,
      bigBlind: options.bigBlind ?? 10,
      seed: options.seed ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  /**
   * Seats `userId`, or restores them if they are already seated — a reconnect
   * mid-hand keeps the seat, the stack and the hole cards.
   */
  join(userId: string, name: string, socket: RoomSocket, buyIn: number): void {
    this.sockets.set(userId, socket);
    this.leaving.delete(userId);

    if (this.seats.has(userId)) {
      // Reconnect: their seat is still live, just re-point the socket.
      this.sendTo(userId);
      return;
    }

    const seatIndex = this.state.seats.findIndex((seat) => seat.player === null);
    if (seatIndex === -1) {
      this.error(userId, 'TABLE_FULL', 'No seat available at this table');
      return;
    }
    if (!Number.isInteger(buyIn) || buyIn <= 0) {
      this.error(userId, 'INVALID_BUYIN', 'Buy-in must be a positive whole number of chips');
      return;
    }

    this.state = seatPlayer(this.state, { seatIndex, id: userId, name, stack: buyIn });
    this.seats.set(userId, seatIndex);

    // A player seated mid-hand must not be treated as a contender in it.
    // `contenders()` counts anyone ACTIVE, and they hold no cards, so park them
    // as SITTING_OUT and deal them in at the start of the next hand.
    if (this.state.street !== 'WAITING') {
      const player = this.state.seats[seatIndex].player;
      if (player) player.status = 'SITTING_OUT';
      this.waiting.add(userId);
    }

    this.broadcast();
    this.maybeStartHand();
  }

  /**
   * Drops a player. Mid-hand they are folded (if it is their turn) and unseated
   * once the hand finishes, so the engine never loses a live contender.
   */
  leave(userId: string): void {
    if (!this.seats.has(userId)) {
      this.sockets.delete(userId);
      return;
    }

    if (this.state.street === 'WAITING') {
      this.unseat(userId);
      this.sockets.delete(userId);
      this.broadcast();
      return;
    }

    this.leaving.add(userId);
    if (this.actingPlayerId() === userId && !this.settling) {
      this.applyServerAction({ type: 'FOLD', playerId: userId });
    }
    this.sockets.delete(userId);
    this.broadcast();
  }

  /** A socket dropped. Keeps the seat so a reconnect can reclaim it. */
  disconnect(userId: string): void {
    this.sockets.delete(userId);
    // Nobody is watching this decision any more; don't leave a timer armed for
    // a socket that is gone.
    if (this.actingPlayerId() === userId) this.clock.clear();
  }

  /** Cancels every pending timer. For shutdown and tests. */
  dispose(): void {
    this.clock.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Handles a client action. Every rejection is reported to that one socket and
   * never throws out of here — a bad action must not take the room down.
   */
  action(userId: string, type: unknown, amount?: unknown): void {
    if (this.settling) {
      this.error(userId, 'WRONG_STREET', 'Hand is being settled');
      return;
    }
    if (typeof type !== 'string' || !CLIENT_ACTIONS.has(type)) {
      // POST_BLIND lands here: blinds are posted by the server, never by a client.
      this.error(userId, 'ILLEGAL_ACTION', `Unsupported action ${String(type)}`);
      return;
    }
    if (!this.seats.has(userId)) {
      this.error(userId, 'UNKNOWN_PLAYER', 'You are not seated at this table');
      return;
    }
    if (this.actingPlayerId() !== userId) {
      this.error(userId, 'NOT_YOUR_TURN', 'It is not your turn');
      return;
    }
    if (amount !== undefined && typeof amount !== 'number') {
      this.error(userId, 'INVALID_AMOUNT', 'amount must be a number');
      return;
    }

    const action: Action = { type: type as ActionType, playerId: userId };
    if (typeof amount === 'number') action.amount = amount;

    try {
      this.state = applyAction(this.state, action);
    } catch (err) {
      this.reportPokerError(userId, err);
      return;
    }

    this.clock.clear();
    this.afterChange();
  }

  // -------------------------------------------------------------------------
  // Hand lifecycle
  // -------------------------------------------------------------------------

  private maybeStartHand(): void {
    if (this.settling || this.state.street !== 'WAITING') return;

    // Deal in anyone who was seated mid-hand or sat out after busting.
    for (const seat of this.state.seats) {
      const player = seat.player;
      if (player && player.stack > 0) player.status = 'ACTIVE';
    }
    this.waiting.clear();

    const ready = this.state.seats.filter(
      (seat) => seat.player !== null && seat.player.stack > 0,
    ).length;
    if (ready < 2) {
      this.broadcast();
      return;
    }

    try {
      this.state = startHand(this.state);
    } catch (err) {
      // NOT_ENOUGH_PLAYERS and friends are recoverable: stay in WAITING.
      this.logPokerError('startHand', err);
      return;
    }

    this.postPendingBlinds();
    this.afterChange();
  }

  /**
   * Blinds come off the engine's queue and are posted BY THE SERVER. A client
   * POST_BLIND is rejected in `action()`.
   */
  private postPendingBlinds(): void {
    while (this.state.pendingBlinds.length > 0) {
      const blind = this.state.pendingBlinds[0];
      try {
        this.state = applyAction(this.state, {
          type: 'POST_BLIND',
          playerId: blind.playerId,
        });
      } catch (err) {
        this.logPokerError('postBlind', err);
        return;
      }
    }
  }

  /** Broadcasts, then drives whatever the new street requires. */
  private afterChange(): void {
    this.broadcast();

    if (this.state.street === 'SHOWDOWN') {
      this.beginShowdown();
      return;
    }
    if (this.state.street === 'PAYOUT') {
      // Uncontested win: the engine already went straight to PAYOUT and
      // credited the chips, so there is nothing to settle.
      this.finishHand();
      return;
    }
    this.armClock();
  }

  private beginShowdown(): void {
    this.settling = true;
    this.clock.clear();

    const result = this.state.result;
    for (const [userId] of this.sockets) {
      this.push(userId, {
        type: 'showdown',
        state: toPublicState(this.state, userId),
        result,
      });
    }

    this.after(this.showdownRevealMs, () => {
      try {
        this.state = settle(this.state);
      } catch (err) {
        this.logPokerError('settle', err);
        this.settling = false;
        return;
      }
      this.broadcast();
      this.finishHand();
    });
  }

  /** PAYOUT -> WAITING, plus the housekeeping the engine does not do. */
  private finishHand(): void {
    const result = this.state.result;
    for (const [userId] of this.sockets) {
      this.push(userId, {
        type: 'handEnd',
        state: toPublicState(this.state, userId),
        result,
      });
    }

    try {
      this.state = endHand(this.state);
    } catch (err) {
      this.logPokerError('endHand', err);
      this.settling = false;
      return;
    }

    for (const userId of [...this.leaving]) this.unseat(userId);
    this.leaving.clear();
    this.settling = false;

    this.broadcast();
    this.maybeStartHand();
  }

  // -------------------------------------------------------------------------
  // Clock
  // -------------------------------------------------------------------------

  private armClock(): void {
    const playerId = this.actingPlayerId();
    if (playerId === null) {
      this.clock.clear();
      return;
    }

    // History length changes on every action, so each decision gets its own key
    // and therefore its own fresh 20s.
    const key = `${this.state.handId}:${this.state.street}:${playerId}:${this.state.history.length}`;
    this.clock.arm(key, () => this.onTimeout(playerId));
  }

  private onTimeout(playerId: string): void {
    if (this.settling || this.actingPlayerId() !== playerId) return;

    const legal = getLegalActions(this.state, playerId);
    const type: ActionType = legal?.canCheck ? 'CHECK' : 'FOLD';
    this.applyServerAction({ type, playerId });
  }

  /** Applies an action the server decided on (timeout, forced fold on leave). */
  private applyServerAction(action: Action): void {
    try {
      this.state = applyAction(this.state, action);
    } catch (err) {
      this.logPokerError('serverAction', err);
      return;
    }
    this.clock.clear();
    this.afterChange();
  }

  // -------------------------------------------------------------------------
  // Messaging — the only place state reaches a socket
  // -------------------------------------------------------------------------

  private broadcast(): void {
    for (const [userId] of this.sockets) this.sendTo(userId);
  }

  private sendTo(userId: string): void {
    this.push(userId, { type: 'state', state: toPublicState(this.state, userId) });
  }

  private error(userId: string, code: string, message: string): void {
    this.push(userId, { type: 'error', code, message });
  }

  private push(userId: string, payload: unknown): void {
    const socket = this.sockets.get(userId);
    if (!socket) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (err) {
      // A dead socket must not interrupt the broadcast to everyone else.
      console.error(`[room ${this.tableId}] send to ${userId} failed:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private actingPlayerId(): string | null {
    if (this.state.actingIndex === null) return null;
    return this.state.seats[this.state.actingIndex]?.player?.id ?? null;
  }

  /**
   * Frees a seat. Only safe outside a live hand — the engine has no unseat API,
   * so this edits the seat directly rather than reimplementing hand logic.
   */
  private unseat(userId: string): void {
    const seatIndex = this.seats.get(userId);
    if (seatIndex === undefined) return;
    const seat = this.state.seats[seatIndex];
    if (seat) seat.player = null;
    this.seats.delete(userId);
    this.waiting.delete(userId);
  }

  private after(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      try {
        fn();
      } catch (err) {
        console.error(`[room ${this.tableId}] deferred task failed:`, err);
      }
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
  }

  private reportPokerError(userId: string, err: unknown): void {
    if (err instanceof PokerError) {
      this.error(userId, err.code, err.message);
      return;
    }
    console.error(`[room ${this.tableId}] unexpected error:`, err);
    this.error(userId, 'INTERNAL', 'Something went wrong');
  }

  private logPokerError(where: string, err: unknown): void {
    if (err instanceof PokerError) {
      console.warn(`[room ${this.tableId}] ${where}: ${err.code} ${err.message}`);
      return;
    }
    console.error(`[room ${this.tableId}] ${where} failed:`, err);
  }
}
