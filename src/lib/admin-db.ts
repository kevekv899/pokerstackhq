import { sql, toIso, mapTx, type Transaction } from "./db";

/**
 * Admin-panel queries: platform aggregates, the users/transactions tables,
 * the daily chart series, the unified activity feed, and moderation writes.
 *
 * Everything here is operator-facing and reads across all users, so each entry
 * point must only ever be reached through an authenticated admin route.
 */

// ── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  totalUsers: number;
  totalTransactions: number;
  totalDeposits: number;    // cents — completed deposits only
  totalWithdrawals: number; // cents — non-failed withdrawals
}

export async function getAdminStats(): Promise<AdminStats> {
  const [userRows, txRows] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM users`,
    sql`
      SELECT
        count(*)::int AS n,
        COALESCE(SUM(CASE WHEN type = 'deposit'  AND status = 'completed' THEN amount_usd ELSE 0 END), 0) AS deposits,
        COALESCE(SUM(CASE WHEN type = 'withdraw' AND status <> 'failed'   THEN amount_usd ELSE 0 END), 0) AS withdrawals
      FROM transactions
    `,
  ]);
  return {
    totalUsers: Number(userRows[0].n),
    totalTransactions: Number(txRows[0].n),
    totalDeposits: Number(txRows[0].deposits),
    totalWithdrawals: Number(txRows[0].withdrawals),
  };
}

// ── Daily chart series ───────────────────────────────────────────────────────

export interface DailyPoint {
  day: string;
  value: number;
}

/**
 * generate_series supplies the full date spine so days with no activity come
 * back as explicit zeros. The CSS bar chart renders a fixed-width series and
 * would silently mis-scale against a sparse one.
 */
export async function getNewUsersPerDay(days = 14): Promise<DailyPoint[]> {
  const rows = await sql`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(u.id)::int AS value
    FROM generate_series(
      current_date - make_interval(days => ${days - 1}),
      current_date,
      interval '1 day'
    ) AS d(day)
    LEFT JOIN users u
      ON u.created_at >= d.day AND u.created_at < d.day + interval '1 day'
    GROUP BY d.day
    ORDER BY d.day
  `;
  return rows.map((r) => ({ day: r.day as string, value: Number(r.value) }));
}

/** Total transaction volume (cents) per day across the trailing window. */
export async function getTxVolumePerDay(days = 14): Promise<DailyPoint[]> {
  const rows = await sql`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(t.amount_usd), 0) AS value
    FROM generate_series(
      current_date - make_interval(days => ${days - 1}),
      current_date,
      interval '1 day'
    ) AS d(day)
    LEFT JOIN transactions t
      ON t.created_at >= d.day AND t.created_at < d.day + interval '1 day'
    GROUP BY d.day
    ORDER BY d.day
  `;
  return rows.map((r) => ({ day: r.day as string, value: Number(r.value) }));
}

// ── Users table ──────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  balance: number;
  created_at: string;
  last_login: string | null;
  banned: boolean;
}

export type AdminUserSort =
  | "id" | "username" | "email" | "balance" | "created_at" | "last_login";

const USER_SORT_COLUMNS: readonly string[] = [
  "id", "username", "email", "balance", "created_at", "last_login",
];

export function isAdminUserSort(v: string): v is AdminUserSort {
  return USER_SORT_COLUMNS.includes(v);
}

/**
 * Users for the admin table, with optional substring search and column sort.
 *
 * `sort` is narrowed to the AdminUserSort union by isAdminUserSort before it
 * gets here, then passed through postgres.js's `sql()` helper, which emits it
 * as a quoted identifier rather than interpolating it as a value.
 */
export async function getAdminUsers(
  search = "",
  sort: AdminUserSort = "id",
  dir: "asc" | "desc" = "asc",
  limit = 200
): Promise<AdminUserRow[]> {
  const term = search.trim();
  const pattern = `%${term}%`;
  const order = dir === "asc"
    ? sql`${sql(sort)} ASC NULLS LAST`
    : sql`${sql(sort)} DESC NULLS LAST`;

  const rows = term
    ? await sql`
        SELECT id, username, email, balance, created_at, last_login, banned
        FROM users
        WHERE username ILIKE ${pattern} OR email ILIKE ${pattern}
        ORDER BY ${order}, id ASC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, username, email, balance, created_at, last_login, banned
        FROM users
        ORDER BY ${order}, id ASC
        LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: Number(r.id),
    username: r.username as string,
    email: r.email as string,
    balance: Number(r.balance),
    created_at: toIso(r.created_at) as string,
    last_login: toIso(r.last_login),
    banned: Boolean(r.banned),
  }));
}

// ── Transactions table ───────────────────────────────────────────────────────

export interface AdminTxRow extends Transaction {
  username: string | null;
}

/** Platform-wide transactions joined to the owning username, newest first. */
export async function getAdminTransactions(type = "all", limit = 200): Promise<AdminTxRow[]> {
  const rows = type === "all"
    ? await sql`
        SELECT t.*, u.username FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT t.*, u.username FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.type = ${type}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit}
      `;
  return rows.map((r) => ({ ...mapTx(r), username: (r.username as string) ?? null }));
}

/** Distinct types present in the data, used to populate the filter dropdown. */
export async function getTransactionTypes(): Promise<string[]> {
  const rows = await sql`SELECT DISTINCT type FROM transactions ORDER BY type`;
  return rows.map((r) => r.type as string);
}

// ── Activity feed ────────────────────────────────────────────────────────────

export interface ActivityEntry {
  kind: "transaction" | "signup" | "admin";
  action: string;
  detail: string;
  username: string | null;
  created_at: string;
}

/**
 * Unified "last N things that happened on the platform" feed.
 *
 * Merges three timestamped sources — transactions, registrations, and operator
 * actions from activity_log — so the panel shows one chronological stream
 * instead of three disjoint lists.
 */
export async function getActivityFeed(limit = 20): Promise<ActivityEntry[]> {
  const rows = await sql`
    (
      SELECT 'transaction' AS kind,
             t.type AS action,
             t.coin || ' ' || to_char(t.amount_usd::numeric / 100, 'FM999999990.00') || ' · ' || t.status AS detail,
             u.username AS username,
             t.created_at AS created_at
      FROM transactions t LEFT JOIN users u ON u.id = t.user_id
    )
    UNION ALL
    (
      SELECT 'signup' AS kind,
             'register' AS action,
             'account created' AS detail,
             username,
             created_at
      FROM users
    )
    UNION ALL
    (
      SELECT 'admin' AS kind, a.action, a.detail, u.username, a.created_at
      FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
    )
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    kind: r.kind as ActivityEntry["kind"],
    action: r.action as string,
    detail: (r.detail as string) ?? "",
    username: (r.username as string) ?? null,
    created_at: toIso(r.created_at) as string,
  }));
}

/** Best-effort audit write — never blocks the operator action that triggered it. */
export async function logActivity(
  userId: number | null,
  action: string,
  detail: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO activity_log (user_id, action, detail)
      VALUES (${userId}, ${action}, ${detail})
    `;
  } catch (err) {
    console.error("logActivity failed:", err);
  }
}

// ── Moderation writes ────────────────────────────────────────────────────────

/** Sets the ban flag; returns the resulting row, or null if no such user. */
export async function setUserBanned(
  id: number,
  banned: boolean
): Promise<{ id: number; username: string; banned: boolean } | null> {
  const rows = await sql`
    UPDATE users SET banned = ${banned} WHERE id = ${id}
    RETURNING id, username, banned
  `;
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    username: rows[0].username as string,
    banned: Boolean(rows[0].banned),
  };
}

/**
 * Operator credit/debit.
 *
 * Clamps at zero so a debit larger than the balance settles the account at 0
 * rather than going negative, and returns the delta actually applied so the
 * audit log records the real figure rather than the requested one.
 */
export async function adminAdjustBalance(
  id: number,
  deltaCents: number
): Promise<{ balance: number; applied: number; username: string } | null> {
  const rows = await sql`
    WITH before AS (SELECT id, balance FROM users WHERE id = ${id})
    UPDATE users u
    SET balance = GREATEST(0, u.balance + ${deltaCents})
    FROM before b
    WHERE u.id = b.id
    RETURNING u.balance AS balance, u.balance - b.balance AS applied, u.username AS username
  `;
  if (!rows[0]) return null;
  return {
    balance: Number(rows[0].balance),
    applied: Number(rows[0].applied),
    username: rows[0].username as string,
  };
}
