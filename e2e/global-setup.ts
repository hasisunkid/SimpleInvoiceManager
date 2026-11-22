import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { E2E, appUrl } from './env';

const root = path.resolve(import.meta.dirname, '..');

function compose(...args: string[]): void {
  execFileSync('docker', ['compose', '-p', E2E.project, '-f', 'docker-compose.yml', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_PUBLISHED_PORT: String(E2E.appPort),
      DB_PUBLISHED_PORT: String(E2E.dbPort),
      INITIAL_ADMIN_PASSWORD: E2E.initialAdminPassword,
      SEED_DEMO: 'true',
      BUILD_VERSION: E2E.buildVersion,
      MCP_ENABLED: 'true',
      SESSION_SECRET: 'e2e-session-secret-0123456789-abcdefgh',
    },
  });
}

async function waitForHealth(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${appUrl}api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('App did not become healthy');
}

/** The admin must change the bootstrap password at first login (FR-AUTH-03) – do it once. */
async function prepareAdmin(): Promise<void> {
  const login = async (password: string) =>
    fetch(`${appUrl}api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'e2e' },
      body: JSON.stringify({ username: 'admin', password }),
    });
  if ((await login(E2E.adminPassword)).ok) return; // reused stack
  const res = await login(E2E.initialAdminPassword);
  if (!res.ok) throw new Error(`Admin login failed: ${res.status}`);
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const change = await fetch(`${appUrl}api/me/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, cookie },
    body: JSON.stringify({
      currentPassword: E2E.initialAdminPassword,
      newPassword: E2E.adminPassword,
    }),
  });
  if (!change.ok) throw new Error(`Password change failed: ${change.status}`);
}

/**
 * Minimal Home Assistant Ingress stand-in (AR-13): serves the app under a path prefix, strips
 * the prefix and sends X-Ingress-Path – absolute URLs in the app would hit a 404 here.
 */
function startIngressProxy(): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === E2E.ingressPath) {
      res.writeHead(302, { Location: `${E2E.ingressPath}/` }).end();
      return;
    }
    if (!url.startsWith(`${E2E.ingressPath}/`)) {
      res.writeHead(404).end('not under ingress path');
      return;
    }
    const upstream = http.request(
      {
        host: 'localhost',
        port: E2E.appPort,
        method: req.method,
        path: url.slice(E2E.ingressPath.length),
        headers: {
          ...req.headers,
          host: `localhost:${E2E.appPort}`,
          'x-ingress-path': E2E.ingressPath,
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.listen(E2E.ingressPort);
  return server;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const reuse = process.env.E2E_REUSE === '1';
  if (!reuse) {
    compose('down', '-v', '--remove-orphans');
    compose('up', '-d', '--build', '--wait');
  }
  await waitForHealth();
  await prepareAdmin();
  const proxy = startIngressProxy();

  return async () => {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (!reuse && process.env.E2E_KEEP !== '1') compose('down', '-v');
  };
}
