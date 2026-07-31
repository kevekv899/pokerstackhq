"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import type { PublicUser, Transaction, TransactionSummary } from "@/lib/db";

// ─── Coin config ─────────────────────────────────────────────────────────────
const COINS = [
  { id: "BTC",  name: "Bitcoin",   emoji: "₿", color: "#F7931A", rate: 65000, minDeposit: 0.0001, confirmTime: "10–60 min", networkFee: 325,  networkFeeSymbol: "0.00005 BTC" },
  { id: "ETH",  name: "Ethereum",  emoji: "Ξ", color: "#627EEA", rate: 3200,  minDeposit: 0.001,  confirmTime: "2–5 min",   networkFee: 320,  networkFeeSymbol: "0.001 ETH"   },
  { id: "USDT", name: "Tether",    emoji: "₮", color: "#26A17B", rate: 1,     minDeposit: 10,     confirmTime: "2–5 min",   networkFee: 150,  networkFeeSymbol: "1.50 USDT"   },
  { id: "USDC", name: "USD Coin",  emoji: "$", color: "#2775CA", rate: 1,     minDeposit: 10,     confirmTime: "2–5 min",   networkFee: 100,  networkFeeSymbol: "1.00 USDC"   },
  { id: "LTC",  name: "Litecoin",  emoji: "Ł", color: "#A6A9AA", rate: 85,    minDeposit: 0.01,   confirmTime: "5–15 min",  networkFee: 9,    networkFeeSymbol: "0.001 LTC"   },
  { id: "SOL",  name: "Solana",    emoji: "◎", color: "#9945FF", rate: 145,   minDeposit: 0.1,    confirmTime: "< 1 min",   networkFee: 4,    networkFeeSymbol: "0.00025 SOL" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function depositAddress(coin: string, userId: number): string {
  const a = (userId * 0x6b43).toString(16).padStart(8, "0");
  const b = (userId * 0x3f1a).toString(16).padStart(8, "0");
  const c = (userId * 0x1d2b).toString(16).padStart(8, "0");
  switch (coin) {
    case "BTC":  return `bc1q${a}x8r2j${b}m3n7p4${c.slice(0, 4)}`;
    case "ETH":  return `0x${a}A3B2${b}E5F6${c}A7B8`;
    case "USDT": return `0x${b}F9E8${a}B5A4${c}9382`;
    case "USDC": return `0x${c}1A2B${b}5E6F${a}7081`;
    case "LTC":  return `ltc1q${b}j8k3${a}n7p2${c.slice(0, 6)}`;
    case "SOL":  return `${a.toUpperCase()}Pp9K${c.toUpperCase()}x8R${b.toUpperCase()}J5M3`;
    default:     return `${a}${b}${c}`;
  }
}

function shortHash(hash: string): string {
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── QR Code placeholder ─────────────────────────────────────────────────────
function FakeQR({ data }: { data: string }) {
  const N = 21;

  function isFinderDark(r: number, c: number): boolean | null {
    const check = (rr: number, cc: number) => {
      if (rr === 0 || rr === 6 || cc === 0 || cc === 6) return true;
      if (rr === 1 || rr === 5 || cc === 1 || cc === 5) return false;
      return true;
    };
    if (r < 7 && c < 7) return check(r, c);
    if (r < 7 && c >= N - 7) return check(r, c - (N - 7));
    if (r >= N - 7 && c < 7) return check(r - (N - 7), c);
    return null;
  }

  const cells = Array.from({ length: N * N }, (_, i) => {
    const r = Math.floor(i / N);
    const c = i % N;
    const fp = isFinderDark(r, c);
    if (fp !== null) return fp;
    const code = data.charCodeAt(i % data.length) || 0;
    return (code * 7 + i * 13 + r * 3) % 4 < 1;
  });

  return (
    <div className="mx-auto rounded-xl overflow-hidden p-3 bg-white" style={{ width: 168, height: 168 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${N}, 1fr)`, width: "100%", height: "100%" }}>
        {cells.map((filled, i) => (
          <div key={i} style={{ backgroundColor: filled ? "#111827" : "transparent" }} />
        ))}
      </div>
    </div>
  );
}

// ─── Coin selector ────────────────────────────────────────────────────────────
function CoinSelector({ selected, onChange }: { selected: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {COINS.map(coin => (
        <button
          key={coin.id}
          onClick={() => onChange(coin.id)}
          className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all duration-150"
          style={{
            borderColor: selected === coin.id ? "#10b981" : "rgba(63,63,70,0.8)",
            background: selected === coin.id ? "rgba(16,185,129,0.1)" : "rgba(39,39,42,0.5)",
          }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-base font-black text-white"
            style={{ backgroundColor: coin.color }}
          >
            {coin.emoji}
          </div>
          <span className="text-xs font-bold text-white">{coin.id}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    completed: { label: "Completed", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    pending:   { label: "Pending",   cls: "bg-amber-500/15 text-amber-400 border-amber-500/30"   },
    failed:    { label: "Failed",    cls: "bg-red-500/15 text-red-400 border-red-500/30"         },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-zinc-700 text-zinc-400 border-zinc-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

// ─── Type badge ───────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    deposit:  { label: "Deposit",  cls: "text-emerald-400" },
    withdraw: { label: "Withdraw", cls: "text-blue-400"    },
    win:      { label: "Win",      cls: "text-amber-400"   },
    loss:     { label: "Loss",     cls: "text-red-400"     },
    buyin:    { label: "Buy-in",   cls: "text-zinc-400"    },
    cashout:  { label: "Cash Out", cls: "text-emerald-400" },
  };
  const { label, cls } = map[type] ?? { label: type, cls: "text-zinc-400" };
  return <span className={`text-xs font-bold ${cls}`}>{label}</span>;
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = "deposit" | "withdraw" | "history";
type FilterType = "all" | "deposits" | "withdrawals" | "game";

export default function WalletPage() {
  const [user, setUser]           = useState<PublicUser | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("deposit");
  const [coin, setCoin]           = useState("BTC");
  const [showCrypto, setShowCrypto] = useState(false);

  // Deposit state
  const [simState, setSimState]   = useState<"idle" | "confirming" | "done">("idle");
  const [copied, setCopied]       = useState(false);

  // Withdraw state
  const [wAddr, setWAddr]         = useState("");
  const [wAmt, setWAmt]           = useState("");
  const [wBusy, setWBusy]         = useState(false);
  const [wStatus, setWStatus]     = useState<"idle" | "processing" | "done" | "error">("idle");
  const [wMsg, setWMsg]           = useState("");

  // History state
  const [txns, setTxns]           = useState<Transaction[]>([]);
  const [txFilter, setTxFilter]   = useState<FilterType>("all");
  const [txLoading, setTxLoading] = useState(false);
  const historyLoaded             = useRef(false);

  // Stats state
  const [summary, setSummary] = useState<TransactionSummary>({
    totalDeposited: 0, totalWithdrawn: 0, totalWon: 0, totalLost: 0,
  });

  // ── Auth ──
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); })
      .finally(() => setLoading(false));
  }, []);

  // ── Fetch history ──
  const fetchTxns = useCallback(async (f: FilterType) => {
    setTxLoading(true);
    const res = await fetch(`/api/wallet/transactions?type=${f}`);
    const data = await res.json();
    setTxns(data.transactions ?? []);
    if (data.summary) setSummary(data.summary);
    setTxLoading(false);
  }, []);

  // Load transactions + stat summary as soon as the user is known, not just when History is opened.
  useEffect(() => {
    if (user && !historyLoaded.current) {
      historyLoaded.current = true;
      fetchTxns(txFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (activeTab === "history") fetchTxns(txFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txFilter]);

  // ── Simulate deposit ──
  async function simulateDeposit() {
    if (simState !== "idle") return;
    setSimState("confirming");
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch("/api/wallet/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin, amount_usd: 10000 }), // $100.00
    });
    const data = await res.json();
    if (res.ok) {
      setUser(u => u ? { ...u, balance: data.balance } : u);
      setSimState("done");
      if (historyLoaded.current) fetchTxns(txFilter);
      setTimeout(() => setSimState("idle"), 3000);
    } else {
      setSimState("idle");
    }
  }

  // ── Copy address ──
  function copyAddress() {
    if (!user) return;
    navigator.clipboard.writeText(depositAddress(coin, user.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Withdraw ──
  async function confirmWithdraw() {
    if (!user || wBusy) return;
    setWMsg("");
    const amtCents = Math.round(parseFloat(wAmt) * 100);
    if (!wAddr.trim()) { setWMsg("Enter a withdrawal address."); return; }
    if (isNaN(amtCents) || amtCents < 1000) { setWMsg("Minimum withdrawal is $10.00."); return; }

    const selectedCoin = COINS.find(c => c.id === coin)!;
    const fee = selectedCoin.networkFee;
    if (amtCents + fee > user.balance) { setWMsg("Insufficient balance (including network fee)."); return; }

    setWBusy(true);
    setWStatus("processing");
    const res = await fetch("/api/wallet/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin, address: wAddr, amount_usd: amtCents }),
    });
    const data = await res.json();
    setWBusy(false);
    if (res.ok) {
      setUser(u => u ? { ...u, balance: data.balance } : u);
      setWStatus("done");
      setWAmt("");
      setWAddr("");
      if (historyLoaded.current) fetchTxns(txFilter);
    } else {
      setWStatus("error");
      setWMsg(data.error ?? "Withdrawal failed.");
    }
  }

  // ── Derived values ──
  const selectedCoin = COINS.find(c => c.id === coin)!;
  const balanceDollars = (user?.balance ?? 0) / 100;
  const cryptoEquiv = (balanceDollars / selectedCoin.rate).toFixed(selectedCoin.rate >= 1 ? 4 : 8);
  const withdrawMax = Math.max(0, ((user?.balance ?? 0) - selectedCoin.networkFee) / 100);
  const withdrawFeeUsd = `$${(selectedCoin.networkFee / 100).toFixed(2)}`;

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }
  // ── Guest wallet view ──
  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 pt-24 pb-16 page-enter">
          <div
            className="rounded-2xl p-8 mb-5 text-center"
            style={{ background: "linear-gradient(135deg,#0f1a12 0%,#0a1410 100%)", border: "1px solid rgba(16,185,129,0.2)" }}
          >
            <div className="text-5xl mb-4">🔐</div>
            <h1 className="text-2xl font-black mb-2">Crypto Wallet</h1>
            <p className="text-zinc-400 text-sm mb-6 max-w-sm mx-auto">
              Create an account or sign in to deposit, withdraw, and track your crypto balance.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/register"
                className="px-6 py-3 rounded-xl text-sm font-black bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
                Create Account →
              </Link>
              <Link href="/login"
                className="px-6 py-3 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
                Sign In
              </Link>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-6">
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">Supported Coins</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
              {COINS.map(c => (
                <div key={c.id} className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-zinc-800/40 border border-zinc-700/40">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-base font-black text-white" style={{ backgroundColor: c.color }}>
                    {c.emoji}
                  </div>
                  <span className="text-xs font-bold text-zinc-300">{c.id}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2.5">
              {[
                ["↓", "Deposit crypto", "Unique address per coin, instant credit on confirmation"],
                ["↑", "Instant withdrawals", "Send winnings directly to your external wallet"],
                ["📋", "Transaction history", "Full audit trail — deposits, withdrawals, game activity"],
              ].map(([icon, title, desc]) => (
                <div key={title} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/30">
                  <span className="text-xl w-7 text-center shrink-0">{icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{title}</p>
                    <p className="text-xs text-zinc-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const addr = depositAddress(coin, user.id);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 pt-24 pb-16 page-enter">

        {/* ── Balance hero ── */}
        <div
          className="rounded-2xl p-6 mb-5 shadow-2xl text-center relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #0f1a12 0%, #0a1410 50%, #0f1a12 100%)",
            border: "1px solid rgba(16,185,129,0.2)",
            boxShadow: "0 0 40px rgba(16,185,129,0.05), 0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          {/* Subtle glow blob */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(16,185,129,0.08) 0%, transparent 70%)" }}
          />

          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3 relative">Available Balance</p>

          <button
            onClick={() => setShowCrypto(b => !b)}
            className="group relative"
          >
            <p className="text-5xl font-black text-white mb-1 transition-transform group-hover:scale-[1.02]">
              {showCrypto
                ? `${cryptoEquiv} ${coin}`
                : `$${balanceDollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </p>
            <p className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
              {showCrypto
                ? `← $${balanceDollars.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`
                : `≈ ${cryptoEquiv} ${coin}`
              }
            </p>
          </button>

          {/* Quick action buttons */}
          <div className="flex gap-2 mt-6 relative">
            <button
              onClick={() => setActiveTab("deposit")}
              className="flex-1 font-black py-3 rounded-xl text-sm transition-all duration-150"
              style={{
                background: activeTab === "deposit" ? "#059669" : "rgba(255,255,255,0.06)",
                color: activeTab === "deposit" ? "#fff" : "#a1a1aa",
              }}
            >
              ↓ Deposit
            </button>
            <button
              onClick={() => setActiveTab("withdraw")}
              className="flex-1 font-black py-3 rounded-xl text-sm transition-all duration-150"
              style={{
                background: activeTab === "withdraw" ? "#1d4ed8" : "rgba(255,255,255,0.06)",
                color: activeTab === "withdraw" ? "#fff" : "#a1a1aa",
              }}
            >
              ↑ Withdraw
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className="flex-1 font-bold py-3 rounded-xl text-sm transition-all duration-150"
              style={{
                background: activeTab === "history" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                color: activeTab === "history" ? "#fff" : "#a1a1aa",
              }}
            >
              History
            </button>
          </div>
        </div>

        {/* ── Quick stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: "Total Deposited", value: summary.totalDeposited, cls: "text-emerald-400" },
            { label: "Total Withdrawn", value: summary.totalWithdrawn, cls: "text-blue-400"     },
            { label: "Total Won",       value: summary.totalWon,       cls: "text-amber-400"    },
            { label: "Total Lost",      value: summary.totalLost,      cls: "text-red-400"      },
          ].map(s => (
            <div key={s.label} className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-4 text-center">
              <p className={`text-lg font-black ${s.cls}`}>{fmtUsd(s.value)}</p>
              <p className="text-xs text-zinc-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800/60 rounded-xl p-1 mb-4">
          {(["deposit", "withdraw", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold capitalize transition-all duration-150"
              style={{
                background: activeTab === t ? "#059669" : "transparent",
                color: activeTab === t ? "#fff" : "#71717a",
              }}
            >
              {t === "deposit" ? "Deposit" : t === "withdraw" ? "Withdraw" : "History"}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════
            DEPOSIT TAB
        ════════════════════════════════════════════════════════════ */}
        {activeTab === "deposit" && (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-5 shadow-xl space-y-5">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Select Coin</p>
              <CoinSelector selected={coin} onChange={setCoin} />
            </div>

            {/* Address + QR */}
            <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
                  style={{ backgroundColor: selectedCoin.color }}
                >
                  {selectedCoin.emoji}
                </div>
                <p className="text-xs font-semibold text-zinc-400">
                  Your {selectedCoin.name} Deposit Address
                </p>
              </div>

              <FakeQR data={addr} />

              <div
                className="font-mono text-xs text-zinc-300 break-all rounded-lg p-3 select-all"
                style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                {addr}
              </div>

              <button
                onClick={copyAddress}
                className="w-full py-2.5 rounded-xl text-sm font-bold transition-all duration-150"
                style={{
                  background: copied ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.08)",
                  color: copied ? "#34d399" : "#e4e4e7",
                  border: copied ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {copied ? "✓ Address Copied!" : "Copy Address"}
              </button>
            </div>

            {/* Network info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-800/30 rounded-xl p-3">
                <p className="text-xs text-zinc-500 mb-1">Minimum Deposit</p>
                <p className="text-sm font-bold text-white">
                  {selectedCoin.minDeposit} {coin}
                  <span className="text-zinc-500 font-normal text-xs ml-1">
                    (≈${(selectedCoin.minDeposit * selectedCoin.rate).toFixed(2)})
                  </span>
                </p>
              </div>
              <div className="bg-zinc-800/30 rounded-xl p-3">
                <p className="text-xs text-zinc-500 mb-1">Est. Confirmation</p>
                <p className="text-sm font-bold text-white">{selectedCoin.confirmTime}</p>
              </div>
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
              <span className="text-amber-400 text-sm mt-0.5">⚠</span>
              <p className="text-xs text-amber-400/80 leading-relaxed">
                Only send {selectedCoin.name} ({coin}) to this address. Sending any other coin may result in permanent loss.
              </p>
            </div>

            {/* Simulate deposit */}
            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-600 mb-3 text-center">— Test Mode —</p>
              <button
                onClick={simulateDeposit}
                disabled={simState !== "idle"}
                className="w-full py-3 rounded-xl text-sm font-black transition-all duration-200 relative overflow-hidden disabled:cursor-not-allowed"
                style={{
                  background: simState === "done"
                    ? "rgba(16,185,129,0.2)"
                    : simState === "confirming"
                    ? "rgba(245,158,11,0.15)"
                    : "rgba(16,185,129,0.1)",
                  color: simState === "done" ? "#34d399" : simState === "confirming" ? "#fbbf24" : "#6ee7b7",
                  border: simState === "done"
                    ? "1px solid rgba(16,185,129,0.4)"
                    : simState === "confirming"
                    ? "1px solid rgba(245,158,11,0.3)"
                    : "1px dashed rgba(16,185,129,0.3)",
                }}
              >
                {simState === "confirming" ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Confirming on blockchain…
                  </span>
                ) : simState === "done" ? (
                  "✓ $100.00 Deposited!"
                ) : (
                  "⚡ Simulate Deposit (Test Mode) · +$100.00"
                )}
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            WITHDRAW TAB
        ════════════════════════════════════════════════════════════ */}
        {activeTab === "withdraw" && (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-5 shadow-xl space-y-5">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Select Coin</p>
              <CoinSelector selected={coin} onChange={c => { setCoin(c); setWStatus("idle"); setWMsg(""); }} />
            </div>

            {wStatus === "done" ? (
              <div className="text-center py-10 space-y-3">
                <div className="text-5xl">🚀</div>
                <p className="text-lg font-black text-white">Withdrawal Processing</p>
                <p className="text-sm text-zinc-400">Your {coin} is on its way. Estimated arrival: {selectedCoin.confirmTime}</p>
                <button
                  onClick={() => setWStatus("idle")}
                  className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                >
                  New Withdrawal
                </button>
              </div>
            ) : (
              <>
                {/* Address input */}
                <div>
                  <label className="block text-xs text-zinc-500 uppercase tracking-widest mb-2">
                    {selectedCoin.name} Withdrawal Address
                  </label>
                  <input
                    type="text"
                    value={wAddr}
                    onChange={e => setWAddr(e.target.value)}
                    placeholder={`Enter ${coin} address…`}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>

                {/* Amount input */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-widest">Amount (USD)</label>
                    <span className="text-xs text-zinc-500">
                      Available: <span className="text-amber-400 font-bold">{fmtUsd(user.balance)}</span>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-bold text-sm">$</span>
                      <input
                        type="number"
                        value={wAmt}
                        onChange={e => setWAmt(e.target.value)}
                        placeholder="0.00"
                        min="10"
                        step="0.01"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-8 pr-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => setWAmt(withdrawMax.toFixed(2))}
                      className="px-4 py-3 rounded-xl text-xs font-black bg-zinc-700 hover:bg-zinc-600 text-amber-400 transition-colors shrink-0"
                    >
                      MAX
                    </button>
                  </div>
                  {wAmt && !isNaN(parseFloat(wAmt)) && (
                    <p className="text-xs text-zinc-500 mt-1.5">
                      ≈ {(parseFloat(wAmt) / selectedCoin.rate).toFixed(8)} {coin}
                    </p>
                  )}
                </div>

                {/* Fee info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-800/30 rounded-xl p-3">
                    <p className="text-xs text-zinc-500 mb-1">Network Fee</p>
                    <p className="text-sm font-bold text-white">
                      {withdrawFeeUsd}
                      <span className="text-zinc-500 font-normal text-xs ml-1">({selectedCoin.networkFeeSymbol})</span>
                    </p>
                  </div>
                  <div className="bg-zinc-800/30 rounded-xl p-3">
                    <p className="text-xs text-zinc-500 mb-1">Est. Arrival</p>
                    <p className="text-sm font-bold text-white">{selectedCoin.confirmTime}</p>
                  </div>
                </div>

                {wMsg && (
                  <div className="px-4 py-3 rounded-xl text-sm bg-red-950/50 border border-red-800/50 text-red-400">
                    {wMsg}
                  </div>
                )}

                <button
                  onClick={confirmWithdraw}
                  disabled={wBusy || !wAddr || !wAmt}
                  className="w-full py-3 rounded-xl text-sm font-black transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: wBusy ? "rgba(29,78,216,0.5)" : "#1d4ed8", color: "#fff" }}
                >
                  {wBusy ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Processing…
                    </span>
                  ) : (
                    `Confirm Withdrawal${wAmt && !isNaN(parseFloat(wAmt)) ? ` · ${fmtUsd(Math.round(parseFloat(wAmt) * 100))}` : ""}`
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            HISTORY TAB
        ════════════════════════════════════════════════════════════ */}
        {activeTab === "history" && (
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl shadow-xl overflow-hidden">

            {/* Filter bar */}
            <div className="flex gap-1.5 p-4 border-b border-zinc-800/60 overflow-x-auto">
              {(["all", "deposits", "withdrawals", "game"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setTxFilter(f)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all duration-150"
                  style={{
                    background: txFilter === f ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                    color: txFilter === f ? "#34d399" : "#71717a",
                    border: txFilter === f ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent",
                  }}
                >
                  {f === "game" ? "Game Activity" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {txLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="spinner" />
              </div>
            ) : txns.length === 0 ? (
              <div className="text-center py-16 px-4">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-zinc-400 font-semibold">No transactions yet</p>
                <p className="text-zinc-600 text-sm mt-1">
                  {txFilter === "all"
                    ? "Use the Deposit tab to add funds and get started."
                    : `No ${txFilter} found.`}
                </p>
                {txFilter === "all" && (
                  <button
                    onClick={() => setActiveTab("deposit")}
                    className="mt-4 px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                  >
                    Make a Deposit →
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/60">
                      <th className="text-left text-xs text-zinc-500 font-semibold px-4 py-3 uppercase tracking-wider">Date</th>
                      <th className="text-left text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider">Type</th>
                      <th className="text-left text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider">Coin</th>
                      <th className="text-right text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider">Amount</th>
                      <th className="text-left text-xs text-zinc-500 font-semibold px-3 py-3 uppercase tracking-wider hidden sm:table-cell">Status</th>
                      <th className="text-left text-xs text-zinc-500 font-semibold px-4 py-3 uppercase tracking-wider hidden md:table-cell">Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((tx, i) => {
                      const isCredit = ["deposit", "win", "cashout"].includes(tx.type);
                      return (
                        <tr
                          key={tx.id}
                          className="border-b border-zinc-800/30 transition-colors hover:bg-zinc-800/20"
                          style={{ animationDelay: `${i * 30}ms` }}
                        >
                          <td className="px-4 py-3.5 text-xs text-zinc-400 whitespace-nowrap">
                            {fmtDate(tx.created_at)}
                          </td>
                          <td className="px-3 py-3.5">
                            <TypeBadge type={tx.type} />
                          </td>
                          <td className="px-3 py-3.5">
                            {(() => {
                              const c = COINS.find(x => x.id === tx.coin);
                              return c ? (
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
                                    style={{ backgroundColor: c.color }}
                                  >
                                    {c.emoji}
                                  </div>
                                  <span className="text-xs font-bold text-zinc-300">{tx.coin}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-zinc-400">{tx.coin}</span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-3.5 text-right whitespace-nowrap">
                            <span className={`text-sm font-bold ${isCredit ? "text-emerald-400" : "text-red-400"}`}>
                              {isCredit ? "+" : "−"}{fmtUsd(tx.amount_usd)}
                            </span>
                            <br />
                            <span className="text-xs text-zinc-600">{tx.amount_crypto} {tx.coin}</span>
                          </td>
                          <td className="px-3 py-3.5 hidden sm:table-cell">
                            <StatusBadge status={tx.status} />
                          </td>
                          <td className="px-4 py-3.5 hidden md:table-cell">
                            <span
                              className="font-mono text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors"
                              title={tx.tx_hash}
                            >
                              {shortHash(tx.tx_hash)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Footer note ── */}
        <p className="text-center text-xs text-zinc-700 mt-8">
          PokerStack HQ · Simulated crypto wallet for demo purposes only
        </p>
      </main>
    </div>
  );
}
