/**
 * Hand history, written to Supabase.
 *
 * Two rules shape everything here:
 *
 *   1. A hand is written once, whole, at the end. Never mid-hand. A hand that
 *      is half in the database looks complete to every reader that comes
 *      after it, which is worse than a hand that was never written — so the
 *      row and all its children go in one `record_hand()` call, which is one
 *      transaction (see scripts/sql/001_hand_history.sql).
 *
 *   2. Gameplay never waits for it. Chips in memory are authoritative while a
 *      hand is running; this is a record of what happened, not the thing that
 *      makes it happen. Every call is fire-and-forget and every failure is a
 *      log line — Supabase being down slows nothing and stops nothing.
 *
 * The service-role key is the only key that can write these tables, and this
 * module is the only place the game server uses it. It bypasses RLS, so it
 * must never be handed to anything that takes input from a client.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** One player's line in a hand. `userId` is the app's numeric user id. */
export interface HandPlayerRecord {
  userId: number;
  seat: number;
  position: string | null;
  holeCards: unknown[];
  startingStack: number;
  committed: number;
  net: number;
  result: 'WON' | 'LOST' | 'FOLDED';
  handName: string | null;
}

/** One entry in the hand's log. `userId` is null for what the table did. */
export interface HandActionRecord {
  seq: number;
  userId: number | null;
  street: string;
  action: string;
  amount: number;
  at: string;
}

/** A finished hand, exactly as it goes to the database. */
export interface HandRecord {
  /**
   * Minted by the room, not by the database, so the same hand written twice
   * is the same row twice — `record_hand` takes the second write as a no-op
   * rather than filing a duplicate.
   */
  id: string;
  tableId: string;
  variant: string;
  handNumber: number;
  startedAt: string;
  endedAt: string;
  board: unknown[];
  pots: unknown[];
  rake: number;
  players: HandPlayerRecord[];
  actions: HandActionRecord[];
}

/**
 * Somewhere a finished hand can be sent.
 *
 * An interface because the room should not know or care whether the write
 * lands in Supabase, in a test's array, or nowhere at all.
 */
export interface HandWriter {
  write(record: HandRecord): Promise<void>;
}

/** Drops every hand on the floor. What an unconfigured server gets. */
export const nullHandWriter: HandWriter = {
  write: () => Promise.resolve(),
};

/** The wire shape `record_hand(payload jsonb)` expects. */
function toPayload(record: HandRecord): Record<string, unknown> {
  return {
    id: record.id,
    table_id: record.tableId,
    variant: record.variant,
    hand_number: record.handNumber,
    started_at: record.startedAt,
    ended_at: record.endedAt,
    board: record.board,
    pots: record.pots,
    rake: record.rake,
    players: record.players.map((player) => ({
      user_id: player.userId,
      seat: player.seat,
      position: player.position,
      hole_cards: player.holeCards,
      starting_stack: player.startingStack,
      committed: player.committed,
      net: player.net,
      result: player.result,
      hand_name: player.handName,
    })),
    actions: record.actions.map((action) => ({
      seq: action.seq,
      user_id: action.userId,
      street: action.street,
      action: action.action,
      amount: action.amount,
      at: action.at,
    })),
  };
}

/** Writes through the `record_hand` function, with the service-role key. */
export function createSupabaseHandWriter(client: SupabaseClient): HandWriter {
  return {
    async write(record: HandRecord): Promise<void> {
      const { error } = await client.rpc('record_hand', { payload: toPayload(record) });
      if (error) {
        // Thrown so the one catch in `persistHand` reports every failure the
        // same way, whether it arrived as an error or as a rejection.
        throw new Error(`record_hand failed: ${error.message}`);
      }
    },
  };
}

let cached: HandWriter | null = null;

/**
 * The process-wide writer, built from the environment on first use.
 *
 * Missing configuration is not an error: a dev box or a test run without
 * Supabase credentials gets the null writer and deals hands as normal, minus
 * the history. Refusing to start over an unset variable would make the game
 * depend on the thing that is explicitly not allowed to affect it.
 */
export function defaultHandWriter(): HandWriter {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    console.warn(
      '[persistence] SUPABASE_URL / SUPABASE_SECRET_KEY not set — hand history is off',
    );
    cached = nullHandWriter;
    return cached;
  }

  cached = createSupabaseHandWriter(
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  return cached;
}

/**
 * Hands a finished hand to `writer` and returns immediately.
 *
 * Deliberately returns `void` rather than a promise: there is nothing for a
 * caller to await, and offering something awaitable invites someone to await
 * it inside the hand loop one day. A writer that throws synchronously is
 * caught here too, so a broken client cannot take the room down with it.
 */
export function persistHand(writer: HandWriter, record: HandRecord): void {
  const label = `${record.tableId}#${record.handNumber}`;
  try {
    void Promise.resolve(writer.write(record)).catch((err: unknown) => {
      console.error(`[persistence] hand ${label} not written:`, err);
    });
  } catch (err) {
    console.error(`[persistence] hand ${label} not written:`, err);
  }
}
