import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  checkPassword,
  isValidUsername,
  normalizeUsername,
} from '../src/index.js';

describe('checkPassword (FR-AUTH-06)', () => {
  it('requires at least 10 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(checkPassword('123456789')).toBe('TOO_SHORT');
    expect(checkPassword('1234567890')).toBeNull();
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(checkPassword('🔒'.repeat(9))).toBe('TOO_SHORT');
    expect(checkPassword('Góralewicz')).toBeNull();
  });

  it('rejects overly long passwords', () => {
    expect(checkPassword('x'.repeat(257))).toBe('TOO_LONG');
    expect(checkPassword('x'.repeat(256))).toBeNull();
  });
});

describe('usernames', () => {
  it('normalizes to trimmed lowercase', () => {
    expect(normalizeUsername('  Enrico.B ')).toBe('enrico.b');
  });

  it.each(['admin', 'anna-maria', 'jan_k', 'a.b', 'u12'])('accepts %s', (name) => {
    expect(isValidUsername(name)).toBe(true);
  });

  it.each(['ab', 'Admin', 'with space', 'łukasz', 'x'.repeat(33), ''])('rejects %s', (name) => {
    expect(isValidUsername(name)).toBe(false);
  });
});
