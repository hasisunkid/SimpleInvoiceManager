import { describe, expect, it } from 'vitest';
import { createLoginRateLimiter } from '../src/auth/rate-limiter.js';

function setup() {
  let now = 1_000_000;
  const limiter = createLoginRateLimiter(() => now);
  return { limiter, advance: (ms: number) => (now += ms) };
}

const keys = { username: 'anna', ip: '10.0.0.1' };

describe('LoginRateLimiter (FR-AUTH-06)', () => {
  it('locks a username for 1 minute after 5 failures', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 4; i++) limiter.recordFailure(keys);
    expect(limiter.retryAfterMs(keys)).toBe(0);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterMs(keys)).toBe(60_000);
    advance(30_000);
    expect(limiter.retryAfterMs(keys)).toBe(30_000);
    advance(30_000);
    expect(limiter.retryAfterMs(keys)).toBe(0);
  });

  it('does not extend the lock with failures while locked', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure(keys);
    advance(50_000);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterMs(keys)).toBe(10_000);
  });

  it('starts counting again after the lock expired', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure(keys);
    advance(60_001);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterMs(keys)).toBe(0);
  });

  it('forgets failures outside the 15 minute window', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 4; i++) limiter.recordFailure(keys);
    advance(15 * 60_000 + 1);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterMs(keys)).toBe(0);
  });

  it('a successful login resets the username counter', () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.recordFailure(keys);
    limiter.recordSuccess(keys);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterMs(keys)).toBe(0);
  });

  it('locks a shared IP only after 20 failures across usernames', () => {
    const { limiter } = setup();
    for (let i = 0; i < 19; i++) limiter.recordFailure({ username: `u${i}`, ip: '10.0.0.9' });
    expect(limiter.retryAfterMs({ username: 'other', ip: '10.0.0.9' })).toBe(0);
    limiter.recordFailure({ username: 'u19', ip: '10.0.0.9' });
    expect(limiter.retryAfterMs({ username: 'other', ip: '10.0.0.9' })).toBe(60_000);
  });

  it('keeps users independent', () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure({ username: 'anna', ip: '1.1.1.1' });
    expect(limiter.retryAfterMs({ username: 'jan', ip: '2.2.2.2' })).toBe(0);
  });
});
