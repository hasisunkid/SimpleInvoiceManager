import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { SESSION_COOKIE } from './auth/guard.js';

/** Requests per client and minute on /api and /mcp – far above normal use (NFR-SEC-01). */
export const API_REQUESTS_PER_MINUTE = 600;

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Who a request is counted for: the login session, else the API token, else the IP address.
 * Behind Home Assistant Ingress every user arrives from the same proxy address, so counting by
 * IP alone would let one busy user slow down everybody. Secrets are hashed, never kept as keys.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const session = request.cookies?.[SESSION_COOKIE];
  if (session) return `session:${hash(session)}`;
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
  if (bearer) return `token:${hash(bearer)}`;
  return `ip:${request.ip}`;
}

/**
 * Defense in depth against floods and runaway clients (e.g. a looping script or assistant):
 * a general per-client limit for every API and MCP route, on top of the stricter login
 * (FR-AUTH-06) and per-token MCP (NFR-MCP-01) limits. Static files are not counted. State is in
 * memory (single container; resets on restart – see docs/security.md).
 */
export async function registerRateLimit(
  app: FastifyInstance,
  max: number = API_REQUESTS_PER_MINUTE,
): Promise<void> {
  await app.register(fastifyRateLimit, {
    global: true,
    max,
    timeWindow: 60_000,
    keyGenerator: rateLimitKey,
    allowList: (request) => !/^\/(api\/|mcp(?:[/?]|$))/.test(request.url),
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many requests – retry in ${context.after}`), {
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
      }),
  });
}
