import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CreatedSession, SessionRow, SessionStore } from './sessions.js';
import type { UserRow } from '../users/repository.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route is reachable without a session (login, health, …). Default: false. */
    public?: boolean;
    /** Route requires the ADMIN role (FR-AUTH-02). */
    admin?: boolean;
    /** Route stays reachable while the user must change the password (FR-AUTH-03/04). */
    allowPendingPasswordChange?: boolean;
  }
  interface FastifyRequest {
    auth: { session: SessionRow; user: UserRow } | null;
  }
}

export const SESSION_COOKIE = 'sim_session';
export const CSRF_HEADER = 'x-csrf-token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Cookie path follows the ingress base path so the cookie is scoped to this app (AR-13). */
function cookiePath(request: FastifyRequest): string {
  return `${request.basePath}/`;
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  session: CreatedSession,
): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.protocol === 'https',
    path: cookiePath(request),
    // Persistent sessions survive closing the browser; short ones are session cookies.
    ...(session.persistent
      ? { maxAge: Math.floor((session.expiresAt.getTime() - Date.now()) / 1000) }
      : {}),
  });
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.protocol === 'https',
    path: cookiePath(request),
  });
}

/**
 * Authentication, CSRF protection and authorization for every route of the given scope
 * (FR-AUTH-02, FR-AUTH-07, NFR-SEC-01). Default-deny: routes must opt out via `config.public`.
 *
 * CSRF: state-changing requests must carry the X-CSRF-Token header. With a session it must
 * equal the session's token; without one (login) any value is accepted – a custom header
 * cannot be sent cross-site without a CORS preflight, which this API never grants.
 */
export function registerAuthGuard(api: FastifyInstance, sessions: SessionStore): void {
  api.decorateRequest('auth', null);

  api.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await sessions.find(token) : null;

    if (UNSAFE_METHODS.has(request.method)) {
      const header = request.headers[CSRF_HEADER];
      const valid =
        typeof header === 'string' &&
        header.length > 0 &&
        (request.auth === null || safeEqual(header, request.auth.session.csrf_token));
      if (!valid) {
        return reply
          .code(403)
          .send({ error: 'CSRF_FAILED', message: 'Missing or invalid CSRF token' });
      }
    }

    const config = request.routeOptions.config;
    if (config.public) return;

    if (!request.auth) {
      return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Please log in' });
    }
    if (request.auth.user.must_change_password && !config.allowPendingPasswordChange) {
      return reply
        .code(403)
        .send({ error: 'PASSWORD_CHANGE_REQUIRED', message: 'Password must be changed first' });
    }
    if (config.admin && request.auth.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Administrator role required' });
    }
  });
}

/** Narrowing helper for handlers of non-public routes – the guard guarantees `auth`. */
export function currentAuth(request: FastifyRequest): { session: SessionRow; user: UserRow } {
  if (!request.auth) throw new Error('route is not protected by the auth guard');
  return request.auth;
}
