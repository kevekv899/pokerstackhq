"use client";

import { Card, Chip, ChipStack, FlyFrom, SeatAction, SeatPlayer } from "./ui";

// ─── Seat status ──────────────────────────────────────────────────────────────

type SeatStatus = "winner" | "turn" | "allin" | "folded" | "eliminated" | "live";

/** The single colour that drives a seat's avatar ring, chip badge and label. */
const STATUS_RING: Record<SeatStatus, { ring: string; glow?: string; label: string; text: string }> = {
  winner:     { ring: "#c9a227", glow: "0 0 0 3px rgba(201,162,39,.55), 0 0 26px rgba(201,162,39,.5)", label: "WINNER",  text: "#f59e0b" },
  turn:       { ring: "#f59e0b", glow: "0 0 0 3px rgba(245,158,11,.5), 0 0 22px rgba(245,158,11,.45)", label: "TO ACT",  text: "#fbbf24" },
  allin:      { ring: "#ef4444", glow: "0 0 0 3px rgba(239,68,68,.45), 0 0 20px rgba(239,68,68,.4)",   label: "ALL IN",  text: "#f87171" },
  folded:     { ring: "#2d3748", label: "FOLDED", text: "#6b7280" },
  eliminated: { ring: "#1f2937", label: "OUT",    text: "#4b5563" },
  live:       { ring: "#10b981", label: "",       text: "#34d399" },
};

const ACTION_LABEL: Record<SeatAction, string> = {
  waiting: "", fold: "FOLDED", call: "CALL", check: "CHECK", raise: "RAISE", bet: "BET", allin: "ALL IN",
};

function statusOf(p: SeatPlayer, isWinner: boolean, isCurrentTurn: boolean): SeatStatus {
  if (p.eliminated) return "eliminated";
  if (isWinner) return "winner";
  if (p.folded) return "folded";
  if (p.isAllIn) return "allin";
  if (isCurrentTurn) return "turn";
  return "live";
}

// ─── OpponentSeat ─────────────────────────────────────────────────────────────

/**
 * One opponent around the table. Shared by the cash tables and the tournament —
 * tournament players additionally carry `eliminated`/`finishPos`, which switch
 * the seat into its faded bust-out state.
 */
export function OpponentSeat({
  player, pos, showCards, isCurrentTurn, isWinner,
  cardSize = "sm", fly, dealDelay = 0, dealStride = 70, compact = false,
}: {
  player: SeatPlayer; pos: React.CSSProperties;
  showCards: boolean; isCurrentTurn: boolean; isWinner: boolean;
  cardSize?: "sm" | "md"; fly?: FlyFrom;
  /** When this seat's first card leaves the dealer's hand. */
  dealDelay?: number;
  /** Gap to this seat's next card — one full trip around the table. */
  dealStride?: number;
  compact?: boolean;
}) {
  const status = statusOf(player, isWinner, isCurrentTurn);
  const s = STATUS_RING[status];
  const { folded, eliminated } = player;

  if (eliminated) {
    return (
      <div className={`seat absolute flex flex-col items-center gap-1 seat-eliminated ${compact ? "seat-compact" : ""}`} style={{ ...pos, zIndex: 20 }}>
        <div className="seat-avatar" style={{
          borderRadius: "50%", transform: "scale(0.8)",
          background: "#0d1117", border: `2px solid ${s.ring}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 8, color: "#4b5563", fontWeight: 900, letterSpacing: 1 }}>OUT</span>
        </div>
        <div style={{ background: "rgba(0,0,0,.7)", borderRadius: 6, padding: "2px 6px", maxWidth: 84 }}>
          <span className="seat-name" style={{ color: "#374151", fontSize: 10, fontWeight: 700 }}>{player.name}</span>
        </div>
        {player.finishPos != null && (
          <span style={{ color: "#4b5563", fontSize: 9, fontWeight: 700 }}>#{player.finishPos}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`seat absolute flex flex-col items-center gap-1 ${compact ? "seat-compact" : ""} ${isWinner ? "winner-seat" : ""}`}
      style={{ ...pos, zIndex: 20 }}
    >
      {isCurrentTurn && !folded && (
        <div className="seat-pill animate-pulse" style={{ background: "#f59e0b", color: "#000", boxShadow: "0 0 12px rgba(245,158,11,.6)" }}>
          THINKING…
        </div>
      )}
      {isWinner && (
        <div className="seat-pill" style={{ background: "#c9a227", color: "#000", boxShadow: "0 0 14px rgba(201,162,39,.6)" }}>
          WINNER!
        </div>
      )}

      <div className="seat-avatar" style={{ position: "relative" }}>
        {/* Status ring — one element so the colour transition is smooth. */}
        <div
          className={isCurrentTurn && !folded ? "status-ring status-ring-active" : "status-ring"}
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: folded ? "#1a2028" : "linear-gradient(145deg,#3c4655,#4b5563)",
            border: `3px solid ${s.ring}`,
            boxShadow: s.glow,
            opacity: folded ? 0.45 : 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "inherit", overflow: "hidden",
          }}
        >
          {player.avatar}
          {folded && (
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(0,0,0,.68)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 8.5, fontWeight: 900, color: "#9ca3af", letterSpacing: 1 }}>FOLDED</span>
            </div>
          )}
        </div>

        {(player.isDealer || player.isSB || player.isBB) && (
          <div style={{ position: "absolute", bottom: -4, right: -4, display: "flex", gap: 2 }}>
            {player.isDealer && <span className="pos-chip" style={{ background: "#c9a227", color: "#000" }}>D</span>}
            {player.isSB     && <span className="pos-chip" style={{ background: "#6b7280", color: "#fff" }}>SB</span>}
            {player.isBB     && <span className="pos-chip" style={{ background: "#374151", color: "#fff" }}>BB</span>}
          </div>
        )}
      </div>

      <div style={{
        background: isWinner ? "rgba(201,162,39,.18)" : "rgba(0,0,0,.82)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${isWinner ? "rgba(201,162,39,.5)" : isCurrentTurn ? "rgba(245,158,11,.3)" : "rgba(255,255,255,.06)"}`,
        borderRadius: 8, padding: "4px 8px", maxWidth: 96,
        display: "flex", flexDirection: "column", alignItems: "center",
        opacity: folded ? 0.5 : 1, transition: "opacity .3s, border-color .3s, background .3s",
      }}>
        <span className="seat-name" style={{ color: isWinner ? "#f59e0b" : "#fff", fontWeight: 700, fontSize: "var(--seat-name-fs)" }}>{player.name}</span>
        <span style={{ color: "#fbbf24", fontWeight: 900, fontSize: "var(--seat-chip-fs)" }}>${player.chips.toLocaleString()}</span>
        {player.isAllIn && !folded && <span style={{ color: "#ef4444", fontSize: "var(--seat-tag-fs)", fontWeight: 900, letterSpacing: 0.5 }}>ALL IN</span>}
        {!player.isAllIn && player.action !== "waiting" && !folded && (
          <span style={{ color: player.action === "fold" ? "#6b7280" : "#34d399", fontSize: "var(--seat-tag-fs)", fontWeight: 700, letterSpacing: 0.3 }}>
            {ACTION_LABEL[player.action]}
          </span>
        )}
      </div>

      {!folded && (
        <div className="seat-cards" style={{ maxWidth: player.cards.length > 2 ? 150 : 74 }}>
          {player.cards.map((c, i) => (
            <Card
              key={i}
              card={showCards ? c : null}
              faceDown={!showCards}
              size={cardSize}
              isWinner={isWinner && showCards}
              fly={fly}
              delay={dealDelay + i * dealStride}
            />
          ))}
        </div>
      )}

      {player.streetBet > 0 && !folded && (
        <div className="chip-slide bet-pill">
          <ChipStack amount={player.streetBet} size={13} max={3} />
          <span style={{ color: "#fcd34d", fontSize: 11.5, fontWeight: 900 }}>${player.streetBet.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

/** The small chip + amount badge used for the hero's own bet. */
export function BetPill({ amount, suffix }: { amount: number; suffix?: string }) {
  return (
    <div className="chip-slide bet-pill">
      <ChipStack amount={amount} size={14} max={4} />
      <span style={{ color: "#fcd34d", fontSize: 12, fontWeight: 900 }}>
        ${amount.toLocaleString()}{suffix ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}

export { Chip };
