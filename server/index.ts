import { config as loadEnv } from 'dotenv';
import { createServer, type IncomingMessage } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocketServer, type WebSocket } from 'ws';

import { isOriginAllowed } from './origin.js';
import { Room } from './room.js';

// This project keeps its vars in `.env.local` (Next.js convention), so plain
// `dotenv/config` would find nothing. Real env vars always win over both files.
loadEnv({ path: ['.env.local', '.env'], quiet: true });

const PORT = Number(process.env.PORT ?? 8080);

/** Closed on a failed or missing auth handshake. */
const CLOSE_AUTH_FAILED = 4001;
/** A socket that never authenticates is dropped rather than left hanging. */
const AUTH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

// ---------------------------------------------------------------------------
// Supabase — service role, server only
// ---------------------------------------------------------------------------

let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set');
  }
  supabaseAdmin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseAdmin;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>();

function roomFor(tableId: string): Room {
  let room = rooms.get(tableId);
  if (!room) {
    room = new Room({ tableId });
    rooms.set(tableId, room);
  }
  return room;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

interface Session {
  userId: string | null;
  name: string;
  room: Room | null;
}

const wss = new WebSocketServer({
  server,
  // Convenience filter only. The token check below is the real gate and is
  // never skipped or relaxed based on what this returned.
  verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
    isOriginAllowed(info.origin),
});

wss.on('connection', (socket: WebSocket) => {
  const session: Session = { userId: null, name: 'Player', room: null };

  const authTimer = setTimeout(() => {
    if (session.userId === null) socket.close(CLOSE_AUTH_FAILED, 'auth timeout');
  }, AUTH_TIMEOUT_MS);
  authTimer.unref?.();

  socket.on('message', (raw) => {
    void handleMessage(socket, session, raw.toString()).catch((err) => {
      console.error('[ws] message handler failed:', err);
      send(socket, { type: 'error', code: 'INTERNAL', message: 'Something went wrong' });
    });
  });

  socket.on('close', () => {
    clearTimeout(authTimer);
    if (session.userId && session.room) session.room.disconnect(session.userId);
  });

  socket.on('error', (err) => {
    console.error('[ws] socket error:', err);
  });

  async function handleMessage(sock: WebSocket, sess: Session, text: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      msg = parsed as Record<string, unknown>;
    } catch {
      send(sock, { type: 'error', code: 'BAD_MESSAGE', message: 'Expected a JSON object' });
      return;
    }

    // The first message must be auth; nothing else is processed before it.
    if (sess.userId === null) {
      if (msg.type !== 'auth') {
        sock.close(CLOSE_AUTH_FAILED, 'auth required');
        return;
      }
      const userId = await verifyToken(msg.token);
      if (userId === null) {
        sock.close(CLOSE_AUTH_FAILED, 'invalid token');
        return;
      }
      clearTimeout(authTimer);
      sess.userId = userId.id;
      sess.name = userId.name;
      send(sock, { type: 'state', state: null, authenticated: true });
      return;
    }

    switch (msg.type) {
      case 'auth':
        // Already authenticated; ignore rather than allow an identity swap.
        return;

      case 'join': {
        const tableId = typeof msg.tableId === 'string' ? msg.tableId : null;
        const buyIn = typeof msg.buyIn === 'number' ? msg.buyIn : 0;
        if (!tableId) {
          send(sock, { type: 'error', code: 'BAD_MESSAGE', message: 'join needs a tableId' });
          return;
        }
        sess.room = roomFor(tableId);
        sess.room.join(sess.userId, sess.name, wrap(sock), buyIn);
        return;
      }

      case 'action': {
        if (!sess.room) {
          send(sock, { type: 'error', code: 'UNKNOWN_PLAYER', message: 'Join a table first' });
          return;
        }
        sess.room.action(sess.userId, msg.action ?? msg.actionType, msg.amount);
        return;
      }

      case 'leave': {
        if (sess.room) sess.room.leave(sess.userId);
        sess.room = null;
        return;
      }

      default:
        send(sock, { type: 'error', code: 'BAD_MESSAGE', message: `Unknown type ${String(msg.type)}` });
    }
  }
});

/**
 * The real security boundary. Unconditional — it does not consult the origin
 * and there is no path around it.
 */
async function verifyToken(token: unknown): Promise<{ id: string; name: string } | null> {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata as Record<string, unknown> | null;
    const name =
      (typeof meta?.username === 'string' && meta.username) ||
      data.user.email ||
      data.user.id;
    return { id: data.user.id, name };
  } catch (err) {
    console.error('[auth] token verification failed:', err);
    return null;
  }
}

function wrap(socket: WebSocket) {
  return {
    send: (data: string) => socket.send(data),
    close: (code?: number, reason?: string) => socket.close(code, reason),
  };
}

function send(socket: WebSocket, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch (err) {
    console.error('[ws] send failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Keep the process alive through anything a single hand can throw
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err);
});

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
