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
  forfeitHand,
  getLegalActions,
  PokerError,
  seatPlayer,
  settle,
  startHand,
  toPublicState,
  type Action,
  type ActionType,
  type GameVariant,
  type TableState,
} from '../src/lib/poker/index.js';
import { randomUUID } from 'node:crypto';

import { ActionClock } from './clock.js';
import {
  defaultHandWriter,
  persistHand,
  type HandActionRecord,
  type HandPlayerRecord,
  type HandRecord,
  type HandWriter,
} from './persistence.js';

/** How long clients get to animate the reveal before chips move. */
export const SHOWDOWN_REVEAL_MS = 4000;

/** Streets on which a hand is still being contested and can be mucked. */
const HAND_IS_LIVE: ReadonlySet<string> = new Set(['PREFLOP', 'FLOP', 'TURN', 'RIVER']);

/** Actions a client is allowed to send. POST_BLIND is deliberately absent. */
const CLIENT_ACTIONS: ReadonlySet<string> = new Set<ActionType>([
  'FOLD',
  'CHECK',
  'CALL',
  'BET',
  'RAISE',
  'ALL_IN',
]);

/**
 * Chat limits. Enforced here and nowhere else that matters: the input's own
 * `maxlength` is a courtesy to whoever is typing, not a control — anything
 * holding a socket can send whatever it likes.
 */
export const CHAT_MAX_LENGTH = 200;
/** How much backlog a room keeps, and hands to whoever joins next. */
export const CHAT_HISTORY_LIMIT = 50;
/** At most this many messages per user per window; the rest are dropped. */
export const CHAT_RATE_LIMIT = 5;
export const CHAT_RATE_WINDOW_MS = 10_000;

/**
 * A chat line as it goes out on the wire.
 *
 * `username` and `at` are stamped by the room, never copied off the incoming
 * message — see `chat()`.
 */
export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  at: number;
}

/**
 * The engine keys players by string; the database keys them by the app's
 * numeric user id. Returns null for anything that is not one, which is the
 * room's cue not to write the hand at all.
 */
function numericUserId(playerId: string): number | null {
  return /^\d+$/.test(playerId) ? Number(playerId) : null;
}

/** The slice of a WebSocket the room needs. Keeps rooms testable without ws. */
export interface RoomSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RoomOptions {
  tableId: string;
  /** Which rules this room runs. Defaults to Hold'em. */
  variant?: GameVariant;
  seatCount?: number;
  smallBlind?: number;
  bigBlind?: number;
  /** SECRET. Deterministic shuffles for replay/tests. Never sent to a client. */
  seed?: string | null;
  showdownRevealMs?: number;
  /** How long each decision gets. Shortened in tests. */
  actionTimeoutMs?: number;
  /**
   * Where finished hands are written. Defaults to the process-wide Supabase
   * writer, which is a no-op when the server has no credentials.
   */
  handWriter?: HandWriter;
}

/** What the room remembers about a player from the moment they were dealt in. */
interface HandSeatSnapshot {
  playerId: string;
  seat: number;
  position: string;
  startingStack: number;
}

/** A history event with the time the room saw it, before it is keyed by user. */
interface LoggedEvent {
  seq: number;
  playerId: string | null;
  street: string;
  action: string;
  amount: number;
  at: string;
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

  /**
   * Display names as the *session* gave them, userId -> username. The only
   * source of a name on a chat line; nothing a client sends is consulted.
   */
  private readonly names = new Map<string, string>();
  /** The last `CHAT_HISTORY_LIMIT` messages, oldest first. Memory only. */
  private readonly chatHistory: ChatMessage[] = [];
  /**
   * Send times inside the current window, userId -> epoch ms. Deliberately
   * kept after a player leaves: forgetting it would make leaving and rejoining
   * a way to buy a fresh allowance. At most `CHAT_RATE_LIMIT` numbers per user.
   */
  private readonly chatTimes = new Map<string, number[]>();

  /**
   * Hand history. Filled as the hand runs, written once when it ends — see
   * `writeHandHistory`. Nothing in here is ever read back into the game: the
   * chips in `state` stay authoritative whatever the database is doing.
   */
  private readonly handWriter: HandWriter;
  /** When the current hand was dealt, or null between hands. */
  private handStartedAt: number | null = null;
  /** Seat, position and stack for each player dealt into the current hand. */
  private handSeats: HandSeatSnapshot[] = [];
  /** Every history event so far this hand, stamped when the room saw it. */
  private eventLog: LoggedEvent[] = [];

  private readonly clock: ActionClock;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly showdownRevealMs: number;
  /** True between reaching SHOWDOWN and finishing the hand — actions are refused. */
  private settling = false;

  constructor(options: RoomOptions) {
    this.tableId = options.tableId;
    this.showdownRevealMs = options.showdownRevealMs ?? SHOWDOWN_REVEAL_MS;
    this.handWriter = options.handWriter ?? defaultHandWriter();
    this.clock = new ActionClock(options.actionTimeoutMs);
    this.state = createTable({
      tableId: options.tableId,
      variant: options.variant ?? 'HOLDEM',
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
    this.names.set(userId, name);
    this.leaving.delete(userId);

    // Before anything that can return early: someone who finds the table full,
    // or who is reconnecting, still gets the room's recent context.
    this.sendChatHistory(userId);

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
   * Gives up a seat for good — the explicit counterpart to `disconnect()`,
   * which holds the seat for a reconnect.
   *
   * Mid-hand their hand is mucked at once, whoever happens to be on the clock
   * (`forfeitHand`), which runs the same end-of-hand check as any other fold.
   * That matters heads-up: folding them leaves one contender, so the hand ends
   * uncontested there and then instead of the pot sitting in the middle while
   * the remaining player waits on someone who has gone.
   *
   * Chips they have already put in stay in the pot and are won by whoever
   * takes the hand. Nothing is refunded; only the stack still in front of them
   * is theirs to cash out. The seat itself is released at the end of the hand
   * (`finishHand`), so the engine never loses a live contender mid-hand.
   */
  leave(userId: string): void {
    if (!this.seats.has(userId)) {
      this.confirmLeft(userId);
      this.sockets.delete(userId);
      return;
    }

    if (this.state.street === 'WAITING') {
      this.unseat(userId);
      this.confirmLeft(userId);
      this.sockets.delete(userId);
      this.broadcast();
      return;
    }

    this.leaving.add(userId);
    // Muck their hand wherever the action happens to be. Folding only when it
    // was their turn left the hand running on a player who had gone: heads-up
    // that stranded the pot in the middle until the other player acted, since
    // nothing had re-checked whether the hand was already over.
    if (HAND_IS_LIVE.has(this.state.street) && !this.settling) {
      this.forfeit(userId);
    }
    // Acknowledge before dropping the socket — this is the last thing they
    // will hear from us, and the client waits for it before navigating away.
    this.confirmLeft(userId);
    this.sockets.delete(userId);
    this.broadcast();
  }

  /** A socket dropped. Keeps the seat so a reconnect can reclaim it. */
  disconnect(userId: string): void {
    this.sockets.delete(userId);
    // The action clock is deliberately left running. Disarming it for the
    // player who just dropped would stall the hand indefinitely: nothing
    // re-arms it, so everyone else waits on a socket that may never return.
    // Leaving it armed times them out and auto-folds them like anyone else,
    // and a reconnect within the window still gets the remaining time.
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
  // Chat
  // -------------------------------------------------------------------------

  /**
   * Takes a chat line from `userId` and gives it to the whole room.
   *
   * The *only* thing taken from the client is the text. The name on the line
   * and the time on it are the server's: a client that could supply either
   * could post as another player at the table, or reorder the log by lying
   * about when it spoke.
   *
   * Every rejection goes to that one socket and nothing is broadcast — a
   * message that breaks the rules is dropped, not delivered as an apology to
   * everyone else.
   */
  chat(userId: string, text: unknown): void {
    if (!this.sockets.has(userId)) {
      this.error(userId, 'UNKNOWN_PLAYER', 'You are not at this table');
      return;
    }
    if (typeof text !== 'string') {
      this.error(userId, 'BAD_MESSAGE', 'chat needs a text string');
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      this.error(userId, 'EMPTY_MESSAGE', 'Nothing to say');
      return;
    }
    if (trimmed.length > CHAT_MAX_LENGTH) {
      this.error(
        userId,
        'MESSAGE_TOO_LONG',
        `Keep it to ${CHAT_MAX_LENGTH} characters or fewer`,
      );
      return;
    }
    // Last, so a rejected message never costs the sender part of their
    // allowance — only messages that are actually delivered do.
    if (!this.allowChat(userId)) {
      this.error(userId, 'RATE_LIMITED', 'You are sending messages too quickly');
      return;
    }

    const message: ChatMessage = {
      userId,
      username: this.names.get(userId) ?? userId,
      text: trimmed,
      at: Date.now(),
    };

    this.chatHistory.push(message);
    if (this.chatHistory.length > CHAT_HISTORY_LIMIT) {
      this.chatHistory.splice(0, this.chatHistory.length - CHAT_HISTORY_LIMIT);
    }

    for (const [id] of this.sockets) this.push(id, { type: 'chat', ...message });
  }

  /**
   * Whether `userId` may send right now, counting a send if so. A sliding
   * window rather than a fixed one, so a burst cannot straddle a boundary and
   * land twice the allowance in a moment.
   */
  private allowChat(userId: string): boolean {
    const now = Date.now();
    const recent = (this.chatTimes.get(userId) ?? []).filter(
      (at) => now - at < CHAT_RATE_WINDOW_MS,
    );
    if (recent.length >= CHAT_RATE_LIMIT) {
      this.chatTimes.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.chatTimes.set(userId, recent);
    return true;
  }

  /** The backlog, so a joiner arrives mid-conversation rather than at silence. */
  private sendChatHistory(userId: string): void {
    this.push(userId, { type: 'chatHistory', messages: this.chatHistory });
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

    // Before the blinds go in, so the recorded stacks are what each player sat
    // down with this hand, and while `pendingBlinds` still says who posts what.
    this.snapshotHandStart();
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
    if (this.state.street === 'SHOWDOWN') {
      this.broadcast();
      this.beginShowdown();
      return;
    }
    if (this.state.street === 'PAYOUT') {
      // Uncontested win: the engine already went straight to PAYOUT and
      // credited the chips, so there is nothing to settle.
      this.broadcast();
      this.finishHand();
      return;
    }
    // Arm before broadcasting: the clock's deadline rides along on every state
    // message, so re-arming afterwards would ship a decision with a stale (or
    // null) deadline and leave the client without a countdown until the next
    // broadcast.
    this.armClock();
    this.broadcast();
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
        ...this.clockEnvelope(),
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
    // The hand is complete and `state` still holds all of it — board, pots,
    // hole cards, committed chips. `endHand` below clears every one of those,
    // so this is the moment, and the only one, that it can be written.
    this.writeHandHistory();

    const result = this.state.result;
    for (const [userId] of this.sockets) {
      this.push(userId, {
        type: 'handEnd',
        state: toPublicState(this.state, userId),
        result,
        ...this.clockEnvelope(),
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
  // Hand history
  //
  // Recording only. Nothing below may change `state`, and nothing above may
  // wait on it: a hand plays out identically whether these writes land or not.
  // -------------------------------------------------------------------------

  /** Opens a new hand's record: who is in it, where, and with how much. */
  private snapshotHandStart(): void {
    this.handStartedAt = Date.now();
    this.eventLog = [];
    this.handSeats = [];

    const positions = this.positions();
    for (const seat of this.state.seats) {
      const player = seat.player;
      if (!player || player.status === 'SITTING_OUT') continue;
      this.handSeats.push({
        playerId: player.id,
        seat: seat.index,
        position: positions.get(player.id) ?? '',
        startingStack: player.stack,
      });
    }
  }

  /**
   * Table position per player, clockwise from the button.
   *
   * The blinds come from `pendingBlinds` rather than from counting seats,
   * because the engine is the one that decided them and heads-up disagrees
   * with the count: there the button posts the small blind.
   */
  private positions(): Map<string, string> {
    const seats = this.state.seats;
    const count = seats.length;
    const order: string[] = [];
    for (let step = 1; step <= count; step += 1) {
      const player = seats[(this.state.buttonIndex + step) % count].player;
      if (player && player.status !== 'SITTING_OUT') order.push(player.id);
    }

    const out = new Map<string, string>();
    const last = order.length - 1;
    order.forEach((playerId, i) => {
      // `order` starts one seat past the button, so the button is last.
      if (i === last) out.set(playerId, 'BTN');
      else if (i === 0) out.set(playerId, 'SB');
      else if (i === 1) out.set(playerId, 'BB');
      else if (i === last - 1) out.set(playerId, 'CO');
      else if (i === 2) out.set(playerId, 'UTG');
      else out.set(playerId, `UTG+${i - 2}`);
    });

    for (const blind of this.state.pendingBlinds) {
      const existing = out.get(blind.playerId);
      if (blind.kind === 'SMALL') {
        out.set(blind.playerId, existing === 'BTN' ? 'BTN/SB' : 'SB');
      } else {
        out.set(blind.playerId, 'BB');
      }
    }
    return out;
  }

  /** Stamps every history event the room has not logged yet. */
  private captureEvents(): void {
    if (this.handStartedAt === null) return;
    const history = this.state.history;
    for (let seq = this.eventLog.length; seq < history.length; seq += 1) {
      const event = history[seq];
      this.eventLog.push({
        seq,
        playerId: event.playerId,
        street: event.street,
        action: event.type,
        amount: event.amount ?? 0,
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * Sends the finished hand to the writer and forgets it.
   *
   * Called once per hand: `handStartedAt` is cleared first, so a second call
   * (or a hand that somehow reaches PAYOUT twice) cannot write it again.
   */
  private writeHandHistory(): void {
    this.captureEvents();
    const startedAt = this.handStartedAt;
    if (startedAt === null) return;
    this.handStartedAt = null;

    const record = this.buildHandRecord(startedAt);
    this.handSeats = [];
    this.eventLog = [];
    if (record) persistHand(this.handWriter, record);
  }

  /**
   * The hand as it will be stored, or null if any part of it cannot be — an
   * unseated player, a user id that is not a number. Null means nothing is
   * written at all: a hand missing a player looks whole to whoever reads it
   * later and quietly misstates what happened.
   */
  private buildHandRecord(startedAt: number): HandRecord | null {
    const result = this.state.result;
    if (!result) return null;

    const label = `${this.tableId}#${this.state.handId}`;
    const players: HandPlayerRecord[] = [];

    for (const snapshot of this.handSeats) {
      const userId = numericUserId(snapshot.playerId);
      if (userId === null) {
        console.warn(`[room ${this.tableId}] hand ${label} not recorded: non-numeric player id`);
        return null;
      }

      const player = this.state.seats[snapshot.seat]?.player;
      if (!player || player.id !== snapshot.playerId) {
        console.warn(`[room ${this.tableId}] hand ${label} not recorded: seat ${snapshot.seat} moved`);
        return null;
      }

      const won = result.payouts[player.id] ?? 0;
      const shown = result.showdown?.find((entry) => entry.playerId === player.id) ?? null;

      players.push({
        userId,
        seat: snapshot.seat,
        position: snapshot.position || null,
        holeCards: player.holeCards,
        startingStack: snapshot.startingStack,
        committed: player.totalCommitted,
        net: won - player.totalCommitted,
        result: won > 0 ? 'WON' : player.status === 'FOLDED' ? 'FOLDED' : 'LOST',
        handName: shown?.hand.name ?? null,
      });
    }

    const actions: HandActionRecord[] = [];
    for (const event of this.eventLog) {
      // A null actor is the table itself dealing or turning a street; only a
      // player id that should be there and is not is a reason to give up.
      let userId: number | null = null;
      if (event.playerId !== null) {
        userId = numericUserId(event.playerId);
        if (userId === null) {
          console.warn(`[room ${this.tableId}] hand ${label} not recorded: non-numeric actor`);
          return null;
        }
      }
      actions.push({
        seq: event.seq,
        userId,
        street: event.street,
        action: event.action,
        amount: event.amount,
        at: event.at,
      });
    }

    return {
      id: randomUUID(),
      tableId: this.tableId,
      variant: this.state.variant,
      handNumber: this.state.handId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      board: this.state.board,
      // The awarded pots rather than the raw ones: same totals, plus who won
      // each, which is what makes the row worth reading.
      pots: result.pots,
      // No rake is taken yet. The column exists so taking one later does not
      // need a migration.
      rake: 0,
      players,
      actions,
    };
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

  /**
   * Mucks the hand of someone who has left. Drives the identical follow-up to
   * any other action, so the end-of-hand check is never skipped.
   */
  private forfeit(userId: string): void {
    try {
      this.state = forfeitHand(this.state, userId);
    } catch (err) {
      this.logPokerError('forfeit', err);
      return;
    }
    this.clock.clear();
    this.afterChange();
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
    // Every state change in the room ends up here, which makes this the one
    // place that catches every history event as it happens — and catching them
    // as they happen is what puts a real time on each one.
    this.captureEvents();
    for (const [userId] of this.sockets) this.sendTo(userId);
  }

  private sendTo(userId: string): void {
    this.push(userId, {
      type: 'state',
      state: toPublicState(this.state, userId),
      ...this.clockEnvelope(),
    });
  }

  /**
   * The action clock, as the server sees it. `serverTime` is included so a
   * client with a skewed clock can convert `actionDeadline` into its own frame
   * instead of trusting that the two machines agree on the epoch.
   */
  private clockEnvelope(): {
    actionDeadline: number | null;
    actionTimeoutMs: number;
    serverTime: number;
  } {
    return {
      actionDeadline: this.clock.deadline,
      actionTimeoutMs: this.clock.timeoutMs,
      serverTime: Date.now(),
    };
  }

  private error(userId: string, code: string, message: string): void {
    this.push(userId, { type: 'error', code, message });
  }

  /** Tells a leaver their seat is given up, so they can stop waiting on us. */
  private confirmLeft(userId: string): void {
    this.push(userId, { type: 'left', tableId: this.tableId });
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
