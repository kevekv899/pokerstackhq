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

  constructor(private readonly durationMs: number = ACTION_TIMEOUT_MS) {}

  /** Arms the clock for `key`. Does nothing if it is already running for it. */
  arm(key: string, onExpire: () => void): void {
    if (this.key === key && this.timer !== null) return;
    this.clear();
    this.key = key;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.key = null;
      onExpire();
    }, this.durationMs);
    // Never hold the process open just because someone is on the clock.
    this.timer.unref?.();
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.key = null;
  }

  get armedFor(): string | null {
    return this.key;
  }
}
