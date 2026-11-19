import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { normalizeUsername } from '@sim/domain';
import type { Db } from '../db.js';
import { verifyDummy, verifyPassword } from '../auth/passwords.js';
import type { LoginRateLimiter } from '../auth/rate-limiter.js';
import type { SessionStore } from '../auth/sessions.js';
import { clearSessionCookie, setSessionCookie } from '../auth/guard.js';
import { findUserByUsername, toPublicUser } from '../users/repository.js';
import { PublicUserSchema, errorResponses } from '../schemas.js';

export interface AuthRoutesOptions {
  db: Db;
  sessions: SessionStore;
  rateLimiter: LoginRateLimiter;
}

const SessionInfo = Type.Object({
  user: Type.Union([PublicUserSchema, Type.Null()]),
  csrfToken: Type.Union([Type.String(), Type.Null()]),
});

/** FR-AUTH-01, -03, -06, -07: login, logout, current session. */
export const authRoutes: FastifyPluginAsyncTypebox<AuthRoutesOptions> = async (
  app,
  { db, sessions, rateLimiter },
) => {
  app.post(
    '/auth/login',
    {
      config: { public: true },
      schema: {
        summary: 'Log in with username and password',
        tags: ['auth'],
        body: Type.Object({
          username: Type.String({ minLength: 1, maxLength: 64 }),
          password: Type.String({ minLength: 1, maxLength: 256 }),
          stayLoggedIn: Type.Boolean({ default: false }),
        }),
        response: { 200: SessionInfo, ...errorResponses(400, 401, 403, 429) },
      },
    },
    async (request, reply) => {
      const username = normalizeUsername(request.body.username);
      const keys = { username, ip: request.ip };

      const waitMs = rateLimiter.retryAfterMs(keys);
      if (waitMs > 0) {
        const retryAfterSeconds = Math.ceil(waitMs / 1000);
        reply.header('Retry-After', String(retryAfterSeconds));
        return reply.code(429).send({
          error: 'TOO_MANY_ATTEMPTS',
          message: 'Too many failed logins, please wait',
          retryAfterSeconds,
        });
      }

      const user = await findUserByUsername(db, username);
      const ok =
        user && user.active
          ? await verifyPassword(user.password_hash, request.body.password)
          : await verifyDummy(request.body.password);
      if (!user || !ok) {
        rateLimiter.recordFailure(keys);
        request.log.info({ username }, 'login failed');
        return reply
          .code(401)
          .send({ error: 'INVALID_CREDENTIALS', message: 'Username or password is wrong' });
      }

      rateLimiter.recordSuccess(keys);
      // New session on every login (prevents session fixation); drop the previous one.
      if (request.auth) await sessions.deleteById(request.auth.session.id);
      await sessions.purgeExpired();
      const session = await sessions.create(user.id, request.body.stayLoggedIn);
      setSessionCookie(request, reply, session);
      request.log.info({ userId: user.id }, 'login');
      return { user: toPublicUser(user), csrfToken: session.csrfToken };
    },
  );

  app.post(
    '/auth/logout',
    {
      config: { public: true },
      schema: {
        summary: 'Log out',
        tags: ['auth'],
        response: { 204: Type.Null(), ...errorResponses(403) },
      },
    },
    async (request, reply) => {
      if (request.auth) await sessions.deleteById(request.auth.session.id);
      clearSessionCookie(request, reply);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/auth/session',
    {
      config: { public: true },
      schema: {
        summary: 'Current user and CSRF token (user is null when not logged in)',
        tags: ['auth'],
        response: { 200: SessionInfo },
      },
    },
    async (request) => {
      if (!request.auth) return { user: null, csrfToken: null };
      return {
        user: toPublicUser(request.auth.user),
        csrfToken: request.auth.session.csrf_token,
      };
    },
  );
};
