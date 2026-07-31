"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import NotificationBell from "./NotificationBell";

import type { PublicUser } from "@/lib/db";

const navLinks = [
  { label: "Games",       href: "/lobby",        authOnly: false },
  { label: "Tournaments", href: "/tournaments",  authOnly: false },
  { label: "Wallet",      href: "/wallet",       authOnly: true  },
  { label: "Promotions",  href: "/register",     authOnly: false },
  { label: "Leaderboard", href: "/leaderboard",   authOnly: false },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser]         = useState<PublicUser | null>(null);
  const pathname = usePathname();
  const router   = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => setUser(d.user ?? null))
      .catch(() => {});
  }, [pathname]); // re-check on every navigation

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.replace("/");
  }

  const balanceDisplay = user
    ? `$${(user.balance / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
    : null;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-zinc-950/95 backdrop-blur-sm border-b border-emerald-900/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 select-none shrink-0">
            <span className="text-2xl">🃏</span>
            <span className="text-xl font-black tracking-tight text-white">
              Poker<span className="text-amber-400">Stack</span>
            </span>
          </Link>

          {/* Nav links (desktop) */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.filter(l => !l.authOnly || user).map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                className="text-sm transition-colors duration-150"
                style={{
                  color: pathname === href ? "#f4f4f5" : "#a1a1aa",
                  fontWeight: pathname === href ? 700 : 400,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#f4f4f5")}
                onMouseLeave={e => (e.currentTarget.style.color = pathname === href ? "#f4f4f5" : "#a1a1aa")}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <>
                {/* Notifications — polls every 30s while mounted */}
                <NotificationBell />

                {/* Balance chip → links to wallet */}
                <Link
                  href="/wallet"
                  className="hidden sm:block text-xs font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-3 py-1.5 rounded-full hover:bg-amber-400/20 transition-colors"
                >
                  {balanceDisplay}
                </Link>

                {/* Avatar + username → profile */}
                <Link
                  href="/profile"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors"
                >
                  <span className="text-lg leading-none">{user.avatar}</span>
                  <span className="hidden sm:block text-sm font-semibold text-zinc-200">{user.username}</span>
                </Link>

                {/* Logout */}
                <button
                  onClick={handleLogout}
                  className="hidden sm:block text-sm text-zinc-400 hover:text-white transition-colors px-3 py-1.5 rounded-full hover:bg-white/5"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden sm:block text-sm text-zinc-300 hover:text-white transition-colors px-4 py-2 rounded-full hover:bg-white/5 active:bg-white/10"
                >
                  Log In
                </Link>
                <Link
                  href="/register"
                  className="text-sm font-bold bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 px-4 sm:px-5 py-2 rounded-full transition-colors duration-150 shadow-lg shadow-amber-500/20"
                >
                  Sign Up
                </Link>
              </>
            )}

            {/* Mobile hamburger */}
            <button
              className="md:hidden flex flex-col gap-1 p-2 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Toggle menu"
            >
              <span className="block w-5 h-0.5 bg-zinc-400 transition-all" style={menuOpen ? { transform: "rotate(45deg) translateY(6px)" } : {}} />
              <span className="block w-5 h-0.5 bg-zinc-400 transition-all" style={menuOpen ? { opacity: 0 } : {}} />
              <span className="block w-5 h-0.5 bg-zinc-400 transition-all" style={menuOpen ? { transform: "rotate(-45deg) translateY(-6px)" } : {}} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className="md:hidden overflow-hidden transition-all duration-200"
        style={{ maxHeight: menuOpen ? "400px" : "0" }}
      >
        <div className="bg-zinc-900/98 border-t border-zinc-800 px-4 py-3 flex flex-col gap-1">
          {navLinks.filter(l => !l.authOnly || user).map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setMenuOpen(false)}
              className="text-sm py-3 px-3 rounded-xl transition-colors"
              style={{
                color: pathname === href ? "#f59e0b" : "#a1a1aa",
                background: pathname === href ? "rgba(245,158,11,0.08)" : "transparent",
                fontWeight: pathname === href ? 700 : 400,
              }}
            >
              {label}
            </Link>
          ))}

          <div className="border-t border-zinc-800 pt-3 mt-1">
            {user ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="text-2xl">{user.avatar}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{user.username}</p>
                    <p className="text-xs text-amber-400 font-semibold">{balanceDisplay}</p>
                  </div>
                </div>
                <Link href="/wallet" onClick={() => setMenuOpen(false)}
                  className="text-center text-sm py-2.5 rounded-xl font-bold transition-colors"
                  style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                  💰 Wallet · {balanceDisplay}
                </Link>
                <Link href="/profile" onClick={() => setMenuOpen(false)}
                  className="text-center text-sm py-2.5 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors font-semibold">
                  My Profile
                </Link>
                <button onClick={() => { setMenuOpen(false); handleLogout(); }}
                  className="text-center text-sm py-2.5 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors font-semibold">
                  Log Out
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Link href="/login" onClick={() => setMenuOpen(false)}
                  className="flex-1 text-center text-sm py-2.5 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors font-semibold">
                  Log In
                </Link>
                <Link href="/register" onClick={() => setMenuOpen(false)}
                  className="flex-1 text-center text-sm py-2.5 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors font-bold">
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
