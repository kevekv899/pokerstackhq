"use client";

/**
 * Client transport for the game server.
 *
 * The server owns the game. This hook owns nothing but the socket: it
 * authenticates, joins a table, and hands back whatever `PublicTableState` the
 * server last sent. It never derives, patches or predicts game state — if a
 * value is not in the message, the UI does not get to know it.
 *
 * Protocol (see `server/index.ts`):
 *   -> { type: 'auth',  token }              first message on every connection
 *   <- { type: 'state', state: null, authenticated: true }
 *   -> { type: 'join',  tableId, buyIn }
 *   <- { type: 'state' | 'showdown' | 'handEnd', state, ... }
 *   -> { type: 'action', action, amount? }
 *   <- { type: 'error', code, message }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTableState } from "./poker/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Actions a client may send. `POST_BLIND` is the server's job, not ours. */
export type GameActionType = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE" | "ALL_IN";

export interface GameAction {
  type: GameActionType;
  /** For BET/RAISE: the total "to" amount for the round, not the increment. */
  amount?: number;
}

export type ConnectionStatus =
  /** First connection attempt is in flight. */
  | "connecting"
  /** Authenticated, joined, and holding live state. */
  | "connected"
  /** The socket dropped; a retry is scheduled or in flight. */
  | "reconnecting"
  /** Closed with no retry pending — bad token, or the hook was disabled. */
  | "disconnected";

export interface UseGameSocketOptions {
  tableId: string;
  /** Chips to sit down with. The server validates it. */
  buyIn: number;
  /** Set false to hold the socket closed (e.g. before the buy-in settles). */
  enabled?: boolean;
  /**
   * Overrides how the auth token is obtained. Defaults to the app's own
   * `ps_token` session, fetched from `/api/auth/game-token`.
   */
  getToken?: () => Promise<string | null>;
}

export interface UseGameSocket {
  /** The server's latest view of the table, or null before the first message. */
  state: PublicTableState | null;
  connected: boolean;
  error: string | null;
  status: ConnectionStatus;
  sendAction: (action: GameAction) => void;
  /**
   * When the player on the clock runs out, as an epoch ms in *this browser's*
   * frame (server skew already removed). Null when nobody is on the clock.
   */
  actionDeadline: number | null;
  /** How long a full decision gets, for sizing a countdown ring. */
  actionTimeoutMs: number;
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_BACKOFF_MS = 30_000;

function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? MAX_BACKOFF_MS;
}

/** The server closes with this when auth fails; retrying the same token loops. */
const CLOSE_AUTH_FAILED = 4001;

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The app's session lives in the httpOnly `ps_token` cookie, which JavaScript
 * cannot read and a WebSocket cannot send. This endpoint hands it back to the
 * logged-in caller so it can go in the `auth` message.
 */
async function sessionToken(): Promise<string | null> {
  const res = await fetch("/api/auth/game-token", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  const token = (data as { token?: unknown } | null)?.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGameSocket({
  tableId,
  buyIn,
  enabled = true,
  getToken,
}: UseGameSocketOptions): UseGameSocket {
  const [state, setState] = useState<PublicTableState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(enabled ? "connecting" : "disconnected");
  const [error, setError] = useState<string | null>(null);
  const [actionDeadline, setActionDeadline] = useState<number | null>(null);
  const [actionTimeoutMs, setActionTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);

  const socketRef = useRef<WebSocket | null>(null);
  /** True once auth + join have gone out, so `sendAction` may write. */
  const joinedRef = useRef(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  /** Set by cleanup so a socket we closed on purpose does not trigger a retry. */
  const disposedRef = useRef(false);

  // Read inside the socket callbacks without making them a dependency — a new
  // `getToken` identity must not tear down a healthy connection.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      return;
    }

    const url = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
    if (!url) {
      setStatus("disconnected");
      setError("NEXT_PUBLIC_GAME_SERVER_URL is not set");
      return;
    }

    disposedRef.current = false;
    attemptRef.current = 0;

    /** Schedules the next attempt, unless we are shutting down for good. */
    function retry(): void {
      if (disposedRef.current) return;
      const delay = backoffFor(attemptRef.current);
      attemptRef.current += 1;
      setStatus("reconnecting");
      retryRef.current = setTimeout(connect, delay);
    }

    async function connect(): Promise<void> {
      if (disposedRef.current) return;

      let token: string | null = null;
      try {
        token = await (getTokenRef.current?.() ?? sessionToken());
      } catch {
        token = null;
      }
      if (disposedRef.current) return;

      if (!token) {
        // No session yet. Keep retrying on the same backoff so signing in
        // during the retry window recovers without a remount.
        setError("Not signed in — log in to join the table");
        retry();
        return;
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(url!);
      } catch {
        setError("Could not open a connection to the game server");
        retry();
        return;
      }
      socketRef.current = socket;
      joinedRef.current = false;

      socket.onopen = () => {
        // Auth is always the first message; the server closes the socket on
        // anything else.
        socket.send(JSON.stringify({ type: "auth", token }));
      };

      socket.onmessage = (event: MessageEvent) => {
        let msg: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(String(event.data));
          if (!parsed || typeof parsed !== "object") return;
          msg = parsed as Record<string, unknown>;
        } catch {
          return;
        }

        // Auth ack. Join immediately — and on every reconnect, since the
        // server treats each socket as a fresh session.
        if (msg.authenticated === true) {
          joinedRef.current = true;
          attemptRef.current = 0;
          setError(null);
          socket.send(JSON.stringify({ type: "join", tableId, buyIn }));
          return;
        }

        if (msg.type === "error") {
          setError(typeof msg.message === "string" ? msg.message : "Server error");
          return;
        }

        if (msg.type === "state" || msg.type === "showdown" || msg.type === "handEnd") {
          if (msg.state) {
            setState(msg.state as PublicTableState);
            setStatus("connected");
            setError(null);
          }
          // Convert the deadline out of the server's clock frame and into this
          // browser's, so a skewed client still counts down the right span.
          if (typeof msg.actionTimeoutMs === "number") setActionTimeoutMs(msg.actionTimeoutMs);
          if (typeof msg.serverTime === "number") {
            const skew = msg.serverTime - Date.now();
            setActionDeadline(
              typeof msg.actionDeadline === "number" ? msg.actionDeadline - skew : null,
            );
          } else {
            setActionDeadline(
              typeof msg.actionDeadline === "number" ? msg.actionDeadline : null,
            );
          }
        }
      };

      socket.onerror = () => {
        // `onclose` always follows; the retry is scheduled from there so a
        // single failure cannot queue two attempts.
      };

      socket.onclose = (event: CloseEvent) => {
        socketRef.current = null;
        joinedRef.current = false;
        setActionDeadline(null);
        if (disposedRef.current) return;

        if (event.code === CLOSE_AUTH_FAILED) {
          // A rejected token will be rejected again. Stop and surface it
          // rather than hammering the server.
          setStatus("disconnected");
          setError("Authentication failed — sign in again to rejoin the table");
          return;
        }
        retry();
      };
    }

    void connect();

    return () => {
      disposedRef.current = true;
      if (retryRef.current !== null) clearTimeout(retryRef.current);
      retryRef.current = null;
      joinedRef.current = false;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        // Drop the handlers first: a close we initiated must not be mistaken
        // for a dropped connection and schedule a retry.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [tableId, buyIn, enabled]);

  const sendAction = useCallback((action: GameAction) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !joinedRef.current) {
      setError("Not connected to the table");
      return;
    }
    socket.send(
      JSON.stringify({
        type: "action",
        action: action.type,
        ...(action.amount === undefined ? {} : { amount: action.amount }),
      }),
    );
  }, []);

  return {
    state,
    connected: status === "connected",
    error,
    status,
    sendAction,
    actionDeadline,
    actionTimeoutMs,
  };
}
