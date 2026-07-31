// One-time migration: create the Supabase PostgreSQL schema.
//
// Run with the DATABASE_URL passed in the environment, e.g.:
//   DATABASE_URL='postgresql://...:PASSWORD@...pooler.supabase.com:6543/postgres' node scripts/migrate.mjs
//
// (Use single quotes so the shell does not expand `$` in the password.)

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function main() {
  console.log("Connecting to Supabase PostgreSQL…");

  // citext gives case-insensitive username/email uniqueness, matching the
  // SQLite COLLATE NOCASE behaviour.
  await sql`CREATE EXTENSION IF NOT EXISTS citext`;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      username      citext NOT NULL UNIQUE,
      email         citext NOT NULL UNIQUE,
      password_hash text   NOT NULL,
      balance       bigint NOT NULL DEFAULT 100000,
      avatar        text   NOT NULL DEFAULT '😎',
      hands_played  int    NOT NULL DEFAULT 0,
      biggest_win   bigint NOT NULL DEFAULT 0,
      created_at    timestamptz NOT NULL DEFAULT now(),
      last_login    timestamptz
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id       int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type          text NOT NULL,
      coin          text NOT NULL DEFAULT 'USD',
      amount_usd    bigint NOT NULL,
      amount_crypto text NOT NULL DEFAULT '0',
      address       text NOT NULL DEFAULT '',
      status        text NOT NULL DEFAULT 'pending',
      tx_hash       text NOT NULL DEFAULT '',
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_created
    ON transactions (user_id, created_at DESC)
  `;

  // Enable RLS with NO policies. Our app connects with the privileged `postgres`
  // role (which bypasses RLS), but the public anon/authenticated PostgREST API
  // gets zero access — so password_hash and balances are never exposed there.
  await sql`ALTER TABLE users        ENABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE transactions ENABLE ROW LEVEL SECURITY`;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('users','sessions','transactions')
  `;
  console.log(`✔ Migration complete — ${count}/3 tables present.`);

  await sql.end();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await sql.end().catch(() => {});
  process.exit(1);
});
