"use client";

import { useState, useEffect, useRef, useCallback } from "react";

import type { Notification, NotificationType } from "@/lib/notifications";

const ICON: Record<NotificationType, string> = {
  win: "🏆",
  loss: "😔",
  deposit: "✅",
  tournament: "🎯",
};

const ACCENT: Record<NotificationType, string> = {
  win: "#34d399",
  loss: "#9ca3af",
  deposit: "#60a5fa",
  tournament: "#f59e0b",
};

const POLL_MS = 30_000;

/** "just now" / "4m" / "3h" / "6d" — compact enough for a dropdown row. */
function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Written as a promise chain rather than async/await so the state updates sit
  // inside `.then` callbacks — react-hooks/set-state-in-effect rejects an
  // awaited setState reached from an effect body.
  const load = useCallback(() => {
    return fetch("/api/notifications")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setItems(data.notifications ?? []);
          setUnread(data.unreadCount ?? 0);
        }
        setLoaded(true);
      })
      .catch(() => {
        // Offline or mid-navigation — keep showing the last good list.
        setLoaded(true);
      });
  }, []);

  // Initial fetch + 30s poll. The interval is cleared on unmount so a
  // navigation away from a Navbar-bearing page doesn't leave it running.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    // Optimistic: the badge clears immediately, then the server response
    // reconciles. A failure leaves the next poll to restore the true count.
    setUnread(0);
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications/read", { method: "POST" });
    } catch {
      load();
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load(); // opening should never show a stale list
  }

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/5 active:bg-white/10 transition-colors"
      >
        <span className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span
            className="absolute flex items-center justify-center font-black rounded-full"
            style={{
              top: 2, right: 0, minWidth: 17, height: 17, padding: "0 4px",
              background: "#ef4444", color: "white", fontSize: 10,
              border: "2px solid #09090b", lineHeight: 1,
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute rounded-xl overflow-hidden shadow-2xl"
          style={{
            top: "calc(100% + 10px)", right: 0, width: 340, maxWidth: "calc(100vw - 24px)",
            background: "#0d1512", border: "1px solid #1f3a2b", zIndex: 60,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: "1px solid #1f3a2b", background: "#0a1410" }}
          >
            <span className="text-sm font-bold text-white">
              Notifications
              {unread > 0 && (
                <span className="ml-2 text-xs font-bold" style={{ color: "#ef4444" }}>
                  {unread} new
                </span>
              )}
            </span>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-xs font-semibold transition-colors disabled:cursor-default"
              style={{ color: unread === 0 ? "#3f3f46" : "#34d399" }}
            >
              Mark all as read
            </button>
          </div>

          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {!loaded ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: "#52525b" }}>
                Loading…
              </p>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-2xl mb-2">🔕</p>
                <p className="text-sm" style={{ color: "#52525b" }}>No notifications yet</p>
                <p className="text-xs mt-1" style={{ color: "#3f3f46" }}>
                  Wins, deposits and tournament results show up here.
                </p>
              </div>
            ) : (
              items.map(n => (
                <div
                  key={n.id}
                  className="flex gap-3 px-4 py-3 transition-colors"
                  style={{
                    borderBottom: "1px solid #14241c",
                    background: n.read ? "transparent" : "rgba(52,211,153,0.05)",
                  }}
                >
                  <span className="text-lg leading-none shrink-0 mt-0.5">
                    {ICON[n.type] ?? "🔔"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm leading-snug"
                      style={{
                        color: n.read ? "#a1a1aa" : "#f4f4f5",
                        fontWeight: n.read ? 400 : 600,
                      }}
                    >
                      {n.message}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: ACCENT[n.type] ?? "#52525b" }}>
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                  {!n.read && (
                    <span
                      className="shrink-0 rounded-full mt-1.5"
                      style={{ width: 7, height: 7, background: "#34d399" }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
