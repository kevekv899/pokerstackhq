/**
 * Per-player action timer.
 *
 * The room arms this whenever someone is on the clock and clears it on every
 * valid action and on disconnect. The `key` identifies *which* decision is
 * being timed — re-arming with the same key is a no-op, so a broadcast that
 * does not change whose turn it is will not hand the player a fresh 20s.
 */

export const ACTION_TIMEOUT_MS = 20_000;

export class ActionClock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;
  private expiresAt: number | null = null;

  constructor(private readonly durationMs: number = ACTION_TIMEOUT_MS) {}

  /** Arms the clock for `key`. Does nothing if it is already running for it. */
  arm(key: string, onExpire: () => void): void {
    if (this.key === key && this.timer !== null) return;
    this.clear();
    this.key = key;
    this.expiresAt = Date.now() + this.durationMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.key = null;
      this.expiresAt = null;
      onExpire();
    }, this.durationMs);
    // Never hold the process open just because someone is on the clock.
    this.timer.unref?.();
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.key = null;
    this.expiresAt = null;
  }

  get armedFor(): string | null {
    return this.key;
  }

  /**
   * When the armed decision expires, as a server epoch timestamp, or null when
   * nobody is on the clock. Clients render their countdown from this rather
   * than starting a timer of their own, so a reconnect picks the clock up
   * where it actually is instead of restarting it.
   */
  get deadline(): number | null {
    return this.timer === null ? null : this.expiresAt;
  }

  /** How long a fresh decision gets. Lets a client size its countdown ring. */
  get timeoutMs(): number {
    return this.durationMs;
  }
}
