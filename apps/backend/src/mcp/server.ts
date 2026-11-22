import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  MAX_POSITIONS,
  UNIT_CODES,
  VAT_RATES,
  formatDecimalAmount,
  type InvoiceStatus,
} from '@sim/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db.js';
import { searchCatalog } from '../catalog/repository.js';
import { loadCompany } from '../company/repository.js';
import { findCustomer, searchCustomers } from '../customers/repository.js';
import { invoiceDetail, newDraftData, selectableCustomer } from '../invoices/detail.js';
import {
  createDraft,
  deleteDraft,
  findInvoice,
  listInvoices,
  saveDraft,
} from '../invoices/repository.js';
import { businessToday } from '../time.js';
import {
  McpInputError,
  applyChanges,
  customerRef,
  draftData,
  findOrCreateCustomer,
  invoiceSummary,
  resolveCustomer,
  resolvePositions,
  type CustomerInput,
  type DraftChanges,
} from './drafts.js';
import type { Origin } from './origin.js';
import type { ApiToken } from './tokens.js';
import type { UserRow } from '../users/repository.js';

export interface McpContext {
  db: Db;
  user: UserRow;
  token: ApiToken;
  /** App address for links, ending in "/" (config PUBLIC_URL or derived from the request). */
  baseUrl: string;
  version: string;
  log: FastifyBaseLogger;
}

/** FR-MCP-11: what every assistant learns when it connects. */
export const SERVER_INSTRUCTIONS = `SimpleInvoice Manager – invoices for a tradesperson's business (Germany, EUR).

You can look up customers, catalogue entries and invoices, and create or change invoice DRAFTS.
Drafts only: you can never finalize an invoice, assign an invoice number, create the PDF, mark it
paid or cancel it. A person checks every draft in the app and creates the PDF there – always end
by giving the user the draft's "link".

Workflow for "write an invoice to <customer> for <work/material>":
1. create_invoice_draft with the customer (name, type, address if known) and the positions.
   The server reuses a SIMILAR existing customer and SIMILAR catalogue entries (other spelling,
   accents, legal form like GmbH are ignored). Only if nothing similar exists, it creates a new
   customer / catalogue entry and marks it "created by AI" for the person to check.
   Check "customer.matched"/"created" and each position's "matched"/"created" in the result.
2. If the result lists "alternatives" and another one fits better, fix it with
   update_invoice_draft (customerId) or remove_position + add_positions (catalogItemId).
3. Summarize the draft (customer, positions, totals incl. VAT) and give the link.

Numbers are decimal STRINGS with a dot: amounts in net euros ("1755.00", "48"), quantities with
up to three decimals ("2.5"). VAT rate is 19, 7 or 0. Dates are YYYY-MM-DD.
Units: HUR hour, H87 piece, MTR m, MTK m², MTQ m³, KGM kg, LS lump sum ("pauschal").`;

const Language = z.enum(['de', 'pl', 'en']);
const PositionType = z
  .enum(['WORK', 'MATERIAL'])
  .describe('WORK = labour (Arbeit/Lohn), MATERIAL = material. Required: they are printed apart.');
const IsoDate = z.string().describe('Date as YYYY-MM-DD, e.g. "2026-05-13"');
const Id = z.number().int().positive();
const Version = z
  .number()
  .int()
  .positive()
  .describe('The "version" from the last result for this draft. A 409 conflict means: re-read it.');

const CustomerData = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Company name for businesses ("Omicronservice GmbH"), full name for private people'),
  type: z
    .enum(['BUSINESS', 'PRIVATE'])
    .describe('BUSINESS = company (B2B), PRIVATE = private person (B2C)'),
  contactPerson: z.string().max(200).optional().describe('Businesses: contact person ("Z. Hd.")'),
  street: z.string().max(200).optional(),
  zip: z.string().max(16).optional(),
  city: z.string().max(120).optional(),
  countryCode: z.string().length(2).optional().describe('ISO 3166 code, default "DE"'),
  email: z.string().max(254).optional(),
  phone: z.string().max(50).optional(),
  invoiceLanguage: Language.optional().describe(
    'Language of this customer\'s invoices, default "de"',
  ),
});

const Position = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('Short name of the work or material, e.g. "Putzarbeiten", "Material"'),
  description: z
    .string()
    .max(4000)
    .optional()
    .describe('Optional extra lines printed under the title (this invoice only)'),
  type: PositionType,
  quantity: z
    .string()
    .optional()
    .describe('Decimal string, default "1" – e.g. "3" hours, "2.5" m²'),
  unit: z
    .string()
    .optional()
    .describe(
      `Unit code (${UNIT_CODES.join(', ')}) or a common name like "h", "Stk", "m²", "pauschal"`,
    ),
  unitPrice: z
    .string()
    .optional()
    .describe(
      'Net price per unit in euros as decimal string ("48.00"). Overrides the catalogue price in ' +
        'this invoice only. Required when no similar catalogue entry exists.',
    ),
  vatRate: z
    .union([z.literal(19), z.literal(7), z.literal(0)])
    .optional()
    .describe('19, 7 or 0 percent; default from the catalogue entry or the company'),
  catalogItemId: Id.optional().describe('Use exactly this catalogue entry (from search_catalog)'),
});

const DraftFields = {
  invoiceDate: IsoDate.optional().describe('Default: today'),
  serviceDateFrom: IsoDate.optional().describe(
    'Service date or start of the period; default: invoice date',
  ),
  serviceDateTo: IsoDate.nullable()
    .optional()
    .describe(
      'End of the service period, e.g. 13.–17.05. → from 05-13 to 05-17; null = single day',
    ),
  paymentTermDays: z.number().int().min(0).max(365).optional().describe('Default from company'),
  documentLanguage: Language.optional().describe("Default: the customer's invoice language"),
  subject: z
    .string()
    .max(2000)
    .optional()
    .describe('Subject block, e.g. "Renovierung nach Wasserschaden – Putzarbeiten"'),
  siteAddress: z.string().max(2000).optional().describe('Construction site address, multi-line'),
  introText: z.string().max(4000).optional().describe('Default: company text'),
  closingText: z.string().max(4000).optional().describe('Default: company text'),
};

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const DRAFT_ONLY =
  'Drafts only (no number, no PDF): a person checks it in the app and creates the PDF there.';

/**
 * FR-MCP-01..11: one MCP server per request (stateless Streamable HTTP), acting as the token's
 * user. The tool set itself is the draft-only guarantee (FR-MCP-02): there is no tool to
 * finalize, number, pay, cancel or change settings – and the draft tools only touch drafts.
 */
export function buildMcpServer(ctx: McpContext): McpServer {
  const { db, user } = ctx;
  const origin: Origin = { via: 'MCP', tokenId: ctx.token.id };
  const link = (id: number) => `${ctx.baseUrl}#/invoices/${id}`;
  const server = new McpServer(
    { name: 'simpleinvoice-manager', title: 'SimpleInvoice Manager', version: ctx.version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  /** Wraps a tool: input errors become tool errors; every call is logged (FR-MCP-10). */
  function tool<A>(
    name: string,
    run: (args: A) => Promise<{ result: unknown; ids?: Record<string, unknown> }>,
  ) {
    return async (args: A): Promise<CallToolResult> => {
      try {
        const { result, ids = {} } = await run(args);
        ctx.log.info(
          { mcp: { tool: name, userId: user.id, tokenId: ctx.token.id, ...ids } },
          'mcp tool call',
        );
        return json(result);
      } catch (err) {
        if (err instanceof McpInputError) {
          ctx.log.info(
            { mcp: { tool: name, userId: user.id, tokenId: ctx.token.id, error: err.message } },
            'mcp tool call rejected',
          );
          return toolError(err.message);
        }
        throw err;
      }
    };
  }

  async function summary(id: number) {
    return invoiceSummary(await invoiceDetail(db, (await findInvoice(db, id))!), link(id));
  }

  /** Loads a draft for a change; finalized invoices are refused (FR-MCP-02). */
  async function editableDraft(id: number, version: number) {
    const invoice = await findInvoice(db, id);
    if (!invoice) throw new McpInputError(`No invoice with id ${id}`);
    if (invoice.status !== 'DRAFT') {
      throw new McpInputError(
        `Invoice ${id} is ${invoice.status}, not a draft – finalized invoices cannot be changed by AI assistants`,
      );
    }
    if (invoice.version !== version) {
      throw new McpInputError(
        `Conflict: invoice ${id} is at version ${invoice.version}, not ${version} – call get_invoice and retry`,
      );
    }
    return invoiceDetail(db, invoice);
  }

  async function save(id: number, version: number, data: ReturnType<typeof draftData>) {
    const { profile } = await loadCompany(db);
    const result = await saveDraft(db, id, version, data, profile.taxMode, user.id, {
      review: false,
    });
    if (result === 'conflict') {
      throw new McpInputError(
        `Conflict: invoice ${id} was changed meanwhile – call get_invoice and retry`,
      );
    }
    if (result !== 'saved') throw new McpInputError(`Invoice ${id} cannot be changed (${result})`);
  }

  // ---------------------------------------------------------------- lookup (FR-MCP-04)

  server.registerTool(
    'search_customers',
    {
      title: 'Search customers',
      description:
        'Search customers by name, company, contact person or city (case- and accent-insensitive, ' +
        'at least 2 characters). Archived customers are included and flagged; they cannot be used ' +
        'for new invoices. Example: {"query": "omicron"}',
      inputSchema: {
        query: z.string().min(2).max(100),
        includeArchived: z.boolean().optional().describe('Default true'),
      },
      annotations: { readOnlyHint: true },
    },
    tool('search_customers', async ({ query, includeArchived = true }) => {
      const { items, total } = await searchCustomers(db, {
        q: query,
        includeArchived,
        limit: 20,
        offset: 0,
      });
      return { result: { total, customers: items.map(customerRef) } };
    }),
  );

  server.registerTool(
    'get_customer',
    {
      title: 'Get customer',
      description: 'Full data of one customer (address, invoice language, archived, AI-created).',
      inputSchema: { id: Id },
      annotations: { readOnlyHint: true },
    },
    tool('get_customer', async ({ id }) => {
      const customer = await findCustomer(db, id);
      if (!customer) throw new McpInputError(`No customer with id ${id}`);
      const { notes: _notes, ...data } = customer;
      return { result: data, ids: { customerId: id } };
    }),
  );

  server.registerTool(
    'search_catalog',
    {
      title: 'Search catalogue',
      description:
        'Search the catalogue of reusable positions (title, description). Returns id, type, unit and ' +
        'net unit price as decimal string. Use an id as "catalogItemId" in a position to use exactly ' +
        'that entry. Example: {"query": "putz", "type": "WORK"}',
      inputSchema: { query: z.string().max(100).optional(), type: PositionType.optional() },
      annotations: { readOnlyHint: true },
    },
    tool('search_catalog', async ({ query, type }) => {
      const items = await searchCatalog(db, {
        ...(query ? { q: query } : {}),
        ...(type ? { type } : {}),
      });
      return {
        result: items.slice(0, 50).map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          description: i.description,
          unit: i.unitCode,
          unitPrice: formatDecimalAmount(i.unitPriceCents),
          vatRate: i.vatRate,
          aiCreated: i.aiCreated,
        })),
      };
    }),
  );

  server.registerTool(
    'get_company_defaults',
    {
      title: 'Company defaults',
      description:
        'Tax mode (REGULAR = VAT, SMALL_BUSINESS_19 = no VAT, § 19 UStG), default VAT rate, ' +
        'payment term, languages and units used for new drafts.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool('get_company_defaults', async () => {
      const { profile } = await loadCompany(db);
      return {
        result: {
          companyName: profile.name,
          taxMode: profile.taxMode,
          defaultVatRate: profile.defaultVatRate,
          vatRates: VAT_RATES,
          paymentTermDays: profile.defaultPaymentTermDays,
          documentLanguages: ['de', 'pl', 'en'],
          currency: 'EUR',
          units: {
            HUR: 'hour (Std.)',
            H87: 'piece (Stk.)',
            MTR: 'metre',
            MTK: 'square metre',
            MTQ: 'cubic metre',
            KGM: 'kilogram',
            LS: 'lump sum (pauschal)',
          },
          today: businessToday(),
        },
      };
    }),
  );

  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'List invoices (drafts and finalized), newest first. Filter by status ' +
        '(DRAFT, OPEN, PAID, CANCELLED, OVERDUE), customerId, or a query (number or customer name).',
      inputSchema: {
        status: z.enum(['DRAFT', 'OPEN', 'PAID', 'CANCELLED', 'OVERDUE']).optional(),
        customerId: Id.optional(),
        query: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
      },
      annotations: { readOnlyHint: true },
    },
    tool('list_invoices', async ({ status, customerId, query, limit = 20 }) => {
      const { items, total } = await listInvoices(db, {
        today: businessToday(),
        limit,
        offset: 0,
        ...(status ? { status: status as InvoiceStatus | 'OVERDUE' } : {}),
        ...(customerId ? { customerId } : {}),
        ...(query ? { q: query } : {}),
      });
      return {
        result: {
          total,
          invoices: items.map((i) => ({
            id: i.id,
            number: i.number,
            status: i.status,
            customer: i.customerName,
            invoiceDate: i.invoiceDate,
            dueDate: i.dueDate,
            gross: formatDecimalAmount(i.grossCents),
            aiCreated: i.aiCreated,
            link: link(i.id),
          })),
        },
      };
    }),
  );

  server.registerTool(
    'get_invoice',
    {
      title: 'Get invoice',
      description:
        'One invoice with positions, totals and "missingForFinalize" (what a person must still ' +
        'complete). Works for drafts and finalized invoices (read-only).',
      inputSchema: { id: Id },
      annotations: { readOnlyHint: true },
    },
    tool('get_invoice', async ({ id }) => {
      if (!(await findInvoice(db, id))) throw new McpInputError(`No invoice with id ${id}`);
      return { result: await summary(id), ids: { invoiceId: id } };
    }),
  );

  // ---------------------------------------------------------------- customers (FR-MCP-05)

  server.registerTool(
    'find_or_create_customer',
    {
      title: 'Find or create customer',
      description:
        'Finds a SIMILAR existing customer (spelling, accents, legal form such as GmbH / Sp. z o.o. ' +
        'ignored; same name in another ZIP/city is a different customer) and returns it with ' +
        '"matched": true and possible "alternatives". Only if nothing similar exists, creates a new ' +
        'customer marked "created by AI". Usually not needed: create_invoice_draft does this itself. ' +
        'Example: {"name": "Omicronservice", "type": "BUSINESS", "city": "Beispielstadt"}',
      inputSchema: CustomerData.shape,
    },
    tool('find_or_create_customer', async (args: CustomerInput) => {
      const r = await findOrCreateCustomer(db, args, user.id, origin);
      return {
        result: {
          customer: customerRef(r.customer),
          matched: r.matched,
          created: r.created,
          alternatives: r.alternatives,
          archivedMatches: r.archivedMatches,
        },
        ids: { customerId: r.customer.id, created: r.created },
      };
    }),
  );

  // ---------------------------------------------------------------- drafts (FR-MCP-06, -07)

  server.registerTool(
    'create_invoice_draft',
    {
      title: 'Create invoice draft',
      description:
        `Creates a new invoice draft. ${DRAFT_ONLY}\n` +
        'Customer: pass "customerId" or "customer" (looked up like find_or_create_customer). ' +
        'Each position is matched to a SIMILAR catalogue entry (same type, compatible unit) and its ' +
        'values are copied; a stated unitPrice/quantity overrides them in this invoice only. If ' +
        'nothing similar exists, a catalogue entry is created (needs unitPrice) and marked "created ' +
        'by AI". Defaults: invoice date today, service date = invoice date, texts and payment term ' +
        'from the company. Returns the draft with totals, per-position "matched"/"created", ' +
        '"missingForFinalize" and the "link" to give to the user.\n' +
        'Example: {"customer": {"name": "Omicronservice", "type": "BUSINESS"}, "positions": [' +
        '{"title": "Putzarbeiten", "type": "WORK", "quantity": "3", "unit": "h", "unitPrice": "48.00"}, ' +
        '{"title": "Material", "type": "MATERIAL", "unit": "pauschal", "unitPrice": "640.00"}], ' +
        '"serviceDateFrom": "2026-05-13", "serviceDateTo": "2026-05-17"}',
      inputSchema: {
        customerId: Id.optional(),
        customer: CustomerData.optional(),
        positions: z.array(Position).min(1).max(MAX_POSITIONS),
        ...DraftFields,
      },
    },
    tool('create_invoice_draft', async ({ customerId, customer, positions, ...fields }) => {
      const c = await resolveCustomer(db, { customerId, customer }, user.id, origin);
      const { draft, taxMode } = await newDraftData(db, c.customer);
      const header = applyChanges(draft, fields as DraftChanges);
      const resolved = await resolvePositions(db, positions, user.id, origin);
      const id = await createDraft(
        db,
        { ...header, positions: resolved.positions },
        taxMode,
        user.id,
        origin,
      );
      return {
        result: {
          draft: await summary(id),
          customer: {
            ...customerRef(c.customer),
            matched: c.matched,
            created: c.created,
            alternatives: c.alternatives,
            archivedMatches: c.archivedMatches,
          },
          positions: resolved.resolutions,
          note: DRAFT_ONLY,
        },
        ids: {
          invoiceId: id,
          customerId: c.customer.id,
          customerCreated: c.created,
          catalogItemIds: resolved.resolutions.map((r) => r.catalogItemId),
        },
      };
    }),
  );

  server.registerTool(
    'update_invoice_draft',
    {
      title: 'Update invoice draft',
      description:
        `Changes header fields of a draft (customer, dates, texts …). ${DRAFT_ONLY} ` +
        'Only the given fields change. Example: {"id": 57, "version": 1, "changes": ' +
        '{"subject": "Renovierung Bad", "serviceDateTo": "2026-05-17"}}',
      inputSchema: {
        id: Id,
        version: Version,
        changes: z.object({ customerId: Id.optional(), ...DraftFields }),
      },
    },
    tool('update_invoice_draft', async ({ id, version, changes }) => {
      const current = await editableDraft(id, version);
      const { customerId, ...fields } = changes;
      let data = applyChanges(draftData(current), fields as DraftChanges);
      if (customerId !== undefined && customerId !== current.customerId) {
        const c = await selectableCustomer(db, customerId);
        if ('error' in c) throw new McpInputError(`${c.message} (customerId ${customerId})`);
        data = { ...data, customerId };
      }
      await save(id, version, data);
      return { result: await summary(id), ids: { invoiceId: id } };
    }),
  );

  server.registerTool(
    'add_positions',
    {
      title: 'Add positions to a draft',
      description: `Appends positions to a draft, with the same catalogue lookup as create_invoice_draft. ${DRAFT_ONLY}`,
      inputSchema: {
        id: Id,
        version: Version,
        positions: z.array(Position).min(1).max(MAX_POSITIONS),
      },
    },
    tool('add_positions', async ({ id, version, positions }) => {
      const current = await editableDraft(id, version);
      const data = draftData(current);
      if (data.positions.length + positions.length > MAX_POSITIONS) {
        throw new McpInputError(`An invoice can have at most ${MAX_POSITIONS} positions`);
      }
      const resolved = await resolvePositions(
        db,
        positions,
        user.id,
        origin,
        data.positions.length + 1,
      );
      await save(id, version, { ...data, positions: [...data.positions, ...resolved.positions] });
      return {
        result: { draft: await summary(id), positions: resolved.resolutions },
        ids: { invoiceId: id, catalogItemIds: resolved.resolutions.map((r) => r.catalogItemId) },
      };
    }),
  );

  server.registerTool(
    'remove_position',
    {
      title: 'Remove a position from a draft',
      description: `Removes the position with the given "index" (1 = first, as in the draft's positions). ${DRAFT_ONLY}`,
      inputSchema: { id: Id, version: Version, index: z.number().int().min(1) },
      annotations: { destructiveHint: true },
    },
    tool('remove_position', async ({ id, version, index }) => {
      const current = await editableDraft(id, version);
      const data = draftData(current);
      if (index > data.positions.length) {
        throw new McpInputError(`Draft ${id} has only ${data.positions.length} positions`);
      }
      await save(id, version, {
        ...data,
        positions: data.positions.filter((_, i) => i !== index - 1),
      });
      return { result: await summary(id), ids: { invoiceId: id } };
    }),
  );

  server.registerTool(
    'delete_invoice_draft',
    {
      title: 'Delete invoice draft',
      description:
        'Deletes a DRAFT (e.g. created by mistake). Finalized invoices can never be deleted.',
      inputSchema: { id: Id, version: Version },
      annotations: { destructiveHint: true },
    },
    tool('delete_invoice_draft', async ({ id, version }) => {
      await editableDraft(id, version);
      const result = await deleteDraft(db, id, version);
      if (result !== 'deleted')
        throw new McpInputError(`Draft ${id} could not be deleted (${result})`);
      return { result: { deleted: true, id }, ids: { invoiceId: id } };
    }),
  );

  // ---------------------------------------------------------------- prompt (FR-MCP-11)

  server.registerPrompt(
    'create_invoice',
    {
      title: 'Create an invoice draft',
      description: 'Guides the assistant from a spoken request to a checked invoice draft.',
      argsSchema: {
        request: z
          .string()
          .describe('What the user said, e.g. "Invoice to Omicronservice: 3 h plastering at 48 €"'),
      },
    },
    ({ request }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Create an invoice DRAFT in SimpleInvoice Manager for this request:\n\n${request}\n\n` +
              'Steps: (1) Work out the customer (name, BUSINESS or PRIVATE, city if known) and the ' +
              'positions (title, WORK or MATERIAL, quantity, unit, net unit price as decimal ' +
              'string). Ask me if something essential is unclear – do not invent prices. ' +
              '(2) Call create_invoice_draft. (3) If the customer or a position was matched to ' +
              'an existing entry that does not fit, correct it. (4) Reply with a short summary ' +
              '(customer, positions, net, VAT, gross; say which entries are new) and the link. ' +
              'Remind me that I have to check the draft and create the PDF in the app.',
          },
        },
      ],
    }),
  );

  return server;
}
