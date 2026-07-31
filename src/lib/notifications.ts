import type postgres from "postgres";
import { sql, toIso } from "./db";

/**
 * In-app notification feed.
 *
 * Rows are written as a side effect of wallet/tournament settlement, and read
 * by the Navbar bell (newest 10 + unread count, polled every 30s).
 */

export type NotificationType = "win" | "loss" | "deposit" | "tournament";

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  message: string;
  read: boolean;
  created_at: string;
}

/** Emoji shown beside each notification type in the dropdown. */
export const NOTIFICATION_ICON: Record<NotificationType, string> = {
  win: "🏆",
  loss: "😔",
  deposit: "✅",
  tournament: "🎯",
};

function mapNotification(row: postgres.Row): Notification {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    type: row.type as NotificationType,
    message: row.message as string,
    read: Boolean(row.read),
    created_at: toIso(row.created_at) as string,
  };
}

/** Formats cents as `$1,234.56`, dropping the decimals on whole-dollar amounts. */
export function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Best-effort notification insert.
 *
 * Called from wallet/tournament handlers *after* the balance and transaction
 * writes have already committed. A failure here must not turn a settled hand
 * into a 500, so it logs and reports success as a boolean instead of throwing.
 */
export async function createNotification(
  userId: number,
  type: NotificationType,
  message: string
): Promise<boolean> {
  try {
    await sql`
      INSERT INTO notifications (user_id, type, message)
      VALUES (${userId}, ${type}, ${message})
    `;
    return true;
  } catch (err) {
    console.error("createNotification failed:", err);
    return false;
  }
}

export async function getNotifications(userId: number, limit = 10): Promise<Notification[]> {
  const rows = await sql`
    SELECT * FROM notifications WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC LIMIT ${limit}
  `;
  return rows.map(mapNotification);
}

export async function getUnreadNotifications(userId: number, limit = 10): Promise<Notification[]> {
  const rows = await sql`
    SELECT * FROM notifications WHERE user_id = ${userId} AND read = false
    ORDER BY created_at DESC, id DESC LIMIT ${limit}
  `;
  return rows.map(mapNotification);
}

export async function getUnreadCount(userId: number): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE user_id = ${userId} AND read = false
  `;
  return Number(rows[0].n);
}

/** Marks every unread notification for the user as read. Returns rows affected. */
export async function markAllNotificationsRead(userId: number): Promise<number> {
  const rows = await sql`
    UPDATE notifications SET read = true
    WHERE user_id = ${userId} AND read = false
    RETURNING id
  `;
  return rows.length;
}
