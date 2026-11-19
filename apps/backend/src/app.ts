import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Path under which the browser reaches the app: the Home Assistant ingress path
     * (X-Ingress-Path header, AR-13) or "" for direct access. Used e.g. for cookie paths.
     */
    basePath: string;
  }
}

export interface AppDeps {
  readonly config: Config;
  readonly db: Db;
  readonly logger?: FastifyServerOptions['logger'];
}

/** Accepts only a plain absolute path from the ingress header – never a URL. */
export function sanitizeIngressPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\/[A-Za-z0-9/_.-]*$/.test(value) || value.includes('..')) return '';
  return value.replace(/\/+$/, '');
}

export async function buildApp({ config, db, logger = false }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: true }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorateRequest('basePath', '');
  app.addHook('onRequest', async (request) => {
    request.basePath = sanitizeIngressPath(request.headers['x-ingress-path']);
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'SimpleInvoice Manager API', version: '0.1.0' },
    },
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db });
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: '/api' },
  );

  if (existsSync(config.frontendDir)) {
    await app.register(fastifyStatic, {
      root: config.frontendDir,
      wildcard: false,
      index: ['index.html'],
      // Hashed assets may be cached forever; index.html must always be revalidated.
      setHeaders(reply, filePath) {
        reply.header(
          'Cache-Control',
          filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
  } else {
    app.log.warn({ frontendDir: config.frontendDir }, 'frontend build not found – API only');
  }

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send({ error: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` });
  });

  return app;
}
