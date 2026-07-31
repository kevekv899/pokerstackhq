"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "../components/Navbar";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from   = params.get("from") ?? "/lobby";

  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const email    = (fd.get("email") as string).trim();
    const password = fd.get("password") as string;

    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error ?? "Login failed."); return; }
    router.replace(from);
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 shadow-2xl">
      {/* Header */}
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-2 mb-6">
          <span className="text-3xl">🃏</span>
          <span className="text-2xl font-black tracking-tight">
            Poker<span className="text-amber-400">Stack</span>
          </span>
        </Link>
        <h1 className="text-2xl font-black mb-1">Welcome back</h1>
        <p className="text-zinc-500 text-sm">Sign in to your account to continue playing</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-950/60 border border-red-800/60 text-red-400 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Form */}
      <form className="space-y-5" onSubmit={handleSubmit}>
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
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="password" className="block text-sm font-semibold text-zinc-300">
              Password
            </label>
            <a href="#" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
              Forgot password?
            </a>
          </div>
          <input
            id="password" name="password" type="password"
            autoComplete="current-password" placeholder="••••••••"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
          />
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-950 font-black py-3.5 rounded-xl transition-colors duration-150 shadow-lg shadow-amber-500/20 text-sm"
        >
          {loading ? "Signing in…" : "Sign In to PokerStack"}
        </button>
      </form>

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-zinc-800" />
        <span className="text-xs text-zinc-600 uppercase tracking-wider">or</span>
        <div className="flex-1 h-px bg-zinc-800" />
      </div>

      <p className="text-center text-sm text-zinc-500">
        Don&#39;t have an account?{" "}
        <Link href="/register" className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">
          Create one free
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="flex items-center justify-center min-h-screen px-4 pt-16">
        <div className="w-full max-w-md">
          <Suspense fallback={<div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 animate-pulse" style={{height:400}}/>}>
            <LoginForm />
          </Suspense>
          <p className="text-center text-xs text-zinc-700 mt-6">
            18+ only · Play responsibly · GamCare
          </p>
        </div>
      </main>
    </div>
  );
}
