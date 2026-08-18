"use client";

/**
 * Pot-Limit Omaha table — a *view* of the game server, nothing more.
 *
 * The server owns the deck, the betting round, the clock and the showdown.
 * Everything on this page is derived from the last `PublicTableState` it sent:
 * there is no deck here, no bot, no local hand evaluation and no local
 * countdown. Buttons call `sendAction()` and then wait to be told what
 * happened — they never move a chip themselves.
 *
 * This page previously held the whole 52-card deck, which meant every
 * opponent's four hole cards were sitting in the browser and readable by
 * anyone who opened the console. They are now dealt server-side and only ever
 * sent to their owner, or to everybody once the server reveals them at
 * showdown.
 *
 * Omaha differs from Hold'em only in what the server does — four hole cards
 * instead of two, and a hand scored from exactly two of them plus exactly
 * three from the board (`evaluateOmaha`). None of that lives here; this file
 * differs from `/table` only in how it looks and which table id it joins.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatSidebar from "../ChatSidebar";
import { loadMuted, makeSounds, saveMuted } from "../_shared/sounds";
import {
  ActionButton, AnimatedAmount, Card, Chip, CommunitySlot, PotDisplay, WinBurst,
} from "../_shared/ui";
import type { CardData, FlyFrom, SeatAction, Suit } from "../_shared/ui";
import { BetPill, OpponentSeat } from "../_shared/seat";
import { OVAL_FIT, SCENE_H, SCENE_W, useFitScale } from "../_shared/useFitScale";
import { OMAHA_TABLE_NUMBER, tableIdFor } from "../_shared/tables";
import {
  announcementSummary, buildAnnouncement, winningsByPlayer,
  type WinAnnouncement, type WinnerLine,
} from "../_shared/winAnnouncement";
import { useGameSocket, type ConnectionStatus } from "@/lib/useGameSocket";
import { HOLE_CARDS } from "@/lib/poker/types";
import type {
  Card as EngineCard,
  Suit as EngineSuit,
  HandEvent,
  HandResult,
  PublicPlayer,
  PublicSeat,
  PublicTableState,
} from "@/lib/poker/types";

// ─── Constants ─────────────────────────────────────────────────────────────────

const TABLE_NUMBER = OMAHA_TABLE_NUMBER;
/** The rules this page is drawn for; everything below assumes four hole cards. */
const PAGE_VARIANT = "OMAHA" as const;
/** Chips bought with the $200 wallet buy-in — one chip is one dollar. */
const BUY_IN_CHIPS = 200;
const AVATARS = ["😎", "🤠", "👑", "🎩", "🦈", "🐉"];

// ─── Server → view conversions ────────────────────────────────────────────────

const SUIT_SYMBOL: Record<EngineSuit, Suit> = { s: "♠", h: "♥", d: "♦", c: "♣" };

/** The engine speaks `{rank:'T',suit:'h'}`; the card components speak `10♥`. */
function toCardData(card: EngineCard): CardData {
  return { value: card.rank === "T" ? "10" : card.rank, suit: SUIT_SYMBOL[card.suit] };
}

/**
 * Symmetric four-card fan. Omaha deals twice the hole cards, so they are laid
 * out as a spread rather than Hold'em's two-card tilt, and drawn one size
 * smaller to keep the row inside a phone.
 */
const OMAHA_CARD_FANS = [
  "rotate(-9deg) translateY(8px)",
  "rotate(-3deg) translateY(3px)",
  "rotate(3deg) translateY(3px)",
  "rotate(9deg) translateY(8px)",
];

/** Placeholder for a face-down card — `<Card>` never reads it when `faceDown`. */
const HIDDEN_CARD: CardData = { value: "2", suit: "♠" };

/** Stable avatar per player id, so a seat keeps its face across hands. */
function avatarFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

/** Lower-cased street for display; SHOWDOWN and PAYOUT read as one phase. */
function streetLabel(state: PublicTableState | null): string {
  if (!state) return "waiting";
  if (state.street === "PAYOUT") return "showdown";
  return state.street.toLowerCase();
}

function isShowdownStreet(state: PublicTableState | null): boolean {
  return state?.street === "SHOWDOWN" || state?.street === "PAYOUT";
}

/**
 * Seats in the order they sit around the felt, hero first. Rotating by the
 * hero's seat is what puts *this* player at the bottom of the table without
 * the server having to care who is looking.
 */
function rotatedSeats(state: PublicTableState): { hero: PublicSeat | null; others: PublicSeat[] } {
  const heroIndex = state.seats.findIndex((seat) => seat.player?.isViewer);
  if (heroIndex === -1) {
    // Not seated (spectating, or the table filled up first) — show the table
    // as-is, trimmed to the slots the felt has.
    return { hero: null, others: state.seats.slice(0, SEAT_POS.length) };
  }
  const others: PublicSeat[] = [];
  for (let i = 1; i < state.seats.length; i++) {
    others.push(state.seats[(heroIndex + i) % state.seats.length]);
  }
  return { hero: state.seats[heroIndex], others };
}

/**
 * Who posted the blinds this hand, read off the server's history. The public
 * state does not label seats SB/BB, but the POST_BLIND events are ordered.
 */
function blindIds(history: HandEvent[]): { sb: string | null; bb: string | null } {
  const posts = history.filter((e) => e.type === "POST_BLIND" && e.playerId);
  return { sb: posts[0]?.playerId ?? null, bb: posts[1]?.playerId ?? null };
}

const EVENT_ACTION: Partial<Record<HandEvent["type"], SeatAction>> = {
  FOLD: "fold", CHECK: "check", CALL: "call", BET: "bet", RAISE: "raise", ALL_IN: "allin",
};

/** Each player's most recent action on the current street, for the seat badge. */
function currentStreetActions(state: PublicTableState): Record<string, SeatAction> {
  const out: Record<string, SeatAction> = {};
  for (const event of state.history) {
    if (event.street !== state.street || !event.playerId) continue;
    const action = EVENT_ACTION[event.type];
    if (action) out[event.playerId] = action;
  }
  return out;
}

/** The action log rail, rendered straight from the server's hand history. */
function historyLines(state: PublicTableState, nameOf: (id: string | null) => string): string[] {
  const lines: string[] = [];
  for (const event of state.history) {
    const who = nameOf(event.playerId);
    const amount = event.amount?.toLocaleString() ?? "";
    switch (event.type) {
      case "POST_BLIND": lines.push(`${who} posted $${amount}`); break;
      case "FOLD":       lines.push(`${who} folded`); break;
      case "CHECK":      lines.push(`${who} checked`); break;
      case "CALL":       lines.push(`${who} called $${amount}`); break;
      case "BET":        lines.push(`${who} bet $${amount}`); break;
      case "RAISE":      lines.push(`${who} raised to $${amount}`); break;
      case "ALL_IN":     lines.push(`${who} went all in $${amount}`); break;
      case "STREET":     lines.push(`— ${event.street.toLowerCase()} —`); break;
      default: break;
    }
  }
  return lines.slice(-20);
}

// ─── Win announcement ─────────────────────────────────────────────────────────

/** Chips leave the pot, land, and only then does the text arrive. */
const CHIP_FLIGHT_MS = 420;
const TEXT_IN_MS = 250;
const TEXT_HOLD_MS = 2000;
const TEXT_OUT_MS = 350;
/** How long the amount takes to count up once the text is in. */
const COUNT_UP_MS = 600;

type AnnouncePhase = "idle" | "chips" | "text" | "out";

/** The pot sits at the middle of the ring; chips start their flight here. */
const POT_CENTER = { left: "50%", top: "50%" };
/**
 * The hero seat lives below the felt, outside the ring, so its chips aim just
 * past the ring's bottom edge. Percentages of the ring rather than scene px:
 * the ring tracks the oval, so this stays aimed at the hero if the oval's
 * geometry ever changes per breakpoint.
 */
const HERO_CHIP_TARGET = { left: "50%", top: "104%" };

const CHIPS_PER_WINNER = 4;

/**
 * Where a winner's chips should land, in the seat ring's percentage frame.
 *
 * Derived from the seat index rather than by looking the player up in the
 * current seats, because they may have got up before the animation finishes —
 * the same rotation the seats are drawn with, applied to a snapshot.
 */
function chipTargetFor(winner: WinnerLine, announcement: WinAnnouncement): { left: string; top: string } {
  if (winner.isViewer) return HERO_CHIP_TARGET;

  const { viewerSeatIndex, seatCount } = announcement;
  if (winner.seatIndex === null || viewerSeatIndex === null || seatCount <= 0) {
    return POT_CENTER;
  }
  // Seats are drawn clockwise from the hero's left, so slot 0 is one seat past
  // the viewer — exactly the offset the ring is built with.
  const slot = (winner.seatIndex - viewerSeatIndex + seatCount) % seatCount - 1;
  const pos = slot >= 0 ? SEAT_POS[slot] : undefined;
  return pos ? { left: String(pos.left), top: String(pos.top) } : POT_CENTER;
}

/**
 * Chips sliding from the pot to each winner's seat.
 *
 * `left`/`top` are transitioned rather than keyframed because every winner has
 * a different destination, and keyframes cannot take per-element values. They
 * are percentages of the seat ring — the same frame the seats themselves are
 * positioned in — so a chip always lands on its seat at any viewport.
 */
function ChipFlight({ announcement, released }: { announcement: WinAnnouncement; released: boolean }) {
  return (
    <div className="absolute felt-oval seat-ring" style={{ zIndex: 30 }} aria-hidden>
      {announcement.winners.flatMap((winner) => {
        const target = chipTargetFor(winner, announcement);
        return Array.from({ length: CHIPS_PER_WINNER }, (_, i) => (
          <div
            key={`${winner.playerId}-${i}`}
            style={{
              position: "absolute",
              left: released ? target.left : POT_CENTER.left,
              top: released ? target.top : POT_CENTER.top,
              // Fanned slightly so four chips read as a stack in motion.
              transform: `translate(calc(-50% + ${(i - 1.5) * 7}px), calc(-50% + ${(i - 1.5) * 3}px))`,
              opacity: released ? 0 : 1,
              transition:
                `left ${CHIP_FLIGHT_MS}ms cubic-bezier(.35,.85,.35,1) ${i * 45}ms,` +
                `top ${CHIP_FLIGHT_MS}ms cubic-bezier(.35,.85,.35,1) ${i * 45}ms,` +
                // Fades out just as it arrives, handing off to the seat stack.
                `opacity 160ms linear ${CHIP_FLIGHT_MS - 60 + i * 45}ms`,
            }}
          >
            <Chip size={15} tone="gold" />
          </div>
        ));
      })}
    </div>
  );
}

/**
 * Counts from zero to `value`. Deliberately not `AnimatedAmount`, which holds
 * its first value so nothing counts up on mount — here the count-up from zero
 * *is* the effect, and it must restart every time the overlay appears.
 */
function CountUp({ value, style }: { value: number; style?: React.CSSProperties }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / COUNT_UP_MS);
      // easeOutCubic — fast out of the gate, settles onto the final number.
      setShown(t === 1 ? value : Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span style={style}>${shown.toLocaleString()}</span>;
}

/**
 * The announcement itself. Big and gold when the viewer won, quiet and
 * informative when somebody else did.
 *
 * Purely presentational: it renders the snapshot it is handed and owns no
 * game state.
 */
function WinAnnouncementCard({
  announcement, leaving,
}: { announcement: WinAnnouncement; leaving: boolean }) {
  const { winners, viewerWon } = announcement;
  const split = winners.length > 1;

  return (
    <div
      className={leaving ? "win-announce-out" : "win-announce"}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: split ? 8 : 4,
        // Bounded so a long name or a three-way split can never reach the rail.
        maxWidth: 520, padding: "0 16px", textAlign: "center",
      }}
    >
      {viewerWon && !split && (
        <div style={{
          color: "#fde68a", fontWeight: 900, fontSize: 40, lineHeight: 1, letterSpacing: 2,
          textShadow: "0 2px 10px rgba(0,0,0,.85), 0 0 34px rgba(201,162,39,.75)",
        }}>
          YOU WIN
        </div>
      )}

      {split && (
        <div style={{
          color: "#fbbf24", fontWeight: 900, fontSize: 15, letterSpacing: 3,
          textShadow: "0 2px 8px rgba(0,0,0,.8)",
        }}>
          SPLIT POT
        </div>
      )}

      {winners.map((winner) => {
        // A single non-viewer winner is the subdued case: informative, not a
        // celebration of somebody else's pot.
        const loud = winner.isViewer;
        return (
          <div key={winner.playerId} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {(split || !winner.isViewer) && (
                <span style={{
                  color: loud ? "#fde68a" : "#e5e7eb",
                  fontWeight: 900, fontSize: loud ? 20 : 15,
                  textShadow: "0 2px 8px rgba(0,0,0,.8)",
                  maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {winner.name} {winner.isViewer ? "win" : "wins"}
                </span>
              )}
              <CountUp
                value={winner.amount}
                style={{
                  color: loud ? "#f59e0b" : "#fcd34d",
                  fontWeight: 900,
                  fontSize: loud ? (split ? 26 : 34) : 20,
                  letterSpacing: -0.5,
                  textShadow: loud
                    ? "0 2px 10px rgba(0,0,0,.85), 0 0 26px rgba(245,158,11,.6)"
                    : "0 2px 8px rgba(0,0,0,.8)",
                }}
              />
            </div>
            {winner.hand && (
              <span style={{
                color: loud ? "#d1d5db" : "#9ca3af",
                fontSize: loud ? 13 : 11.5, fontWeight: 700, letterSpacing: 0.3,
                textShadow: "0 1px 6px rgba(0,0,0,.9)",
              }}>
                {winner.hand}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Seat geometry ────────────────────────────────────────────────────────────

// Seats are placed inside `.seat-ring`, which is the felt oval's own box — so
// every value below is a percentage OF THE OVAL, never a scene pixel. That is
// what keeps the opponents spread around the table on a phone: the ring tracks
// the oval, including the taller one phones switch to, so the seats scale with
// it instead of bunching to one side.
// The server deals a six-max table, so the ring holds five opponents plus the
// hero at the bottom. They run clockwise from the hero's left — the same order
// the seat indices do — and the ring is mirrored about the oval's vertical
// axis. Every seat is anchored through its own centre (`translate(-50%,…)`)
// rather than by an edge, so the two halves are true mirror images; anchoring
// one side by `left` and the other by `right` is what made the composition sit
// off-centre even when the container was perfectly centred.
const SEAT_POS: React.CSSProperties[] = [
  { top: "50%",  left: "0%",   transform: "translate(-50%,-50%)" }, // left extreme
  { top: "2%",   left: "18%",  transform: "translateX(-50%)"     }, // top left
  { top: "-7%",  left: "50%",  transform: "translateX(-50%)"     }, // top centre
  { top: "2%",   left: "82%",  transform: "translateX(-50%)"     }, // top right
  { top: "50%",  left: "100%", transform: "translate(-50%,-50%)" }, // right extreme
];

// Where each seat's cards fly in FROM, in px relative to where they land.
// These point back at the dealer position in the middle of the felt, so every
// card appears to be pitched out from the centre of the table.
const SEAT_FLY: FlyFrom[] = [
  { x:  216, y:  35, r:  18 },
  { x:  170, y: 110, r: -14 },
  { x:    0, y: 150, r:   0 },
  { x: -170, y: 110, r:  14 },
  { x: -216, y:  35, r: -18 },
];
// The hero's cards live in the action bar below the felt, so they arrive from
// well above rather than from a seat coordinate.
const HERO_FLY: FlyFrom = { x: 0, y: -280, r: 12 };

// Milliseconds between consecutive cards leaving the dealer's hand. Omaha
// pitches twice as many, so the stride is tighter than Hold'em's.
const DEAL_STRIDE = 52;

// ─── Empty seat ───────────────────────────────────────────────────────────────

/** An open seat. Rendered wherever the server reports `player: null`. */
function EmptySeat({ pos }: { pos: React.CSSProperties }) {
  return (
    <div className="seat absolute flex flex-col items-center gap-1" style={{ ...pos, zIndex: 20 }}>
      <div className="seat-avatar" style={{
        borderRadius: "50%",
        border: "2px dashed rgba(255,255,255,0.12)",
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 8, color: "#4b5563", fontWeight: 900, letterSpacing: 1 }}>OPEN</span>
      </div>
      <div style={{ background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "2px 6px" }}>
        <span className="seat-name" style={{ color: "#374151", fontSize: 10, fontWeight: 700 }}>
          Empty
        </span>
      </div>
    </div>
  );
}

// ─── Connection states ────────────────────────────────────────────────────────

/** Blocking cover for the states where there is no table to look at yet. */
function ConnectionCover({ status, error }: { status: ConnectionStatus; error: string | null }) {
  const disconnected = status === "disconnected";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{
      background: "rgba(6,13,8,0.92)", backdropFilter: "blur(3px)", zIndex: 60,
    }}>
      {!disconnected && <div className="spinner" />}
      <span style={{ color: disconnected ? "#f87171" : "#9ca3af", fontSize: 14, fontWeight: 700 }}>
        {status === "connecting" && "Connecting to the table…"}
        {status === "reconnecting" && "Reconnecting…"}
        {disconnected && "Disconnected"}
      </span>
      {error && (
        <span style={{ color: "#6b7280", fontSize: 12, maxWidth: 380, textAlign: "center", lineHeight: 1.5 }}>
          {error}
        </span>
      )}
      {disconnected && (
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg font-black transition-colors"
          style={{ background: "#b45309", color: "#fef3c7", fontSize: 13, padding: "8px 18px" }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Shown instead of the table when the server is not running Omaha.
 *
 * The variant is the server's to decide, so this is the last line of defence
 * for the one thing this page cannot fake: a Hold'em room would hand it a
 * two-card hand, which the felt would draw as though it were an Omaha hand
 * missing half its cards, and the pot-limit sizing and 2-of-4 hand reading the
 * player is counting on would not be the rules in play. Better to stop.
 */
function VariantMismatch({
  variant, tableId, onLeave, leaving,
}: {
  variant: string;
  tableId: string;
  onLeave: (e: React.MouseEvent) => void;
  leaving: boolean;
}) {
  return (
    <div
      role="alert"
      className="h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: "#060d08" }}
    >
      <span style={{ fontSize: 34 }} aria-hidden>♠️♦️</span>
      <h1 style={{ color: "#f87171", fontSize: 20, fontWeight: 900, letterSpacing: 0.3 }}>
        This table is not running Omaha
      </h1>
      <p style={{ color: "#9ca3af", fontSize: 13.5, maxWidth: 420, lineHeight: 1.6 }}>
        The server reports table <span style={{ color: "#e5e7eb", fontFamily: "monospace" }}>{tableId}</span>{" "}
        is dealing <span style={{ color: "#e5e7eb", fontWeight: 700 }}>{variant}</span>, not Omaha. This page
        is only safe to play as Pot-Limit Omaha, so it will not deal you a hand
        under the wrong rules.
      </p>
      <a
        href="/lobby"
        onClick={onLeave}
        className="rounded-lg font-black transition-colors"
        style={{
          background: "#b45309", color: "#fef3c7", fontSize: 13,
          padding: "9px 20px", opacity: leaving ? 0.6 : 1,
        }}
      >
        {leaving ? "Leaving…" : "← Back to the lobby"}
      </a>
    </div>
  );
}

/** Non-blocking strip: the table is still on screen and still readable. */
function ReconnectingStrip() {
  return (
    <div className="absolute left-1/2 flex items-center gap-2 animate-pulse" style={{
      top: 8, transform: "translateX(-50%)", zIndex: 55,
      background: "rgba(180,83,9,0.95)", color: "#fef3c7",
      fontSize: 11.5, fontWeight: 900, letterSpacing: 0.5,
      padding: "5px 14px", borderRadius: 999,
      boxShadow: "0 4px 18px rgba(0,0,0,0.55)",
    }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#fef3c7" }} />
      Reconnecting…
    </div>
  );
}

// ─── TableContent ─────────────────────────────────────────────────────────────

function OmahaTableContent() {
  const searchParams = useSearchParams();
  // The server reads the variant off the id it is handed, so this page may only
  // ever join one it resolves as Omaha — a Hold'em id here would be dealt two
  // hole cards onto a felt drawn for four. A `?table=` override for the other
  // variant is dropped, not forwarded.
  const tableId = tableIdFor(PAGE_VARIANT, searchParams.get("table"));
  const router = useRouter();

  // One scale factor for every screen. The scene is measured against the box
  // left between the header and the action bar and shrinks as a single unit, so
  // a phone gets the desktop table made smaller — not a rearranged one.
  const { ref: tableAreaRef, scale: tableScale } = useFitScale(OVAL_FIT);

  // Mute is loaded after mount — localStorage does not exist during SSR — and
  // written back on every toggle so the preference survives a reload.
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { setMuted(loadMuted()); }, []);

  const sounds = useRef(makeSounds(mutedRef));

  const toggleMute = useCallback(() => {
    setMuted((m) => { saveMuted(!m); return !m; });
    sounds.current.unlock();
  }, []);

  const [realBalance, setRealBalance] = useState<number | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  /** Held false until the wallet buy-in settles — we do not sit down unpaid. */
  const [seatReady, setSeatReady] = useState(false);
  const buyinDoneRef = useRef(false);
  const cashoutDoneRef = useRef(false);

  // ── The one source of game truth ──
  const {
    state, error, status, chatMessages, sendAction, sendChat, leave,
    actionDeadline, actionTimeoutMs,
  } = useGameSocket({
    tableId,
    buyIn: BUY_IN_CHIPS,
    enabled: seatReady,
  });

  // ── Derived view of the server's state ──
  const { hero: heroSeat, others } = useMemo(
    () => (state ? rotatedSeats(state) : { hero: null, others: [] }),
    [state],
  );
  const hero: PublicPlayer | null = heroSeat?.player ?? null;

  const nameOf = useCallback(
    (id: string | null): string => {
      if (!id || !state) return "Someone";
      if (id === state.viewerId) return "You";
      for (const seat of state.seats) if (seat.player?.id === id) return seat.player.name;
      return "Someone";
    },
    [state],
  );

  const blinds = useMemo(() => (state ? blindIds(state.history) : { sb: null, bb: null }), [state]);
  const seatActions = useMemo(() => (state ? currentStreetActions(state) : {}), [state]);
  const actionLog = useMemo(
    () => (state ? historyLines(state, nameOf) : []),
    [state, nameOf],
  );

  const isShowdown = isShowdownStreet(state);
  const legal = state?.legalActions ?? null;
  // The single gate on every action button: the server says it is our turn.
  const isHeroTurn = !!state && state.actingPlayerId === state.viewerId && legal !== null;

  // ── Win announcement ──
  //
  // Taken as a *snapshot* off the server's payout payload rather than read from
  // live state, because the two have different lifetimes: an uncontested win
  // goes PAYOUT -> WAITING -> next hand within the same tick, so by the time
  // the overlay is on screen `state.result` is already gone. Snapshotting is
  // also what keeps this purely decorative — the overlay can never hold up a
  // hand, because nothing waits on it.
  const [announcement, setAnnouncement] = useState<WinAnnouncement | null>(null);
  const [phase, setPhase] = useState<AnnouncePhase>("idle");
  const announcedHandRef = useRef(-1);

  useEffect(() => {
    if (!state?.result) return;
    // PAYOUT is the moment the chips actually move, on both the showdown and
    // the uncontested path. Firing on SHOWDOWN instead would run the chip
    // flight a full reveal-delay before the stacks changed.
    if (state.street !== "PAYOUT") return;
    if (announcedHandRef.current === state.result.handId) return;
    announcedHandRef.current = state.result.handId;
    setAnnouncement(buildAnnouncement(state, state.result));
  }, [state]);

  // Chips fly first, then the text lands on top of them.
  useEffect(() => {
    if (!announcement) { setPhase("idle"); return; }
    setPhase("chips");
    const toText = setTimeout(() => setPhase("text"), CHIP_FLIGHT_MS);
    const toOut = setTimeout(() => setPhase("out"), CHIP_FLIGHT_MS + TEXT_IN_MS + TEXT_HOLD_MS);
    const done = setTimeout(
      () => setAnnouncement(null),
      CHIP_FLIGHT_MS + TEXT_IN_MS + TEXT_HOLD_MS + TEXT_OUT_MS,
    );
    return () => { clearTimeout(toText); clearTimeout(toOut); clearTimeout(done); };
  }, [announcement]);

  // One flip drives every chip's transition, so they all leave together and
  // the browser gets a committed starting position first (see `chipsReleased`).
  const [chipsReleased, setChipsReleased] = useState(false);
  useEffect(() => {
    if (!announcement) { setChipsReleased(false); return; }
    setChipsReleased(false);
    // Two frames: the first paints the chips at the pot, the second moves
    // them. Without the gap the transition has no start value to run from.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setChipsReleased(true));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [announcement]);

  const winnerIds = useMemo(
    () => new Set((announcement?.winners ?? []).map((w) => w.playerId)),
    [announcement],
  );
  const isHeroWinner = !!announcement?.viewerWon;
  const showWinText = phase === "text" || phase === "out";

  /** One-line summary of the same snapshot, for the chat feed. */
  const announcementText = useMemo(
    () => (announcement ? announcementSummary(announcement) : ""),
    [announcement],
  );

  // ── Action clock, rendered from the server's deadline ──
  // The interval only re-renders the number; it is not a countdown of its own
  // and it never folds anyone. The server owns the timeout.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (actionDeadline === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [actionDeadline]);

  const secondsLeft = actionDeadline === null
    ? null
    : Math.max(0, Math.ceil((actionDeadline - now) / 1000));
  const totalSeconds = Math.max(1, Math.round(actionTimeoutMs / 1000));

  // Urgent countdown: a beep every second inside the last ten, climbing in
  // pitch as the clock runs out.
  useEffect(() => {
    if (!isHeroTurn || secondsLeft === null || secondsLeft > 10 || secondsLeft <= 0) return;
    sounds.current.timer(1 - secondsLeft / 10);
  }, [secondsLeft, isHeroTurn]);

  // ── Sounds, driven by what the server reports rather than by our own clicks ──
  const soundMarkRef = useRef({ handId: -1, historyLength: 0, boardLength: 0 });
  useEffect(() => {
    if (!state) return;
    const mark = soundMarkRef.current;

    if (state.handId !== mark.handId) {
      mark.handId = state.handId;
      mark.historyLength = 0;
      mark.boardLength = 0;
    }

    for (const event of state.history.slice(mark.historyLength)) {
      if (event.type === "FOLD") sounds.current.fold();
      else if (event.type === "ALL_IN") sounds.current.allin();
      else if (event.type === "BET" || event.type === "RAISE" || event.type === "CALL") {
        sounds.current.chip();
      }
    }
    mark.historyLength = state.history.length;

    if (state.board.length > mark.boardLength) {
      if (mark.boardLength > 0 || state.board.length >= 3) sounds.current.reveal();
      mark.boardLength = state.board.length;
    }
  }, [state]);

  // One swoosh per card as the hand is pitched out.
  const dealtHandRef = useRef(-1);
  useEffect(() => {
    if (!state || state.street !== "PREFLOP" || state.handId === dealtHandRef.current) return;
    dealtHandRef.current = state.handId;
    const dealt = state.seats.filter((seat) => seat.player?.hasCards).length;
    const ids = Array.from({ length: dealt * 2 }, (_, i) =>
      setTimeout(() => sounds.current.deal(), i * DEAL_STRIDE + 40));
    return () => ids.forEach(clearTimeout);
  }, [state]);

  // The win tone lands with the text, and only for the viewer's own win —
  // someone else taking the pot is information, not a fanfare.
  const wonSoundRef = useRef(-1);
  useEffect(() => {
    if (!announcement?.viewerWon || !showWinText) return;
    if (wonSoundRef.current === announcement.handId) return;
    wonSoundRef.current = announcement.handId;
    sounds.current.win();
  }, [announcement, showWinText]);

  // ── Wallet ──

  // Notification only — deliberately NOT a balance move.
  //
  // Chips at this table are real money that already left the wallet at buy-in
  // and comes back at cash-out. Settling each hand against the wallet as well
  // would pay a win twice: once here, and again when the stack holding it is
  // cashed out. The wallet is the truth for the account, the game server's
  // `stack` is the truth for the table, and they only meet at buy-in/cash-out.
  // The route moves nothing unless a caller opts in with `settleBalance`.
  //
  // `hand` is used to phrase the notification ("🏆 You won $47 with a Full
  // House!"). The response still carries the real balance, so the header stays
  // accurate without this having changed it.
  const reportGameResult = useCallback(
    async (type: "win" | "loss", amount: number, hand?: string) => {
      if (!buyinDoneRef.current || amount <= 0) return;
      try {
        const res = await fetch("/api/wallet/game-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            amount: Math.round(amount * 100),
            hand,
            table: TABLE_NUMBER,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setRealBalance(data.balance / 100);
        }
      } catch {}
    },
    [],
  );

  // Auth check + buy-in on mount. The socket stays closed until this settles.
  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        const user = meData.user;
        if (!user) { setIsGuest(true); setSeatReady(true); return; }
        if (user.balance < 20000) {
          router.replace("/wallet?message=Insufficient+balance%2C+please+deposit+funds");
          return;
        }
        if (buyinDoneRef.current) return;
        buyinDoneRef.current = true;
        const res = await fetch("/api/table/buyin", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          setRealBalance(data.balance / 100);
        }
      } finally {
        setSeatReady(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Settle each hand against the wallet from the server's result — the payouts
  // are the server's, not something recomputed here.
  const reportedHandRef = useRef(-1);
  useEffect(() => {
    const result = state?.result;
    if (!state || !result || reportedHandRef.current === result.handId) return;
    reportedHandRef.current = result.handId;
    const won = result.payouts[state.viewerId] ?? 0;
    const committed = hero?.totalCommitted ?? 0;
    if (won > 0) {
      const handName = result.showdown?.find((e) => e.playerId === state.viewerId)?.hand.name;
      reportGameResult("win", won, handName);
    } else if (committed > 0) {
      reportGameResult("loss", committed);
    }
  }, [state, hero, reportGameResult]);

  // Cash out whatever the server says we are sitting behind.
  const heroStackRef = useRef(BUY_IN_CHIPS);
  useEffect(() => { if (hero) heroStackRef.current = hero.stack; }, [hero]);

  // Send cashout when page is closed/refreshed (sendBeacon survives unload)
  useEffect(() => {
    function handleBeforeUnload() {
      if (cashoutDoneRef.current || !buyinDoneRef.current) return;
      cashoutDoneRef.current = true;
      navigator.sendBeacon(
        "/api/table/cashout",
        new Blob([JSON.stringify({ finalChips: heroStackRef.current })], { type: "application/json" }),
      );
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Send cashout on SPA unmount (browser back, programmatic navigation)
  useEffect(() => {
    return () => {
      if (cashoutDoneRef.current || !buyinDoneRef.current) return;
      cashoutDoneRef.current = true;
      fetch("/api/table/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalChips: heroStackRef.current }),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  const [leaving, setLeaving] = useState(false);

  async function handleLeaveTable(e: React.MouseEvent) {
    e.preventDefault();
    if (leaving) return;
    setLeaving(true);

    // Give the seat up first and wait for the server to confirm. Simply
    // navigating away drops the socket, which the server reads as a
    // disconnect and holds the seat open for a reconnect — the player would
    // stay sat at the table with their chips. Mid-hand this folds them; chips
    // already in the pot are forfeit, so only the stack below is cashed out.
    await leave();

    if (!cashoutDoneRef.current && buyinDoneRef.current) {
      cashoutDoneRef.current = true;
      await fetch("/api/table/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalChips: heroStackRef.current }),
      }).catch(() => {});
    }
    router.push("/lobby");
  }

  // Off-turn the server sends no `legalActions`, so these two keep the buttons
  // reading correctly from plain public fields. Display only — nothing acts on
  // them, and the server re-checks every action anyway.
  const toCall = legal
    ? legal.callAmount
    : Math.max(0, (state?.currentBet ?? 0) - (hero?.betThisRound ?? 0));
  const isBetContext = legal ? legal.canBet : (state?.currentBet ?? 0) === 0;

  // ── Bet sizing, bounded by what the server says is legal ──
  const minRaiseTo = legal ? (legal.canBet ? legal.minBet : legal.minRaiseTo) : (state?.bigBlind ?? 10);
  const maxRaiseTo = legal ? legal.maxRaiseTo : Math.max(minRaiseTo, hero?.stack ?? 0);
  const [raiseAmt, setRaiseAmt] = useState(minRaiseTo);
  useEffect(() => {
    setRaiseAmt((prev) => Math.max(minRaiseTo, Math.min(prev, maxRaiseTo)));
  }, [minRaiseTo, maxRaiseTo, state?.handId, state?.street]);
  const clampedRaise = Math.max(minRaiseTo, Math.min(raiseAmt, maxRaiseTo));

  // ── Actions. Each one is a message and nothing else. ──
  const heroFold  = () => { if (isHeroTurn) sendAction({ type: "FOLD" }); };
  const heroCheck = () => { if (isHeroTurn && legal?.canCheck) sendAction({ type: "CHECK" }); };
  const heroCall  = () => { if (isHeroTurn && legal?.canCall) sendAction({ type: "CALL" }); };
  const heroAllIn = () => { if (isHeroTurn) sendAction({ type: "ALL_IN" }); };
  const heroBetRaise = () => {
    if (!isHeroTurn || !legal) return;
    if (legal.canBet) sendAction({ type: "BET", amount: clampedRaise });
    else if (legal.canRaise) sendAction({ type: "RAISE", amount: clampedRaise });
  };

  // ── Chat feed. Presentational; seat index stands in for the numeric id the
  //    shared sidebar expects. ──
  const chatGame = useMemo(() => {
    const players = (state?.seats ?? [])
      .filter((seat): seat is PublicSeat & { player: PublicPlayer } => seat.player !== null)
      .map((seat) => ({
        id: seat.index,
        name: seat.player.isViewer ? "You" : seat.player.name,
        avatar: avatarFor(seat.player.id),
        folded: seat.player.status === "FOLDED",
        streetBet: seat.player.betThisRound,
        action: seatActions[seat.player.id] ?? "waiting",
        isHero: seat.player.isViewer,
      }));
    const winnerSeats = (state?.seats ?? [])
      .filter((seat) => seat.player && winnerIds.has(seat.player.id))
      .map((seat) => seat.index);
    return {
      handNum: state?.handId ?? 0,
      street: streetLabel(state),
      currentBet: state?.currentBet ?? 0,
      banner: announcementText,
      winnerIds: winnerSeats,
      players,
    };
  }, [state, seatActions, winnerIds, announcementText]);

  const communityLabels = ["FLOP", "FLOP", "FLOP", "TURN", "RIVER"];
  const board: (CardData | null)[] = [0, 1, 2, 3, 4].map((i) => {
    const card = state?.board[i];
    return card ? toCardData(card) : null;
  });

  const timerSeconds = secondsLeft ?? 0;
  const timerColor = timerSeconds > totalSeconds * 0.45 ? "#10b981"
    : timerSeconds > totalSeconds * 0.2 ? "#f59e0b" : "#ef4444";
  const timerRadius = 22;
  const timerCirc = 2 * Math.PI * timerRadius;
  const timerDash = (Math.min(1, timerSeconds / totalSeconds)) * timerCirc;

  const heroCards: CardData[] = hero?.holeCards?.map(toCardData) ?? [];
  const heroFolded = hero?.status === "FOLDED";
  const heroAllInNow = hero?.status === "ALL_IN";
  const activeCount = (state?.seats ?? []).filter(
    (seat) => seat.player && seat.player.status !== "SITTING_OUT" && seat.player.status !== "FOLDED",
  ).length;
  const seatCount = state?.seats.length ?? 6;
  const handId = state?.handId ?? 0;

  // The felt is covered while there is nothing to show; once state has arrived
  // a drop shows as a strip instead, so the table stays readable.
  const showCover = status === "disconnected" || (!state && status !== "connected");
  const showStrip = status === "reconnecting" && !!state;

  // Every hook above has run, so this is a safe place to bail out. The check is
  // deliberately on what the *server* said rather than on the id we sent: if
  // those two ever disagree again, this is what makes it loud instead of a
  // Hold'em hand quietly dealt onto an Omaha felt.
  if (state && state.variant !== PAGE_VARIANT) {
    return (
      <VariantMismatch
        variant={state.variant}
        tableId={state.tableId}
        onLeave={handleLeaveTable}
        leaving={leaving}
      />
    );
  }

  return (
    <div className="h-[100dvh] text-white flex flex-col overflow-hidden" style={{ background: "#060d08", userSelect: "none" }}>

      {/* ── Header ── */}
      <header className="table-header flex items-center justify-between shrink-0 px-2 md:px-4 gap-2 h-11" style={{ background: "#0a1410", borderBottom: "1px solid #1a2d1e" }}>
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <a href="/lobby" onClick={handleLeaveTable} className="text-[11px] md:text-sm transition-colors shrink-0 cursor-pointer whitespace-nowrap" style={{ color: "#4b5563", opacity: leaving ? 0.6 : 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e5e7eb")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#4b5563")}>
            {leaving ? "Leaving…" : "← Lobby"}
          </a>
          <span className="hdr-title text-white font-bold text-xs md:text-sm truncate">Pot-Limit Omaha</span>
          <span className="text-zinc-500 text-xs hidden sm:inline">
            ${state?.smallBlind ?? 5}/${state?.bigBlind ?? 10} · Table #{TABLE_NUMBER}
          </span>
          <span className="text-xs px-2 py-0.5 rounded font-mono hidden md:inline" style={{ background: "#1a2d1e", color: "#6b7280" }}>
            Hand #{handId.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-4 text-xs shrink-0" style={{ color: "#6b7280" }}>
          <span className="hidden sm:flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{
              background: status === "connected" ? "#10b981" : status === "disconnected" ? "#ef4444" : "#f59e0b",
            }} />
            {activeCount}/{seatCount} active
          </span>
          <span style={{ color: "#c9a227" }} className="font-bold whitespace-nowrap text-[11px] md:text-xs">
            Pot: <AnimatedAmount value={state?.totalPot ?? 0} />
          </span>
          <span className="hidden sm:inline uppercase" style={{ fontSize: 11 }}>{streetLabel(state)}</span>
          {realBalance !== null && (
            <span className="hidden sm:block text-xs font-bold px-2 py-0.5 rounded" style={{ color: "#34d399", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
              ${realBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          )}
          {isGuest && (
            <span className="hidden sm:block text-xs font-bold px-2 py-0.5 rounded" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
              GUEST · Fake Chips
            </span>
          )}
          <button
            onClick={toggleMute}
            className="tip px-1.5 md:px-2 py-0.5 md:py-1 rounded transition-colors shrink-0 text-xs md:text-sm"
            data-tip={muted ? "Unmute sounds" : "Mute sounds"}
            style={{ background: "#1a2d1e", color: muted ? "#4b5563" : "#34d399", border: "1px solid #2d4a3a" }}
            title={muted ? "Unmute" : "Mute"}>
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* `w-full mx-auto` + `min-w-0` keep the felt centred on the viewport:
            nothing in this row may make <main> wider than the screen, or the
            centred scene inside it drifts off to one side. */}
        <main className="flex-1 w-full mx-auto min-w-0 flex flex-col overflow-hidden">

          {/* ── Table scene ── */}
          <div ref={tableAreaRef} className="table-area flex-1 relative overflow-hidden">
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 60%,#1a130a 0%,#060d08 100%)" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="table-scene relative" style={{ width: SCENE_W, height: SCENE_H, transform: `scale(${tableScale})` }}>

                {/* Felt — gold rail, green bloom off the edge, woven overlay */}
                <div className="absolute felt-oval table-glow" style={{
                  background: "linear-gradient(155deg,#2a3a1a 0%,#1a2a0f 50%,#2a3a1a 100%)",
                  boxShadow: ["0 0 0 3px #c9a227", "0 0 0 7px #1e1200", "0 40px 130px rgba(0,0,0,0.95)", "inset 0 2px 6px rgba(255,200,50,0.12)"].join(",") }}>
                  <div className="absolute" style={{ inset: 10, borderRadius: "50%", background: "linear-gradient(155deg,#1c2a00,#162200,#1c2a00)" }}>
                    <div className="absolute felt-texture" style={{ inset: 16, borderRadius: "50%", background: "radial-gradient(ellipse at 45% 38%,#2a5f2a 0%,#1a4a1a 52%,#0f3010 100%)", boxShadow: "inset 0 0 90px rgba(0,0,0,0.6),inset 0 0 30px rgba(0,0,0,0.35)" }}>
                      <div className="felt-center absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <div className="flex items-center gap-3">
                          <PotDisplay pot={state?.totalPot ?? 0} />
                          <span style={{ background: "rgba(201,162,39,0.15)", color: "#c9a227", fontSize: 10, fontWeight: 900, padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(201,162,39,0.3)" }}>PLO</span>
                        </div>
                        {(state?.pots.length ?? 0) > 1 && (
                          <div className="flex gap-2 flex-wrap justify-center">
                            {state!.pots.map((pot, i) => (
                              <span key={i} style={{ background: "rgba(201,162,39,0.2)", color: "#fbbf24", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(201,162,39,0.3)" }}>
                                {i === 0 ? "Main Pot" : `Side Pot ${i}`}: ${pot.amount.toLocaleString()}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2" style={{ perspective: "600px" }}>
                          {board.map((card, i) => (
                            <CommunitySlot key={`${handId}-${i}-${card !== null}`} card={card} label={communityLabels[i]} flipDelay={i * 120} />
                          ))}
                        </div>
                        {!showWinText && (
                          <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>
                            {streetLabel(state)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seats. The ring shares the felt's exact box, so the
                    percentage seat coordinates stay pinned to the oval at every
                    viewport. Cards fly out from the middle of the felt, one seat
                    at a time, in the order a dealer would pitch them. */}
                <div className="absolute felt-oval seat-ring">
                  {SEAT_POS.map((pos, i) => {
                    const seat = others[i];
                    const player = seat?.player;
                    if (!seat || !player) return <EmptySeat key={`empty-${i}`} pos={pos} />;

                    // Only ever the cards the server chose to send us. Hidden
                    // hands are drawn as backs from `hasCards` — the values are
                    // not on this client to leak.
                    const revealed = player.holeCards !== null;
                    const cards: CardData[] = revealed
                      ? player.holeCards!.map(toCardData)
                      : Array.from(
                          { length: player.hasCards ? HOLE_CARDS[state!.variant] : 0 },
                          () => HIDDEN_CARD,
                        );

                    return (
                      <OpponentSeat
                        key={seat.index}
                        player={{
                          id: seat.index,
                          name: player.name,
                          avatar: avatarFor(player.id),
                          chips: player.stack,
                          cards,
                          folded: player.status === "FOLDED",
                          streetBet: player.betThisRound,
                          action: seatActions[player.id] ?? "waiting",
                          isDealer: seat.index === state?.buttonIndex,
                          isSB: player.id === blinds.sb,
                          isBB: player.id === blinds.bb,
                          isAllIn: player.status === "ALL_IN",
                        }}
                        pos={pos}
                        showCards={revealed}
                        isCurrentTurn={state?.actingPlayerId === player.id}
                        isWinner={winnerIds.has(player.id)}
                        fly={SEAT_FLY[i]}
                        dealDelay={i * DEAL_STRIDE}
                        dealStride={seatCount * DEAL_STRIDE}
                      />
                    );
                  })}
                </div>

                {/* Pot sliding across to whoever won it, ahead of the text. */}
                {announcement && (
                  <ChipFlight announcement={announcement} released={chipsReleased} />
                )}

                {/* Gold burst when the hero takes it down — behind the text. */}
                {showWinText && isHeroWinner && <WinBurst />}

                {/* Hero seat */}
                {hero && (
                  <div className="absolute flex flex-col items-center gap-1" style={{ bottom: 0, left: "50%", transform: "translateX(-50%)" }}>
                    {isHeroTurn && (
                      <div className="animate-pulse" style={{ background: "#10b981", color: "#000", fontWeight: 900, fontSize: 10, padding: "2px 10px", borderRadius: 4, letterSpacing: 1, boxShadow: "0 0 14px rgba(16,185,129,0.75)" }}>
                        YOUR TURN{secondsLeft !== null ? ` — ${secondsLeft}s` : ""}
                      </div>
                    )}
                    <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{
                      background: "rgba(0,0,0,0.78)",
                      border: isHeroWinner ? "2px solid #c9a227" : isHeroTurn ? "2px solid #10b981" : "1px solid rgba(245,158,11,0.35)",
                      backdropFilter: "blur(6px)",
                      boxShadow: isHeroWinner ? "0 0 22px rgba(201,162,39,0.55)" : isHeroTurn ? "0 0 16px rgba(16,185,129,0.5)" : undefined,
                    }}>
                      {(heroSeat!.index === state?.buttonIndex || hero.id === blinds.sb || hero.id === blinds.bb) && (
                        <div style={{ display: "flex", gap: 2, marginRight: 2 }}>
                          {heroSeat!.index === state?.buttonIndex && <span style={{ background: "#c9a227", color: "#000", fontWeight: 900, fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>D</span>}
                          {hero.id === blinds.sb && <span style={{ background: "#6b7280", color: "white", fontWeight: 900, fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>SB</span>}
                          {hero.id === blinds.bb && <span style={{ background: "#374151", color: "white", fontWeight: 900, fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>BB</span>}
                        </div>
                      )}
                      <span className="text-lg leading-none">{avatarFor(hero.id)}</span>
                      <span style={{ color: isHeroWinner ? "#f59e0b" : "#fbbf24", fontWeight: 900, fontSize: 12 }}>You</span>
                      <span style={{ color: "#374151", fontSize: 11 }}>·</span>
                      <AnimatedAmount value={hero.stack} style={{ color: "#f3f4f6", fontWeight: 700, fontSize: 12 }} />
                      {hero.betThisRound > 0 && <><span style={{ color: "#374151", fontSize: 11 }}>·</span><span style={{ color: "#fcd34d", fontSize: 11 }}>Bet ${hero.betThisRound}</span></>}
                      {heroFolded && <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 900 }}>· FOLDED</span>}
                      {heroAllInNow && <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 900 }}>· ALL IN</span>}
                      {isHeroWinner && <span style={{ color: "#f59e0b", fontSize: 11, fontWeight: 900 }}>· WINNER!</span>}
                    </div>

                    {!heroFolded && (hero.totalCommitted > 0 || hero.betThisRound > 0) && (
                      <div className="flex items-center gap-3" style={{ background: "rgba(0,0,0,0.7)", borderRadius: 8, padding: "3px 10px", border: "1px solid rgba(245,158,11,0.2)" }}>
                        <div className="flex flex-col items-center">
                          <span style={{ color: "#4b5563", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Stack</span>
                          <span style={{ color: "#f3f4f6", fontWeight: 900, fontSize: 12 }}>${hero.stack.toLocaleString()}</span>
                        </div>
                        {hero.totalCommitted > 0 && (
                          <div className="flex flex-col items-center">
                            <span style={{ color: "#4b5563", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>In Pot</span>
                            <span style={{ color: "#fcd34d", fontWeight: 900, fontSize: 12 }}>${hero.totalCommitted.toLocaleString()}</span>
                          </div>
                        )}
                        {hero.betThisRound > 0 && (
                          <div className="flex flex-col items-center">
                            <span style={{ color: "#4b5563", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Your Bet</span>
                            <span style={{ color: "#fbbf24", fontWeight: 900, fontSize: 12 }}>${hero.betThisRound.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {hero.betThisRound > 0 && !heroFolded && (
                      <BetPill amount={hero.betThisRound} suffix="to pot" />
                    )}
                  </div>
                )}

                {/* Win announcement. Lives inside `.table-scene`, so it shrinks
                    with the table and cannot overflow a phone; centred by flex
                    rather than a translate, so the scale-in pivots on its own
                    centre instead of the scene's layout box. */}
                {announcement && showWinText && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{ zIndex: 65 }}
                  >
                    <WinAnnouncementCard announcement={announcement} leaving={phase === "out"} />
                  </div>
                )}

              </div>
            </div>

            {showStrip && <ReconnectingStrip />}
            {showCover && <ConnectionCover status={status} error={error} />}
          </div>

          {/* ── Action bar ── */}
          <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 action-bar-wrapper" style={{ background: "rgba(6,13,8,0.97)", borderTop: "1px solid #1a2d1e" }}>

            {/* Hero cards + timer */}
            <div className="hero-hand-row flex items-end justify-center gap-4 md:gap-8 mb-3 md:mb-4">
              <div className="hero-hand-meta hero-meta-left flex flex-col items-end min-w-[90px] md:min-w-[110px]">
                <span className="hero-label" style={{ color: "#4b5563", fontSize: 11 }}>Your hand</span>
                <span className="truncate-1" style={{ color: "#34d399", fontWeight: 700, fontSize: 12, maxWidth: 130 }}>
                  {heroCards.map((c) => `${c.value}${c.suit}`).join(" ") || "—"}
                </span>
              </div>

              {isHeroTurn && secondsLeft !== null && (
                <div className="hero-timer">
                  <svg viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                    <circle cx="28" cy="28" r={timerRadius} fill="none" stroke={timerColor} strokeWidth="4"
                      strokeDasharray={`${timerDash} ${timerCirc}`}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dasharray 0.25s linear,stroke 0.3s" }} />
                  </svg>
                  <div className="timer-count" style={{ color: timerColor }}>{secondsLeft}</div>
                </div>
              )}

              {/* Hero hole cards: pitched in from the felt, then flipped face
                  up in 3D once they land. */}
              <div className="hero-cards flex gap-1.5 md:gap-2 items-end">
                {heroCards.map((c, i) => (
                  <div key={`${handId}-${i}`} style={{
                    transform: OMAHA_CARD_FANS[i] ?? OMAHA_CARD_FANS[OMAHA_CARD_FANS.length - 1],
                    transition: "transform 0.2s",
                  }}>
                    <Card
                      card={c}
                      size="md"
                      fly={HERO_FLY}
                      delay={i * seatCount * DEAL_STRIDE}
                      reveal
                      isWinner={isHeroWinner}
                      className={heroFolded ? "card-fold" : ""}
                    />
                  </div>
                ))}
              </div>

              <div className="hero-hand-meta hero-meta-right flex flex-col items-start min-w-[70px] md:min-w-[80px]">
                <span className="hero-label" style={{ color: "#4b5563", fontSize: 11 }}>Street</span>
                <span className="hero-street font-black" style={{ fontSize: 15, color: "#10b981", textTransform: "capitalize" }}>{streetLabel(state)}</span>
                {!!legal?.callAmount && (
                  <span style={{ color: "#6b7280", fontSize: 10, marginTop: 2 }}>To call: ${legal.callAmount.toLocaleString()}</span>
                )}
              </div>
            </div>

            {/* Pot / current bet reminder */}
            {!isShowdown && !heroFolded && !heroAllInNow && (
              <div className="flex justify-center mb-2">
                <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 700 }}>
                  Pot: <AnimatedAmount value={state?.totalPot ?? 0} style={{ color: "#f59e0b", fontWeight: 900 }} />
                  {!!state?.currentBet && <> · Current bet: <span style={{ color: "#fbbf24", fontWeight: 900 }}>${state.currentBet.toLocaleString()}</span></>}
                </span>
              </div>
            )}

            {/* Buttons */}
            {isShowdown ? (
              <div className="flex justify-center items-center gap-3">
                <span style={{ color: "#4b5563", fontSize: 13, fontWeight: 700 }}>
                  {phase === "out" ? "Dealing…" : "Next hand in a moment…"}
                </span>
              </div>
            ) : !hero ? (
              <div className="flex justify-center">
                <span style={{ color: "#4b5563", fontSize: 13, fontWeight: 700 }}>Waiting for a seat…</span>
              </div>
            ) : heroFolded ? (
              <div className="flex justify-center">
                <span style={{ color: "#4b5563", fontSize: 13, fontWeight: 700 }}>Waiting for next hand…</span>
              </div>
            ) : heroAllInNow ? (
              <div className="flex justify-center">
                <span style={{ color: "#ef4444", fontSize: 14, fontWeight: 900 }}>ALL IN — Waiting for showdown…</span>
              </div>
            ) : (
              <div className="flex items-stretch gap-2 md:gap-3 justify-center flex-wrap action-bar">

                <ActionButton tone="fold" onClick={heroFold} disabled={!isHeroTurn || !legal?.canFold} tip="Discard your hand">
                  Fold
                </ActionButton>

                {toCall <= 0 ? (
                  <ActionButton tone="check" onClick={heroCheck} disabled={!isHeroTurn || !legal?.canCheck} tip="Pass action without betting">
                    Check
                  </ActionButton>
                ) : (
                  <ActionButton tone="call" onClick={heroCall} disabled={!isHeroTurn || !legal?.canCall} tip={`Match the current bet of $${state?.currentBet ?? 0}`}>
                    Call ${toCall.toLocaleString()}
                  </ActionButton>
                )}

                {/* Bet / Raise + slider — collapses to one compact row on phones */}
                <div className="bet-controls flex items-center gap-2 md:gap-3 rounded-xl px-3 md:px-4 py-2" style={{ background: "#0f1a12", border: "1px solid #2d4a3a" }}>
                  <div className="bet-readout min-w-[60px] md:min-w-[72px]">
                    <div className="bet-readout-label" style={{ color: "#4b5563", fontSize: 11 }}>{isBetContext ? "Bet" : "Raise to"}</div>
                    <div className="bet-readout-value" style={{ color: "#f59e0b", fontWeight: 900, fontSize: 15 }}>${clampedRaise.toLocaleString()}</div>
                  </div>
                  <input type="range"
                    min={minRaiseTo} max={Math.max(minRaiseTo, maxRaiseTo)} step={1}
                    value={clampedRaise}
                    onChange={(e) => setRaiseAmt(Number(e.target.value))}
                    disabled={!isHeroTurn}
                    className="bet-slider w-20 md:w-32 cursor-pointer" style={{ accentColor: "#f59e0b" }} />
                  <div className="bet-quick flex flex-col gap-0.5">
                    {([
                      ["½P", Math.round((state?.totalPot ?? 0) * 0.5)],
                      ["Pot", state?.totalPot ?? 0],
                    ] as [string, number][]).map(([label, v]) => (
                      <button key={label}
                        onClick={() => setRaiseAmt(Math.min(maxRaiseTo, Math.max(minRaiseTo, v)))}
                        className="text-xs px-1.5 py-0.5 rounded transition-colors"
                        style={{ color: "#6b7280", background: "transparent" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#f59e0b"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#6b7280"; }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <ActionButton tone="raise" onClick={heroBetRaise}
                    disabled={!isHeroTurn || !(legal?.canBet || legal?.canRaise)}
                    tip={isBetContext ? "Open the betting" : "Raise the current bet"}>
                    {/* The amount is already shown in the readout to the left,
                        so drop it from the label on phones to save the row. */}
                    <span className="md:hidden">{isBetContext ? "Bet" : "Raise"}</span>
                    <span className="hidden md:inline">
                      {isBetContext ? "Bet" : "Raise to"} ${clampedRaise.toLocaleString()}
                    </span>
                  </ActionButton>
                  <ActionButton tone="allin" onClick={heroAllIn} disabled={!isHeroTurn || !legal?.canAllIn} compact
                    tip="Go all-in with all your chips">
                    All-in
                  </ActionButton>
                </div>

              </div>
            )}
          </div>
        </main>

        {/* ── Betting history ── */}
        <aside className="hidden lg:flex flex-col shrink-0" style={{ width: 190, background: "#0a1410", borderLeft: "1px solid #1a2d1e" }}>
          <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid #1a2d1e" }}>
            <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" }}>Action Log</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
            {actionLog.length === 0
              ? <span style={{ color: "#374151", fontSize: 11 }}>No actions yet</span>
              : actionLog.slice(-5).reverse().map((entry, i) => (
                  <div key={`${actionLog.length}-${i}`} style={{
                    color: i === 0 ? "#d1d5db" : "#6b7280", fontSize: 11.5, lineHeight: 1.4,
                    padding: "4px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  }}>
                    {entry}
                  </div>
                ))}
          </div>
        </aside>

        {/* ── Live chat ── */}
        <ChatSidebar
          game={chatGame}
          chatMessages={chatMessages}
          viewerId={state?.viewerId ?? null}
          avatarFor={avatarFor}
          onSend={sendChat}
        />
      </div>

      {/* Responsible gaming footer */}
      <div className="shrink-0 text-center py-1 text-xs" style={{ background: "#030806", color: "#374151", borderTop: "1px solid #111" }}>
        18+ · Play Responsibly · GamCare · BeGambleAware
      </div>
    </div>
  );
}

// ─── Default Export (Suspense wrapper) ────────────────────────────────────────

export default function OmahaTablePage() {
  return (
    <Suspense fallback={
      <div style={{ background: "#060d08", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div className="spinner" />
        <span style={{ color: "#4b5563", fontSize: 13 }}>Loading table…</span>
      </div>
    }>
      <OmahaTableContent />
    </Suspense>
  );
}
