"use client";

/**
 * The table's chat rail.
 *
 * Two feeds share one log, and they are not the same kind of thing:
 *
 *   - What players say. Owned by the game server. This component sends a line
 *     with `onSend` and then waits: nothing the viewer types is drawn until it
 *     comes back from the server, so every seat reads the conversation in the
 *     same order, with the names and times the server stamped on it.
 *   - What the table did. Folds, big raises, new hands, showdowns — derived
 *     here from the state the page already has, never sent anywhere. Local by
 *     nature: they are a reading of `game`, not something anyone said.
 *
 * The two are merged for display by timestamp and nothing else.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ChatMessage } from "@/lib/useGameSocket";

// ─── Types ────────────────────────────────────────────────────────────────────
// A structural view of the table's GameState — only the fields the chat needs.
// Both table pages' full GameState is assignable to this.

interface ChatPlayerView {
  id: number;
  name: string;
  avatar: string;
  folded: boolean;
  streetBet: number;
  action: string;
  isHero: boolean;
}

interface ChatGameView {
  handNum: number;
  street: string;
  currentBet: number;
  banner: string;
  winnerIds: number[];
  players: ChatPlayerView[];
}

/** A table event this component derived from `game`. Never leaves the browser. */
interface GameEvent {
  id: number;
  text: string;
  at: number;
}

/** A line in the rendered log, from either feed. */
type FeedItem =
  | { key: string; kind: "system"; text: string; at: number }
  | {
      key: string;
      kind: "user" | "opponent";
      name: string;
      avatar: string;
      text: string;
      at: number;
    };

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_LEN = 200;           // matches the server's own limit
const KEEP = 50;               // keep the last 50 lines
const BIG_RAISE_TO = 15;       // $ threshold that makes a raise "big" enough to announce

const QUICK_MESSAGES = ["Nice hand! 👏", "Good game 🤝", "Lucky! 😅", "All in! 💰"];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── ChatSidebar ───────────────────────────────────────────────────────────────

export default function ChatSidebar({
  game,
  chatMessages,
  viewerId,
  avatarFor,
  onSend,
}: {
  game: ChatGameView;
  /** The room's chat, as the server ordered it. */
  chatMessages: ChatMessage[];
  /** Which of those messages are the viewer's own. */
  viewerId: string | null;
  /** The same stable avatar the felt draws for a player id. */
  avatarFor: (userId: string) => string;
  onSend: (text: string) => void;
}) {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");

  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pushEvent = useCallback((text: string) => {
    setEvents((prev) => [...prev, { id: idRef.current++, text, at: Date.now() }].slice(-KEEP));
  }, []);

  // ── The rendered log ──
  // Chat carries the server's timestamps and table events carry ours, so the
  // merge is only as good as the two clocks agree — near enough for a log, and
  // chat still holds the server's order among itself, which is what matters.
  const feed = useMemo<FeedItem[]>(() => {
    const lines: FeedItem[] = events.map((event) => ({
      key: `e${event.id}`,
      kind: "system",
      text: event.text,
      at: event.at,
    }));

    for (const [i, message] of chatMessages.entries()) {
      const own = viewerId !== null && message.userId === viewerId;
      lines.push({
        key: `m${message.at}-${message.userId}-${i}`,
        kind: own ? "user" : "opponent",
        name: own ? "You" : message.username,
        avatar: avatarFor(message.userId),
        text: message.text,
        at: message.at,
      });
    }

    return lines.sort((a, b) => a.at - b.at).slice(-KEEP);
  }, [events, chatMessages, viewerId, avatarFor]);

  // ── Unread ──
  // Counted against the newest line seen when the rail was closed, in that
  // line's own clock frame, so a skewed browser cannot miscount them.
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const unread = collapsed ? feed.filter((item) => item.at > seenAt).length : 0;

  const collapse = useCallback(() => {
    setSeenAt(Date.now());
    setCollapsed(true);
  }, []);
  const expand = useCallback(() => setCollapsed(false), []);

  // Collapse by default on mobile / narrow screens.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches) {
      setCollapsed(true);
    }
  }, []);

  // Auto-scroll to the newest line while expanded.
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feed, collapsed]);

  // ── Derive live game events from state transitions ──
  const prevRef = useRef<{ handNum: number; street: string; currentBet: number; folded: boolean[] } | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    const label = (p: ChatPlayerView) => (p.isHero ? "You" : p.name);
    const prev = prevRef.current;

    if (!prev) {
      // First render: seat the opponents, then announce the opening hand.
      if (!didInit.current) {
        didInit.current = true;
        game.players
          .filter((p) => !p.isHero)
          .forEach((p) => pushEvent(`${p.name} joined the table`));
        pushEvent(`--- New Hand #${game.handNum} ---`);
      }
    } else {
      if (game.handNum !== prev.handNum) {
        // New hand started.
        pushEvent(`--- New Hand #${game.handNum} ---`);
      } else {
        // Folds that happened this hand.
        game.players.forEach((p, i) => {
          if (p.folded && !prev.folded[i]) pushEvent(`${label(p)} folded`);
        });
        // A big raise = the current bet jumped past the threshold this street.
        if (game.currentBet > prev.currentBet && game.currentBet >= BIG_RAISE_TO) {
          const raiser = game.players.find(
            (p) =>
              p.streetBet === game.currentBet &&
              (p.action === "raise" || p.action === "bet" || p.action === "allin")
          );
          if (raiser) {
            const opening = prev.currentBet === 0;
            const verb = raiser.isHero
              ? opening ? "bet" : "raise to"
              : opening ? "bets" : "raises to";
            pushEvent(`💰 ${label(raiser)} ${verb} $${game.currentBet.toLocaleString()}!`);
          }
        }
      }

      // Showdown result.
      if (game.street === "showdown" && prev.street !== "showdown" && game.banner) {
        pushEvent(`🏆 ${game.banner}`);
      }
    }

    prevRef.current = {
      handNum: game.handNum,
      street: game.street,
      currentBet: game.currentBet,
      folded: game.players.map((p) => p.folded),
    };
  }, [game, pushEvent]);

  // ── Sending ──
  // Hands the line to the server and clears the box. Nothing is added to the
  // log here; it appears when the server sends it back to the whole room.
  const send = useCallback(
    (text: string) => {
      const t = text.trim().slice(0, MAX_LEN);
      if (!t) return;
      onSend(t);
      setDraft("");
    },
    [onSend]
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(draft);
  }

  const unreadBadge = unread > 0 && (
    <span
      className="absolute"
      style={{
        top: -6, right: -6, minWidth: 17, height: 17, padding: "0 4px",
        background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 900,
        borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 0 0 2px #0a1410",
      }}
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );

  // ── Collapsed ──
  // Below `md` the rail is gone entirely and only a floating button remains:
  // anything in this flex row — even a 46px strip — narrows <main>, and since
  // the felt is centred inside <main> rather than inside the viewport, that
  // shows up on a phone as the whole table shunted to the left.
  if (collapsed) {
    return (
      <>
        <div
          className="hidden md:flex shrink-0 flex-col items-center pt-3"
          style={{ width: 46, background: "#0a1410", borderLeft: "1px solid #1a2d1e" }}
        >
          <button
            onClick={expand}
            className="relative flex items-center justify-center rounded-lg transition-colors"
            title="Open chat"
            style={{ width: 34, height: 34, background: "#1a2d1e", border: "1px solid #2d4a3a", fontSize: 18 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#223a2a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1a2d1e")}
          >
            💬
            {unreadBadge}
          </button>
          <span
            style={{ writingMode: "vertical-rl", color: "#4b5563", fontSize: 10, fontWeight: 900, letterSpacing: 1, marginTop: 10, textTransform: "uppercase" }}
          >
            Chat
          </span>
        </div>

        {/* Phones: out of the layout flow, so the felt keeps the full width.
            Parked at the top-left, just under the 44px header and clear of the
            felt's top edge — the seats now reach 8% down the oval on the right
            and 2% in from its left, so the top-right corner is no longer free. */}
        <button
          onClick={expand}
          className="md:hidden fixed flex items-center justify-center rounded-lg"
          title="Open chat"
          style={{
            top: 48, left: 6, zIndex: 40, width: 32, height: 32,
            background: "rgba(26,45,30,0.9)", border: "1px solid #2d4a3a",
            fontSize: 17, backdropFilter: "blur(6px)",
          }}
        >
          💬
          {unreadBadge}
        </button>
      </>
    );
  }

  // ── Expanded sidebar ──
  // In the flex row from `md` up; a fixed overlay panel on phones, for the same
  // reason as the collapsed rail — it must not take width away from the felt.
  return (
    <div
      className="shrink-0 flex flex-col fixed inset-y-0 right-0 z-50 md:static md:z-auto"
      style={{ width: 250, background: "#0a1410", borderLeft: "1px solid #1a2d1e" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 36, borderBottom: "1px solid #1a2d1e" }}
      >
        <div className="flex items-center gap-1.5">
          <span style={{ fontSize: 13 }}>💬</span>
          <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" }}>
            Table Chat
          </span>
        </div>
        <button
          onClick={collapse}
          title="Collapse chat"
          className="rounded transition-colors"
          style={{ color: "#4b5563", fontSize: 16, lineHeight: 1, padding: "2px 6px" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e5e7eb")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#4b5563")}
        >
          ›
        </button>
      </div>

      {/* Message log */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2" style={{ minHeight: 0 }}>
        {feed.length === 0 ? (
          <span style={{ color: "#374151", fontSize: 11 }}>No messages yet</span>
        ) : (
          feed.map((m) => {
            if (m.kind === "system") {
              return (
                <div key={m.key} style={{ fontSize: 11, fontStyle: "italic", color: "#34d399", lineHeight: 1.4, padding: "2px 0" }}>
                  {m.text}{" "}
                  <span style={{ color: "#2f6b4f", fontStyle: "normal" }}>{timeLabel(m.at)}</span>
                </div>
              );
            }
            const isUser = m.kind === "user";
            const nameCol = isUser ? "#fbbf24" : "#e5e7eb";
            const textCol = isUser ? "#fcd34d" : "#d1d5db";
            return (
              <div key={m.key} className="flex gap-2" style={{ padding: "3px 0" }}>
                <span style={{ fontSize: 16, lineHeight: 1.3, flexShrink: 0 }}>{m.avatar}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-baseline gap-1.5">
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: nameCol, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.name}
                    </span>
                    <span style={{ fontSize: 9, color: "#4b5563", flexShrink: 0 }}>{timeLabel(m.at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: textCol, lineHeight: 1.4, wordBreak: "break-word" }}>{m.text}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick messages */}
      <div className="shrink-0 px-2 pt-2 flex flex-wrap gap-1" style={{ borderTop: "1px solid #1a2d1e" }}>
        {QUICK_MESSAGES.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            className="rounded-full transition-colors"
            style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", background: "#12211a", border: "1px solid #2d4a3a", padding: "3px 8px" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#1c3226"; e.currentTarget.style.color = "#e5e7eb"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#12211a"; e.currentTarget.style.color = "#9ca3af"; }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="shrink-0 p-2 flex flex-col gap-1">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
            maxLength={MAX_LEN}
            placeholder="Say something..."
            className="flex-1 rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: "#0f1a12", border: "1px solid #2d4a3a", color: "#e5e7eb", fontSize: 12.5 }}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg font-black transition-all disabled:opacity-40"
            style={{ background: "#b45309", color: "#fef3c7", fontSize: 12, padding: "0 12px", boxShadow: "0 2px 8px rgba(180,83,9,0.4)" }}
            onMouseEnter={(e) => { if (draft.trim()) e.currentTarget.style.background = "#d97706"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#b45309")}
          >
            Send
          </button>
        </div>
        <div className="text-right" style={{ color: draft.length >= MAX_LEN ? "#ef4444" : "#4b5563", fontSize: 10 }}>
          {draft.length}/{MAX_LEN}
        </div>
      </form>
    </div>
  );
}
