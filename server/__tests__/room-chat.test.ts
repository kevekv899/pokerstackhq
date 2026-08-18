/**
 * Table chat, which is a security surface as much as a feature.
 *
 * A chat line carries a name, and a name is an identity: if a client could put
 * one on the wire, it could say anything at the table as anyone sitting at it.
 * So these tests care less about the happy path than about what the room
 * refuses to take from the sender — the name, the time, an unbounded flood, and
 * anything that is not a message at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT,
  CHAT_RATE_WINDOW_MS,
  Room,
  type RoomSocket,
} from '../room.js';

class FakeSocket implements RoomSocket {
  readonly messages: Record<string, unknown>[] = [];
  send(data: string): void {
    this.messages.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {}
  ofType(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
  latest(type: string) {
    return [...this.messages].reverse().find((m) => m.type === type);
  }
}

interface ChatLine {
  type: string;
  userId: string;
  username: string;
  text: string;
  at: number;
}

const rooms: Room[] = [];

function table() {
  const room = new Room({ tableId: 'chat-test', seatCount: 6, seed: 'chat-seed' });
  rooms.push(room);
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join('A', 'Alice', a, 1000);
  room.join('B', 'Bob', b, 1000);
  return { room, a, b };
}

const chatOf = (s: FakeSocket) => s.ofType('chat') as unknown as ChatLine[];

afterEach(() => {
  vi.useRealTimers();
  for (const room of rooms) room.dispose();
  rooms.length = 0;
});

describe('a chat message', () => {
  it('reaches the other players, stamped with the name the server knows', () => {
    const { room, a, b } = table();

    room.chat('A', 'hello table');

    const line = chatOf(b).at(-1)!;
    expect(line).toMatchObject({
      type: 'chat',
      userId: 'A',
      username: 'Alice',
      text: 'hello table',
    });
    expect(line.at).toBeTypeOf('number');
    // The sender sees it too, and sees exactly what everyone else sees.
    expect(chatOf(a).at(-1)).toEqual(line);
  });

  it('takes the name from the session, never from the sender', () => {
    const { room, b } = table();

    // Whatever a client decorates its payload with, only the text is read:
    // `chat()` takes a userId the socket has already authenticated as.
    room.chat('A', JSON.stringify({ username: 'Bob', text: 'I fold' }));

    expect(chatOf(b).at(-1)).toMatchObject({ userId: 'A', username: 'Alice' });
  });

  it('is trimmed, and the trimmed text is what everyone gets', () => {
    const { room, b } = table();

    room.chat('A', '   spaced out   ');

    expect(chatOf(b).at(-1)?.text).toBe('spaced out');
  });
});

describe('a message the room refuses', () => {
  it('drops one that is empty or only whitespace', () => {
    const { room, a, b } = table();

    room.chat('A', '');
    room.chat('A', '   \n\t ');

    expect(chatOf(b)).toHaveLength(0);
    expect(a.ofType('error')).toHaveLength(2);
    expect(a.latest('error')).toMatchObject({ code: 'EMPTY_MESSAGE' });
  });

  it('drops one over the length limit, and keeps the one at it', () => {
    const { room, a, b } = table();

    room.chat('A', 'x'.repeat(CHAT_MAX_LENGTH + 1));

    expect(chatOf(b)).toHaveLength(0);
    expect(a.latest('error')).toMatchObject({ code: 'MESSAGE_TOO_LONG' });

    room.chat('A', 'x'.repeat(CHAT_MAX_LENGTH));
    expect(chatOf(b)).toHaveLength(1);
  });

  it('drops anything that is not a string', () => {
    const { room, a, b } = table();

    for (const notText of [undefined, null, 42, { text: 'hi' }, ['hi']]) {
      room.chat('A', notText);
    }

    expect(chatOf(b)).toHaveLength(0);
    expect(a.latest('error')).toMatchObject({ code: 'BAD_MESSAGE' });
  });

  it('tells only the sender, never the room', () => {
    const { room, a, b } = table();

    room.chat('A', '');

    expect(a.ofType('error')).toHaveLength(1);
    expect(b.ofType('error')).toHaveLength(0);
  });

  it('refuses someone who is not at this table', () => {
    const { room, a } = table();

    room.chat('stranger', 'let me in');

    expect(chatOf(a)).toHaveLength(0);
  });
});

describe('the rate limit', () => {
  it(`drops message ${CHAT_RATE_LIMIT + 1} inside the window`, () => {
    const { room, a, b } = table();

    for (let i = 1; i <= CHAT_RATE_LIMIT; i++) room.chat('A', `message ${i}`);
    expect(chatOf(b)).toHaveLength(CHAT_RATE_LIMIT);
    expect(a.ofType('error')).toHaveLength(0);

    room.chat('A', 'one too many');

    expect(chatOf(b)).toHaveLength(CHAT_RATE_LIMIT);
    expect(chatOf(b).at(-1)?.text).toBe(`message ${CHAT_RATE_LIMIT}`);
    expect(a.latest('error')).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('is per user — one player flooding does not silence another', () => {
    const { room, b } = table();

    for (let i = 0; i <= CHAT_RATE_LIMIT; i++) room.chat('A', `flood ${i}`);
    room.chat('B', 'hello');

    expect(chatOf(b).at(-1)).toMatchObject({ userId: 'B', text: 'hello' });
  });

  it('lets the window slide, rather than locking anyone out for good', () => {
    vi.useFakeTimers();
    const { room, b } = table();

    for (let i = 0; i < CHAT_RATE_LIMIT; i++) room.chat('A', `burst ${i}`);
    room.chat('A', 'dropped');
    expect(chatOf(b)).toHaveLength(CHAT_RATE_LIMIT);

    vi.advanceTimersByTime(CHAT_RATE_WINDOW_MS);
    room.chat('A', 'allowed again');

    expect(chatOf(b).at(-1)?.text).toBe('allowed again');
  });

  it('does not charge a rejected message against the allowance', () => {
    const { room, b } = table();

    for (let i = 0; i < CHAT_RATE_LIMIT; i++) room.chat('A', '');
    room.chat('A', 'still allowed');

    expect(chatOf(b).at(-1)?.text).toBe('still allowed');
  });
});

describe('the backlog a joiner gets', () => {
  it('is the conversation so far', () => {
    const { room } = table();
    room.chat('A', 'first');
    room.chat('B', 'second');

    const c = new FakeSocket();
    room.join('C', 'Cara', c, 1000);

    const history = c.latest('chatHistory')?.messages as ChatLine[];
    expect(history.map((m) => [m.username, m.text])).toEqual([
      ['Alice', 'first'],
      ['Bob', 'second'],
    ]);
  });

  it('arrives before anything is said to the joiner, and only to them', () => {
    const { room, a } = table();
    const before = a.ofType('chatHistory').length;

    const c = new FakeSocket();
    room.join('C', 'Cara', c, 1000);

    expect(c.ofType('chatHistory')).toHaveLength(1);
    expect(c.messages[0].type).toBe('chatHistory');
    expect(a.ofType('chatHistory')).toHaveLength(before);
  });

  it(`keeps the last ${CHAT_HISTORY_LIMIT} and no more`, () => {
    vi.useFakeTimers();
    const { room } = table();

    // Past the cap, and past the rate limit — so the window is stepped over
    // between bursts rather than being what this test measures.
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 10; i++) {
      if (i % CHAT_RATE_LIMIT === 0) vi.advanceTimersByTime(CHAT_RATE_WINDOW_MS);
      room.chat('A', `line ${i}`);
    }

    const c = new FakeSocket();
    room.join('C', 'Cara', c, 1000);

    const history = c.latest('chatHistory')?.messages as ChatLine[];
    expect(history).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(history[0].text).toBe('line 10');
    expect(history.at(-1)?.text).toBe(`line ${CHAT_HISTORY_LIMIT + 9}`);
  });

  it('reaches someone the table had no seat for', () => {
    const room = new Room({ tableId: 'chat-full', seatCount: 2, seed: 's' });
    rooms.push(room);
    room.join('A', 'Alice', new FakeSocket(), 1000);
    room.join('B', 'Bob', new FakeSocket(), 1000);
    room.chat('A', 'sorry, full');

    const watcher = new FakeSocket();
    room.join('C', 'Cara', watcher, 1000);

    expect(watcher.latest('error')).toMatchObject({ code: 'TABLE_FULL' });
    expect((watcher.latest('chatHistory')?.messages as ChatLine[]).at(-1)?.text).toBe('sorry, full');
  });
});
