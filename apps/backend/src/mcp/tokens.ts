import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import type { UserRow } from '../users/repository.js';

/** The only scope in v1.1: create and change invoice drafts via MCP (FR-MCP-03). */
export const MCP_SCOPE = 'mcp:drafts';

/** Recognisable prefix, e.g. for secret scanners: `sim_…`. */
const TOKEN_PREFIX = 'sim_';

interface TokenRow {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface ApiToken {
  id: number;
  userId: number;
  userName: string;
  name: string;
  /** First characters of the token, so people can tell their tokens apart. */
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Usable right now: not revoked and not expired. */
  active: boolean;
}

/**
 * Tokens carry 256 random bits, so a plain SHA-256 is enough to store them (no password
 * stretching needed): a leaked database does not reveal usable tokens (FR-MCP-03).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toToken(row: TokenRow & { display_name?: string }, now = new Date()): ApiToken {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.display_name ?? '',
    name: row.name,
    prefix: row.token_prefix,
    scopes: row.scopes.split(' ').filter(Boolean),
    expiresAt: row.expires_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    active: !row.revoked_at && (!row.expires_at || row.expires_at > now),
  };
}

/** Creates a token; the plain value is returned only here – it is shown to the user once. */
export async function createToken(
  db: Db,
  userId: number,
  name: string,
  expiresAt: Date | null,
): Promise<{ id: number; token: string }> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [id] = await db('api_token').insert({
    user_id: userId,
    name,
    token_hash: hashToken(token),
    token_prefix: token.slice(0, 10),
    scopes: MCP_SCOPE,
    expires_at: expiresAt,
  });
  return { id: id as number, token };
}

/** Tokens of one user, or of everyone (admin overview) when `userId` is undefined. */
export async function listTokens(db: Db, userId?: number): Promise<ApiToken[]> {
  const rows = await db('api_token as t')
    .join('app_user as u', 'u.id', 't.user_id')
    .modify((q) => {
      if (userId !== undefined) q.where('t.user_id', userId);
    })
    // Active tokens first, newest first.
    .orderByRaw('t.revoked_at IS NOT NULL, t.id DESC')
    .select('t.*', 'u.display_name');
  return (rows as (TokenRow & { display_name: string })[]).map((r) => toToken(r));
}

export async function findToken(db: Db, id: number): Promise<ApiToken | undefined> {
  const row = await db('api_token as t')
    .join('app_user as u', 'u.id', 't.user_id')
    .where('t.id', id)
    .first('t.*', 'u.display_name');
  return row ? toToken(row as TokenRow & { display_name: string }) : undefined;
}

/** Revoking is final; the row stays so AI-created records keep their token name. */
export async function revokeToken(db: Db, id: number): Promise<void> {
  await db('api_token').where({ id }).whereNull('revoked_at').update({ revoked_at: new Date() });
}

export interface TokenAuth {
  token: ApiToken;
  user: UserRow;
}

/**
 * FR-MCP-03: the bearer token of an MCP request → token and user, or null when the token is
 * unknown, revoked, expired, lacks the scope, or its user is deactivated.
 */
export async function authenticateToken(db: Db, raw: string): Promise<TokenAuth | null> {
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 200) return null;
  const row = await db<TokenRow>('api_token')
    .where({ token_hash: hashToken(raw) })
    .first();
  if (!row) return null;
  const now = new Date();
  const token = toToken(row, now);
  if (!token.active || !token.scopes.includes(MCP_SCOPE)) return null;
  const user = await db<UserRow>('app_user').where({ id: row.user_id }).first();
  if (!user || !user.active) return null;
  // Remember the last use, at most once a minute (keeps writes low on a Raspberry Pi).
  if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() > 60_000) {
    await db('api_token').where({ id: row.id }).update({ last_used_at: now });
  }
  return { token: { ...token, userName: user.display_name }, user };
}
