/**
 * Hand history: what gets written, when, and what happens when it fails.
 *
 * The rules being held to here are the ones that make history safe to add to a
 * live game: a hand is written once and whole, only after it is over, and the
 * database never gets a say in whether the next hand is dealt.
 */

import { describe, expect, it, vi } from 'vitest';

import { Room, type RoomSocket } from '../room.js';
import type { HandRecord, HandWriter } from '../persistence.js';

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

interface LegalView {
  canCheck: boolean;
  canCall: boolean;
}
interface StateView {
  viewerId: string;
  actingPlayerId: string | null;
  handId: number;
  totalPot: number;
  legalActions: LegalView | null;
}

/** Collects what the room writes, and can be told to fail. */
function recordingWriter(mode: 'ok' | 'reject' | 'throw' = 'ok') {
  const writes: HandRecord[] = [];
  const writer: HandWriter = {
    write(record: HandRecord): Promise<void> {
      writes.push(record);
      if (mode === 'reject') return Promise.reject(new Error('supabase is down'));
      if (mode === 'throw') throw new Error('client blew up');
      return Promise.resolve();
    },
  };
  return { writes, writer };
}

function table(writer: HandWriter, options: { showdownRevealMs?: number } = {}) {
  const room = new Room({
    tableId: 'holdem-history',
    seatCount: 6,
    smallBlind: 5,
    bigBlind: 10,
    seed: 'history-seed',
    handWriter: writer,
    showdownRevealMs: options.showdownRevealMs ?? 0,
  });
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join('11', 'Alice', a, 1000);
  room.join('22', 'Bob', b, 1000);
  return { room, a, b, sockets: [a, b] };
}

const stateOf = (s: FakeSocket) => s.latest('state')?.state as StateView | undefined;

/** Whoever is on the clock, playing the cheapest legal action. */
function stepCheckOrCall(room: Room, sockets: FakeSocket[]): boolean {
  for (const socket of sockets) {
    const state = stateOf(socket);
    if (!state?.legalActions || state.actingPlayerId !== state.viewerId) continue;
    room.action(state.viewerId, state.legalActions.canCheck ? 'CHECK' : 'CALL');
    return true;
  }
  return false;
}

/** Checks the hand down to showdown, then lets the reveal delay elapse. */
async function playToShowdown(room: Room, sockets: FakeSocket[]): Promise<void> {
  for (let i = 0; i < 40 && stepCheckOrCall(room, sockets); i += 1);
  // `showdownRevealMs` is 0 here, but it is still a timer: give it a turn.
  await new Promise((resolve) => setTimeout(resolve, 1));
}

/** Folds whoever is on the clock, ending the hand uncontested. */
function foldActing(room: Room, sockets: FakeSocket[]): void {
  for (const socket of sockets) {
    const state = stateOf(socket);
    if (!state?.legalActions || state.actingPlayerId !== state.viewerId) continue;
    room.action(state.viewerId, 'FOLD');
    return;
  }
  throw new Error('nobody is on the clock');
}

describe('a finished hand', () => {
  it('is written exactly once, with children that match it', () => {
    const { writes, writer } = recordingWriter();
    const { room, sockets } = table(writer);

    foldActing(room, sockets);
    room.dispose();

    expect(writes).toHaveLength(1);
    const hand = writes[0];

    expect(hand).toMatchObject({
      tableId: 'holdem-history',
      variant: 'HOLDEM',
      handNumber: 1,
      rake: 0,
    });
    // The room mints the id, so a re-sent write is the same row, not a second
    // copy of the hand.
    expect(hand.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(hand.startedAt)).toBeLessThanOrEqual(Date.parse(hand.endedAt));

    // Both players dealt in, each once.
    expect(hand.players.map((p) => p.userId).sort()).toEqual([11, 22]);
    expect(hand.players.every((p) => p.startingStack === 1000)).toBe(true);
    // Heads-up: the button posts the small blind.
    expect(hand.players.map((p) => p.position).sort()).toEqual(['BB', 'BTN/SB']);

    // The whole hand, in order, with no gaps: the deal, both blinds, the fold
    // and the payout — enough to replay it exactly.
    expect(hand.actions.map((a) => a.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(hand.actions.map((a) => a.action)).toEqual([
      'DEAL', 'POST_BLIND', 'POST_BLIND', 'FOLD', 'PAYOUT',
    ]);
    expect(hand.actions.map((a) => a.amount)).toEqual([0, 5, 10, 0, 0]);
    // What the table did is attributed to nobody; what a player did, to them.
    expect(hand.actions.filter((a) => a.userId === null).map((a) => a.action))
      .toEqual(['DEAL', 'PAYOUT']);
    expect(hand.actions.filter((a) => a.userId !== null).every((a) => a.userId === 11 || a.userId === 22))
      .toBe(true);
    // Timestamps are the room's own, in the order the events happened.
    const times = hand.actions.map((a) => Date.parse(a.at));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it('records the hole cards and the winning hand at showdown', async () => {
    const { writes, writer } = recordingWriter();
    const { room, a, sockets } = table(writer);

    await playToShowdown(room, sockets);
    const shownPot = (a.latest('showdown')?.state as StateView | undefined)?.totalPot;
    room.dispose();

    const hand = writes[0];
    expect(hand.board).toHaveLength(5);
    expect(hand.players.every((p) => p.holeCards.length === 2)).toBe(true);
    // Both hands were shown, so both are named.
    expect(hand.players.every((p) => typeof p.handName === 'string')).toBe(true);
    expect(hand.players.some((p) => p.result === 'WON')).toBe(true);

    // Checked down, so nothing was refunded: what the table showed in the
    // middle is exactly what the written rows account for.
    const committed = hand.players.reduce((sum, p) => sum + p.committed, 0);
    const pots = (hand.pots as { amount: number }[]).reduce((sum, p) => sum + p.amount, 0);
    expect(committed).toBe(pots);
    expect(committed).toBe(shownPot);
    expect(hand.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
  });

  it('accounts for every chip: committed sums to the pot, net sums to zero', () => {
    const { writes, writer } = recordingWriter();
    const { room, sockets } = table(writer);

    foldActing(room, sockets);
    room.dispose();

    const hand = writes[0];
    const committed = hand.players.reduce((sum, p) => sum + p.committed, 0);
    const pots = (hand.pots as { amount: number }[]).reduce((sum, p) => sum + p.amount, 0);

    expect(committed).toBe(pots);
    // Heads-up, the big blind's uncalled $5 goes back to them when the small
    // blind folds, so what is recorded is the $5 each that actually got
    // matched — not the $15 that was briefly in the middle.
    expect(hand.players.map((p) => p.committed)).toEqual([5, 5]);
    expect(committed).toBe(10);
    // Chips only move between players — the hand creates and destroys none.
    expect(hand.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
  });

  it('is not written until it is over', () => {
    const { writes, writer } = recordingWriter();
    const { room, sockets } = table(writer);

    // Blinds are posted and cards are out: a hand is very much in progress.
    expect(stateOf(sockets[0])?.handId).toBe(1);
    expect(writes).toHaveLength(0);

    foldActing(room, sockets);
    expect(writes).toHaveLength(1);
    room.dispose();
  });
});

describe('when the database is unreachable', () => {
  it('deals the next hand anyway', () => {
    const { writes, writer } = recordingWriter('reject');
    const { room, a, sockets } = table(writer);

    foldActing(room, sockets);

    // The rejected write did not stop the room: hand two is already live.
    expect(writes).toHaveLength(1);
    expect(stateOf(a)?.handId).toBe(2);

    foldActing(room, sockets);
    expect(writes).toHaveLength(2);
    expect(stateOf(a)?.handId).toBe(3);
    room.dispose();
  });

  it('survives a writer that throws in the caller’s face', () => {
    const { writes, writer } = recordingWriter('throw');
    const { room, a, sockets } = table(writer);

    expect(() => foldActing(room, sockets)).not.toThrow();
    expect(writes).toHaveLength(1);
    expect(stateOf(a)?.handId).toBe(2);
    room.dispose();
  });

  it('holds nobody up while a slow write is in flight', () => {
    // A write that never settles. Gameplay must not be waiting on it.
    const pending: HandWriter = { write: () => new Promise<void>(() => {}) };
    const { room, a, sockets } = table(pending);

    foldActing(room, sockets);
    expect(stateOf(a)?.handId).toBe(2);

    foldActing(room, sockets);
    expect(stateOf(a)?.handId).toBe(3);
    room.dispose();
  });
});

describe('a hand it cannot key', () => {
  it('is dropped whole rather than written in part', () => {
    const { writes, writer } = recordingWriter();
    const room = new Room({
      tableId: 'holdem-guest',
      seatCount: 6,
      seed: 'guest-seed',
      handWriter: writer,
      showdownRevealMs: 0,
    });
    const a = new FakeSocket();
    const b = new FakeSocket();
    // The database keys players by the app's numeric user id; this one has no
    // such id, so there is no honest row to write for them.
    room.join('guest-abc', 'Guest', a, 1000);
    room.join('22', 'Bob', b, 1000);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    foldActing(room, [a, b]);
    room.dispose();

    expect(writes).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
