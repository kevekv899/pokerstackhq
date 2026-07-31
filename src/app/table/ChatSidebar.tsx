"use client";

import { useState, useRef, useEffect, useCallback } from "react";

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

type MsgKind = "user" | "opponent" | "system";

interface ChatMessage {
  id: number;
  kind: MsgKind;
  avatar?: string;
  name?: string;
  text: string;
  time: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_LEN = 200;
const KEEP = 50;               // keep the last 50 messages
const BIG_RAISE_TO = 15;       // $ threshold that makes a raise "big" enough to announce

const QUICK_MESSAGES = ["Nice hand! 👏", "Good game 🤝", "Lucky! 😅", "All in! 💰"];

const OPP_CHATTER = [
  "nh", "well played", "brutal river", "I had it 😤", "run it back",
  "ship it 🚢", "folded the winner again 🙈", "chip and a chair", "gg",
  "who taught you to bluff 😂", "variance is wild", "sitting on a monster 👀",
];

const WIN_CHATTER = ["ty ty", "ez 😎", "run good", "sorry 🙃", "🎣", "on the heater"];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function pick<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

// ─── ChatSidebar ───────────────────────────────────────────────────────────────

export default function ChatSidebar({
  game,
  heroAvatar,
}: {
  game: ChatGameView;
  heroAvatar: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [hero, setHero] = useState({ name: "You", avatar: heroAvatar });

  const idRef = useRef(0);
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pushMessage = useCallback((m: Omit<ChatMessage, "id" | "time">) => {
    setMessages((prev) => [...prev, { ...m, id: idRef.current++, time: nowLabel() }].slice(-KEEP));
    if (collapsedRef.current) setUnread((u) => u + 1);
  }, []);

  // Identify the signed-in player so their own lines show their real name/avatar.
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.user) setHero({ name: d.user.username, avatar: d.user.avatar });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Collapse by default on mobile / narrow screens.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches) {
      setCollapsed(true);
    }
  }, []);

  // Auto-scroll to the newest message while expanded.
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, collapsed]);

  const expand = useCallback(() => { setUnread(0); setCollapsed(false); }, []);

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
          .forEach((p) => pushMessage({ kind: "system", text: `${p.name} joined the table` }));
        pushMessage({ kind: "system", text: `--- New Hand #${game.handNum} ---` });
      }
    } else {
      if (game.handNum !== prev.handNum) {
        // New hand started.
        pushMessage({ kind: "system", text: `--- New Hand #${game.handNum} ---` });
        if (Math.random() < 0.4) {
          const opp = pick(game.players.filter((p) => !p.isHero && !p.folded));
          const line = pick(OPP_CHATTER);
          if (opp && line) pushMessage({ kind: "opponent", avatar: opp.avatar, name: opp.name, text: line });
        }
      } else {
        // Folds that happened this hand.
        game.players.forEach((p, i) => {
          if (p.folded && !prev.folded[i]) pushMessage({ kind: "system", text: `${label(p)} folded` });
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
            pushMessage({
              kind: "system",
              text: `💰 ${label(raiser)} ${verb} $${game.currentBet.toLocaleString()}!`,
            });
          }
        }
      }

      // Showdown result.
      if (game.street === "showdown" && prev.street !== "showdown" && game.banner) {
        pushMessage({ kind: "system", text: `🏆 ${game.banner}` });
        const winner = game.players.find((p) => game.winnerIds.includes(p.id) && !p.isHero);
        const line = pick(WIN_CHATTER);
        if (winner && line && Math.random() < 0.5) {
          pushMessage({ kind: "opponent", avatar: winner.avatar, name: winner.name, text: line });
        }
      }
    }

    prevRef.current = {
      handNum: game.handNum,
      street: game.street,
      currentBet: game.currentBet,
      folded: game.players.map((p) => p.folded),
    };
  }, [game, pushMessage]);

  // ── Sending ──
  const send = useCallback(
    (text: string) => {
      const t = text.trim().slice(0, MAX_LEN);
      if (!t) return;
      pushMessage({ kind: "user", avatar: hero.avatar, name: hero.name, text: t });
      setDraft("");
    },
    [hero, pushMessage]
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(draft);
  }

  // ── Collapsed strip ──
  if (collapsed) {
    return (
      <div
        className="shrink-0 flex flex-col items-center pt-3"
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
          {unread > 0 && (
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
          )}
        </button>
        <span
          style={{ writingMode: "vertical-rl", color: "#4b5563", fontSize: 10, fontWeight: 900, letterSpacing: 1, marginTop: 10, textTransform: "uppercase" }}
        >
          Chat
        </span>
      </div>
    );
  }

  // ── Expanded sidebar ──
  return (
    <div
      className="shrink-0 flex flex-col"
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
          onClick={() => setCollapsed(true)}
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
        {messages.length === 0 ? (
          <span style={{ color: "#374151", fontSize: 11 }}>No messages yet</span>
        ) : (
          messages.map((m) => {
            if (m.kind === "system") {
              return (
                <div key={m.id} style={{ fontSize: 11, fontStyle: "italic", color: "#34d399", lineHeight: 1.4, padding: "2px 0" }}>
                  {m.text}{" "}
                  <span style={{ color: "#2f6b4f", fontStyle: "normal" }}>{m.time}</span>
                </div>
              );
            }
            const isUser = m.kind === "user";
            const nameCol = isUser ? "#fbbf24" : "#e5e7eb";
            const textCol = isUser ? "#fcd34d" : "#d1d5db";
            return (
              <div key={m.id} className="flex gap-2" style={{ padding: "3px 0" }}>
                <span style={{ fontSize: 16, lineHeight: 1.3, flexShrink: 0 }}>{m.avatar}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-baseline gap-1.5">
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: nameCol, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.name}
                    </span>
                    <span style={{ fontSize: 9, color: "#4b5563", flexShrink: 0 }}>{m.time}</span>
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
