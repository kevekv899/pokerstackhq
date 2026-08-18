import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { encodeSecret, verifySessionToken } from './auth.js';
import { isOriginAllowed } from './origin.js';
import { Room } from './room.js';
import { roomFor } from './rooms.js';

// This project keeps its vars in `.env.local` (Next.js convention), so plain
// `dotenv/config` would find nothing. Real env vars always win over both files.
loadEnv({ path: ['.env.local', '.env'], quiet: true });

const PORT = Number(process.env.PORT ?? 8080);

/**
 * The secret the Next.js app signs `ps_token` with. Required: without it every
 * connection would be rejected one by one, which looks like a client bug rather
 * than a missing deployment variable, so refuse to boot instead.
 *
 * Note `src/lib/auth.ts` falls back to a dev string when this is unset. Set it
 * explicitly in both places — a server booted here and an app running on the
 * fallback would sign and verify with different keys.
 */
const JWT_SECRET_VALUE = process.env.JWT_SECRET;
if (!JWT_SECRET_VALUE) {
  console.error(
    '[server] JWT_SECRET is not set. It must match the secret the Next.js app ' +
      'signs ps_token with, or no client can authenticate.',
  );
  process.exit(1);
}
const JWT_SECRET = encodeSecret(JWT_SECRET_VALUE);

/** Closed on a failed or missing auth handshake. */
const CLOSE_AUTH_FAILED = 4001;
/** A socket that never authenticates is dropped rather than left hanging. */
const AUTH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Build stamp
// ---------------------------------------------------------------------------

/**
 * Identifies the build actually running, so one `curl /health` answers "which
 * commit is live?" without guessing from behaviour.
 *
 * Resolved once at boot: the values cannot change while the process runs, and
 * a health check must not shell out to git on every request.
 */
const BUILD = { commit: resolveCommit(), builtAt: resolveBuiltAt() };
const STARTED_AT = new Date().toISOString();

/** Railway injects the deployed SHA; locally we ask git. */
function resolveCommit(): string {
  const fromEnv =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.SOURCE_VERSION; // Heroku-style, harmless if unset
  if (fromEnv) return fromEnv.slice(0, 7);

  try {
    // execFile, not exec: no shell, nothing interpolated.
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return sha || 'unknown';
  } catch {
    // No git, or not a checkout — a deployed image usually has neither.
    return 'unknown';
  }
}

/**
 * When this build was produced, taken from the compiled entry file's mtime —
 * the compiler wrote it, so it is the build time without needing the build to
 * stamp anything. Null if it cannot be read (e.g. running from source).
 */
function resolveBuiltAt(): string | null {
  try {
    if (typeof __filename !== 'string') return null;
    return statSync(__filename).mtime.toISOString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    // Never cached: a stale stamp would defeat the whole point of asking.
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(
      JSON.stringify({
        ok: true,
        commit: BUILD.commit,
        builtAt: BUILD.builtAt,
        // Distinguishes a fresh deploy from a process that merely stayed up.
        startedAt: STARTED_AT,
      }),
    );
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

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

      case 'chat': {
        if (!sess.room) {
          send(sock, { type: 'error', code: 'UNKNOWN_PLAYER', message: 'Join a table first' });
          return;
        }
        // Only the text crosses over. Who said it comes from the session this
        // socket authenticated as, and when from the room's own clock — see
        // `Room.chat`. Anything else on the message is ignored.
        sess.room.chat(sess.userId, msg.text);
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
 * and there is no path around it. See `auth.ts`.
 */
async function verifyToken(token: unknown): Promise<{ id: string; name: string } | null> {
  return verifySessionToken(token, JWT_SECRET);
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
  console.log(
    `[server] listening on :${PORT} — commit ${BUILD.commit}, built ${BUILD.builtAt ?? 'unknown'}`,
  );
});

// Exported so an integration test can drive a real handshake against a real
// socket (bind with PORT=0 for an ephemeral port) and close it again.
export { server, wss };
