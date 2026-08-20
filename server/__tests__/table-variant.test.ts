/**
 * The table ids the pages join, taken through the real room registry.
 *
 * The two halves of this rule live apart — a page picks an id, the server turns
 * an id into rules — and they once disagreed: the Omaha page joined an id the
 * server read as Hold'em, so it was dealt two hole cards and drew them on a
 * four-card felt without complaint. These tests close that gap by joining with
 * the pages' own constants rather than with literals written out again here.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { disposeAllRooms, roomFor } from '../rooms.js';
import type { RoomSocket } from '../room.js';
import { isTournamentTableId } from '../../src/lib/poker/index.js';
import {
  HOLDEM_TABLE_ID,
  OMAHA_TABLE_ID,
  tableIdFor,
} from '../../src/app/table/_shared/tables.js';

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

interface StateView {
  variant?: string;
  seats?: { player: { id: string; holeCards: unknown[] | null } | null }[];
}

afterEach(() => {
  disposeAllRooms();
});

/**
 * Sits two players down at `tableId` through the production `roomFor`, and
 * reports what the first one was told. Two is the minimum for a hand to start,
 * which is when cards are dealt.
 */
function joinTable(tableId: string) {
  const room = roomFor(tableId);
  const socket = new FakeSocket();
  room.join('viewer', 'Viewer', socket, 1000);
  room.join('other', 'Other', new FakeSocket(), 1000);

  const state = socket.latest('state')?.state as StateView | undefined;
  const holeCards =
    state?.seats?.find((seat) => seat.player?.id === 'viewer')?.player?.holeCards ?? null;
  return { variant: state?.variant, holeCards };
}

describe('the id a table page joins', () => {
  it('gets the Omaha page a room running Omaha, four cards to a hand', () => {
    const tableId = tableIdFor('OMAHA', null);

    expect(tableId).toBe(OMAHA_TABLE_ID);

    const { variant, holeCards } = joinTable(tableId);
    expect(variant).toBe('OMAHA');
    expect(holeCards).toHaveLength(4);
  });

  it('still gets the Hold’em page two', () => {
    const tableId = tableIdFor('HOLDEM', null);

    expect(tableId).toBe(HOLDEM_TABLE_ID);

    const { variant, holeCards } = joinTable(tableId);
    expect(variant).toBe('HOLDEM');
    expect(holeCards).toHaveLength(2);
  });

  it('ignores a `?table=` override for the other variant', () => {
    // Anyone can type a URL, and a page cannot render rules it was not built
    // for — so an override that would land on the wrong variant is dropped.
    expect(tableIdFor('OMAHA', HOLDEM_TABLE_ID)).toBe(OMAHA_TABLE_ID);
    expect(tableIdFor('OMAHA', '4822')).toBe(OMAHA_TABLE_ID);
    expect(tableIdFor('HOLDEM', OMAHA_TABLE_ID)).toBe(HOLDEM_TABLE_ID);

    expect(joinTable(tableIdFor('OMAHA', '4822')).holeCards).toHaveLength(4);
  });

  it('is never a tournament id — those are recognised, not defaulted', () => {
    // `variantForTableId` reads anything it does not know as Hold'em, which is
    // the right default for a cash table and exactly the wrong one for a
    // tournament: it would open a real-chip room. These are spotted first.
    for (const tableId of ['tournament-1', 'Tourney-2', 'sitgo-3', 'sit-and-go-4', 'SNG-5']) {
      expect(isTournamentTableId(tableId), tableId).toBe(true);
    }
    for (const tableId of [HOLDEM_TABLE_ID, OMAHA_TABLE_ID, 'kitchen-table', '']) {
      expect(isTournamentTableId(tableId), tableId).toBe(false);
    }
  });

  it('honours a `?table=` override that runs the page’s own variant', () => {
    expect(tableIdFor('OMAHA', 'omaha-9001')).toBe('omaha-9001');
    expect(tableIdFor('HOLDEM', 'holdem-9002')).toBe('holdem-9002');
    // Any id the server does not read as Omaha is Hold'em, private tables too.
    expect(tableIdFor('HOLDEM', 'kitchen-table')).toBe('kitchen-table');
  });
});
