/**
 * End-to-end handshake against a real WebSocket server.
 *
 * `auth.test.ts` covers the token rules in isolation; this file proves they are
 * actually wired to the socket — that a good `ps_token` gets you authenticated
 * and that everything else is closed with 4001 rather than being left open or
 * quietly tolerated.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import { WebSocket } from 'ws';

import { HOLDEM_TABLE_ID, OMAHA_TABLE_ID } from '../../src/app/table/_shared/tables.js';

const SECRET_VALUE = 'handshake-test-secret';

// Must be set before importing the server: it reads JWT_SECRET at module load
// and exits if it is missing. Real env vars win over the .env files dotenv
// loads there, so these stick.
process.env.JWT_SECRET = SECRET_VALUE;
process.env.PORT = '0'; // ephemeral port — never collide with a running server
process.env.ALLOWED_ORIGINS = '';

const SECRET = new TextEncoder().encode(SECRET_VALUE);

/** Mirrors `signToken()` in src/lib/auth.ts. */
function signPsToken(
  claims: Record<string, unknown>,
  { secret = SECRET, expiresIn = '7d' as string | number } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

const CLOSE_AUTH_FAILED = 4001;

let port: number;
let server: import('node:http').Server;
const open: WebSocket[] = [];

beforeAll(async () => {
  const mod = await import('../index.js');
  server = mod.server;
  if (!server.listening) await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of open) socket.terminate();
  const mod = await import('../index.js');
  mod.wss.close();
  server.close();
});

async function connect(): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  open.push(socket);
  await once(socket, 'open');
  return socket;
}

/**
 * Sends `token` as the auth message and reports what the server did first:
 * replied, or closed. Whichever happens first is the answer.
 */
function authenticate(socket: WebSocket, token: unknown): Promise<
  { outcome: 'message'; data: Record<string, unknown> } | { outcome: 'closed'; code: number }
> {
  return new Promise((resolve) => {
    socket.once('message', (raw) =>
      resolve({ outcome: 'message', data: JSON.parse(raw.toString()) }),
    );
    socket.once('close', (code) => resolve({ outcome: 'closed', code }));
    socket.send(JSON.stringify({ type: 'auth', token }));
  });
}

/** Resolves on the next message of `type`, ignoring anything else in between. */
function waitFor(socket: WebSocket, type: string, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timed out waiting for "${type}"`));
    }, timeoutMs);
    function onMessage(raw: unknown) {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.type !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(msg);
    }
    socket.on('message', onMessage);
  });
}

describe('leaving over the wire', () => {
  it('acknowledges an explicit leave', async () => {
    const token = await signPsToken({ userId: 7, username: 'leaver' });
    const socket = await connect();

    const authed = await authenticate(socket, token);
    expect(authed.outcome).toBe('message');

    socket.send(JSON.stringify({ type: 'join', tableId: 'leave-wire', buyIn: 200 }));
    await waitFor(socket, 'state');

    // The ack the client waits for before it navigates away.
    const left = waitFor(socket, 'left');
    socket.send(JSON.stringify({ type: 'leave' }));

    expect(await left).toMatchObject({ type: 'left', tableId: 'leave-wire' });
  });
});

describe('table variant', () => {
  it('runs Omaha rules for an omaha table id, and Hold’em otherwise', async () => {
    // The variant is derived from the id server-side; a client cannot ask for
    // one set of rules at a table running the other.
    // The page ids come from the pages' own module: what they join is what is
    // asserted here, so the two cannot drift apart again.
    for (const [tableId, expected] of [
      [OMAHA_TABLE_ID, 'OMAHA'],
      [HOLDEM_TABLE_ID, 'HOLDEM'],
      ['some-other-table', 'HOLDEM'],
    ] as const) {
      const socket = await connect();
      await authenticate(socket, await signPsToken({ userId: 11, username: 'v' }));
      socket.send(JSON.stringify({ type: 'join', tableId, buyIn: 200 }));

      const msg = await waitFor(socket, 'state');
      expect((msg.state as { variant?: string }).variant, tableId).toBe(expected);
    }
  });
});

describe('websocket auth handshake', () => {
  it('authenticates a valid ps_token', async () => {
    const token = await signPsToken({
      userId: 42,
      username: 'kevin',
      email: 'kevin@example.com',
    });

    const result = await authenticate(await connect(), token);

    expect(result.outcome).toBe('message');
    if (result.outcome !== 'message') return;
    expect(result.data.authenticated).toBe(true);
    // Nothing about the table leaks before a join.
    expect(result.data.state).toBeNull();
  });

  it('closes a tampered token with 4001', async () => {
    const token = await signPsToken({ userId: 42, username: 'kevin' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ userId: 99, username: 'attacker', exp: 4102444800 }))
      .toString('base64url')
      .replace(/=+$/, '');

    const result = await authenticate(await connect(), `${header}.${forged}.${signature}`);

    expect(result).toEqual({ outcome: 'closed', code: CLOSE_AUTH_FAILED });
  });

  it('closes an expired token with 4001', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ userId: 42, username: 'kevin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(nowSeconds - 7200)
      .setExpirationTime(nowSeconds - 3600)
      .sign(SECRET);

    const result = await authenticate(await connect(), token);

    expect(result).toEqual({ outcome: 'closed', code: CLOSE_AUTH_FAILED });
  });

  it('closes a token signed with the wrong secret with 4001', async () => {
    const token = await signPsToken(
      { userId: 42, username: 'kevin' },
      { secret: new TextEncoder().encode('not-the-real-secret') },
    );

    const result = await authenticate(await connect(), token);

    expect(result).toEqual({ outcome: 'closed', code: CLOSE_AUTH_FAILED });
  });

  it('closes a missing or malformed token with 4001', async () => {
    expect(await authenticate(await connect(), undefined)).toEqual({
      outcome: 'closed', code: CLOSE_AUTH_FAILED,
    });
    expect(await authenticate(await connect(), 'not-a-jwt')).toEqual({
      outcome: 'closed', code: CLOSE_AUTH_FAILED,
    });
  });

  it('refuses to do anything before auth', async () => {
    const socket = await connect();
    const closed = once(socket, 'close');
    // A join without authenticating first must not be honoured.
    socket.send(JSON.stringify({ type: 'join', tableId: 'x', buyIn: 200 }));

    const [code] = await closed;
    expect(code).toBe(CLOSE_AUTH_FAILED);
  });
});
