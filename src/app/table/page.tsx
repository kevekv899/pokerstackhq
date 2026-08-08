"use client";

/**
 * Cash table — a *view* of the game server, nothing more.
 *
 * The server owns the deck, the betting round, the clock and the showdown.
 * Everything on this page is derived from the last `PublicTableState` it sent:
 * there is no deck here, no bot, no local hand evaluation and no local
 * countdown. Buttons call `sendAction()` and then wait to be told what
 * happened — they never move a chip themselves.
 *
 * The presentation (felt, seats, cards, chips, sounds, animations, chat) is
 * unchanged; only where the numbers come from has moved.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatSidebar from "./ChatSidebar";
import { loadMuted, makeSounds, saveMuted } from "./_shared/sounds";
import {
  ActionButton, AnimatedAmount, Card, CommunitySlot, PotDisplay, WinBurst,
} from "./_shared/ui";
import type { CardData, FlyFrom, SeatAction, Suit } from "./_shared/ui";
import { BetPill, OpponentSeat } from "./_shared/seat";
import { OVAL_FIT, SCENE_H, SCENE_W, useFitScale } from "./_shared/useFitScale";
import { useGameSocket, type ConnectionStatus } from "@/lib/useGameSocket";
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

const TABLE_NUMBER = 4821;
const DEFAULT_TABLE_ID = `holdem-${TABLE_NUMBER}`;
/** Chips bought with the $200 wallet buy-in — one chip is one dollar. */
const BUY_IN_CHIPS = 200;
const AVATARS = ["😎", "🤠", "👑", "🎩", "🦈", "🐉"];

// ─── Server → view conversions ────────────────────────────────────────────────

const SUIT_SYMBOL: Record<EngineSuit, Suit> = { s: "♠", h: "♥", d: "♦", c: "♣" };

/** The engine speaks `{rank:'T',suit:'h'}`; the card components speak `10♥`. */
function toCardData(card: EngineCard): CardData {
  return { value: card.rank === "T" ? "10" : card.rank, suit: SUIT_SYMBOL[card.suit] };
}

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

/** Total chips each player is taking from the pots this hand. */
function winningsByPlayer(result: HandResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const pot of result.pots) {
    for (const winner of pot.winners) {
      out.set(winner.playerId, (out.get(winner.playerId) ?? 0) + winner.amount);
    }
  }
  return out;
}

function resultBanner(
  result: HandResult,
  nameOf: (id: string | null) => string,
  viewerId: string,
): string {
  const parts: string[] = [];
  for (const [playerId, amount] of winningsByPlayer(result)) {
    const hand = result.showdown?.find((entry) => entry.playerId === playerId)?.hand.name;
    const who = playerId === viewerId ? "You win" : `${nameOf(playerId)} wins`;
    parts.push(
      hand
        ? `${who} $${amount.toLocaleString()} with ${hand}`
        : `${who} $${amount.toLocaleString()}`,
    );
  }
  return parts.join(" · ");
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

// Milliseconds between consecutive cards leaving the dealer's hand.
const DEAL_STRIDE = 70;

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

function TableContent() {
  const searchParams = useSearchParams();
  const tableId = searchParams.get("table") ?? DEFAULT_TABLE_ID;
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
  const { state, error, status, sendAction, actionDeadline, actionTimeoutMs } = useGameSocket({
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

  // The result is cleared as soon as the next hand starts, but the banner and
  // the winner highlights should survive the reveal. Hold the last one until a
  // new hand is dealt.
  const [lastResult, setLastResult] = useState<{ handId: number; result: HandResult } | null>(null);
  useEffect(() => {
    if (!state) return;
    const { handId, result } = state;
    // Functional updates, and `lastResult` deliberately out of the dependency
    // list: reading it here would re-run this on its own write and spin.
    if (result) {
      setLastResult((prev) => (prev?.handId === handId ? prev : { handId, result }));
    } else {
      setLastResult((prev) => (prev && prev.handId !== handId ? null : prev));
    }
  }, [state]);

  const shownResult = isShowdown ? (state?.result ?? lastResult?.result ?? null) : null;
  const winnerIds = useMemo(
    () => (shownResult ? new Set(winningsByPlayer(shownResult).keys()) : new Set<string>()),
    [shownResult],
  );
  const isHeroWinner = !!state && winnerIds.has(state.viewerId);
  const banner = useMemo(
    () => (shownResult && state ? resultBanner(shownResult, nameOf, state.viewerId) : ""),
    [shownResult, state, nameOf],
  );

  const [bannerFading, setBannerFading] = useState(false);
  useEffect(() => {
    if (!banner) { setBannerFading(false); return; }
    const id = setTimeout(() => setBannerFading(true), 3500);
    return () => clearTimeout(id);
  }, [banner]);

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

  const wonSoundRef = useRef(-1);
  useEffect(() => {
    if (!shownResult || !isHeroWinner || wonSoundRef.current === shownResult.handId) return;
    wonSoundRef.current = shownResult.handId;
    sounds.current.win();
  }, [shownResult, isHeroWinner]);

  // ── Wallet ──

  // `hand` is only used to phrase the in-app notification ("🏆 You won $47 with
  // a Full House!"); the balance move ignores it.
  const reportGameResult = useCallback(
    async (type: "win" | "loss", amount: number, hand?: string) => {
      if (!buyinDoneRef.current || amount <= 0) return;
      try {
        const res = await fetch("/api/wallet/game-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, amount: Math.round(amount * 100), hand, table: TABLE_NUMBER }),
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

  async function handleLeaveTable(e: React.MouseEvent) {
    e.preventDefault();
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
      banner,
      winnerIds: winnerSeats,
      players,
    };
  }, [state, seatActions, winnerIds, banner]);

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

  return (
    <div className="h-[100dvh] text-white flex flex-col overflow-hidden" style={{ background: "#060d08", userSelect: "none" }}>

      {/* ── Header ── */}
      <header className="table-header flex items-center justify-between shrink-0 px-2 md:px-4 gap-2 h-11" style={{ background: "#0a1410", borderBottom: "1px solid #1a2d1e" }}>
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <a href="/lobby" onClick={handleLeaveTable} className="text-[11px] md:text-sm transition-colors shrink-0 cursor-pointer whitespace-nowrap" style={{ color: "#4b5563" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e5e7eb")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#4b5563")}>
            ← Lobby
          </a>
          <span className="hdr-title text-white font-bold text-xs md:text-sm truncate">NL Texas Hold&apos;em</span>
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
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 60%,#0d1f11 0%,#060d08 100%)" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="table-scene relative" style={{ width: SCENE_W, height: SCENE_H, transform: `scale(${tableScale})` }}>

                {/* Felt — gold rail, green bloom off the edge, woven overlay */}
                <div className="absolute felt-oval table-glow" style={{
                  background: "linear-gradient(155deg,#1a4a2a 0%,#0f3019 50%,#1a4a2a 100%)",
                  boxShadow: ["0 0 0 3px #c9a227", "0 0 0 7px #1e1200", "0 40px 130px rgba(0,0,0,0.95)", "inset 0 2px 6px rgba(255,200,50,0.08)"].join(",") }}>
                  <div className="absolute" style={{ inset: 10, borderRadius: "50%", background: "linear-gradient(155deg,#1c2a00,#162200,#1c2a00)" }}>
                    <div className="absolute felt-texture" style={{ inset: 16, borderRadius: "50%", background: "radial-gradient(ellipse at 45% 38%,#235f35 0%,#1a4a2a 52%,#0f3019 100%)", boxShadow: "inset 0 0 90px rgba(0,0,0,0.6),inset 0 0 30px rgba(0,0,0,0.35)" }}>
                      <div className="felt-center absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <PotDisplay pot={state?.totalPot ?? 0} />
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
                        {!banner && (
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
                      : Array.from({ length: player.hasCards ? 2 : 0 }, () => HIDDEN_CARD);

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

                {/* Gold burst when the hero takes it down */}
                {isShowdown && isHeroWinner && <WinBurst />}

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

                {/* Winner banner */}
                {banner && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 50 }}>
                    <div style={{
                      background: isHeroWinner ? "rgba(16,185,129,0.96)" : "rgba(185,30,30,0.96)",
                      color: "white", fontWeight: 900, fontSize: 18,
                      padding: "16px 36px", borderRadius: 16,
                      boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
                      textShadow: "0 2px 8px rgba(0,0,0,0.4)",
                      maxWidth: 560, textAlign: "center", lineHeight: 1.5,
                      animation: "page-fade-in 0.3s ease-out",
                      opacity: bannerFading ? 0 : 1,
                      transition: "opacity 0.5s ease-out",
                    }}>
                      {banner}
                    </div>
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
                    transform: i === 0 ? "rotate(-5deg) translateY(4px)" : "rotate(5deg) translateY(4px)",
                    transition: "transform 0.2s",
                  }}>
                    <Card
                      card={c}
                      size="lg"
                      fly={HERO_FLY}
                      delay={i * seatCount * DEAL_STRIDE}
                      reveal
                      isWinner={isHeroWinner && isShowdown}
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
                  {bannerFading ? "Dealing…" : "Next hand in a moment…"}
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
        <ChatSidebar game={chatGame} heroAvatar={hero ? avatarFor(hero.id) : AVATARS[0]} />
      </div>

      {/* Responsible gaming footer */}
      <div className="shrink-0 text-center py-1 text-xs" style={{ background: "#030806", color: "#374151", borderTop: "1px solid #111" }}>
        18+ · Play Responsibly · GamCare · BeGambleAware
      </div>
    </div>
  );
}

// ─── Default Export (Suspense wrapper) ────────────────────────────────────────

export default function TablePage() {
  return (
    <Suspense fallback={
      <div style={{ background: "#060d08", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div className="spinner" />
        <span style={{ color: "#4b5563", fontSize: 13 }}>Loading table…</span>
      </div>
    }>
      <TableContent />
    </Suspense>
  );
}
