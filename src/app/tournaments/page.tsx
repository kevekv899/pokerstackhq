"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "../components/Navbar";
import type { PublicUser } from "@/lib/db";

const CONFIGS = [
  { id: 1, players: 4, prizePool: 200, initFilled: 2, label: "4-Player Sit & Go" },
  { id: 2, players: 6, prizePool: 300, initFilled: 3, label: "6-Player Sit & Go" },
  { id: 3, players: 9, prizePool: 450, initFilled: 5, label: "9-Player Sit & Go" },
] as const;

type Phase = "open" | "filling" | "full";

interface TState {
  filled: number;
  phase: Phase;
  countdown: number;
}

function SeatDots({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="transition-all duration-500"
          style={{
            width: 14, height: 14, borderRadius: "50%",
            border: `2px solid ${i < filled ? "#10b981" : "rgba(255,255,255,0.18)"}`,
            background: i < filled ? "#10b981" : "transparent",
            boxShadow: i < filled ? "0 0 6px rgba(16,185,129,0.55)" : undefined,
          }}
        />
      ))}
    </div>
  );
}

function TournamentCard({
  config, state, onRegister,
}: {
  config: typeof CONFIGS[number];
  state: TState;
  onRegister: () => void;
}) {
  const { id, players, prizePool, label } = config;
  const { filled, phase, countdown } = state;
  const isFull = filled >= players;
  const registered = phase !== "open";

  return (
    <div
      className="flex flex-col rounded-2xl p-5 transition-all duration-300"
      style={{
        background: "#0f1a12",
        border: `1px solid ${isFull ? "rgba(16,185,129,0.45)" : phase === "filling" ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.07)"}`,
        boxShadow: isFull ? "0 0 32px rgba(16,185,129,0.1)" : undefined,
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-black text-white text-base">{label}</span>
            {phase === "filling" && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full animate-pulse"
                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
                FILLING…
              </span>
            )}
            {isFull && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                FULL
              </span>
            )}
          </div>
          <p className="text-zinc-500 text-xs">Texas Hold'em · Sit &amp; Go</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-zinc-600 mb-0.5">Prize Pool</div>
          <div className="font-black text-amber-400 text-lg">${prizePool}</div>
        </div>
      </div>

      {/* Seat dots */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-zinc-600 uppercase tracking-wider">Seats</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: isFull ? "#10b981" : "#d1d5db" }}>
            {filled}/{players}
          </span>
        </div>
        <SeatDots filled={filled} total={players} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-5 text-center">
        {[
          ["Buy-in", "$50"],
          ["Chips", "1,000"],
          ["Levels", "2 min"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg py-2"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="text-xs text-zinc-600 mb-0.5">{label}</div>
            <div className="text-xs font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      {isFull ? (
        <div className="text-center rounded-xl py-3 font-black text-base"
          style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981" }}>
          ⏱ Starting in {countdown}s…
        </div>
      ) : (
        <button
          onClick={onRegister}
          disabled={registered}
          className="w-full font-black rounded-xl py-3 text-sm transition-all"
          style={{
            background: registered ? "#1a2d1e" : "#c9a227",
            color: registered ? "#4b5563" : "#000",
            boxShadow: registered ? undefined : "0 4px 20px rgba(201,162,39,0.35)",
            cursor: registered ? "not-allowed" : "pointer",
          }}
          onMouseEnter={e => { if (!registered) e.currentTarget.style.background = "#f59e0b"; }}
          onMouseLeave={e => { if (!registered) e.currentTarget.style.background = "#c9a227"; }}
        >
          {registered ? "Registered ✓" : "Register →"}
        </button>
      )}
    </div>
  );
}

export default function TournamentsPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [states, setStates] = useState<TState[]>(
    CONFIGS.map(c => ({ filled: c.initFilled, phase: "open" as Phase, countdown: 5 }))
  );
  const fillingRef = useRef<Set<number>>(new Set());
  const redirectedRef = useRef(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); })
      .catch(() => {});
  }, []);

  // Countdown tick for "full" tournaments
  useEffect(() => {
    const id = setInterval(() => {
      setStates(prev =>
        prev.map(s => s.phase === "full" && s.countdown > 0 ? { ...s, countdown: s.countdown - 1 } : s)
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Redirect when countdown hits 0
  useEffect(() => {
    if (redirectedRef.current) return;
    const idx = states.findIndex(s => s.phase === "full" && s.countdown <= 0);
    if (idx < 0) return;
    redirectedRef.current = true;
    router.push(`/tournament/${CONFIGS[idx].id}`);
  }, [states, router]);

  function handleRegister(tIdx: number) {
    if (!user) { setLoginPrompt(true); return; }
    if (fillingRef.current.has(tIdx)) return;
    fillingRef.current.add(tIdx);

    const config = CONFIGS[tIdx];
    setStates(prev => {
      const next = [...prev];
      const newFilled = next[tIdx].filled + 1;
      next[tIdx] = { ...next[tIdx], filled: newFilled, phase: "filling" };
      return next;
    });

    // Schedule AI fills for remaining seats
    const currentFilled = states[tIdx].filled + 1;
    const remaining = config.players - currentFilled;
    for (let i = 0; i < remaining; i++) {
      setTimeout(() => {
        setStates(prev => {
          const next = [...prev];
          if (next[tIdx].phase !== "filling") return prev;
          const newFilled = next[tIdx].filled + 1;
          const isFull = newFilled >= config.players;
          next[tIdx] = { ...next[tIdx], filled: newFilled, phase: isFull ? "full" : "filling", countdown: 5 };
          return next;
        });
      }, (i + 1) * 650);
    }
  }

  return (
    <div className="min-h-screen text-white" style={{ background: "#060d08" }}>
      <Navbar />

      {/* Login prompt modal */}
      {loginPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          onClick={() => setLoginPrompt(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700/60 rounded-2xl p-7 max-w-sm w-full text-center shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-4xl mb-3">🏆</div>
            <h2 className="text-xl font-black mb-2">Sign In to Register</h2>
            <p className="text-zinc-400 text-sm mb-6">
              Tournament registration requires an account. Create one free — it only takes a minute.
            </p>
            <div className="flex gap-3">
              <Link href="/register"
                className="flex-1 text-center py-3 rounded-xl text-sm font-black transition-colors"
                style={{ background: "#c9a227", color: "#000" }}>
                Create Account
              </Link>
              <Link href="/login"
                className="flex-1 text-center py-3 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
                Sign In
              </Link>
            </div>
            <button
              onClick={() => setLoginPrompt(false)}
              className="mt-3 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Continue as guest (no real money)
            </button>
          </div>
        </div>
      )}

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

        {/* Tournament cards */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="grid gap-4 md:grid-cols-3">
            {CONFIGS.map((config, tIdx) => (
              <TournamentCard
                key={config.id}
                config={config}
                state={states[tIdx]}
                onRegister={() => handleRegister(tIdx)}
              />
            ))}
          </div>

          {/* Info section */}
          <div className="mt-8 rounded-xl p-5"
            style={{ background: "rgba(10,20,12,0.7)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 className="font-bold text-white text-sm mb-4 uppercase tracking-wider">How It Works</h3>
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
