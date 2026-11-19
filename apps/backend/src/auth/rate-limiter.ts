/**
 * In-memory login throttling (FR-AUTH-06): after `maxFailures` failed logins for a key
 * within `windowMs`, the key is locked for `lockMs`.
 *
 * Keys are tracked per username and per client IP with separate thresholds (see ADR 0005):
 * behind Home Assistant Ingress many users may share one proxy IP, so the IP limit is higher.
 * State is per process and resets on restart – acceptable for a single-container app.
 */
export interface RateLimitRule {
  readonly maxFailures: number;
  readonly lockMs: number;
  readonly windowMs: number;
}

interface Entry {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const MAX_ENTRIES = 10_000;

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly rules: Readonly<Record<string, RateLimitRule>>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns the remaining lock time in ms for the most restrictive key, or 0. */
  retryAfterMs(keys: Readonly<Record<string, string>>): number {
    const now = this.now();
    let wait = 0;
    for (const [kind, value] of Object.entries(keys)) {
      const entry = this.entries.get(`${kind}:${value}`);
      if (entry && entry.lockedUntil > now) wait = Math.max(wait, entry.lockedUntil - now);
    }
    return wait;
  }

  recordFailure(keys: Readonly<Record<string, string>>): void {
    const now = this.now();
    for (const [kind, value] of Object.entries(keys)) {
      const rule = this.rules[kind];
      if (!rule) continue;
      const id = `${kind}:${value}`;
      let entry = this.entries.get(id);
      // While locked, further failures neither count nor extend the lock.
      if (entry && entry.lockedUntil > now) continue;
      // Start a fresh window after an expired lock or when the window has passed.
      if (!entry || entry.lockedUntil !== 0 || now - entry.firstFailureAt > rule.windowMs) {
        entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
        this.entries.set(id, entry);
      }
      entry.failures += 1;
      if (entry.failures >= rule.maxFailures) entry.lockedUntil = now + rule.lockMs;
    }
    this.prune(now);
  }

  recordSuccess(keys: Readonly<Record<string, string>>): void {
    // Only the username counter is cleared: a success must not unlock a shared IP.
    if (keys.username !== undefined) this.entries.delete(`username:${keys.username}`);
  }

  private prune(now: number): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    for (const [id, entry] of this.entries) {
      if (entry.lockedUntil < now) this.entries.delete(id);
      if (this.entries.size <= MAX_ENTRIES / 2) break;
    }
  }
}

export function createLoginRateLimiter(now?: () => number): LoginRateLimiter {
  return new LoginRateLimiter(
    {
      username: { maxFailures: 5, lockMs: 60_000, windowMs: 15 * 60_000 },
      ip: { maxFailures: 20, lockMs: 60_000, windowMs: 15 * 60_000 },
    },
    now,
  );
}
