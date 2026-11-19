import { randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { hashPassword } from '../auth/passwords.js';
import { countUsers, insertUser } from './repository.js';

export const INITIAL_ADMIN_USERNAME = 'admin';

export type BootstrapResult =
  | { readonly created: false }
  | { readonly created: true; readonly generatedPassword: string | undefined };

/**
 * FR-AUTH-03: on first start with an empty user table, create `admin` with
 * INITIAL_ADMIN_PASSWORD or a random password (returned so the caller can log it once).
 * The admin must change the password at first login.
 */
export async function ensureInitialAdmin(
  db: Db,
  initialPassword: string | undefined,
): Promise<BootstrapResult> {
  return db.transaction(async (trx) => {
    if ((await countUsers(trx)) > 0) return { created: false } as const;
    const generatedPassword = initialPassword ? undefined : randomBytes(12).toString('base64url');
    await insertUser(trx, {
      username: INITIAL_ADMIN_USERNAME,
      displayName: 'Administrator',
      passwordHash: await hashPassword(initialPassword ?? (generatedPassword as string)),
      role: 'ADMIN',
      uiLanguage: null,
      mustChangePassword: true,
    });
    return { created: true, generatedPassword } as const;
  });
}
