/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are untyped JSON documents */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildApp } from '../src/app.js';
import { createTokenRateLimiter } from '../src/mcp/plugin.js';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';

/**
 * TR-MCP-01: an MCP client (official SDK) against the real backend and MariaDB – tool list,
 * the full "customer by name → draft with positions" flow, the lookup-or-create rule (D8),
 * price override, version conflicts, token scope/expiry/revocation and draft-only enforcement.
 */
let ctx: TestApp;
let base: string;
let token: string;
let ids: { omicron: number; goralewicz: number; illing: number; material: number; drywall: number };

const PUBLIC_URL = 'https://rechnungen.example.de/';

async function connect(bearer: string = token): Promise<Client> {
  const client = new Client({ name: 'sim-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
}

/** Calls a tool and parses its JSON result; fails the test on a tool error. */
async function call<T = Record<string, any>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (res.content[0] as { text: string }).text;
  if (res.isError) throw new Error(`tool error: ${text}`);
  return JSON.parse(text) as T;
}

/** Calls a tool that must fail; returns the error text. */
async function callError(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(res.isError, JSON.stringify(res.content)).toBe(true);
  return (res.content[0] as { text: string }).text;
}

async function newToken(client = ctx.user, name = 'Claude on laptop', expiresInDays = null) {
  const res = await client.post('/api/me/tokens', { name, expiresInDays });
  expect(res.statusCode).toBe(201);
  return res.json() as { token: string; item: { id: number } };
}

async function rawMcp(headers: Record<string, string>) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

beforeAll(async () => {
  ctx = await createTestApp('mcp', { mcpEnabled: true, publicUrl: PUBLIC_URL });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  await ctx.user.put('/api/company', COMPLETE_COMPANY);
  await ctx.admin.put('/api/settings/numbering', {
    prefix: '',
    minDigits: 0,
    nextValue: 200,
    resetYearly: false,
  });
  const customer = async (body: object) =>
    (await ctx.user.post('/api/customers', body)).json().id as number;
  ids = {
    omicron: await customer({
      type: 'BUSINESS',
      companyName: 'Omicronservice GmbH',
      contactPerson: 'Herr Karaca',
      street: 'Industriestraße 5',
      zip: '54321',
      city: 'Beispielstadt',
    }),
    goralewicz: await customer({
      type: 'PRIVATE',
      contactPerson: 'Anna Góralewicz',
      street: 'Ogrodowa 3',
      zip: '10115',
      city: 'Berlin',
      invoiceLanguage: 'pl',
    }),
    illing: await customer({ type: 'PRIVATE', contactPerson: 'Bernd Illing', city: 'Musterstadt' }),
    material: (
      await ctx.user.post('/api/catalog', {
        type: 'MATERIAL',
        title: 'Material',
        description: '',
        unitCode: 'LS',
        unitPriceCents: 50_000,
        vatRate: 19,
      })
    ).json().id,
    drywall: (
      await ctx.user.post('/api/catalog', {
        type: 'WORK',
        title: 'Trockenbau',
        description: 'Ständerwerk und Beplankung',
        unitCode: 'HUR',
        unitPriceCents: 5_200,
        vatRate: 19,
      })
    ).json().id,
  };
  await ctx.user.put(`/api/customers/${ids.illing}/archived`, { archived: true });
  token = (await newToken()).token;
});
afterAll(async () => ctx?.close());

describe('MCP tools (FR-MCP-02, FR-MCP-04, TR-MCP-01)', () => {
  it('offers lookup and draft tools only – nothing to finalize, pay, cancel or configure', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_positions',
      'create_invoice_draft',
      'delete_invoice_draft',
      'find_or_create_customer',
      'get_company_defaults',
      'get_customer',
      'get_invoice',
      'list_invoices',
      'remove_position',
      'search_catalog',
      'search_customers',
      'update_invoice_draft',
    ]);
    for (const tool of tools) {
      expect(tool.name).not.toMatch(
        /final|pay|cancel|number|user|setting|style|company_(?!defaults)/,
      );
      expect(tool.description?.length).toBeGreaterThan(40);
    }
    expect(client.getInstructions()).toMatch(/Drafts only/);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['create_invoice']);
    await client.close();
  });

  it('looks up customers, catalogue and company defaults (read-only)', async () => {
    const client = await connect();
    const found = await call(client, 'search_customers', { query: 'omicron' });
    expect(found.customers).toEqual([expect.objectContaining({ id: ids.omicron })]);
    const catalog = await call<any[]>(client, 'search_catalog', { query: 'trocken' });
    expect(catalog).toEqual([
      expect.objectContaining({ id: ids.drywall, unit: 'HUR', unitPrice: '52.00' }),
    ]);
    const defaults = await call(client, 'get_company_defaults', {});
    expect(defaults).toMatchObject({ taxMode: 'REGULAR', defaultVatRate: 19, paymentTermDays: 30 });
    await client.close();
  });
});

describe('create_invoice_draft – the example flow of §4.10 (FR-MCP-06, D8)', () => {
  let draft: Record<string, any>;
  let result: Record<string, any>;

  beforeAll(async () => {
    const client = await connect();
    result = await call(client, 'create_invoice_draft', {
      customer: { name: 'omicron service', type: 'BUSINESS' },
      subject: 'Renovierung nach Wasserschaden',
      serviceDateFrom: '2026-05-13',
      serviceDateTo: '2026-05-17',
      positions: [
        { title: 'Putzarbeiten', type: 'WORK', quantity: '3', unit: 'h', unitPrice: '48.00' },
        { title: 'Material pauschal', type: 'MATERIAL', unit: 'pauschal', unitPrice: '640.00' },
      ],
    });
    draft = result.draft;
    await client.close();
  });

  it('reuses the similar customer (other spelling, no legal form)', () => {
    expect(result.customer).toMatchObject({ id: ids.omicron, matched: true, created: false });
    expect(draft.customer).toEqual({ id: ids.omicron, name: 'Omicronservice GmbH' });
  });

  it('reuses the similar catalogue entry and creates the unknown one, marked AI-created', async () => {
    const [plaster, material] = result.positions;
    expect(material).toMatchObject({
      catalogItemId: ids.material,
      matched: true,
      created: false,
      priceOverridden: true,
    });
    expect(plaster).toMatchObject({ matched: false, created: true, catalogTitle: 'Putzarbeiten' });
    const created = (await ctx.user.get(`/api/catalog/${plaster.catalogItemId}`)).json();
    expect(created).toMatchObject({
      type: 'WORK',
      unitCode: 'HUR',
      unitPriceCents: 4_800,
      aiCreated: true,
    });
  });

  it('uses the stated price in this invoice only – the catalogue entry stays', async () => {
    expect(draft.positions[1]).toMatchObject({ unitPrice: '640.00', lineTotal: '640.00' });
    const material = (await ctx.user.get(`/api/catalog/${ids.material}`)).json();
    expect(material.unitPriceCents).toBe(50_000);
    expect(material.aiCreated).toBe(false);
  });

  it('calculates the totals with the domain package (FR-INV-06)', () => {
    expect(draft.positions[0]).toMatchObject({
      type: 'WORK',
      quantity: '3',
      unit: 'HUR',
      unitPrice: '48.00',
      lineTotal: '144.00',
    });
    expect(draft.totals).toMatchObject({
      net: '784.00',
      vat: '148.96',
      gross: '932.96',
      work: '144.00',
      material: '640.00',
    });
  });

  it('is a marked draft of the token user, with defaults and a link', async () => {
    expect(draft).toMatchObject({
      status: 'DRAFT',
      number: null,
      aiCreated: true,
      serviceDateFrom: '2026-05-13',
      serviceDateTo: '2026-05-17',
      paymentTermDays: 30,
      link: `${PUBLIC_URL}#/invoices/${draft.id}`,
    });
    expect(draft.missingForFinalize).toEqual([]);
    const row = await ctx.t.db('invoice').where({ id: draft.id }).first();
    const worker = await ctx.t.db('app_user').where({ username: 'worker' }).first();
    expect(row).toMatchObject({ created_by: worker.id, created_via: 'MCP' });
    expect(row.created_via_token_id).toEqual(expect.any(Number));
    const detail = (await ctx.user.get(`/api/invoices/${draft.id}`)).json();
    expect(detail.introText).toBe('Sehr geehrte Damen und Herren,');
    expect(detail.positions[0].description).toBe('Putzarbeiten');
  });

  it('shows up under the "Von KI erstellt" filter (FR-MCP-10)', async () => {
    const list = (await ctx.user.get('/api/invoices?aiCreated=true')).json();
    expect(list.items.map((i: { id: number }) => i.id)).toContain(draft.id);
    expect(list.items.every((i: { aiCreated: boolean }) => i.aiCreated)).toBe(true);
    const catalog = (await ctx.user.get('/api/catalog?aiCreated=true')).json();
    expect(catalog.map((i: { title: string }) => i.title)).toEqual(['Putzarbeiten']);
  });
});

describe('customer lookup rule (FR-MCP-05, D8)', () => {
  it('matches accents and word order of private customers', async () => {
    const client = await connect();
    const r = await call(client, 'find_or_create_customer', {
      name: 'Goralewicz Anna',
      type: 'PRIVATE',
    });
    expect(r).toMatchObject({ matched: true, created: false, customer: { id: ids.goralewicz } });
    await client.close();
  });

  it('uses the customer language as document language', async () => {
    const client = await connect();
    const r = await call(client, 'create_invoice_draft', {
      customerId: ids.goralewicz,
      positions: [{ title: 'Trockenbau', type: 'WORK', quantity: '2' }],
    });
    expect(r.draft).toMatchObject({ documentLanguage: 'pl' });
    expect(r.draft.positions[0]).toMatchObject({ unitPrice: '52.00', lineTotal: '104.00' });
    expect(r.positions[0]).toMatchObject({ catalogItemId: ids.drywall, priceOverridden: false });
    await client.close();
  });

  it('creates an unknown customer marked AI-created; archived ones are reported, not used', async () => {
    const client = await connect();
    const r = await call(client, 'find_or_create_customer', {
      name: 'Bernd Illing',
      type: 'PRIVATE',
      street: 'Gartenweg 7',
      zip: '12345',
    });
    expect(r).toMatchObject({ matched: false, created: true });
    expect(r.archivedMatches).toEqual([
      expect.objectContaining({ id: ids.illing, archived: true }),
    ]);
    const created = (await ctx.user.get(`/api/customers/${r.customer.id}`)).json();
    expect(created).toMatchObject({ contactPerson: 'Bernd Illing', aiCreated: true });

    // Asking again finds the new one instead of creating a twin.
    const again = await call(client, 'find_or_create_customer', {
      name: 'Illing Bernd',
      type: 'PRIVATE',
    });
    expect(again).toMatchObject({ matched: true, customer: { id: r.customer.id } });

    // A person edits and saves it → marker gone (FR-MCP-10).
    const saved = await ctx.user.put(`/api/customers/${r.customer.id}`, {
      type: 'PRIVATE',
      contactPerson: 'Bernd Illing',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
    });
    expect(saved.json().aiCreated).toBe(false);
    await client.close();
  });

  it('refuses an archived customer id', async () => {
    const client = await connect();
    const message = await callError(client, 'create_invoice_draft', {
      customerId: ids.illing,
      positions: [{ title: 'Trockenbau', type: 'WORK' }],
    });
    expect(message).toMatch(/archived/);
    await client.close();
  });
});

describe('positions and numbers (FR-MCP-08, FR-MCP-09)', () => {
  it('rejects floats and commas with a clear message and creates nothing', async () => {
    const client = await connect();
    const before = await ctx.t.db('catalog_item').count({ n: '*' }).first();
    const message = await callError(client, 'create_invoice_draft', {
      customerId: ids.omicron,
      positions: [
        { title: 'Fliesen legen', type: 'WORK', unitPrice: '45.00' },
        { title: 'Silikonfugen', type: 'WORK', unitPrice: '48,00' },
      ],
    });
    expect(message).toMatch(/unitPrice "48,00" is invalid/);
    expect(await ctx.t.db('catalog_item').count({ n: '*' }).first()).toEqual(before);
    await client.close();
  });

  it('needs a price to create a new catalogue entry', async () => {
    const client = await connect();
    const message = await callError(client, 'create_invoice_draft', {
      customerId: ids.omicron,
      positions: [{ title: 'Dachrinne reinigen', type: 'WORK' }],
    });
    expect(message).toMatch(/unitPrice is required/);
    await client.close();
  });

  it('creates one catalogue entry for repeated new positions', async () => {
    const client = await connect();
    const r = await call(client, 'create_invoice_draft', {
      customerId: ids.omicron,
      positions: [
        { title: 'Estrich verlegen', type: 'WORK', quantity: '4', unit: 'm²', unitPrice: '30' },
        { title: 'Estrich verlegen', type: 'WORK', quantity: '2.5', unit: 'm²' },
      ],
    });
    expect(r.positions[0].created).toBe(true);
    expect(r.positions[1]).toMatchObject({
      matched: true,
      catalogItemId: r.positions[0].catalogItemId,
    });
    expect(r.draft.totals.net).toBe('195.00');
    await client.close();
  });
});

describe('refining drafts (FR-MCP-07) and the draft-only rule (FR-MCP-02)', () => {
  async function createDraft(client: Client) {
    return (
      await call(client, 'create_invoice_draft', {
        customerId: ids.omicron,
        positions: [{ title: 'Trockenbau', type: 'WORK', quantity: '1' }],
      })
    ).draft;
  }

  it('updates, adds and removes positions with the version check', async () => {
    const client = await connect();
    const draft = await createDraft(client);
    const updated = await call(client, 'update_invoice_draft', {
      id: draft.id,
      version: draft.version,
      changes: { subject: 'Bad', invoiceDate: '2026-05-20' },
    });
    expect(updated).toMatchObject({
      subject: 'Bad',
      invoiceDate: '2026-05-20',
      serviceDateFrom: '2026-05-20',
      aiCreated: true,
    });
    const conflict = await callError(client, 'update_invoice_draft', {
      id: draft.id,
      version: draft.version,
      changes: { subject: 'stale' },
    });
    expect(conflict).toMatch(/Conflict/);
    const added = await call(client, 'add_positions', {
      id: draft.id,
      version: updated.version,
      positions: [{ title: 'Material', type: 'MATERIAL' }],
    });
    expect(added.draft.positions).toHaveLength(2);
    const removed = await call(client, 'remove_position', {
      id: draft.id,
      version: added.draft.version,
      index: 1,
    });
    expect(removed.positions.map((p: { type: string }) => p.type)).toEqual(['MATERIAL']);
    const deleted = await call(client, 'delete_invoice_draft', {
      id: draft.id,
      version: removed.version,
    });
    expect(deleted).toEqual({ deleted: true, id: draft.id });
    expect((await ctx.user.get(`/api/invoices/${draft.id}`)).statusCode).toBe(404);
    await client.close();
  });

  it('cannot change or delete a finalized invoice', async () => {
    const client = await connect();
    const draft = await createDraft(client);
    // A person finalizes it in the app – that also clears the AI marker.
    const finalized = (
      await ctx.user.post(`/api/invoices/${draft.id}/finalize`, { version: draft.version })
    ).json();
    expect(finalized).toMatchObject({ status: 'OPEN', aiCreated: false });
    for (const [tool, args] of [
      ['update_invoice_draft', { changes: { subject: 'x' } }],
      ['add_positions', { positions: [{ title: 'Material', type: 'MATERIAL' }] }],
      ['remove_position', { index: 1 }],
      ['delete_invoice_draft', {}],
    ] as const) {
      const message = await callError(client, tool, {
        id: draft.id,
        version: finalized.version,
        ...args,
      });
      expect(message).toMatch(/not a draft/);
    }
    // Reading it is fine.
    expect(await call(client, 'get_invoice', { id: draft.id })).toMatchObject({
      status: 'OPEN',
      number: finalized.number,
    });
    await client.close();
  });

  it('a person confirms an AI draft ("Geprüft")', async () => {
    const client = await connect();
    const draft = await createDraft(client);
    const res = await ctx.user.post(`/api/invoices/${draft.id}/reviewed`);
    expect(res.json().aiCreated).toBe(false);
    // Further MCP changes do not bring the marker back.
    const updated = await call(client, 'update_invoice_draft', {
      id: draft.id,
      version: res.json().version,
      changes: { subject: 'checked' },
    });
    expect(updated.aiCreated).toBe(false);
    await client.close();
  });
});

describe('API tokens (FR-MCP-03, NFR-MCP-01)', () => {
  it('shows the token once and stores only its hash', async () => {
    const { token: plain, item } = await newToken(ctx.user, 'Phone');
    expect(plain).toMatch(/^sim_[A-Za-z0-9_-]{43}$/);
    const list = (await ctx.user.get('/api/me/tokens')).json();
    expect(list.mcpEnabled).toBe(true);
    expect(JSON.stringify(list)).not.toContain(plain);
    expect(list.items.find((t: { id: number }) => t.id === item.id)).toMatchObject({
      name: 'Phone',
      scopes: ['mcp:drafts'],
      active: true,
    });
    const row = await ctx.t.db('api_token').where({ id: item.id }).first();
    expect(row.token_hash).toHaveLength(64);
    expect(row.token_hash).not.toContain(plain);
  });

  it('refuses requests without a valid token', async () => {
    expect((await rawMcp({})).status).toBe(401);
    expect((await rawMcp({ Authorization: 'Bearer sim_wrong' })).status).toBe(401);
    expect((await rawMcp({ Authorization: `Bearer ${token}` })).status).toBe(200);
    // A login session is not accepted on /mcp …
    expect((await rawMcp({ Cookie: ctx.user.cookie! })).status).toBe(401);
    // … and a token is not accepted on the normal API.
    const api = await fetch(`${base}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(api.status).toBe(401);
  });

  it('stops working when revoked, expired or the user is deactivated', async () => {
    const revoked = await newToken(ctx.user, 'Revoked');
    expect((await ctx.user.request('DELETE', `/api/me/tokens/${revoked.item.id}`)).statusCode).toBe(
      204,
    );
    expect((await rawMcp({ Authorization: `Bearer ${revoked.token}` })).status).toBe(401);

    const expired = await newToken(ctx.user, 'Expired', 1 as never);
    await ctx.t
      .db('api_token')
      .where({ id: expired.item.id })
      .update({ expires_at: new Date(Date.now() - 1000) });
    expect((await rawMcp({ Authorization: `Bearer ${expired.token}` })).status).toBe(401);

    const admins = await newToken(ctx.admin, 'Admin assistant');
    expect((await rawMcp({ Authorization: `Bearer ${admins.token}` })).status).toBe(200);
    const adminRow = await ctx.t.db('app_user').where({ username: 'admin' }).first();
    await ctx.t.db('app_user').where({ id: adminRow.id }).update({ active: false });
    expect((await rawMcp({ Authorization: `Bearer ${admins.token}` })).status).toBe(401);
    await ctx.t.db('app_user').where({ id: adminRow.id }).update({ active: true });
  });

  it('users manage only their own tokens; admins can revoke all', async () => {
    const own = await newToken(ctx.user, 'Mine');
    expect((await ctx.admin.request('DELETE', `/api/me/tokens/${own.item.id}`)).statusCode).toBe(
      404,
    );
    expect((await ctx.user.get('/api/admin/tokens')).statusCode).toBe(403);
    const all = (await ctx.admin.get('/api/admin/tokens')).json();
    expect(all.items.find((t: { id: number }) => t.id === own.item.id)).toMatchObject({
      userName: 'Worker',
    });
    expect((await ctx.admin.request('DELETE', `/api/admin/tokens/${own.item.id}`)).statusCode).toBe(
      204,
    );
    expect((await rawMcp({ Authorization: `Bearer ${own.token}` })).status).toBe(401);
  });

  it('limits calls per token and minute', () => {
    const limiter = createTokenRateLimiter(3, 60_000);
    expect([1, 2, 3].map(() => limiter.hit(7, 0))).toEqual([0, 0, 0]);
    expect(limiter.hit(7, 1_000)).toBe(59);
    expect(limiter.hit(8, 1_000)).toBe(0);
    expect(limiter.hit(7, 60_000)).toBe(0);
  });

  it('answers 429 after 60 calls in a minute', async () => {
    const { token: busy } = await newToken(ctx.user, 'Busy');
    const statuses = [];
    for (let i = 0; i < 61; i++)
      statuses.push((await rawMcp({ Authorization: `Bearer ${busy}` })).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});

describe('MCP switched off (FR-MCP-12)', () => {
  it('has no /mcp endpoint by default', async () => {
    const app = await buildApp({ config: { ...ctx.t.config, mcpEnabled: false }, db: ctx.t.db });
    try {
      const res = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
