import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/**
 * Minimal browser-like API client for integration tests: keeps the session cookie and the
 * CSRF token and sends them like the SPA does.
 */
export class TestClient {
  cookie: string | undefined;
  csrfToken: string | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly headers: Record<string, string> = {},
  ) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        ...this.headers,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== 'GET' ? { 'x-csrf-token': this.csrfToken ?? 'login' } : {}),
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const setCookie = res.cookies.find((c) => c.name === 'sim_session');
    if (setCookie) this.cookie = setCookie.value ? `sim_session=${setCookie.value}` : undefined;
    return res;
  }

  async login(username: string, password: string, stayLoggedIn = false) {
    const res = await this.request('POST', '/api/auth/login', {
      username,
      password,
      stayLoggedIn,
    });
    if (res.statusCode === 200) this.csrfToken = res.json().csrfToken;
    return res;
  }

  get(url: string) {
    return this.request('GET', url);
  }
  post(url: string, body?: unknown) {
    return this.request('POST', url, body ?? {});
  }
  put(url: string, body: unknown) {
    return this.request('PUT', url, body);
  }
  patch(url: string, body: unknown) {
    return this.request('PATCH', url, body);
  }
}
