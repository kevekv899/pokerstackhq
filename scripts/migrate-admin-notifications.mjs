// Additive migration: notifications, admin activity log, and user ban flag.
//
// Safe to re-run — every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
// Run with the DATABASE_URL passed in the environment, e.g.:
//   DATABASE_URL='postgresql://...' node scripts/migrate-admin-notifications.mjs
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

  // ── Notifications ──────────────────────────────────────────────────────────
  // `read` is an unreserved keyword in Postgres, so it needs no quoting.
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id    int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       text NOT NULL,
      message    text NOT NULL,
      read       boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // The bell polls "newest 10 for this user" and "unread count for this user"
  // every 30s, so both are served off this index.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id) WHERE read = false
  `;

  // ── Ban flag ───────────────────────────────────────────────────────────────
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false
  `;

  // ── Admin activity log ─────────────────────────────────────────────────────
  // Records operator actions (ban / unban / manual balance adjustment) so the
  // admin activity feed can show them alongside organic platform events.
  await sql`
    CREATE TABLE IF NOT EXISTS activity_log (
      id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id    int  REFERENCES users(id) ON DELETE SET NULL,
      action     text NOT NULL,
      detail     text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_activity_log_created
    ON activity_log (created_at DESC)
  `;

  // Same posture as the existing tables: RLS on with no policies, so the public
  // anon/authenticated PostgREST API gets zero access. The app connects as the
  // privileged `postgres` role, which bypasses RLS.
  await sql`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`;
  await sql`ALTER TABLE activity_log  ENABLE ROW LEVEL SECURITY`;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('notifications','activity_log')
  `;
  const [{ banned }] = await sql`
    SELECT count(*)::int AS banned FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'banned'
  `;
  console.log(`✔ Migration complete — ${count}/2 tables present, users.banned ${banned ? "present" : "MISSING"}.`);

  await sql.end();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await sql.end().catch(() => {});
  process.exit(1);
});
