/**
 * Tournament lobby — a preview, not a door.
 *
 * The tables themselves are closed (see `app/tournament/[id]/page.tsx`): they
 * ran the whole game in the browser, hole cards included. This page stays up so
 * what is planned is still visible, but nothing on it registers anyone, takes a
 * buy-in, or leads to a table. There is no registration state to hold, so there
 * is no state here at all — a Server Component that renders three cards and a
 * notice.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "../components/Navbar";

export const metadata: Metadata = {
  title: "Tournaments · PokerStack",
  description: "Sit & Go tournaments are coming soon.",
};

const CONFIGS = [
  { id: 1, players: 4, prizePool: 200, label: "4-Player Sit & Go" },
  { id: 2, players: 6, prizePool: 300, label: "6-Player Sit & Go" },
  { id: 3, players: 9, prizePool: 450, label: "9-Player Sit & Go" },
] as const;

/**
 * The table's seats, all of them open.
 *
 * Deliberately never drawn as partly filled: there is no registration, so any
 * filled seat here would be an invented player at a table that does not exist.
 */
function SeatDots({ total }: { total: number }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 14, height: 14, borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.18)",
            background: "transparent",
          }}
        />
      ))}
    </div>
  );
}

function TournamentCard({ config }: { config: typeof CONFIGS[number] }) {
  const { players, prizePool, label } = config;

  return (
    <div
      className="flex flex-col rounded-2xl p-5"
      style={{ background: "#0f1a12", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-black text-white text-base">{label}</span>
          </div>
          <p className="text-zinc-500 text-xs">Texas Hold&rsquo;em · Sit &amp; Go</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-zinc-600 mb-0.5">Prize Pool</div>
          <div className="font-black text-amber-400 text-lg">${prizePool}</div>
        </div>
      </div>

      {/* Seats */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-zinc-600 uppercase tracking-wider">Seats</span>
          <span className="text-sm font-bold tabular-nums text-zinc-400">{players}</span>
        </div>
        <SeatDots total={players} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-5 text-center">
        {[
          ["Buy-in", "$50"],
          ["Chips", "1,000"],
          ["Levels", "2 min"],
        ].map(([statLabel, value]) => (
          <div key={statLabel} className="rounded-lg py-2"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="text-xs text-zinc-600 mb-0.5">{statLabel}</div>
            <div className="text-xs font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Where the Register button was. A badge rather than a disabled button:
          there is nothing to press, so it should not look like there is. */}
      <div
        className="text-center rounded-xl py-3 font-black text-sm uppercase tracking-wider select-none"
        style={{
          background: "#1a2d1e",
          border: "1px solid rgba(255,255,255,0.06)",
          color: "#6b7280",
          cursor: "not-allowed",
        }}
        aria-disabled="true"
      >
        Coming Soon
      </div>
    </div>
  );
}

export default function TournamentsPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: "#060d08" }}>
      <Navbar />

      <main className="pt-16">
        {/* Header */}
        <div className="py-10 px-4"
          style={{ background: "linear-gradient(to bottom, rgba(12,22,14,0.95), rgba(6,13,8,1))", borderBottom: "1px solid rgba(201,162,39,0.12)" }}>
          <div className="max-w-4xl mx-auto">
            <p className="text-amber-400 text-xs font-bold uppercase tracking-widest mb-2">Sit &amp; Go</p>
            <h1 className="text-3xl md:text-4xl font-black mb-2">Tournaments</h1>
            <p className="text-zinc-500 text-sm">Fill a table, play for the prize — starts instantly when full.</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* The notice. First thing under the header, so nobody reads the cards
              below as something they can enter. */}
          <div
            role="status"
            className="mb-6 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
            style={{
              background: "rgba(201,162,39,0.08)",
              border: "1px solid rgba(201,162,39,0.28)",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>🏆</span>
            <div className="flex-1">
              <div className="font-black text-sm mb-1" style={{ color: "#e5c76b" }}>
                Tournaments are not open yet
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Sit &amp; Go tables are being rebuilt on the game server that runs the cash
                games. Registration is closed until then — nothing below takes a buy-in.
                The tables here are a preview of what is planned.
              </p>
            </div>
            <Link
              href="/lobby"
              className="shrink-0 text-center rounded-xl px-4 py-2.5 text-xs font-black transition-colors"
              style={{ background: "#c9a227", color: "#000" }}
            >
              Play a cash table →
            </Link>
          </div>

          {/* Tournament cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {CONFIGS.map((config) => (
              <TournamentCard key={config.id} config={config} />
            ))}
          </div>

          {/* Info section */}
          <div className="mt-8 rounded-xl p-5"
            style={{ background: "rgba(10,20,12,0.7)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 className="font-bold text-white text-sm mb-4 uppercase tracking-wider">How It Will Work</h3>
            <div className="grid md:grid-cols-3 gap-5">
              {[
                { icon: "♠", title: "Register", desc: "Fill your seat. Table launches the moment all seats are taken — no waiting." },
                { icon: "⏱", title: "Blind Levels", desc: "Blinds escalate every 2 minutes: $1/$2 → $2/$4 → $4/$8 → $8/$16 → $25/$50 → $50/$100." },
                { icon: "🏆", title: "Win the Prize", desc: "Last player standing wins the full prize pool. Every player starts with 1,000 chips." },
              ].map(item => (
                <div key={item.title} className="flex gap-3">
                  <span className="text-amber-400 text-lg font-black shrink-0 mt-0.5">{item.icon}</span>
                  <div>
                    <div className="font-bold text-white text-sm mb-1">{item.title}</div>
                    <div className="text-zinc-500 text-xs leading-relaxed">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
