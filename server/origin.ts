/**
 * Origin filtering for the WebSocket upgrade.
 *
 * SECURITY: origin is a convenience filter, NOT the security boundary. Any
 * non-browser client can set whatever Origin header it likes. The Supabase
 * token check in `index.ts` is the real gate, and it runs unconditionally —
 * never skip or relax it based on what this predicate returned.
 */

/**
 * Native shells are hardcoded rather than read from ALLOWED_ORIGINS so a
 * misconfigured or truncated env var cannot silently lock the mobile apps out.
 */
const NATIVE_ORIGINS: ReadonlySet<string> = new Set([
  'capacitor://localhost', // iOS
  'http://localhost', // Android WebView (no port — the dev server is a different origin)
  'ionic://localhost',
]);

/** Parses the comma-separated ALLOWED_ORIGINS list (the Vercel web origin, etc). */
export function allowedWebOrigins(raw: string | undefined = process.env.ALLOWED_ORIGINS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

/**
 * Native WebSocket clients frequently omit the Origin header entirely, so a
 * missing origin is allowed through — the token check still has to pass.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  configured: Set<string> = allowedWebOrigins(),
): boolean {
  if (origin === undefined || origin === null || origin === '') return true;
  return NATIVE_ORIGINS.has(origin) || configured.has(origin);
}
