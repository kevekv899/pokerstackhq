/**
 * Leaving a table, by the rules of poker.
 *
 * The money rule is the one that matters: chips already pushed into the pot
 * belong to the pot, not to the player. Standing up forfeits them to whoever
 * wins the hand — only the stack still in front of you is yours to cash out.
 * A leave is also permanent, unlike a `disconnect()`, which holds the seat.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Room, type RoomSocket } from '../room.js';

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

interface PublicPlayerView {
  id: string;
  stack: number;
  status: string;
  totalCommitted: number;
}
interface StateView {
  street?: string;
  handId?: number;
  actingPlayerId?: string | null;
  totalPot?: number;
  seats?: { index: number; player: PublicPlayerView | null }[];
}

const rooms: Room[] = [];

afterEach(() => {
  for (const room of rooms) room.dispose();
  rooms.length = 0;
});

const stateOf = (socket: FakeSocket): StateView | undefined =>
  socket.latest('state')?.state as StateView | undefined;

const seatedPlayer = (socket: FakeSocket, id: string): PublicPlayerView | null =>
  stateOf(socket)?.seats?.find((seat) => seat.player?.id === id)?.player ?? null;

/** The last view of a player before their seat was released, for post-mortems. */
function lastSeenPlayer(socket: FakeSocket, id: string): PublicPlayerView | null {
  for (const msg of [...socket.messages].reverse()) {
    const player = (msg.state as StateView | undefined)?.seats?.find(
      (seat) => seat.player?.id === id,
    )?.player;
    if (player) return player;
  }
  return null;
}

/**
 * Seats `seatCount` players with everyone dealt into the live hand.
 *
 * The room deals as soon as two players are seated, so anyone seated after
 * that is parked as SITTING_OUT until the next hand. For tables bigger than
 * heads-up we therefore fold the opening hand out and let the next one begin,
 * which is the first hand everybody is actually in. That opening hand moves
 * the blinds around, so tests on these tables assert on *changes* in a stack
 * rather than on absolute chip counts.
 */
function table(seatCount: number, buyIn = 1000) {
  const room = new Room({
    tableId: 'leave',
    seatCount,
    smallBlind: 5,
    bigBlind: 10,
    seed: 'leave-seed',
    showdownRevealMs: 5,
  });
  rooms.push(room);

  const ids: string[] = [];
  const sockets: Record<string, FakeSocket> = {};
  for (let i = 0; i < seatCount; i++) {
    const id = String.fromCharCode(65 + i); // A, B, C…
    ids.push(id);
    sockets[id] = new FakeSocket();
    room.join(id, `Player ${id}`, sockets[id], buyIn);
  }

  const observer = sockets[ids[0]];
  const sittingOut = () =>
    ids.some((id) => seatedPlayer(observer, id)?.status === 'SITTING_OUT');

  for (let guard = 0; guard < 6 && sittingOut(); guard++) {
    const next = stateOf(observer)?.actingPlayerId;
    if (!next) break;
    // Folding wins the hand uncontested, which runs the whole
    // finish -> deal-everyone-in path synchronously.
    room.action(next, 'FOLD');
  }

  return { room, sockets, ids, observer };
}

/** Advances the betting until `id` is on the clock (or the hand moves on). */
function actUntil(room: Room, observer: FakeSocket, id: string, action = 'CALL'): void {
  for (let guard = 0; guard < 6; guard++) {
    const next = stateOf(observer)?.actingPlayerId;
    if (!next || next === id) return;
    room.action(next, action);
  }
}

describe('leaving mid-hand', () => {
  it('folds the leaver immediately when they are on the clock', () => {
    const { room, sockets, observer } = table(3);
    const actor = stateOf(observer)?.actingPlayerId as string;
    expect(actor).toBeTruthy();

    room.leave(actor);

    const folded = seatedPlayer(sockets.C, actor) ?? lastSeenPlayer(sockets.C, actor);
    expect(folded?.status).toBe('FOLDED');
  });

  it('folds a leaver who was not on the clock as soon as action reaches them', () => {
    const { room, sockets, ids, observer } = table(3);

    // Pick someone who is NOT to act, so the engine cannot fold them yet.
    const actor = stateOf(observer)?.actingPlayerId as string;
    const waiting = ids.find((id) => id !== actor)!;

    room.leave(waiting);
    // Still holding cards — the engine refuses an out-of-turn fold, so a leave
    // cannot muck them on the spot.
    expect(seatedPlayer(sockets.C, waiting)?.status).not.toBe('FOLDED');

    // Play on. They are mucked the moment action arrives, rather than the
    // table sitting through their 20 second clock.
    actUntil(room, sockets.C, waiting);

    expect(stateOf(sockets.C)?.actingPlayerId).not.toBe(waiting);
    expect(lastSeenPlayer(sockets.C, waiting)?.status).toBe('FOLDED');
  });

  it('leaves committed chips in the pot and refunds nothing', () => {
    const { room, sockets, observer } = table(3);

    const raiser = stateOf(observer)?.actingPlayerId as string;
    const before = seatedPlayer(sockets.C, raiser)!;
    const behindAtStart = before.stack + before.totalCommitted;

    room.action(raiser, 'RAISE', 100);

    const raised = seatedPlayer(sockets.C, raiser)!;
    // "Raise to 100" is the total for the round, so 100 is now in the pot.
    expect(raised.totalCommitted).toBe(100);
    expect(raised.stack).toBe(behindAtStart - 100);
    const potWithRaise = stateOf(sockets.C)?.totalPot as number;

    // Walk the action back round to the raiser, then stand them up.
    actUntil(room, sockets.C, raiser);
    room.leave(raiser);

    const after = lastSeenPlayer(sockets.C, raiser)!;
    // The 100 stays exactly where it was: not returned to the stack, and not
    // taken back out of the pot.
    expect(after.stack).toBe(raised.stack);
    expect(after.totalCommitted).toBe(100);
    expect(stateOf(sockets.C)?.totalPot).toBeGreaterThanOrEqual(potWithRaise);
    // What they could cash out is the stack alone — the 100 is gone.
    expect(after.stack).toBe(behindAtStart - 100);
  });

  it('releases the seat only once the hand has finished', async () => {
    const { room, sockets, observer } = table(3);
    const actor = stateOf(observer)?.actingPlayerId as string;

    room.leave(actor);
    // Mid-hand the seat is still theirs, holding a folded hand.
    expect(seatedPlayer(sockets.C, actor)).not.toBeNull();
    expect(stateOf(sockets.C)?.street).not.toBe('WAITING');

    // Fold the rest out so the hand ends.
    for (let guard = 0; guard < 6; guard++) {
      const next = stateOf(sockets.C)?.actingPlayerId;
      if (!next) break;
      room.action(next, 'FOLD');
    }
    await sleep(30);

    expect(seatedPlayer(sockets.C, actor)).toBeNull();
  });
});

describe('heads-up leave', () => {
  it('awards the pot, including the leaver’s committed chips, to the player who stays', async () => {
    // Heads-up seats both players before the deal, so these are clean 1000
    // stacks and the chip counts can be asserted exactly.
    const { room, sockets } = table(2);

    // Get real money in: the first to act calls, so both have 10 committed.
    const leaver = stateOf(sockets.A)?.actingPlayerId as string;
    room.action(leaver, 'CALL');

    const stayer = stateOf(sockets.A)?.actingPlayerId as string;
    expect(stayer).not.toBe(leaver);
    expect(stateOf(sockets.A)?.totalPot).toBe(20);

    // The player holding the option stands up. Only one contender is left, so
    // the hand is won uncontested.
    room.leave(stayer);
    await sleep(30);

    const watcher = sockets[leaver];
    const winner = lastSeenPlayer(watcher, leaver)!;
    const gone = lastSeenPlayer(watcher, stayer)!;

    // The winner takes the whole pot: their own 10 back plus the leaver's 10.
    expect(winner.stack).toBe(1010);
    // The leaver keeps only what was still in front of them — the 10 they had
    // committed is forfeit, not refunded.
    expect(gone.stack).toBe(990);
    // No chips invented or destroyed.
    expect(winner.stack + gone.stack).toBe(2000);
  });
});

describe('leaving between hands', () => {
  it('frees the seat immediately at WAITING', () => {
    const room = new Room({ tableId: 'idle-leave', seatCount: 2, seed: 'idle' });
    rooms.push(room);
    const a = new FakeSocket();
    room.join('A', 'Alice', a, 1000);
    // One player cannot start a hand, so the table sits in WAITING.
    expect(stateOf(a)?.street).toBe('WAITING');

    room.leave('A');

    const b = new FakeSocket();
    room.join('B', 'Bob', b, 1000);
    expect(stateOf(b)?.seats?.some((seat) => seat.player?.id === 'A')).toBe(false);
  });
});

describe('leave acknowledgement', () => {
  it('acks the leaver, and it is the last thing they hear', () => {
    const { room, sockets } = table(3);

    room.leave('A');

    const ack = sockets.A.latest('left');
    expect(ack).toMatchObject({ type: 'left', tableId: 'leave' });
    expect(sockets.A.messages.indexOf(ack!)).toBe(sockets.A.messages.length - 1);
  });

  it('acks even when the player was never seated', () => {
    const { room } = table(2);
    const stranger = new FakeSocket();
    room.join('Z', 'Zoe', stranger, 1000); // table is full — no seat for them

    room.leave('Z');

    expect(stranger.latest('left')).toBeTruthy();
  });
});

describe('disconnect is not a leave', () => {
  it('keeps the seat so a reconnect can reclaim it', () => {
    const { room, sockets } = table(3);

    room.disconnect('A');

    // Seat and stack survive — this is the distinction the client relies on:
    // only an explicit leave gives the seat up.
    expect(seatedPlayer(sockets.C, 'A')).not.toBeNull();

    const revived = new FakeSocket();
    room.join('A', 'Player A', revived, 1000);
    expect(seatedPlayer(revived, 'A')).not.toBeNull();
  });
});
