import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { buildMcpServer } from './server.js';
import { authenticateToken } from './tokens.js';

/** NFR-MCP-01: tool calls per token and minute. */
export const MCP_CALLS_PER_MINUTE = 60;
/** NFR-MCP-01: request size limit (an invoice with 200 long positions fits easily). */
const MCP_BODY_LIMIT = 256 * 1024;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The MCP endpoint: authenticated by API token, not by session (FR-MCP-03). */
    mcp?: boolean;
  }
}

/** Fixed one-minute windows per token – small and enough for one household's assistants. */
export function createTokenRateLimiter(limit = MCP_CALLS_PER_MINUTE, windowMs = 60_000) {
  const windows = new Map<number, { start: number; count: number }>();
  return {
    /** Seconds to wait, or 0 if the call is allowed (and counted). */
    hit(tokenId: number, now = Date.now()): number {
      const w = windows.get(tokenId);
      if (!w || now - w.start >= windowMs) {
        windows.set(tokenId, { start: now, count: 1 });
        if (windows.size > 10_000) windows.clear();
        return 0;
      }
      if (w.count >= limit) return Math.ceil((w.start + windowMs - now) / 1000);
      w.count++;
      return 0;
    },
  };
}

function rpcError(reply: FastifyReply, status: number, code: number, message: string) {
  return reply.code(status).send({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/** Address for links in tool results: PUBLIC_URL, else the address this request came in on. */
function baseUrl(config: Config, request: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl;
  return `${request.protocol}://${request.host}/`;
}

/**
 * FR-MCP-01, -03, -12: the MCP server at `/mcp` – Streamable HTTP, stateless (a fresh server
 * per request, no sessions to keep in memory). Only bearer API tokens are accepted; cookies are
 * ignored, and API tokens are not accepted anywhere else (the /api guard reads cookies only).
 * Registered only when MCP is enabled (app option `mcp_enabled`).
 */
export async function registerMcp(
  app: FastifyInstance,
  {
    db,
    config,
    rateLimiter = createTokenRateLimiter(),
  }: {
    db: Db;
    config: Config;
    rateLimiter?: ReturnType<typeof createTokenRateLimiter>;
  },
): Promise<void> {
  app.post(
    '/mcp',
    { config: { mcp: true }, bodyLimit: MCP_BODY_LIMIT, schema: { hide: true } },
    async (request, reply) => {
      const header = request.headers.authorization ?? '';
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const auth = match ? await authenticateToken(db, match[1]!) : null;
      if (!auth) {
        reply.header('WWW-Authenticate', 'Bearer realm="SimpleInvoice Manager"');
        return rpcError(reply, 401, -32001, 'A valid API token is required (Profil → KI-Zugänge)');
      }
      const wait = rateLimiter.hit(auth.token.id);
      if (wait > 0) {
        reply.header('Retry-After', String(wait));
        return rpcError(reply, 429, -32002, `Too many requests – retry in ${wait} s`);
      }

      const server = buildMcpServer({
        db,
        user: auth.user,
        token: auth.token,
        baseUrl: baseUrl(config, request),
        version: config.version,
        log: request.log,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.hijack();
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (err) {
        request.log.error({ err }, 'mcp request failed');
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
          reply.raw.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal error' },
              id: null,
            }),
          );
        }
      }
    },
  );

  // Stateless server: no server-sent event stream and no sessions to end.
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({
      method,
      url: '/mcp',
      config: { mcp: true },
      schema: { hide: true },
      handler: async (_request, reply) => {
        reply.header('Allow', 'POST');
        return rpcError(reply, 405, -32000, 'Method not allowed – use POST');
      },
    });
  }
}
