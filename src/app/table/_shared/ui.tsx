"use client";

import { useEffect, useRef, useState } from "react";

// ─── Shared table types ───────────────────────────────────────────────────────

export type Suit = "♠" | "♥" | "♦" | "♣";
export interface CardData { value: string; suit: Suit; }
export type SeatAction = "waiting" | "fold" | "call" | "check" | "raise" | "bet" | "allin";

/**
 * The subset of a player a seat needs to render. Both the cash-game
 * `PlayerState` and the tournament `TPlayer` satisfy this structurally, so one
 * seat component serves every table.
 */
export interface SeatPlayer {
  id: number; name: string; avatar: string; chips: number;
  cards: CardData[]; folded: boolean; streetBet: number;
  action: SeatAction;
  isDealer: boolean; isSB: boolean; isBB: boolean; isAllIn: boolean;
  eliminated?: boolean; finishPos?: number | null;
}

/** Where a card flies in from, in px relative to its resting place. */
export interface FlyFrom { x: number; y: number; r?: number }

// ─── Card ─────────────────────────────────────────────────────────────────────

/**
 * Card metrics live in CSS, not here — see `.pcard-sm/-md/-lg` in globals.css.
 * They have to: an inline custom property beats every stylesheet selector, so
 * seeding them from JS would make the responsive overrides unreachable.
 */
export type CardSize = "sm" | "md" | "lg";

/** How long the deal flight lasts — the 3D reveal is scheduled after it. */
export const FLY_MS = 420;

function faceShadow(isWinner: boolean): string {
  // Layered: a tight contact shadow, a soft ambient one, then the gold bloom.
  return isWinner
    ? "0 1px 2px rgba(0,0,0,.55), 0 6px 16px rgba(0,0,0,.5), 0 0 22px rgba(201,162,39,.55)"
    : "0 1px 2px rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.45)";
}

// Both faces read their metrics from the CSS custom properties set by <Card>,
// so a media query on the card's size class rescales everything at once.

function CardFace({ card, isWinner }: { card: CardData; isWinner: boolean }) {
  const isRed = card.suit === "♥" || card.suit === "♦";
  const col = isRed ? "#c81e1e" : "#111827";
  return (
    <div style={{
      position: "absolute", inset: 0, borderRadius: "var(--c-radius)", padding: "var(--c-pad)",
      background: "linear-gradient(160deg,#fff 0%,#f4f5f7 55%,#e8eaed 100%)",
      border: isWinner ? "2px solid #c9a227" : "1px solid rgba(0,0,0,.16)",
      boxShadow: faceShadow(isWinner),
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
      overflow: "hidden",
    }}>
      <span style={{ fontSize: "var(--c-corner)", fontWeight: 900, lineHeight: 1, color: col, letterSpacing: -0.5 }}>{card.value}</span>
      <span style={{ fontSize: "var(--c-suit)", textAlign: "center", lineHeight: 1, color: col, display: "block", textShadow: "0 1px 1px rgba(0,0,0,.12)" }}>{card.suit}</span>
      <span style={{ fontSize: "var(--c-corner)", fontWeight: 900, lineHeight: 1, color: col, transform: "rotate(180deg)", alignSelf: "flex-end", display: "block", letterSpacing: -0.5 }}>{card.value}</span>
    </div>
  );
}

function CardBack({ spun = false }: { spun?: boolean }) {
  return (
    <div style={{
      position: "absolute", inset: 0, borderRadius: "var(--c-radius)",
      background: "linear-gradient(155deg,#16306e 0%,#1e40af 52%,#16306e 100%)",
      backgroundImage: "repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0,rgba(255,255,255,.05) 2px,transparent 0,transparent 6px)",
      backgroundSize: "9px 9px",
      border: "1.5px solid rgba(200,214,255,.28)",
      boxShadow: "0 1px 2px rgba(0,0,0,.5), 0 6px 16px rgba(0,0,0,.45), inset 0 0 12px rgba(0,0,0,.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
      backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
      transform: spun ? "rotateY(180deg)" : undefined,
      overflow: "hidden",
    }}>
      <span style={{ color: "rgba(190,212,255,.28)", fontSize: "var(--c-corner)", fontWeight: 900, letterSpacing: 1 }}>PS</span>
    </div>
  );
}

/**
 * A playing card.
 *
 * - `fly`   — deals the card in from an offset (the dealer button position).
 * - `reveal`— plays a real 3D rotateY flip from back to face after it lands.
 * - `flip`  — the lighter 2D flip used for community cards.
 *
 * Animation is pure CSS; nothing here holds timer state.
 */
export function Card({
  card, faceDown = false, size = "md", isWinner = false,
  fly, delay = 0, reveal = false, flip = false, className = "", style,
}: {
  card?: CardData | null; faceDown?: boolean; size?: CardSize; isWinner?: boolean;
  fly?: FlyFrom; delay?: number; reveal?: boolean; flip?: boolean;
  className?: string; style?: React.CSSProperties;
}) {
  const showBack = !card || faceDown;

  // Only per-instance values go inline. Size metrics come from the `pcard-*`
  // class so media queries can rescale them.
  const outer: React.CSSProperties = {
    ...(fly ? {
      ["--fly-x" as string]: `${fly.x}px`,
      ["--fly-y" as string]: `${fly.y}px`,
      ["--fly-r" as string]: `${fly.r ?? -20}deg`,
      animationDelay: `${delay}ms`,
    } : delay > 0 ? { animationDelay: `${delay}ms` } : {}),
    ...style,
  };

  const outerClass = [
    "pcard", `pcard-${size}`,
    fly ? "card-fly" : flip ? "card-flip" : "",
    isWinner ? "card-winner" : "",
    className,
  ].filter(Boolean).join(" ");

  // 3D reveal: both faces exist at once inside a preserve-3d flipper.
  if (reveal && card) {
    return (
      <div className={outerClass} style={outer}>
        <div
          className="card-reveal"
          style={{
            position: "absolute", inset: 0, transformStyle: "preserve-3d",
            animationDelay: `${delay + (fly ? FLY_MS - 90 : 0)}ms`,
          }}
        >
          <CardBack />
          <div style={{ position: "absolute", inset: 0, transform: "rotateY(180deg)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
            <CardFace card={card} isWinner={isWinner} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={outerClass} style={outer}>
      {showBack ? <CardBack /> : <CardFace card={card} isWinner={isWinner} />}
    </div>
  );
}

/**
 * A community card position. The caller must vary the React key with whether a
 * card is present, so the placeholder unmounts and a fresh Card mounts —
 * that remount is what replays the flip animation.
 */
export function CommunitySlot({ card, label, flipDelay = 0 }: { card: CardData | null; label: string; flipDelay?: number }) {
  // Shares the card size class so the empty slot always matches the real cards.
  if (!card) return (
    <div className="pcard pcard-md" style={{
      borderRadius: "var(--c-radius)",
      border: "2px dashed rgba(255,255,255,.1)", background: "rgba(0,0,0,.2)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ color: "rgba(255,255,255,.2)", fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
    </div>
  );
  return <Card card={card} size="md" flip delay={flipDelay} />;
}

// ─── Chips ────────────────────────────────────────────────────────────────────

export type ChipTone = "gold" | "green" | "red" | "black" | "blue";

const CHIP_TONES: Record<ChipTone, { base: string; light: string; dark: string; edge: string }> = {
  gold:  { base: "#d4a72c", light: "#fde68a", dark: "#7c5e0a", edge: "#fff7d6" },
  green: { base: "#10b981", light: "#a7f3d0", dark: "#065f46", edge: "#ecfdf5" },
  red:   { base: "#dc2626", light: "#fecaca", dark: "#7f1d1d", edge: "#fff1f1" },
  black: { base: "#374151", light: "#9ca3af", dark: "#030712", edge: "#e5e7eb" },
  blue:  { base: "#2563eb", light: "#bfdbfe", dark: "#1e3a8a", edge: "#eff6ff" },
};

/** One casino chip: dashed edge spots, domed inlay, contact shadow. */
export function Chip({ size = 18, tone = "gold", style }: { size?: number; tone?: ChipTone; style?: React.CSSProperties }) {
  const c = CHIP_TONES[tone];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", position: "relative", flexShrink: 0,
      // Alternating edge spots are what make a disc read as a poker chip.
      background: `repeating-conic-gradient(${c.edge} 0deg 17deg, ${c.base} 17deg 45deg)`,
      boxShadow: `0 ${Math.max(1, size * 0.07)}px ${size * 0.16}px rgba(0,0,0,.6), inset 0 0 0 ${size * 0.055}px ${c.dark}`,
      ...style,
    }}>
      <div style={{
        position: "absolute", inset: size * 0.17, borderRadius: "50%",
        background: `radial-gradient(circle at 34% 27%, ${c.light} 0%, ${c.base} 58%, ${c.dark} 100%)`,
        boxShadow: `inset 0 ${size * 0.05}px ${size * 0.1}px rgba(255,255,255,.4), inset 0 -${size * 0.05}px ${size * 0.1}px rgba(0,0,0,.45)`,
      }} />
    </div>
  );
}

/** A stack of chips, height scaled to the amount. Bounces when it grows. */
export function ChipStack({
  amount, size = 18, tone = "gold", max = 5, bounce = false,
}: { amount: number; size?: number; tone?: ChipTone; max?: number; bounce?: boolean }) {
  if (amount <= 0) return null;
  // Log scale so a $2 blind and a $400 pot both render sensibly.
  const count = Math.max(1, Math.min(max, Math.ceil(Math.log10(amount + 1) * 1.9)));
  const step = size * 0.2;
  return (
    <div
      className={bounce ? "chip-bounce" : undefined}
      style={{ position: "relative", width: size, height: size + step * (count - 1), flexShrink: 0 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Chip key={i} size={size} tone={tone} style={{ position: "absolute", left: 0, bottom: i * step, zIndex: i }} />
      ))}
    </div>
  );
}

// ─── Animated amount ──────────────────────────────────────────────────────────

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Counts smoothly from its previous value to `value`. The first render lands
 * on the final number immediately so nothing counts up from zero on mount.
 */
export function AnimatedAmount({
  value, prefix = "$", duration = 520, style, className,
}: { value: number; prefix?: string; duration?: number; style?: React.CSSProperties; className?: string }) {
  const [shown, setShown] = useState(value);
  // Mirrors `shown` outside React state so an interrupted tween can resume
  // from whatever is actually on screen rather than from the old target.
  const shownRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    let start: number | null = null;

    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const v = t === 1 ? value : Math.round(from + (value - from) * easeOutCubic(t));
      shownRef.current = v;
      setShown(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <span className={className} style={style}>{prefix}{shown.toLocaleString()}</span>;
}

/** True for one render cycle each time `value` increases — drives bounces. */
export function useIncreased(value: number, holdMs = 480): boolean {
  const prev = useRef(value);
  const [hit, setHit] = useState(false);
  useEffect(() => {
    if (value > prev.current) {
      setHit(true);
      const id = setTimeout(() => setHit(false), holdMs);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
  }, [value, holdMs]);
  return hit;
}

// ─── Pot display ──────────────────────────────────────────────────────────────

export function PotDisplay({ pot, tone = "gold" }: { pot: number; tone?: ChipTone }) {
  const grew = useIncreased(pot);
  return (
    <div className="flex items-center gap-2.5">
      <ChipStack amount={pot} size={18} tone={tone} bounce={grew} />
      <AnimatedAmount
        value={pot}
        className={grew ? "chip-flash" : undefined}
        style={{
          color: "#f59e0b", fontSize: 21, fontWeight: 900, letterSpacing: -0.5,
          textShadow: "0 2px 12px rgba(0,0,0,.75), 0 0 20px rgba(245,158,11,.25)",
          display: "inline-block",
        }}
      />
    </div>
  );
}

// ─── Winner celebration ───────────────────────────────────────────────────────

// Deterministic jitter — avoids Math.random() so a burst never differs between
// renders (and can never introduce a hydration mismatch).
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const BURST_TONES = ["#c9a227", "#f59e0b", "#fde68a", "#10b981", "#fbbf24", "#fff7d6"];

/**
 * Gold particle + confetti burst. Mount it only while a win is on screen —
 * it animates once and holds at opacity 0.
 */
export function WinBurst({ count = 38 }: { count?: number }) {
  return (
    <div className="win-burst" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * 360 + jitter(i, 1) * 22;
        const dist = 120 + jitter(i, 2) * 190;
        const rad = (angle * Math.PI) / 180;
        const isConfetti = i % 3 !== 0;
        const size = isConfetti ? 5 + jitter(i, 5) * 5 : 4 + jitter(i, 6) * 4;
        return (
          <span
            key={i}
            className="win-particle"
            style={{
              ["--dx" as string]: `${Math.cos(rad) * dist}px`,
              ["--dy" as string]: `${Math.sin(rad) * dist - 40}px`,
              ["--rot" as string]: `${(jitter(i, 3) - 0.5) * 900}deg`,
              width: isConfetti ? size : size,
              height: isConfetti ? size * 1.9 : size,
              borderRadius: isConfetti ? 1 : "50%",
              background: BURST_TONES[i % BURST_TONES.length],
              animationDelay: `${jitter(i, 4) * 260}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Flash banner ─────────────────────────────────────────────────────────────

/**
 * The "Blinds increased to $4/$8!" sting. Renders while `message` is set and
 * calls `onDone` when the animation finishes so the caller can clear it.
 */
export function FlashBanner({ message, onDone, holdMs = 2600 }: { message: string; onDone?: () => void; holdMs?: number }) {
  useEffect(() => {
    const id = setTimeout(() => onDone?.(), holdMs);
    return () => clearTimeout(id);
  }, [message, holdMs, onDone]);

  return (
    <div className="absolute inset-0 flex items-start justify-center pointer-events-none" style={{ zIndex: 80, paddingTop: "18%" }}>
      <div className="flash-banner">{message}</div>
    </div>
  );
}

// ─── Action buttons ───────────────────────────────────────────────────────────

export type ButtonTone = "fold" | "check" | "call" | "raise" | "allin";

const BUTTON_TONES: Record<ButtonTone, { bg: string; fg: string; glow: string; border: string }> = {
  fold:  { bg: "linear-gradient(180deg,#9b2020 0%,#7f1d1d 100%)", fg: "#ffe4e4", glow: "rgba(185,28,28,.6)",  border: "rgba(255,180,180,.22)" },
  check: { bg: "linear-gradient(180deg,#334155 0%,#1f2937 100%)", fg: "#e5e7eb", glow: "rgba(100,116,139,.55)", border: "rgba(255,255,255,.14)" },
  call:  { bg: "linear-gradient(180deg,#15803d 0%,#14532d 100%)", fg: "#dcfce7", glow: "rgba(22,163,74,.6)",   border: "rgba(167,243,208,.22)" },
  raise: { bg: "linear-gradient(180deg,#d99408 0%,#b45309 100%)", fg: "#fffbeb", glow: "rgba(217,148,8,.65)",  border: "rgba(253,230,138,.3)" },
  allin: { bg: "linear-gradient(180deg,#7f1d1d 0%,#450a0a 100%)", fg: "#fecaca", glow: "rgba(220,38,38,.6)",   border: "rgba(248,113,113,.35)" },
};

export function ActionButton({
  tone, children, onClick, disabled = false, tip, compact = false,
}: {
  tone: ButtonTone; children: React.ReactNode; onClick: () => void;
  disabled?: boolean; tip?: string; compact?: boolean;
}) {
  const t = BUTTON_TONES[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      className={`btn-action action-btn ${compact ? "btn-compact" : ""} ${tip ? "tip" : ""}`}
      style={{
        ["--btn-glow" as string]: t.glow,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        // Sizing lives in CSS (see .btn-action) so media queries can shrink
        // every action button in one place.
      }}
    >
      {children}
    </button>
  );
}
