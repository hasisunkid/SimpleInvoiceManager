import type {
  CatalogItemData,
  CustomerData,
  FinalizeProblem,
  InvoiceDraftData,
  InvoicePositionData,
  InvoiceStatus,
  InvoiceTotals,
  TaxMode,
  VatCategory,
} from '@sim/domain';
import type { Language } from '@sim/i18n';

/**
 * API client. All calls use document-relative paths (`api/...`, no leading slash), so they
 * resolve under the Home Assistant ingress path as well as at "/" (AR-13).
 */

export type Role = 'USER' | 'ADMIN';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  uiLanguage: Language | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  user: PublicUser | null;
  csrfToken: string | null;
}

export interface Health {
  status: 'ok' | 'error';
  database: boolean;
  migrations: { applied: number; pending: number };
  /** AR-26: running version (`dev` for local builds) and its GitHub release notes. */
  version: string;
  releaseNotesUrl: string | null;
}

/** Error with the server's machine-readable code (translated via `errors.<code>`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    /** Per-field problem codes from form validation, e.g. { iban: 'INVALID_IBAN' }. */
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | undefined;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called when a protected request answers 401 (session expired or ended elsewhere). */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  /** JSON body (serialized) … */
  json?: unknown;
  /** … or a raw body such as an uploaded file, sent with its own content type. */
  raw?: Blob;
  /** Parse the response as JSON (default) or return it as a Blob (PDFs, images). */
  as?: 'json' | 'blob';
  /** Let the request finish even if the page is being closed (auto-save on phone lock). */
  keepalive?: boolean;
}

async function send(method: Method, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: options.as === 'blob' ? '*/*' : 'application/json',
  };
  let body: BodyInit | undefined;
  if (options.raw) {
    headers['Content-Type'] = options.raw.type || 'application/octet-stream';
    body = options.raw;
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  // FR-AUTH-07: every state-changing request carries the CSRF token (any value before login).
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken ?? 'anonymous';
  try {
    return await fetch(`api/${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(options.keepalive ? { keepalive: true } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
}

async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(method, path, options);
  if (res.ok && options.as === 'blob') return (await res.blob()) as T;
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | (T & {
        error?: string;
        message?: string;
        retryAfterSeconds?: number;
        fields?: Record<string, string>;
      })
    | null;
  if (!res.ok) {
    const code = data?.error ?? 'UNKNOWN';
    if (res.status === 401 && code === 'UNAUTHENTICATED') onUnauthenticated?.();
    throw new ApiError(
      res.status,
      code,
      data?.message ?? res.statusText,
      data?.retryAfterSeconds,
      data?.fields,
    );
  }
  return data as T;
}

/** Extracts the file name from Content-Disposition (prefers the UTF-8 `filename*`). */
export function fileNameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] ?? fallback;
}

/** Downloads a file (e.g. the stored invoice PDF) with its server-side file name. */
async function getFile(path: string, fallbackName: string): Promise<File> {
  const res = await send('GET', path, { as: 'blob' });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new ApiError(res.status, data?.error ?? 'UNKNOWN', data?.message ?? res.statusText);
  }
  const name = fileNameFrom(res.headers.get('Content-Disposition'), fallbackName);
  return new File([await res.blob()], name, { type: res.headers.get('Content-Type') ?? '' });
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, { json: body }),
  put: <T>(path: string, body: unknown, { keepalive = false } = {}) =>
    request<T>('PUT', path, { json: body, keepalive }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { json: body }),
  delete: (path: string) => request<void>('DELETE', path),
  /** Uploads a file as the raw request body (logo upload). */
  upload: <T>(path: string, file: Blob) => request<T>('POST', path, { raw: file }),
  /** POSTs JSON and returns the binary response, e.g. a PDF preview. */
  postForBlob: (path: string, body: unknown) =>
    request<Blob>('POST', path, { json: body, as: 'blob' }),
  getFile,
};

export interface Customer extends CustomerData {
  id: number;
  displayName: string;
  archived: boolean;
  /** FR-MCP-10: created by an AI assistant, not yet checked. */
  aiCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPage {
  items: Customer[];
  total: number;
}

export interface CatalogItem extends CatalogItemData {
  id: number;
  aiCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePosition extends InvoicePositionData {
  lineTotalCents: number;
  vatCategory: VatCategory;
}

/** Editor view of an invoice (GET /api/invoices/:id). */
export interface Invoice extends Omit<InvoiceDraftData, 'positions'> {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  version: number;
  customer: Customer | null;
  dueDate: string;
  taxMode: TaxMode;
  positions: InvoicePosition[];
  totals: InvoiceTotals;
  finalizeProblems: (FinalizeProblem | 'NUMBERING_NOT_CONFIGURED')[];
  overdue: boolean;
  aiCreated: boolean;
  paidAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListItem {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  customerId: number | null;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  grossCents: number;
  overdue: boolean;
  aiCreated: boolean;
}

export interface InvoicePage {
  items: InvoiceListItem[];
  total: number;
  openTotalCents: number;
}

export interface InvoiceSummary {
  drafts: number;
  open: { count: number; grossCents: number };
  overdue: { count: number; grossCents: number };
  paidThisYear: { count: number; grossCents: number };
}

export interface StatusHistoryEntry {
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  at: string;
  userName: string | null;
  note: string | null;
}

/** FR-MCP-03: personal API token for AI assistants (the secret itself is never listed). */
export interface ApiToken {
  id: number;
  userId: number;
  userName: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface ApiTokenList {
  mcpEnabled: boolean;
  items: ApiToken[];
}
