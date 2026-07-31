"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "../components/Navbar";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const username = (fd.get("username") as string).trim();
    const email    = (fd.get("email") as string).trim();
    const password = fd.get("password") as string;
    const confirm  = fd.get("confirmPassword") as string;
    const ageOk    = fd.get("age") === "on";

    if (!ageOk)           { setError("You must confirm you are 18+."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error ?? "Registration failed."); return; }
    router.replace("/lobby");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <main className="flex items-center justify-center min-h-screen px-4 pt-16 py-12">
        <div className="w-full max-w-md">
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-2xl">

            {/* Header */}
            <div className="text-center mb-8">
              <Link href="/" className="inline-flex items-center gap-2 mb-6">
                <span className="text-3xl">🃏</span>
                <span className="text-2xl font-black tracking-tight">
                  Poker<span className="text-amber-400">Stack</span>
                </span>
              </Link>
              <h1 className="text-2xl font-black mb-1">Create your account</h1>
              <p className="text-zinc-500 text-sm">Start with $1,000 in play money — free</p>

              <div className="mt-4 inline-flex items-center gap-2 bg-emerald-950 border border-emerald-800/60 text-emerald-400 text-xs font-semibold px-4 py-2 rounded-full">
                🎁 $1,000 play money on signup
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 px-4 py-3 rounded-xl bg-red-950/60 border border-red-800/60 text-red-400 text-sm font-medium">
                {error}
              </div>
            )}

            {/* Form */}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="username" className="block text-sm font-semibold text-zinc-300 mb-2">
                  Username
                </label>
                <input
                  id="username" name="username" type="text"
                  autoComplete="username" placeholder="PokerPro99"
                  required minLength={3} maxLength={20}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-zinc-300 mb-2">
                  Email address
                </label>
                <input
                  id="email" name="email" type="email"
                  autoComplete="email" placeholder="you@example.com"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-zinc-300 mb-2">
                  Password
                </label>
                <input
                  id="password" name="password" type="password"
                  autoComplete="new-password" placeholder="Min. 8 characters"
                  required minLength={8}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-zinc-300 mb-2">
                  Confirm password
                </label>
                <input
                  id="confirmPassword" name="confirmPassword" type="password"
                  autoComplete="new-password" placeholder="Repeat your password"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>

              <div className="space-y-3 pt-1">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox" name="age"
                    className="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-zinc-800 accent-emerald-500 shrink-0"
                  />
                  <span className="text-xs text-zinc-400 leading-relaxed">
                    I confirm I am at least <span className="text-white font-semibold">18 years old</span> and agree to the{" "}
                    <a href="#" className="text-emerald-400 hover:underline">Terms of Service</a> and{" "}
                    <a href="#" className="text-emerald-400 hover:underline">Privacy Policy</a>
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox" name="promo"
                    className="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-zinc-800 accent-emerald-500 shrink-0"
                  />
                  <span className="text-xs text-zinc-400">
                    Send me promotions, bonuses, and news by email (optional)
                  </span>
                </label>
              </div>

              <button
                type="submit" disabled={loading}
                className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-950 font-black py-3.5 rounded-xl transition-colors duration-150 shadow-lg shadow-amber-500/20 text-sm mt-2"
              >
                {loading ? "Creating account…" : "Create Account — It's Free"}
              </button>
            </form>

            <p className="text-center text-sm text-zinc-500 mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">
                Sign in
              </Link>
            </p>
          </div>

          <p className="text-center text-xs text-zinc-700 mt-6">
            18+ only · Play responsibly · GamCare · BeGambleAware
          </p>
        </div>
      </main>
    </div>
  );
}
