"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Navbar from "../components/Navbar";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeaderboardEntry {
  id: number;
  username: string;
  avatar: string;
  balance: number;      // cents
  hands_played: number;
  biggest_win: number;  // cents
}

interface PlatformStats {
  totalPlayers: number;
  totalTransactions: number;
  totalHandsPlayed: number;
  totalChipsInPlay: number;
}

// How often to re-pull live data from the database.
const REFRESH_MS = 5000;

// ─── Formatters ─────────────────────────────────────────────────────────────
// Money values are stored in cents; display as whole-dollar USD.
const fmtUsd = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const fmtNum = (n: number) => n.toLocaleString("en-US");

// ─── Medal / rank badge ─────────────────────────────────────────────────────
const MEDALS: Record<number, { emoji: string; ring: string; text: string }> = {
  1: { emoji: "🥇", ring: "#f5c542", text: "#f5c542" },
  2: { emoji: "🥈", ring: "#c7cdd6", text: "#c7cdd6" },
  3: { emoji: "🥉", ring: "#d08a4e", text: "#d08a4e" },
};

// ─── Podium ─────────────────────────────────────────────────────────────────
function PodiumSpot({
  player,
  rank,
  isUser,
}: {
  player: LeaderboardEntry;
  rank: 1 | 2 | 3;
  isUser: boolean;
}) {
  const medal = MEDALS[rank];
  const height = rank === 1 ? 168 : rank === 2 ? 132 : 110;
  const order = rank === 1 ? 2 : rank === 2 ? 1 : 3;

  return (
    <div className="flex flex-col items-center" style={{ order }}>
      <div className="flex flex-col items-center mb-2">
        <div
          className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-3xl sm:text-4xl mb-2"
          style={{
            background: "radial-gradient(circle at 35% 30%, #1c2b20, #0a1410)",
            border: `2px solid ${medal.ring}`,
            boxShadow: `0 0 24px ${medal.ring}55`,
          }}
        >
          {player.avatar}
          <span className="absolute -top-2 -right-1 text-lg drop-shadow">{medal.emoji}</span>
        </div>
        <p className={`font-black text-sm sm:text-base truncate max-w-[110px] sm:max-w-[140px] text-center ${isUser ? "text-amber-300" : "text-white"}`}>
          {player.username}
        </p>
        <p className="font-black text-base sm:text-lg" style={{ color: medal.text }}>
          {fmtUsd(player.balance)}
        </p>
      </div>
      <div
        className="w-24 sm:w-28 rounded-t-xl flex items-start justify-center pt-2"
        style={{
          height,
          background: `linear-gradient(180deg, ${medal.ring}26 0%, ${medal.ring}0d 100%)`,
          border: `1px solid ${medal.ring}55`,
          borderBottom: "none",
        }}
      >
        <span className="text-2xl font-black" style={{ color: medal.text }}>#{rank}</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [live, setLive] = useState(false);

  // Track the latest fetch so a slow response can't overwrite a newer one.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      if (seq !== reqSeq.current) return; // a newer request already resolved
      setRows(data.leaderboard ?? []);
      setStats(data.stats ?? null);
      setError(false);
      setLive(true);
    } catch {
      if (seq !== reqSeq.current) return;
      setError(true);
      setLive(false);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  // Identify the signed-in user so we can highlight their row.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUserId(d.user?.id ?? null))
      .catch(() => setUserId(null));
  }, []);

  // Initial load + live polling. Also refreshes when the tab regains focus.
  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const podium = rows.slice(0, 3);

  const STAT_CARDS = [
    { label: "Registered Players", value: stats ? fmtNum(stats.totalPlayers) : "—", cls: "text-emerald-400" },
    { label: "Total Transactions", value: stats ? fmtNum(stats.totalTransactions) : "—", cls: "text-blue-400" },
    { label: "Hands Played", value: stats ? fmtNum(stats.totalHandsPlayed) : "—", cls: "text-amber-400" },
    { label: "Chips in Play", value: stats ? fmtUsd(stats.totalChipsInPlay) : "—", cls: "text-fuchsia-400" },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 pt-24 pb-16 page-enter">

        {/* ── Title ── */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-4xl">🏆</span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-white">Leaderboard</h1>
              {live && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                  Live
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-zinc-500">Top performers across PokerStack HQ</p>
          </div>
        </div>

        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {STAT_CARDS.map((s) => (
            <div key={s.label} className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-4 text-center">
              <p className={`text-lg font-black ${s.cls}`}>{s.value}</p>
              <p className="text-xs text-zinc-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="spinner" />
          </div>
        ) : error && rows.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-12 text-center">
            <p className="text-zinc-400 font-semibold">Couldn&apos;t load the leaderboard.</p>
            <button
              onClick={load}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-12 text-center">
            <p className="text-zinc-400 font-semibold">No players yet.</p>
            <p className="text-xs text-zinc-600 mt-1">Be the first to climb the board.</p>
          </div>
        ) : (
          <>
            {/* ── Podium ── */}
            {podium.length > 0 && (
              <div
                className="rounded-2xl p-6 mb-6 shadow-2xl relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #0f1a12 0%, #0a1410 50%, #0f1a12 100%)",
                  border: "1px solid rgba(16,185,129,0.2)",
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(245,197,66,0.08) 0%, transparent 70%)" }}
                />
                <div className="flex items-end justify-center gap-3 sm:gap-6 relative">
                  {podium.map((p, i) => (
                    <PodiumSpot key={p.id} player={p} rank={(i + 1) as 1 | 2 | 3} isUser={p.id === userId} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Table ── */}
            <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/60">
                      <th className="text-left text-xs text-zinc-500 font-semibold px-4 py-3 uppercase tracking-wider">Rank</th>
                      <th className="text-left text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider">Player</th>
                      <th className="text-right text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider">Total Winnings</th>
                      <th className="text-right text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider hidden sm:table-cell">Hands</th>
                      <th className="text-right text-xs text-zinc-500 font-semibold px-4 py-3 uppercase tracking-wider hidden md:table-cell">Biggest Win</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p, i) => {
                      const rank = i + 1;
                      const medal = MEDALS[rank];
                      const isUser = p.id === userId;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-zinc-800/30 transition-colors hover:bg-zinc-800/20"
                          style={isUser
                            ? { background: "rgba(245,158,11,0.1)", boxShadow: "inset 3px 0 0 #f59e0b" }
                            : undefined}
                        >
                          <td className="px-4 py-3.5">
                            {medal ? (
                              <span className="text-lg" title={`#${rank}`}>{medal.emoji}</span>
                            ) : (
                              <span className="text-sm font-bold text-zinc-500">#{rank}</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <span className="text-xl leading-none">{p.avatar}</span>
                              <span className={`text-sm font-bold truncate max-w-[140px] sm:max-w-none ${isUser ? "text-amber-300" : "text-white"}`}>
                                {p.username}
                              </span>
                              {isUser && (
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 border border-amber-400/30 shrink-0">
                                  YOU
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-right font-bold text-emerald-400 whitespace-nowrap">
                            {fmtUsd(p.balance)}
                          </td>
                          <td className="px-3 py-3.5 text-right text-zinc-400 hidden sm:table-cell whitespace-nowrap">
                            {fmtNum(p.hands_played)}
                          </td>
                          <td className="px-4 py-3.5 text-right text-amber-400 font-semibold hidden md:table-cell whitespace-nowrap">
                            {fmtUsd(p.biggest_win)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {!userId && (
              <p className="text-center text-xs text-zinc-600 mt-5">
                Sign in to see your rank on the board.
              </p>
            )}
          </>
        )}

        <p className="text-center text-xs text-zinc-700 mt-8">
          PokerStack HQ · Live standings from the PokerStack HQ database
        </p>
      </main>
    </div>
  );
}
