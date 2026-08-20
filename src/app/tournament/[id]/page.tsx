/**
 * Tournament table — closed.
 *
 * This route used to run a whole tournament in the browser: it shuffled the
 * deck, dealt every seat, drove the bots and read the hands, all in client
 * code. That meant every player's hole cards were in every player's bundle,
 * readable from the console — the table could not be trusted to be a game at
 * all. Cash tables were moved to the game server (`server/room.ts`, which
 * deals server-side and sends each player only their own cards); tournaments
 * have not been, so the route is shut instead of left playable.
 *
 * The game logic is deleted rather than disabled: a flag can be flipped, and
 * either way the deck and the deal would still ship to the browser. Nothing
 * here creates game state, and no cards exist in this file.
 *
 * A Server Component with no props on purpose — the `[id]` is not read, so
 * every tournament id lands on the same notice and none of them mean anything
 * yet. The API routes and tables it used are untouched, waiting for the
 * server-side version.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "../../components/Navbar";

export const metadata: Metadata = {
  title: "Tournaments coming soon · PokerStack",
  description: "Tournament tables are not open yet.",
};

export default function TournamentClosedPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: "#060d08" }}>
      <Navbar />

      <main className="pt-16 flex items-center justify-center px-4" style={{ minHeight: "100vh" }}>
        <div
          className="w-full max-w-md rounded-2xl px-7 py-9 text-center"
          style={{
            background: "#0f1a12",
            border: "1px solid rgba(201,162,39,0.25)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          }}
        >
          <div style={{ fontSize: 42, lineHeight: 1 }} aria-hidden>
            🏆
          </div>

          <span
            className="inline-block mt-4 text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{
              background: "rgba(201,162,39,0.12)",
              color: "#c9a227",
              border: "1px solid rgba(201,162,39,0.3)",
            }}
          >
            Coming soon
          </span>

          <h1 className="text-2xl font-black mt-4 mb-3">Tournaments are not open yet</h1>

          <p className="text-zinc-400 text-sm leading-relaxed mb-2">
            Sit &amp; Go tables are being rebuilt on the game server, the same one the
            cash tables run on. Until that is finished there is no tournament to join
            at this address.
          </p>
          <p className="text-zinc-500 text-xs leading-relaxed mb-7">
            Cash tables are open and unaffected.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/lobby"
              className="flex-1 text-center py-3 rounded-xl text-sm font-black transition-colors"
              style={{ background: "#c9a227", color: "#000" }}
            >
              ← Back to the lobby
            </Link>
            <Link
              href="/tournaments"
              className="flex-1 text-center py-3 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              See what&rsquo;s planned
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
