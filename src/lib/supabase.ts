import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client setup.
 *
 * The application's data-access layer (see `src/lib/db.ts`) talks to Supabase's
 * PostgreSQL directly over the connection pooler, which lets us keep the exact
 * SQL semantics the money logic relies on (atomic `balance = balance + n`
 * updates and aggregate transaction summaries).
 *
 * This module exposes the `@supabase/supabase-js` client for everything else
 * that benefits from it (Auth, Storage, Realtime, or future PostgREST access).
 *
 * - `supabase`       — anon/publishable client, safe for the browser.
 * - `supabaseAdmin`  — service-role (secret) client, SERVER ONLY. It bypasses
 *                      Row Level Security, so never import it into client code.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

/** Server-only admin client. Guarded so it can't be constructed in the browser. */
export function getSupabaseAdmin() {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin must only be used on the server.");
  }
  const secret = process.env.SUPABASE_SECRET_KEY!;
  return createClient(SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
