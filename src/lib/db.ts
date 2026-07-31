import postgres from "postgres";

/**
 * Supabase PostgreSQL data-access layer.
 *
 * We connect directly to Supabase's connection pooler via the DATABASE_URL so
 * we can keep the exact SQL the app was built on — notably atomic
 * `balance = balance + n` updates and the CASE/WHEN transaction summary, which
 * the query-builder can't express cleanly. This connection uses the privileged
 * `postgres` role, so it bypasses Row Level Security (RLS is enabled on the
 * tables to block the public anon API — see scripts/migrate.mjs).
 */

const globalForDb = globalThis as unknown as { _sql?: ReturnType<typeof postgres> };

export const sql =
  globalForDb._sql ??
  postgres(process.env.DATABASE_URL!, {
    // Supabase's transaction pooler (port 6543) is PgBouncer in transaction
    // mode, which does not support prepared statements.
    prepare: false,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb._sql = sql;

// ── Types ────────────────────────────────────────────────────────────────────

export interface DbUser {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  balance: number;
  avatar: string;
  hands_played: number;
  biggest_win: number;
  created_at: string;
  last_login: string | null;
  banned: boolean;
}

export interface PublicUser {
  id: number;
  username: string;
  email: string;
  balance: number;
  avatar: string;
  hands_played: number;
  biggest_win: number;
  created_at: string;
  last_login: string | null;
  banned: boolean;
}

export function toPublicUser(u: DbUser): PublicUser {
  const { password_hash: _password_hash, ...pub } = u;
  return pub;
}

export interface Transaction {
  id: number;
  user_id: number;
  type: string;
  coin: string;
  amount_usd: number;
  amount_crypto: string;
  address: string;
  status: string;
  tx_hash: string;
  created_at: string;
}

export interface TransactionSummary {
  totalDeposited: number;
  totalWithdrawn: number;
  totalWon: number;
  totalLost: number;
}

// ── Row mappers ──────────────────────────────────────────────────────────────
// postgres.js returns `bigint` columns as strings and `timestamptz` as Date
// objects. Normalize to the numbers / ISO strings the rest of the app expects.

export function toIso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapUser(row: postgres.Row): DbUser {
  return {
    id: Number(row.id),
    username: row.username as string,
    email: row.email as string,
    password_hash: row.password_hash as string,
    balance: Number(row.balance),
    avatar: row.avatar as string,
    hands_played: Number(row.hands_played),
    biggest_win: Number(row.biggest_win),
    created_at: toIso(row.created_at) as string,
    last_login: toIso(row.last_login),
    banned: Boolean(row.banned),
  };
}

export function mapTx(row: postgres.Row): Transaction {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    type: row.type as string,
    coin: row.coin as string,
    amount_usd: Number(row.amount_usd),
    amount_crypto: row.amount_crypto as string,
    address: row.address as string,
    status: row.status as string,
    tx_hash: row.tx_hash as string,
    created_at: toIso(row.created_at) as string,
  };
}

// ── User queries ─────────────────────────────────────────────────────────────

export async function getUserById(id: number): Promise<DbUser | null> {
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
  return rows[0] ? mapUser(rows[0]) : null;
}

/** Case-insensitive existence check (username/email are `citext`). */
export async function findExistingUser(
  email: string,
  username: string
): Promise<{ id: number } | null> {
  const rows = await sql`
    SELECT id FROM users WHERE email = ${email} OR username = ${username} LIMIT 1
  `;
  return rows[0] ? { id: Number(rows[0].id) } : null;
}

export async function createUser(
  username: string,
  email: string,
  passwordHash: string
): Promise<DbUser> {
  const rows = await sql`
    INSERT INTO users (username, email, password_hash)
    VALUES (${username}, ${email}, ${passwordHash})
    RETURNING *
  `;
  return mapUser(rows[0]);
}

export async function updateLastLogin(id: number): Promise<void> {
  await sql`UPDATE users SET last_login = now() WHERE id = ${id}`;
}

export async function updateAvatar(id: number, avatar: string): Promise<void> {
  await sql`UPDATE users SET avatar = ${avatar} WHERE id = ${id}`;
}

export async function updatePassword(id: number, passwordHash: string): Promise<void> {
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
}

export async function getBalance(id: number): Promise<number | null> {
  const rows = await sql`SELECT balance FROM users WHERE id = ${id}`;
  return rows[0] ? Number(rows[0].balance) : null;
}

/** Atomic balance adjustment. Returns the new balance. */
export async function adjustBalance(id: number, deltaCents: number): Promise<number> {
  const rows = await sql`
    UPDATE users SET balance = balance + ${deltaCents} WHERE id = ${id}
    RETURNING balance
  `;
  return Number(rows[0].balance);
}

// ── Leaderboard / platform queries ───────────────────────────────────────────

export interface LeaderboardEntry {
  id: number;
  username: string;
  avatar: string;
  balance: number;
  hands_played: number;
  biggest_win: number;
}

/** Top players ranked by balance (their standings on the public leaderboard). */
export async function getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const rows = await sql`
    SELECT id, username, avatar, balance, hands_played, biggest_win
    FROM users
    ORDER BY balance DESC, hands_played DESC, id ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    username: r.username as string,
    avatar: r.avatar as string,
    balance: Number(r.balance),
    hands_played: Number(r.hands_played),
    biggest_win: Number(r.biggest_win),
  }));
}

export interface PlatformStats {
  totalPlayers: number;
  totalTransactions: number;
  totalHandsPlayed: number;
  totalChipsInPlay: number;
}

/** Aggregate platform-wide figures shown above the leaderboard. */
export async function getPlatformStats(): Promise<PlatformStats> {
  const [userRows, txRows] = await Promise.all([
    sql`
      SELECT
        count(*)                        AS players,
        COALESCE(SUM(hands_played), 0)  AS hands,
        COALESCE(SUM(balance), 0)       AS chips
      FROM users
    `,
    sql`SELECT count(*) AS transactions FROM transactions`,
  ]);
  return {
    totalPlayers: Number(userRows[0].players),
    totalTransactions: Number(txRows[0].transactions),
    totalHandsPlayed: Number(userRows[0].hands),
    totalChipsInPlay: Number(userRows[0].chips),
  };
}

// ── Transaction queries ──────────────────────────────────────────────────────

export interface NewTransaction {
  user_id: number;
  type: string;
  coin?: string;
  amount_usd: number;
  amount_crypto?: string;
  address?: string;
  status?: string;
  tx_hash?: string;
}

export async function insertTransaction(t: NewTransaction): Promise<Transaction> {
  const rows = await sql`
    INSERT INTO transactions
      (user_id, type, coin, amount_usd, amount_crypto, address, status, tx_hash)
    VALUES (
      ${t.user_id}, ${t.type}, ${t.coin ?? "USD"}, ${t.amount_usd},
      ${t.amount_crypto ?? "0"}, ${t.address ?? ""}, ${t.status ?? "pending"},
      ${t.tx_hash ?? ""}
    )
    RETURNING *
  `;
  return mapTx(rows[0]);
}

export type TransactionFilter = "all" | "deposits" | "withdrawals" | "game";

export async function getTransactions(
  userId: number,
  filter: TransactionFilter
): Promise<Transaction[]> {
  let rows: postgres.RowList<postgres.Row[]>;
  if (filter === "deposits") {
    rows = await sql`
      SELECT * FROM transactions WHERE user_id = ${userId} AND type = 'deposit'
      ORDER BY created_at DESC LIMIT 100`;
  } else if (filter === "withdrawals") {
    rows = await sql`
      SELECT * FROM transactions WHERE user_id = ${userId} AND type = 'withdraw'
      ORDER BY created_at DESC LIMIT 100`;
  } else if (filter === "game") {
    rows = await sql`
      SELECT * FROM transactions WHERE user_id = ${userId}
      AND type IN ('win','loss','buyin','cashout')
      ORDER BY created_at DESC LIMIT 100`;
  } else {
    rows = await sql`
      SELECT * FROM transactions WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 100`;
  }
  return rows.map(mapTx);
}

export async function getTransactionSummary(
  userId: number
): Promise<TransactionSummary> {
  const rows = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'deposit' AND status = 'completed' THEN amount_usd ELSE 0 END), 0) AS "totalDeposited",
      COALESCE(SUM(CASE WHEN type = 'withdraw' AND status != 'failed'  THEN amount_usd ELSE 0 END), 0) AS "totalWithdrawn",
      COALESCE(SUM(CASE WHEN type = 'win'  THEN amount_usd ELSE 0 END), 0) AS "totalWon",
      COALESCE(SUM(CASE WHEN type = 'loss' THEN amount_usd ELSE 0 END), 0) AS "totalLost"
    FROM transactions WHERE user_id = ${userId}
  `;
  const r = rows[0];
  return {
    totalDeposited: Number(r.totalDeposited),
    totalWithdrawn: Number(r.totalWithdrawn),
    totalWon: Number(r.totalWon),
    totalLost: Number(r.totalLost),
  };
}
