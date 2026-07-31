"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

import type {
  AdminStats, AdminUserRow, AdminTxRow, ActivityEntry, DailyPoint, AdminUserSort,
} from "@/lib/admin-db";

// ─── Theme ────────────────────────────────────────────────────────────────────

const BG      = "#060d08";
const PANEL   = "#0a1410";
const BORDER  = "#1a2d1e";
const GOLD    = "#c9a227";
const AMBER   = "#f59e0b";
const GREEN   = "#34d399";
const RED     = "#ef4444";
const MUTED   = "#6b7280";

// ─── Formatting ───────────────────────────────────────────────────────────────

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function usdCompact(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1_000)     return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(2)}`;
}

function dateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function dayLabel(day: string): string {
  // `day` is YYYY-MM-DD from Postgres. Parse the parts directly rather than
  // through Date(string), which would read it as UTC and shift the label a day
  // backwards for anyone west of Greenwich.
  const [, m, d] = day.split("-").map(Number);
  return `${m}/${d}`;
}

// ─── CSS bar chart ────────────────────────────────────────────────────────────

/**
 * Pure-CSS bar chart — flex row of divs sized by percentage of the series max.
 *
 * Bars carry a minimum height so a non-zero-but-tiny day is still visible, but
 * a genuine zero renders flat, keeping "no activity" visually distinct from
 * "a little activity".
 */
function BarChart({
  title, data, format, color,
}: {
  title: string;
  data: DailyPoint[];
  format: (v: number) => string;
  color: string;
}) {
  const max = Math.max(...data.map(d => d.value), 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <span className="text-xs font-mono" style={{ color: MUTED }}>
          14d total: <span style={{ color }}>{format(total)}</span>
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: MUTED }}>
        Peak {format(max)}
      </p>

      <div className="flex items-end gap-1" style={{ height: 132 }}>
        {data.map(d => {
          const pct = max > 0 ? (d.value / max) * 100 : 0;
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full group relative">
              {/* Tooltip */}
              <div
                className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap"
                style={{
                  bottom: "100%", marginBottom: 6, background: "#000", color: "#fff",
                  fontSize: 10, fontWeight: 700, padding: "3px 6px", borderRadius: 4,
                  border: `1px solid ${BORDER}`, zIndex: 10,
                }}
              >
                {dayLabel(d.day)} · {format(d.value)}
              </div>
              <div
                style={{
                  width: "100%",
                  height: d.value > 0 ? `max(3px, ${pct}%)` : 0,
                  minHeight: d.value > 0 ? 3 : 0,
                  background: `linear-gradient(180deg, ${color} 0%, ${color}66 100%)`,
                  borderRadius: "3px 3px 0 0",
                  transition: "height 0.35s ease",
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex gap-1 mt-2">
        {data.map((d, i) => (
          <span
            key={d.day}
            className="flex-1 text-center"
            style={{ fontSize: 9, color: MUTED }}
          >
            {/* Label every other day so they don't collide at narrow widths */}
            {i % 2 === 0 ? dayLabel(d.day) : " "}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
      <p className="text-xs uppercase tracking-wider font-bold" style={{ color: MUTED }}>{label}</p>
      <p className="font-black mt-2" style={{ color, fontSize: 28, lineHeight: 1.1 }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
}

// ─── Login gate ───────────────────────────────────────────────────────────────

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [busy, setBusy]         = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) onSuccess();
      else setError("Incorrect password");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: BG }}>
      <form
        onSubmit={submit}
        className="w-full max-w-sm"
        style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 28 }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-xs font-black px-2 py-0.5 rounded"
            style={{ background: GOLD, color: "#000", letterSpacing: 1 }}
          >
            ADMIN
          </span>
          <span className="text-white font-bold">PokerStack</span>
        </div>
        <p className="text-xs mb-6" style={{ color: MUTED }}>
          Restricted area. Enter the admin password to continue.
        </p>

        <label className="block text-xs font-bold mb-1.5" style={{ color: MUTED }}>
          PASSWORD
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{ background: "#060d08", border: `1px solid ${BORDER}`, color: "#fff" }}
        />

        {error && (
          <p className="text-xs mt-3 font-semibold" style={{ color: RED }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="w-full mt-5 rounded-lg py-2.5 text-sm font-bold transition-opacity disabled:opacity-40"
          style={{ background: GOLD, color: "#000" }}
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

// ─── Balance adjustment modal ─────────────────────────────────────────────────

function AdjustModal({ user, onClose, onDone }: {
  user: AdminUserRow;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [mode, setMode]     = useState<"credit" | "debit">("credit");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");

  const dollars = Number(amount);
  const valid = Number.isFinite(dollars) && dollars > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError("");
    const delta = Math.round(dollars * 100) * (mode === "credit" ? 1 : -1);
    try {
      const res = await fetch("/api/admin/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, delta }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Adjustment failed");
        return;
      }
      // `applied` differs from the request when a debit was clamped at zero.
      const note = data.applied !== delta
        ? ` (clamped to ${usd(data.applied)} — balance floor is $0)`
        : "";
      onDone(`${user.username}: ${usd(data.applied)}${note} → new balance ${usd(data.balance)}`);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.75)", zIndex: 100 }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm"
        style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 24 }}
      >
        <h3 className="text-white font-bold text-base">Adjust balance</h3>
        <p className="text-xs mt-1 mb-5" style={{ color: MUTED }}>
          {user.username} · currently {usd(user.balance)}
        </p>

        <div className="flex gap-2 mb-4">
          {(["credit", "debit"] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="flex-1 rounded-lg py-2 text-xs font-bold uppercase transition-colors"
              style={{
                background: mode === m ? (m === "credit" ? "rgba(52,211,153,0.15)" : "rgba(239,68,68,0.15)") : "#060d08",
                border: `1px solid ${mode === m ? (m === "credit" ? GREEN : RED) : BORDER}`,
                color: mode === m ? (m === "credit" ? GREEN : RED) : MUTED,
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <label className="block text-xs font-bold mb-1.5" style={{ color: MUTED }}>
          AMOUNT (USD)
        </label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          autoFocus
          placeholder="0.00"
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{ background: "#060d08", border: `1px solid ${BORDER}`, color: "#fff" }}
        />

        {error && <p className="text-xs mt-3 font-semibold" style={{ color: RED }}>{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg py-2.5 text-sm font-bold"
            style={{ background: "#060d08", border: `1px solid ${BORDER}`, color: MUTED }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !valid}
            className="flex-1 rounded-lg py-2.5 text-sm font-bold transition-opacity disabled:opacity-40"
            style={{ background: mode === "credit" ? GREEN : RED, color: "#000" }}
          >
            {busy ? "Applying…" : mode === "credit" ? "Credit" : "Debit"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const SORT_COLUMNS: { key: AdminUserSort; label: string }[] = [
  { key: "id",         label: "ID" },
  { key: "username",   label: "Username" },
  { key: "email",      label: "Email" },
  { key: "balance",    label: "Balance" },
  { key: "created_at", label: "Created" },
  { key: "last_login", label: "Last login" },
];

function Dashboard({ onLock }: { onLock: () => void }) {
  const [stats, setStats]       = useState<AdminStats | null>(null);
  const [charts, setCharts]     = useState<{ newUsers: DailyPoint[]; txVolume: DailyPoint[] } | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const [users, setUsers]   = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort]     = useState<AdminUserSort>("id");
  const [dir, setDir]       = useState<"asc" | "desc">("asc");

  const [txs, setTxs]         = useState<AdminTxRow[]>([]);
  const [txTypes, setTxTypes] = useState<string[]>([]);
  const [txFilter, setTxFilter] = useState("all");

  const [adjustTarget, setAdjustTarget] = useState<AdminUserRow | null>(null);
  const [toast, setToast]   = useState("");
  const [error, setError]   = useState("");

  // A 401 from any panel endpoint means the 8h admin session lapsed — drop
  // straight back to the password gate rather than showing a broken dashboard.
  const guard = useCallback((res: Response) => {
    if (res.status === 401) { onLock(); return false; }
    return res.ok;
  }, [onLock]);

  // These loaders are promise chains rather than async/await so every state
  // update lands inside a `.then` callback — react-hooks/set-state-in-effect
  // rejects an awaited setState reached from an effect body.
  const loadStats = useCallback(() => {
    return fetch("/api/admin/stats")
      .then(res => (guard(res) ? res.json() : null))
      .then(data => {
        if (!data) return;
        setStats(data.stats);
        setCharts(data.charts);
        setActivity(data.activity ?? []);
      })
      .catch(() => setError("Could not load dashboard stats"));
  }, [guard]);

  const loadUsers = useCallback(() => {
    const qs = new URLSearchParams({ search, sort, dir });
    return fetch(`/api/admin/users?${qs}`)
      .then(res => (guard(res) ? res.json() : null))
      .then(data => {
        if (data) setUsers(data.users ?? []);
      })
      .catch(() => setError("Could not load users"));
  }, [search, sort, dir, guard]);

  const loadTxs = useCallback(() => {
    return fetch(`/api/admin/transactions?type=${encodeURIComponent(txFilter)}`)
      .then(res => (guard(res) ? res.json() : null))
      .then(data => {
        if (!data) return;
        setTxs(data.transactions ?? []);
        setTxTypes(data.types ?? []);
      })
      .catch(() => setError("Could not load transactions"));
  }, [txFilter, guard]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadTxs(); }, [loadTxs]);

  // Debounced so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(loadUsers, 250);
    return () => clearTimeout(id);
  }, [loadUsers]);

  // Toasts clear themselves so the operator doesn't accumulate stale banners.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  function toggleSort(col: AdminUserSort) {
    if (sort === col) setDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSort(col); setDir("asc"); }
  }

  async function toggleBan(u: AdminUserRow) {
    try {
      const res = await fetch("/api/admin/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id, banned: !u.banned }),
      });
      if (!guard(res)) return;
      // Patch the row in place — a full reload would lose the operator's
      // scroll position in a long table.
      setUsers(prev => prev.map(x => (x.id === u.id ? { ...x, banned: !u.banned } : x)));
      setToast(`${u.username} ${u.banned ? "unbanned" : "banned"}`);
      loadStats();
    } catch {
      setError("Ban action failed");
    }
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" }).catch(() => {});
    onLock();
  }

  const bannedCount = useMemo(() => users.filter(u => u.banned).length, [users]);

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      {/* ── Header ── */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 md:px-6"
        style={{ height: 56, background: PANEL, borderBottom: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-xs font-black px-2 py-1 rounded"
            style={{ background: GOLD, color: "#000", letterSpacing: 1 }}
          >
            ADMIN
          </span>
          <span className="text-white font-bold text-sm">PokerStack Control</span>
          <span className="hidden sm:inline text-xs" style={{ color: MUTED }}>
            Platform operations
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { loadStats(); loadUsers(); loadTxs(); }}
            className="text-xs font-bold px-3 py-1.5 rounded transition-colors"
            style={{ background: "#060d08", border: `1px solid ${BORDER}`, color: GREEN }}
          >
            ↻ Refresh
          </button>
          <button
            onClick={logout}
            className="text-xs font-bold px-3 py-1.5 rounded transition-colors"
            style={{ background: "#060d08", border: `1px solid ${BORDER}`, color: MUTED }}
          >
            Lock
          </button>
        </div>
      </header>

      {(toast || error) && (
        <div
          className="px-4 md:px-6 py-2.5 text-sm font-semibold"
          style={{
            background: error ? "rgba(239,68,68,0.12)" : "rgba(52,211,153,0.12)",
            borderBottom: `1px solid ${error ? RED : GREEN}33`,
            color: error ? RED : GREEN,
          }}
        >
          {error || toast}
          <button
            onClick={() => { setToast(""); setError(""); }}
            className="ml-3 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">

        {/* ── Stat cards ── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Total Users"
            value={stats ? stats.totalUsers.toLocaleString() : "—"}
            sub={bannedCount > 0 ? `${bannedCount} banned in view` : undefined}
            color="#fff"
          />
          <StatCard
            label="Total Transactions"
            value={stats ? stats.totalTransactions.toLocaleString() : "—"}
            color={AMBER}
          />
          <StatCard
            label="Total Deposits"
            value={stats ? usdCompact(stats.totalDeposits) : "—"}
            sub="completed only"
            color={GREEN}
          />
          <StatCard
            label="Total Withdrawals"
            value={stats ? usdCompact(stats.totalWithdrawals) : "—"}
            sub="excludes failed"
            color={RED}
          />
        </section>

        {/* ── Charts ── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {charts ? (
            <>
              <BarChart
                title="New users per day"
                data={charts.newUsers}
                format={v => v.toLocaleString()}
                color={GREEN}
              />
              <BarChart
                title="Transaction volume per day"
                data={charts.txVolume}
                format={usdCompact}
                color={AMBER}
              />
            </>
          ) : (
            <p className="text-sm" style={{ color: MUTED }}>Loading charts…</p>
          )}
        </section>

        {/* ── Users ── */}
        <section style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold text-white">
              Users <span style={{ color: MUTED }}>({users.length})</span>
            </h2>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search username or email…"
              className="text-sm rounded-lg px-3 py-1.5 outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}`, color: "#fff", minWidth: 240 }}
            />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr style={{ background: BG }}>
                  {SORT_COLUMNS.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className="text-left px-4 py-2.5 font-bold cursor-pointer select-none whitespace-nowrap"
                      style={{ color: sort === c.key ? GOLD : MUTED, fontSize: 11, letterSpacing: 0.5 }}
                    >
                      {c.label.toUpperCase()}
                      <span style={{ opacity: sort === c.key ? 1 : 0.25, marginLeft: 4 }}>
                        {sort === c.key ? (dir === "asc" ? "▲" : "▼") : "▲"}
                      </span>
                    </th>
                  ))}
                  <th
                    className="text-right px-4 py-2.5 font-bold whitespace-nowrap"
                    style={{ color: MUTED, fontSize: 11, letterSpacing: 0.5 }}
                  >
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center" style={{ color: MUTED }}>
                      {search ? `No users matching “${search}”` : "No users yet"}
                    </td>
                  </tr>
                ) : users.map(u => (
                  <tr key={u.id} style={{ borderTop: `1px solid ${BORDER}`, opacity: u.banned ? 0.55 : 1 }}>
                    <td className="px-4 py-2.5 font-mono" style={{ color: MUTED }}>{u.id}</td>
                    <td className="px-4 py-2.5 font-semibold text-white whitespace-nowrap">
                      {u.username}
                      {u.banned && (
                        <span
                          className="ml-2 text-xs font-black px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(239,68,68,0.15)", color: RED }}
                        >
                          BANNED
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "#a1a1aa" }}>{u.email}</td>
                    <td className="px-4 py-2.5 font-bold whitespace-nowrap" style={{ color: AMBER }}>
                      {usd(u.balance)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: MUTED, fontSize: 12 }}>
                      {dateTime(u.created_at)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: MUTED, fontSize: 12 }}>
                      {dateTime(u.last_login)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setAdjustTarget(u)}
                          className="text-xs font-bold px-2.5 py-1.5 rounded whitespace-nowrap transition-colors"
                          style={{ background: "rgba(245,158,11,0.12)", border: `1px solid ${AMBER}44`, color: AMBER }}
                        >
                          Adjust
                        </button>
                        <button
                          onClick={() => toggleBan(u)}
                          className="text-xs font-bold px-2.5 py-1.5 rounded whitespace-nowrap transition-colors"
                          style={{
                            background: u.banned ? "rgba(52,211,153,0.12)" : "rgba(239,68,68,0.12)",
                            border: `1px solid ${u.banned ? GREEN : RED}44`,
                            color: u.banned ? GREEN : RED,
                          }}
                        >
                          {u.banned ? "Unban" : "Ban"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Transactions ── */}
        <section style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: `1px solid ${BORDER}` }}
          >
            <h2 className="text-sm font-bold text-white">
              Transactions <span style={{ color: MUTED }}>({txs.length})</span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold" style={{ color: MUTED }}>TYPE</span>
              {["all", ...txTypes].map(t => (
                <button
                  key={t}
                  onClick={() => setTxFilter(t)}
                  className="text-xs font-bold px-2.5 py-1 rounded transition-colors"
                  style={{
                    background: txFilter === t ? "rgba(201,162,39,0.15)" : BG,
                    border: `1px solid ${txFilter === t ? GOLD : BORDER}`,
                    color: txFilter === t ? GOLD : MUTED,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ background: BG }}>
                  {["ID", "USER", "TYPE", "AMOUNT", "COIN", "STATUS", "DATE"].map(h => (
                    <th
                      key={h}
                      className="text-left px-4 py-2.5 font-bold whitespace-nowrap"
                      style={{ color: MUTED, fontSize: 11, letterSpacing: 0.5 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center" style={{ color: MUTED }}>
                      No transactions{txFilter !== "all" ? ` of type “${txFilter}”` : ""}
                    </td>
                  </tr>
                ) : txs.map(t => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td className="px-4 py-2.5 font-mono" style={{ color: MUTED }}>{t.id}</td>
                    <td className="px-4 py-2.5 text-white whitespace-nowrap">
                      {t.username ?? <span style={{ color: MUTED }}>deleted #{t.user_id}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          color: t.type.includes("deposit") || t.type === "win" || t.type === "admin_credit"
                            ? GREEN
                            : t.type.includes("withdraw") || t.type === "loss" || t.type === "admin_debit"
                            ? RED
                            : MUTED,
                        }}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-bold whitespace-nowrap" style={{ color: AMBER }}>
                      {usd(t.amount_usd)}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "#a1a1aa" }}>{t.coin}</td>
                    <td className="px-4 py-2.5">
                      <span
                        style={{
                          fontSize: 12,
                          color: t.status === "completed" ? GREEN : t.status === "failed" ? RED : AMBER,
                        }}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: MUTED, fontSize: 12 }}>
                      {dateTime(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Activity log ── */}
        <section style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <h2 className="text-sm font-bold text-white">Activity log</h2>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              Last 20 events across transactions, signups and admin actions
            </p>
          </div>
          <div>
            {activity.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: MUTED }}>
                Nothing has happened yet
              </p>
            ) : activity.map((a, i) => (
              <div
                key={`${a.kind}-${a.created_at}-${i}`}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{ borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}
              >
                <span
                  className="text-xs font-black px-2 py-0.5 rounded shrink-0"
                  style={{
                    background: a.kind === "admin" ? "rgba(201,162,39,0.15)"
                      : a.kind === "signup" ? "rgba(52,211,153,0.12)"
                      : "rgba(255,255,255,0.05)",
                    color: a.kind === "admin" ? GOLD : a.kind === "signup" ? GREEN : MUTED,
                    minWidth: 92, textAlign: "center",
                  }}
                >
                  {a.action}
                </span>
                <span className="text-sm text-white font-semibold shrink-0">
                  {a.username ?? "—"}
                </span>
                <span className="text-sm truncate flex-1" style={{ color: MUTED }}>
                  {a.detail}
                </span>
                <span className="text-xs shrink-0" style={{ color: "#3f3f46" }}>
                  {dateTime(a.created_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {adjustTarget && (
        <AdjustModal
          user={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={msg => {
            setAdjustTarget(null);
            setToast(msg);
            loadUsers();
            loadStats();
            loadTxs();
          }}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  // null = still checking for an existing session, so we render neither the
  // gate nor the dashboard and avoid a login form flashing on every reload.
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/login")
      .then(r => r.json())
      .then(d => setAuthed(Boolean(d.authed)))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
        <p className="text-sm" style={{ color: MUTED }}>Loading…</p>
      </div>
    );
  }

  return authed
    ? <Dashboard onLock={() => setAuthed(false)} />
    : <LoginGate onSuccess={() => setAuthed(true)} />;
}
