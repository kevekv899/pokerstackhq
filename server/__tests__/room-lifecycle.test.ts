/**
 * Drives a full heads-up hand through the room to confirm the showdown branch
 * (SHOWDOWN -> reveal -> settle -> handEnd -> WAITING) actually runs, and that
 * the uncontested branch does not try to settle a hand the engine already paid.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Room, type RoomSocket } from '../room.js';

const REVEAL_MS = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeSocket implements RoomSocket {
  readonly messages: Record<string, unknown>[] = [];
  send(data: string): void {
    this.messages.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {}
  all(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
  latest(type: string) {
    return [...this.messages].reverse().find((m) => m.type === type);
  }
}

const rooms: Room[] = [];

function table() {
  const room = new Room({
    tableId: 'lifecycle',
    seatCount: 2,
    smallBlind: 5,
    bigBlind: 10,
    seed: 'lifecycle-seed',
    showdownRevealMs: REVEAL_MS,
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

const streetOf = (msg: Record<string, unknown> | undefined) =>
  (msg?.state as { street?: string } | undefined)?.street;

function players(msg: Record<string, unknown> | undefined) {
  const seats = (msg?.state as { seats?: unknown[] } | undefined)?.seats ?? [];
  return seats
    .map((seat) => (seat as { player?: { stack?: number; totalCommitted?: number } }).player)
    .filter((p): p is { stack?: number; totalCommitted?: number } => Boolean(p));
}

/** Chips behind. At PAYOUT the pot has been credited, so this alone is the total. */
const stacks = (msg: Record<string, unknown> | undefined) =>
  players(msg).reduce((sum, p) => sum + (p.stack ?? 0), 0);

/**
 * Chips behind plus chips in the middle. This is the conservation invariant
 * *during* a hand — but not at PAYOUT, where the engine has already moved the
 * pot into `stack` while `totalCommitted` still records what was wagered
 * (it is cleared by `endHand`), which would double-count it.
 */
const chipsInPlay = (msg: Record<string, unknown> | undefined) =>
  players(msg).reduce((sum, p) => sum + (p.stack ?? 0) + (p.totalCommitted ?? 0), 0);

describe('Room hand lifecycle', () => {
  it('checks down to showdown, then settles and starts the next hand', async () => {
    const { room, a } = table();

    // Heads-up: the small blind (A, seat 0) acts first preflop.
    room.action('A', 'CALL');
    room.action('B', 'CHECK');
    // Post-flop the big blind acts first; check three streets down.
    for (let street = 0; street < 3; street += 1) {
      room.action('B', 'CHECK');
      room.action('A', 'CHECK');
    }

    const showdown = a.latest('showdown');
    expect(showdown).toBeTruthy();
    expect(streetOf(showdown)).toBe('SHOWDOWN');
    // Chips must not have moved yet — that is the point of the reveal window.
    expect(chipsInPlay(showdown)).toBe(2000);

    // Nothing should have settled before the reveal window elapses.
    expect(a.latest('handEnd')).toBeUndefined();

    await sleep(REVEAL_MS + 50);

    const handEnd = a.latest('handEnd');
    expect(handEnd).toBeTruthy();
    expect(streetOf(handEnd)).toBe('PAYOUT');
    expect(stacks(handEnd)).toBe(2000);

    // endHand() ran and the room dealt the next hand on its own.
    const latest = a.latest('state');
    expect((latest?.state as { handId?: number })?.handId).toBe(2);
    expect(chipsInPlay(latest)).toBe(2000);

    room.dispose();
  });

  it('pays an uncontested win without going through settle()', () => {
    const { a, room } = table();

    // A folds preflop: the engine jumps straight to PAYOUT and credits chips,
    // so the room must not call settle() here.
    room.action('A', 'FOLD');

    expect(a.all('showdown')).toHaveLength(0);
    const handEnd = a.latest('handEnd');
    expect(handEnd).toBeTruthy();
    expect(streetOf(handEnd)).toBe('PAYOUT');
    expect(stacks(handEnd)).toBe(2000);

    // Straight into the next hand, no reveal delay.
    expect((a.latest('state')?.state as { handId?: number })?.handId).toBe(2);

    room.dispose();
  });

  it('keeps the seat and the hole cards across a reconnect mid-hand', () => {
    const { room, a } = table();

    const before = a.latest('state')?.state as { seats?: unknown[] };
    const cardsBefore = JSON.stringify(
      (before.seats as { player?: { id?: string; holeCards?: unknown } }[]).find(
        (s) => s.player?.id === 'A',
      )?.player?.holeCards,
    );

    room.disconnect('A');
    const reconnected = new FakeSocket();
    room.join('A', 'Alice', reconnected, 1000);

    const after = reconnected.latest('state')?.state as { seats?: unknown[]; handId?: number };
    const cardsAfter = JSON.stringify(
      (after.seats as { player?: { id?: string; holeCards?: unknown } }[]).find(
        (s) => s.player?.id === 'A',
      )?.player?.holeCards,
    );

    expect(after.handId).toBe(1);
    expect(cardsAfter).toBe(cardsBefore);
    expect(JSON.parse(cardsAfter)).toHaveLength(2);

    room.dispose();
  });
});
