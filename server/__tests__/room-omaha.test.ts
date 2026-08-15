/**
 * An Omaha room deals four hole cards — and sends each player only their own.
 *
 * The second half is the point. The page this replaces held the whole deck in
 * the browser, so every opponent's four cards were one console command away.
 * `toPublicState` is the only way state reaches a socket, and these tests hold
 * it to that.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Room, type RoomSocket } from '../room.js';

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

interface SeatView {
  index: number;
  player: { id: string; hasCards: boolean; holeCards: unknown[] | null; isViewer: boolean } | null;
}
interface StateView {
  variant?: string;
  seats?: SeatView[];
}

const rooms: Room[] = [];

function omahaTable() {
  const room = new Room({
    tableId: 'omaha-test',
    variant: 'OMAHA',
    seatCount: 3,
    smallBlind: 5,
    bigBlind: 10,
    seed: 'omaha-seed',
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

const stateOf = (s: FakeSocket) => s.latest('state')?.state as StateView | undefined;
const seatOf = (s: FakeSocket, id: string) =>
  stateOf(s)?.seats?.find((seat) => seat.player?.id === id)?.player ?? null;

describe('an Omaha room', () => {
  it('tells the client which variant it is running', () => {
    const { a } = omahaTable();
    expect(stateOf(a)?.variant).toBe('OMAHA');
  });

  it('deals the viewer four hole cards', () => {
    const { a } = omahaTable();
    const me = seatOf(a, 'A');

    expect(me?.isViewer).toBe(true);
    expect(me?.holeCards).toHaveLength(4);
  });

  it('never sends an opponent’s four cards to anyone else', () => {
    const { a, b } = omahaTable();

    // Each player is told the *other* is holding cards, but not which.
    const opponentFromA = seatOf(a, 'B');
    expect(opponentFromA?.hasCards).toBe(true);
    expect(opponentFromA?.holeCards).toBeNull();

    const opponentFromB = seatOf(b, 'A');
    expect(opponentFromB?.hasCards).toBe(true);
    expect(opponentFromB?.holeCards).toBeNull();
  });

  it('keeps the deck and every other player’s cards out of the payload', () => {
    const { a, b } = omahaTable();

    // Whatever A received, the only cards anywhere in it are A's own four.
    const serialised = JSON.stringify(a.messages);
    const mine = seatOf(a, 'A')!.holeCards as { rank: string; suit: string }[];
    const cardsInPayload = serialised.match(/"rank":"[^"]+","suit":"[^"]+"/g) ?? [];

    expect(mine).toHaveLength(4);
    expect(cardsInPayload).toHaveLength(4);

    // And B's actual cards are nowhere in A's messages.
    const bCards = (seatOf(b, 'B')!.holeCards as { rank: string; suit: string }[])
      .map((c) => `"rank":"${c.rank}","suit":"${c.suit}"`);
    for (const card of bCards) {
      expect(serialised).not.toContain(card);
    }
  });

  it('still deals two at a Hold’em room', () => {
    const room = new Room({ tableId: 'holdem-test', seatCount: 3, seed: 's' });
    rooms.push(room);
    const a = new FakeSocket();
    room.join('A', 'Alice', a, 1000);
    room.join('B', 'Bob', new FakeSocket(), 1000);

    expect(stateOf(a)?.variant).toBe('HOLDEM');
    expect(seatOf(a, 'A')?.holeCards).toHaveLength(2);
  });
});
