"use client";

import { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import type { PublicUser } from "@/lib/db";

const AVATARS = ["😎","🤠","👑","🎩","🦈","🐯","🦁","🐺","🦊","🐻","🐼","🐸","🦅","🃏","💀","🤑"];

export default function ProfilePage() {
  const [user, setUser]           = useState<PublicUser | null>(null);
  const [loading, setLoading]     = useState(true);

  const [pwOld, setPwOld]         = useState("");
  const [pwNew, setPwNew]         = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMsg, setPwMsg]         = useState<{ok:boolean;text:string}|null>(null);
  const [pwBusy, setPwBusy]       = useState(false);

  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => {
        setUser(d.user ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function changeAvatar(avatar: string) {
    if (!user || avatarBusy) return;
    setAvatarBusy(true);
    const res = await fetch("/api/profile/avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar }),
    });
    if (res.ok) setUser(u => u ? { ...u, avatar } : u);
    setAvatarBusy(false);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pwNew !== pwConfirm) { setPwMsg({ ok:false, text:"New passwords do not match." }); return; }
    if (pwNew.length < 8)    { setPwMsg({ ok:false, text:"Password must be at least 8 characters." }); return; }
    setPwBusy(true);
    const res = await fetch("/api/profile/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwOld, newPassword: pwNew }),
    });
    const data = await res.json();
    setPwBusy(false);
    setPwMsg({ ok: res.ok, text: data.message ?? data.error ?? "Unknown error." });
    if (res.ok) { setPwOld(""); setPwNew(""); setPwConfirm(""); }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return null;

  const joined = new Date(user.created_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 pt-24 pb-12">

        {/* ── Profile header ── */}
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 mb-6 shadow-xl">
          <div className="flex items-center gap-5">
            <div className="text-5xl leading-none">{user.avatar}</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-black truncate">{user.username}</h1>
              <p className="text-zinc-400 text-sm truncate">{user.email}</p>
              <p className="text-zinc-600 text-xs mt-1">Member since {joined}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500 mb-0.5">Balance</p>
              <p className="text-2xl font-black text-amber-400">
                ${(user.balance / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-5 text-center">
            <p className="text-3xl font-black text-emerald-400">{user.hands_played.toLocaleString()}</p>
            <p className="text-zinc-400 text-sm mt-1">Hands Played</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-5 text-center">
            <p className="text-3xl font-black text-amber-400">
              ${(user.biggest_win / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </p>
            <p className="text-zinc-400 text-sm mt-1">Biggest Win</p>
          </div>
        </div>

        {/* ── Avatar selector ── */}
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 mb-6">
          <h2 className="font-black text-base mb-4">Choose Avatar</h2>
          <div className="grid grid-cols-8 gap-2">
            {AVATARS.map(av => (
              <button
                key={av}
                onClick={() => changeAvatar(av)}
                disabled={avatarBusy}
                className="text-2xl h-11 w-full rounded-xl transition-all flex items-center justify-center"
                style={{
                  background: user.avatar === av ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                  border: user.avatar === av ? "2px solid #10b981" : "2px solid transparent",
                  transform: user.avatar === av ? "scale(1.12)" : "scale(1)",
                }}
              >
                {av}
              </button>
            ))}
          </div>
        </div>

        {/* ── Change password ── */}
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6 mb-6">
          <h2 className="font-black text-base mb-4">Change Password</h2>
          <form className="space-y-4" onSubmit={changePassword}>
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-2">Current password</label>
              <input
                type="password" value={pwOld} onChange={e=>setPwOld(e.target.value)}
                required placeholder="••••••••"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-2">New password</label>
              <input
                type="password" value={pwNew} onChange={e=>setPwNew(e.target.value)}
                required minLength={8} placeholder="Min. 8 characters"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-2">Confirm new password</label>
              <input
                type="password" value={pwConfirm} onChange={e=>setPwConfirm(e.target.value)}
                required placeholder="Repeat new password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>

            {pwMsg && (
              <div className={`px-4 py-3 rounded-xl text-sm font-medium ${pwMsg.ok ? "bg-emerald-950/60 border border-emerald-800/60 text-emerald-400" : "bg-red-950/60 border border-red-800/60 text-red-400"}`}>
                {pwMsg.text}
              </div>
            )}

            <button
              type="submit" disabled={pwBusy}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 rounded-xl transition-colors text-sm"
            >
              {pwBusy ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>

        {/* ── Quick actions ── */}
        <div className="flex gap-3">
          <Link href="/lobby"
            className="flex-1 text-center bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black py-3 rounded-xl transition-colors text-sm">
            Play Now →
          </Link>
          <Link href="/tournaments"
            className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold py-3 rounded-xl transition-colors text-sm">
            Tournaments
          </Link>
        </div>
      </main>
    </div>
  );
}
