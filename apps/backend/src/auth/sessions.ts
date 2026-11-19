import { createHmac, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { findUserById, type UserRow } from '../users/repository.js';

/** FR-AUTH-07: 30 days with "stay logged in" (phone use), otherwise 12 hours. */
export const PERSISTENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

/** last_seen_at is refreshed at most this often to avoid a DB write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionRow {
  id: string;
  user_id: number;
  csrf_token: string;
  persistent: number | boolean;
  expires_at: Date;
  last_seen_at: Date;
}

export interface CreatedSession {
  readonly token: string;
  readonly id: string;
  readonly csrfToken: string;
  readonly persistent: boolean;
  readonly expiresAt: Date;
}

export interface ActiveSession {
  readonly session: SessionRow;
  readonly user: UserRow;
}

export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  /** Session ids in the DB are HMACs of the cookie token. */
  private idFor(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  async create(userId: number, persistent: boolean): Promise<CreatedSession> {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const id = this.idFor(token);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (persistent ? PERSISTENT_SESSION_MS : SHORT_SESSION_MS),
    );
    await this.db('session').insert({
      id,
      user_id: userId,
      csrf_token: csrfToken,
      persistent,
      expires_at: expiresAt,
      created_at: now,
      last_seen_at: now,
    });
    return { token, id, csrfToken, persistent, expiresAt };
  }

  /** Finds a valid session of an active user, or null. */
  async find(token: string): Promise<ActiveSession | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const id = this.idFor(token);
    const session = await this.db<SessionRow>('session')
      .where('id', id)
      .andWhere('expires_at', '>', new Date())
      .first();
    if (!session) return null;
    const user = await findUserById(this.db, session.user_id);
    if (!user || !user.active) return null;

    if (Date.now() - session.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await this.db('session').where('id', id).update({ last_seen_at: new Date() });
    }
    return { session, user };
  }

  async deleteById(id: string): Promise<void> {
    await this.db('session').where('id', id).delete();
  }

  /** Ends all sessions of a user, optionally keeping one (e.g. the current one). */
  async deleteForUser(userId: number, exceptId?: string): Promise<void> {
    const query = this.db('session').where('user_id', userId);
    if (exceptId) query.andWhereNot('id', exceptId);
    await query.delete();
  }

  async purgeExpired(): Promise<number> {
    return this.db('session').where('expires_at', '<=', new Date()).delete();
  }
}
