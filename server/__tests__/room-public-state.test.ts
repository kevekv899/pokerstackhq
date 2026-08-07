/**
 * Guards the wire format itself: what the Room actually pushes to a socket,
 * not just what `toPublicState` returns in isolation. If someone adds a second
 * send path in `room.ts` that skips the projection, this is what catches it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Room, type RoomSocket } from '../room.js';

const SEED = 'room-leak-check-seed';

class FakeSocket implements RoomSocket {
  readonly messages: Record<string, unknown>[] = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {}

  /** The most recent message of `type`, which is the current view of the table. */
  latest(type: string): Record<string, unknown> | undefined {
    return [...this.messages].reverse().find((msg) => msg.type === type);
  }
}

const rooms: Room[] = [];

function liveHand() {
  const room = new Room({
    tableId: 'leak-test',
    seatCount: 2,
    smallBlind: 5,
    bigBlind: 10,
    seed: SEED,
  });
  rooms.push(room);

  const a = new FakeSocket();
  const b = new FakeSocket();
  // The second join takes the table to two seated players, which starts a hand.
  room.join('player-a', 'Alice', a, 1000);
  room.join('player-b', 'Bob', b, 1000);

  return { room, a, b };
}

afterEach(() => {
  for (const room of rooms) room.dispose();
  rooms.length = 0;
});

/** Every card mentioned anywhere in a payload, as `"As"`-style strings. */
function collectCards(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectCards(item, found);
    return found;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.rank === 'string' && typeof record.suit === 'string') {
      found.push(`${record.rank}${record.suit}`);
      return found;
    }
    for (const value of Object.values(record)) collectCards(value, found);
  }
  return found;
}

function holeCardsOf(view: unknown, playerId: string): string[] | null {
  const seats = (view as { seats?: unknown[] }).seats ?? [];
  for (const seat of seats) {
    const player = (seat as { player?: { id?: string; holeCards?: unknown } }).player;
    if (player?.id !== playerId) continue;
    return player.holeCards === null || player.holeCards === undefined
      ? null
      : collectCards(player.holeCards);
  }
  return null;
}

describe('Room broadcast', () => {
  it("never sends player A a card belonging to player B", () => {
    const { a, b } = liveHand();

    const viewA = a.latest('state')?.state;
    const viewB = b.latest('state')?.state;
    expect(viewA).toBeTruthy();
    expect(viewB).toBeTruthy();

    // B's own view is the only place B's hole cards legitimately appear.
    const bCards = holeCardsOf(viewB, 'player-b');
    expect(bCards).toHaveLength(2);

    // Sanity: A really is holding cards, so the assertion below is not vacuous.
    const aCards = holeCardsOf(viewA, 'player-a');
    expect(aCards).toHaveLength(2);
    expect(aCards).not.toEqual(bCards);

    // A sees that B has cards, but not which ones.
    expect(holeCardsOf(viewA, 'player-b')).toBeNull();

    // And no card of B's appears anywhere in A's payload, however deeply nested
    // (history, result, pots — not just the seat).
    const everythingA = collectCards(a.latest('state'));
    for (const card of bCards as string[]) {
      expect(everythingA).not.toContain(card);
    }
  });

  it('never sends the deck, the burn pile or the RNG seed', () => {
    const { a } = liveHand();

    const message = a.latest('state');
    const view = message?.state as Record<string, unknown>;

    expect(view).not.toHaveProperty('deck');
    expect(view).not.toHaveProperty('burned');
    expect(view).not.toHaveProperty('rng');
    expect(view).not.toHaveProperty('handSeed');

    const serialised = JSON.stringify(message);
    expect(serialised).not.toContain(SEED);
    expect(serialised).not.toContain('handSeed');

    // Only the viewer's two hole cards exist in a preflop payload — no board
    // yet, and certainly no undealt stub.
    expect(collectCards(message)).toHaveLength(2);
  });

  it('refuses POST_BLIND from a client', () => {
    const { room, a } = liveHand();

    room.action('player-a', 'POST_BLIND', 5);

    const error = a.latest('error');
    expect(error?.type).toBe('error');
    expect(error?.code).toBe('ILLEGAL_ACTION');
  });

  it('refuses an action from a player who is not to act', () => {
    const { room, b } = liveHand();

    // Heads-up preflop the small blind (seat 0, player A) acts first.
    room.action('player-b', 'FOLD');

    expect(b.latest('error')?.code).toBe('NOT_YOUR_TURN');
  });
});
