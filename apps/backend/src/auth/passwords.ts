import { hash, verify } from '@node-rs/argon2';

/**
 * FR-AUTH-06: argon2id with the library defaults (m = 19 MiB, t = 2, p = 1 – the OWASP
 * recommendation), which is cheap enough for a Raspberry Pi.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real verification, so a login for an unknown username cannot
 * be told apart from a wrong password by response time.
 */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hash('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
  return false;
}
