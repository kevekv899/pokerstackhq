/**
 * A player who drops mid-decision must still be timed out.
 *
 * Disarming the clock for a disconnected actor stalls the hand forever —
 * nothing re-arms it, so everyone else waits on a socket that may never come
 * back. The clock is left running on disconnect precisely so that cannot happen.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Room, type RoomSocket } from '../room.js';

const ACTION_MS = 40;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const rooms: Room[] = [];

function table() {
  const room = new Room({
    tableId: 'disconnect',
    seatCount: 2,
    smallBlind: 5,
    bigBlind: 10,
    seed: 'disconnect-seed',
    actionTimeoutMs: ACTION_MS,
    showdownRevealMs: 5,
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

type StateView = {
  actingPlayerId?: string | null;
  handId?: number;
  history?: { type?: string; playerId?: string | null }[];
};

const stateOf = (msg: Record<string, unknown> | undefined) => msg?.state as StateView | undefined;

/** True once any broadcast showed `playerId` folding. */
function sawFoldBy(socket: FakeSocket, playerId: string): boolean {
  return socket.messages.some((msg) =>
    (msg.state as StateView | undefined)?.history?.some(
      (event) => event.type === 'FOLD' && event.playerId === playerId,
    ),
  );
}

describe('disconnect mid-turn', () => {
  it('still times the dropped player out instead of stalling the hand', async () => {
    const { room, a, b } = table();

    const before = stateOf(a.latest('state'));
    const actor = before?.actingPlayerId as string;
    expect(actor).toBeTruthy();
    // Preflop the first player to act owes the big blind, so a timeout can only
    // be resolved as a fold — nothing here is legal to check.
    const handId = before?.handId as number;

    // Their socket drops while they are on the clock.
    room.disconnect(actor);

    await sleep(ACTION_MS * 4);

    // The server acted for them: the hand moved on rather than hanging.
    expect(sawFoldBy(b, actor)).toBe(true);
    const after = stateOf(b.latest('state'));
    expect(after?.handId).toBeGreaterThan(handId);
  });

  it('keeps the clock armed and visible to the players still connected', async () => {
    const { room, a, b } = table();
    const actor = stateOf(a.latest('state'))?.actingPlayerId as string;

    room.disconnect(actor);

    // The remaining player is still shown a live deadline for the absent
    // player's decision — the table is counting down, not frozen.
    const deadline = b.latest('state')?.actionDeadline as number | null;
    expect(typeof deadline).toBe('number');
    expect(deadline! - Date.now()).toBeLessThanOrEqual(ACTION_MS);
  });

  it('lets a player who reconnects inside the window act normally', async () => {
    const { room, a, b } = table();
    const actor = stateOf(a.latest('state'))?.actingPlayerId as string;

    room.disconnect(actor);
    // Straight back, well inside the timeout.
    const revived = new FakeSocket();
    room.join(actor, actor === 'A' ? 'Alice' : 'Bob', revived, 1000);

    // Their seat and their turn survived the round trip.
    expect(stateOf(revived.latest('state'))?.actingPlayerId).toBe(actor);

    room.action(actor, 'CALL');
    expect(stateOf(b.latest('state'))?.actingPlayerId).not.toBe(actor);
    expect(sawFoldBy(b, actor)).toBe(false);
  });
});
