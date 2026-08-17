/**
 * The live room registry — one `Room` per tableId, created on first join.
 *
 * Kept out of `index.ts` so the rule that decides a room's variant can be
 * exercised by a test without starting an HTTP server.
 */

import { variantForTableId } from '../src/lib/poker/index.js';
import { Room } from './room.js';

const rooms = new Map<string, Room>();

/**
 * The room for `tableId`, created if this is the first player through the door.
 *
 * The variant comes from `variantForTableId` and never from the `join` message:
 * it decides how many hole cards are dealt and how hands are scored, so letting
 * a client name it would let one ask for Omaha rules at a Hold'em table — or
 * set the rules for everyone else by being first through the door.
 */
export function roomFor(tableId: string): Room {
  let room = rooms.get(tableId);
  if (!room) {
    room = new Room({ tableId, variant: variantForTableId(tableId) });
    rooms.set(tableId, room);
  }
  return room;
}

/** Drops every room. Tests only — a live server has no reason to forget one. */
export function disposeAllRooms(): void {
  for (const room of rooms.values()) room.dispose();
  rooms.clear();
}
