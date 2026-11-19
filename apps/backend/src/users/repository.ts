import type { Knex } from 'knex';
import type { Role } from '@sim/domain';
import type { Language } from '@sim/i18n';
import type { Db } from '../db.js';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  ui_language: Language | null;
  active: number | boolean;
  must_change_password: number | boolean;
  created_at: Date;
  updated_at: Date;
}

/** API representation – never includes the password hash. */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  uiLanguage: Language | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    uiLanguage: row.ui_language,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

type Executor = Db | Knex.Transaction;

export function findUserById(db: Executor, id: number): Promise<UserRow | undefined> {
  return db<UserRow>('app_user').where({ id }).first();
}

export function findUserByUsername(db: Executor, username: string): Promise<UserRow | undefined> {
  return db<UserRow>('app_user').where({ username }).first();
}

export function listUsers(db: Executor): Promise<UserRow[]> {
  return db<UserRow>('app_user').orderBy([
    { column: 'active', order: 'desc' },
    { column: 'username', order: 'asc' },
  ]);
}

export interface NewUser {
  username: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  uiLanguage: Language | null;
  mustChangePassword: boolean;
}

export async function insertUser(db: Executor, user: NewUser): Promise<number> {
  const [id] = await db('app_user').insert({
    username: user.username,
    display_name: user.displayName,
    password_hash: user.passwordHash,
    role: user.role,
    ui_language: user.uiLanguage,
    must_change_password: user.mustChangePassword,
  });
  return id as number;
}

export interface UserChanges {
  displayName?: string;
  role?: Role;
  uiLanguage?: Language | null;
  active?: boolean;
  passwordHash?: string;
  mustChangePassword?: boolean;
}

export async function updateUser(db: Executor, id: number, changes: UserChanges): Promise<void> {
  const row: Partial<Record<keyof UserRow, unknown>> = { updated_at: new Date() };
  if (changes.displayName !== undefined) row.display_name = changes.displayName;
  if (changes.role !== undefined) row.role = changes.role;
  if (changes.uiLanguage !== undefined) row.ui_language = changes.uiLanguage;
  if (changes.active !== undefined) row.active = changes.active;
  if (changes.passwordHash !== undefined) row.password_hash = changes.passwordHash;
  if (changes.mustChangePassword !== undefined) {
    row.must_change_password = changes.mustChangePassword;
  }
  await db('app_user').where({ id }).update(row);
}

/** Locks and returns the ids of all active admins (FR-AUTH-04 last-admin rule). */
export async function lockActiveAdminIds(trx: Knex.Transaction): Promise<number[]> {
  const rows = await trx<UserRow>('app_user')
    .select('id')
    .where({ role: 'ADMIN', active: true })
    .forUpdate();
  return rows.map((r) => r.id);
}

export async function countUsers(db: Executor): Promise<number> {
  const row = await db('app_user').count<{ n: number | string }[]>({ n: '*' }).first();
  return Number(row?.n ?? 0);
}

/** MariaDB duplicate key error (unique username). */
export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}
