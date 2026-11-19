/**
 * Account rules shared by backend validation and frontend forms (FR-AUTH-01..06).
 */

export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** FR-AUTH-06: minimum password length. */
export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound protects the hash function from oversized input. */
export const MAX_PASSWORD_LENGTH = 256;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG';

export function checkPassword(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) return 'TOO_SHORT';
  if (length > MAX_PASSWORD_LENGTH) return 'TOO_LONG';
  return null;
}

/** Usernames: 3–32 characters, lowercase letters, digits, ".", "_" and "-". */
export const USERNAME_PATTERN = '^[a-z0-9._-]{3,32}$';
const USERNAME_REGEX = new RegExp(USERNAME_PATTERN);

/** Usernames are case-insensitive; they are stored and compared in lowercase. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}
