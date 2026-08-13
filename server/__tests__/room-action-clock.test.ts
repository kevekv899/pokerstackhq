/**
 * The action clock is broadcast, not inferred. Clients render their countdown
 * from `actionDeadline`, so a state message that arrives while someone is on
 * the clock must carry a live deadline — a null or stale one leaves the table
 * with no visible timer until the next action.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Room, type RoomSocket } from '../room.js';
import { ACTION_TIMEOUT_MS } from '../clock.js';

class FakeSocket implements RoomSocket {
  readonly messages: Record<string, unknown>[] = [];
  send(data: string): void {
    this.messages.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {}
  latest(type: string) {
    return [...this.messages].reverse().find((m) => m.type === type);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const rooms: Room[] = [];

function table() {
  const room = new Room({
    tableId: 'clock',
    seatCount: 2,
    smallBlind: 5,
    bigBlind: 10,
    seed: 'clock-seed',
  });
  rooms.push(room);
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join('A', 'Alice', a, 1000);
  room.join('B', 'Bob', b, 1000);
  return { room, a, b };
}

afterEach(() => {
  for (const room of rooms) room.dispose();
  rooms.length = 0;
});

const actingId = (msg: Record<string, unknown> | undefined) =>
  (msg?.state as { actingPlayerId?: string | null } | undefined)?.actingPlayerId;

describe('action clock broadcast', () => {
  it('ships a live deadline with the state that puts someone on the clock', () => {
    const { a } = table();
    const message = a.latest('state');

    // Preflop is under way, so somebody owes a decision.
    expect(actingId(message)).toBeTruthy();

    const deadline = message?.actionDeadline as number | null;
    const serverTime = message?.serverTime as number;

    expect(typeof deadline).toBe('number');
    expect(message?.actionTimeoutMs).toBe(ACTION_TIMEOUT_MS);
    // The deadline is ahead of the timestamp it shipped with, by no more than
    // one full decision — i.e. it was armed for *this* decision, not a stale one.
    expect(deadline! - serverTime).toBeGreaterThan(0);
    expect(deadline! - serverTime).toBeLessThanOrEqual(ACTION_TIMEOUT_MS);
  });

  it('re-arms for each decision, so the next player gets a fresh deadline', async () => {
    const { room, a, b } = table();
    const first = a.latest('state');
    const firstActor = actingId(first) as string;

    // Let some of the first player's clock run down. Without this the two
    // arms can land in the same millisecond, which makes a fresh full span
    // indistinguishable from the previous clock simply being left running.
    await sleep(25);
    room.action(firstActor, 'CALL');

    const next = a.latest('state');
    expect(actingId(next)).not.toBe(firstActor);

    // The new player gets a whole decision's worth of time, not the remainder
    // of the last one.
    const remaining = (next?.actionDeadline as number) - (next?.serverTime as number);
    expect(remaining).toBeGreaterThan(ACTION_TIMEOUT_MS - 50);
    expect(remaining).toBeLessThanOrEqual(ACTION_TIMEOUT_MS);
    expect(next?.actionDeadline as number).toBeGreaterThan(first?.actionDeadline as number);

    // Both players are told the same clock; it is the table's, not per-socket.
    expect(b.latest('state')?.actionDeadline).toBe(next?.actionDeadline);
  });

  it('reports no deadline while nobody is on the clock', () => {
    // One player cannot start a hand, so the table sits in WAITING with the
    // clock disarmed — the client must get null rather than a stale deadline.
    const room = new Room({ tableId: 'idle', seatCount: 2, seed: 'idle-seed' });
    rooms.push(room);
    const a = new FakeSocket();
    room.join('A', 'Alice', a, 1000);

    const message = a.latest('state');
    expect(actingId(message)).toBeFalsy();
    expect(message?.actionDeadline).toBeNull();
    expect(message?.actionTimeoutMs).toBe(ACTION_TIMEOUT_MS);
  });
});
