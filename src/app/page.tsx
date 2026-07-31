import Link from "next/link";
import Navbar from "./components/Navbar";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      {/* ── Hero Section ── */}
      <section className="relative pt-36 pb-28 px-4 overflow-hidden felt-bg">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/80 via-zinc-950 to-zinc-950" />

        <div className="absolute top-20 left-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-1/4 w-80 h-80 bg-amber-500/8 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-5xl mx-auto text-center">
          <div className="mb-8 flex justify-center items-center gap-3 text-4xl md:text-5xl">
            <span role="img" aria-label="casino">🎰</span>
            <span role="img" aria-label="spades">♠️</span>
            <span role="img" aria-label="poker chip" className="text-5xl md:text-6xl">🪙</span>
            <span role="img" aria-label="diamonds">♦️</span>
            <span role="img" aria-label="casino">🎰</span>
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black leading-none tracking-tight mb-6">
            Play Real Poker.
            <br />
            <span className="text-amber-400">Win Real Money.</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Join over{" "}
            <span className="text-white font-semibold">2 million players</span>{" "}
            at the world&#39;s most trusted online poker room. Real stakes, real
            action, real wins — every deal.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-black text-lg px-12 py-4 rounded-full transition-all duration-150 hover:scale-105 shadow-xl shadow-amber-500/30 text-center"
            >
              Start Playing Now
            </Link>
            <Link
              href="/lobby"
              className="border border-emerald-700 text-emerald-400 hover:bg-emerald-900/40 hover:border-emerald-500 font-semibold text-lg px-10 py-4 rounded-full transition-all duration-150 text-center"
            >
              Watch Live Tables
            </Link>
          </div>

          <p className="mt-6 text-xs text-zinc-600 tracking-wide uppercase">
            No download required &nbsp;·&nbsp; Instant play &nbsp;·&nbsp; 18+ only &nbsp;·&nbsp; Play responsibly
          </p>
        </div>
      </section>

      {/* ── Live Stats Bar ── */}
      <div className="bg-emerald-950/70 border-y border-emerald-900/50 py-5">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            <div className="text-center">
              <div className="flex items-center gap-2 justify-center">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-2xl font-black text-white tabular-nums">24,891</span>
              </div>
              <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Players Online</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-amber-400 tabular-nums">$4,231,560</div>
              <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Won Today</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-white tabular-nums">1,247</div>
              <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Active Tables</p>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-white">$500K</div>
              <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">Daily Prize Pool</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Games Section ── */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-emerald-400 text-sm font-semibold uppercase tracking-widest mb-3">
              Choose Your Game
            </p>
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Every Format. Every Stake.
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              From micro-stakes beginners to high-roller veterans — find your
              perfect table in seconds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Texas Hold'em → /lobby */}
            <Link
              href="/lobby"
              className="group relative bg-gradient-to-b from-emerald-900/50 to-zinc-900/60 border border-emerald-800/40 rounded-2xl p-8 hover:border-emerald-600/70 transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-900/40 block"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              <div className="text-5xl mb-5">♠️</div>
              <h3 className="text-2xl font-black mb-2">Texas Hold&#39;em</h3>
              <p className="text-zinc-400 text-sm leading-relaxed mb-7">
                The world&#39;s most popular poker game. Two hole cards, five
                community cards — where pure skill meets cold strategy.
              </p>
              <div className="flex justify-between text-sm mb-7">
                <div>
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">Stakes</div>
                  <div className="text-emerald-400 font-bold">$0.01/$0.02 – $50/$100</div>
                </div>
                <div className="text-right">
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">Tables</div>
                  <div className="text-white font-bold">847 Active</div>
                </div>
              </div>
              <div className="w-full bg-emerald-700 group-hover:bg-emerald-600 text-white text-sm font-bold py-3 rounded-xl transition-colors duration-150 text-center">
                Play Now →
              </div>
            </Link>

            {/* Omaha → /lobby?filter=omaha */}
            <Link
              href="/lobby?filter=omaha"
              className="group relative bg-gradient-to-b from-emerald-900/50 to-zinc-900/60 border border-emerald-800/40 rounded-2xl p-8 hover:border-emerald-600/70 transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-900/40 block"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              <div className="text-5xl mb-5">♦️</div>
              <h3 className="text-2xl font-black mb-2">Omaha</h3>
              <p className="text-zinc-400 text-sm leading-relaxed mb-7">
                Four hole cards, bigger pots, maximum action. The game for
                players who want non-stop excitement and huge swings.
              </p>
              <div className="flex justify-between text-sm mb-7">
                <div>
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">Stakes</div>
                  <div className="text-emerald-400 font-bold">$0.05/$0.10 – $25/$50</div>
                </div>
                <div className="text-right">
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">Tables</div>
                  <div className="text-white font-bold">312 Active</div>
                </div>
              </div>
              <div className="w-full bg-emerald-700 group-hover:bg-emerald-600 text-white text-sm font-bold py-3 rounded-xl transition-colors duration-150 text-center">
                Play Now →
              </div>
            </Link>

            {/* Tournaments → /tournaments */}
            <Link
              href="/tournaments"
              className="group relative bg-gradient-to-b from-amber-900/30 to-zinc-900/60 border border-amber-800/50 rounded-2xl p-8 hover:border-amber-500/70 transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-amber-900/30 block"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-600/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              <div className="absolute top-4 right-4 bg-amber-500 text-zinc-950 text-xs font-black px-3 py-1 rounded-full">
                🔥 HOT
              </div>
              <div className="text-5xl mb-5">🏆</div>
              <h3 className="text-2xl font-black mb-2">Tournaments</h3>
              <p className="text-zinc-400 text-sm leading-relaxed mb-7">
                Daily MTTs, Sit &amp; Go&#39;s, and special events with massive
                prize pools. One buy-in can change your life forever.
              </p>
              <div className="flex justify-between text-sm mb-7">
                <div>
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">Buy-ins</div>
                  <div className="text-amber-400 font-bold">$1 – $1,000</div>
                </div>
                <div className="text-right">
                  <div className="text-zinc-600 text-xs uppercase tracking-wider mb-1">Next Start</div>
                  <div className="text-white font-bold">In 12 min</div>
                </div>
              </div>
              <div className="w-full bg-amber-500 group-hover:bg-amber-400 text-zinc-950 text-sm font-black py-3 rounded-xl transition-colors duration-150 text-center">
                Register Now →
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Trust / Features Bar ── */}
      <section className="py-16 px-4 bg-zinc-900/30 border-y border-zinc-800/40">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 text-center">
            {[
              { icon: "🔒", title: "Bank-Grade Security", sub: "256-bit SSL encryption" },
              { icon: "⚡", title: "Instant Withdrawals", sub: "Your money, your way" },
              { icon: "🎯", title: "Fair Play Certified", sub: "RNG audited & verified" },
              { icon: "💬", title: "24/7 Support", sub: "Always here to help" },
            ].map(({ icon, title, sub }) => (
              <div key={title}>
                <div className="text-4xl mb-3">{icon}</div>
                <div className="font-bold text-white mb-1 text-sm md:text-base">{title}</div>
                <div className="text-xs text-zinc-500">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Promotional Banner ── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center bg-gradient-to-r from-emerald-950 via-emerald-900/60 to-emerald-950 border border-emerald-800/50 rounded-3xl p-12">
          <p className="text-emerald-400 text-sm font-semibold uppercase tracking-widest mb-3">
            New Player Bonus
          </p>
          <h2 className="text-4xl md:text-5xl font-black mb-4">
            100% up to <span className="text-amber-400">$600</span>
          </h2>
          <p className="text-zinc-400 mb-8 max-w-lg mx-auto">
            Deposit today and we&#39;ll match your first deposit dollar for
            dollar. Use it on any cash game or tournament.
          </p>
          <Link
            href="/register"
            className="inline-block bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-lg px-12 py-4 rounded-full transition-all duration-150 hover:scale-105 shadow-xl shadow-amber-500/25"
          >
            Claim Your Bonus
          </Link>
          <p className="mt-4 text-xs text-zinc-600">T&amp;Cs apply. 18+. Please gamble responsibly.</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-zinc-950 border-t border-zinc-800/40 pt-12 pb-8 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <Link href="/" className="inline-flex items-center gap-2 mb-4">
                <span className="text-xl">🃏</span>
                <span className="text-lg font-black">
                  Poker<span className="text-amber-400">Stack</span>
                </span>
              </Link>
              <p className="text-zinc-500 text-sm leading-relaxed mb-4">
                The premier destination for real-money online poker. Trusted by
                millions worldwide since 2018.
              </p>
              <div className="flex gap-3">
                {["♠", "♥", "♦", "♣"].map((suit) => (
                  <span key={suit} className="text-zinc-600 text-lg">{suit}</span>
                ))}
              </div>
            </div>

            {/* Games */}
            <div>
              <h4 className="text-xs font-bold text-zinc-400 mb-4 uppercase tracking-widest">Games</h4>
              <ul className="space-y-2.5 text-sm text-zinc-500">
                <li><Link href="/lobby" className="hover:text-zinc-200 transition-colors duration-150">Texas Hold&#39;em</Link></li>
                <li><Link href="/lobby" className="hover:text-zinc-200 transition-colors duration-150">Omaha</Link></li>
                <li><Link href="/lobby" className="hover:text-zinc-200 transition-colors duration-150">Sit &amp; Go</Link></li>
                <li><Link href="/tournaments" className="hover:text-zinc-200 transition-colors duration-150">Tournaments</Link></li>
                <li><Link href="/tournaments" className="hover:text-zinc-200 transition-colors duration-150">Freerolls</Link></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs font-bold text-zinc-400 mb-4 uppercase tracking-widest">Company</h4>
              <ul className="space-y-2.5 text-sm text-zinc-500">
                {["About Us", "Affiliates", "Blog", "Careers", "Press"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-zinc-200 transition-colors duration-150">{item}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="text-xs font-bold text-zinc-400 mb-4 uppercase tracking-widest">Support</h4>
              <ul className="space-y-2.5 text-sm text-zinc-500">
                {["Help Center", "Responsible Gaming", "Terms of Service", "Privacy Policy", "Contact Us"].map((item) => (
                  <li key={item}>
                    <a href="#" className="hover:text-zinc-200 transition-colors duration-150">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-zinc-800/40 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-zinc-600">
            <p>© 2026 PokerStack Ltd. All rights reserved. 18+ only.</p>
            <p>🔞 Gambling can be addictive. Please play responsibly. GamCare · BeGambleAware</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
