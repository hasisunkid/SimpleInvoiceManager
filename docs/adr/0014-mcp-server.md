# ADR 0014 – MCP server for AI assistants

- **Status:** accepted (M9, 2026-11-22)
- **Requirements:** FR-MCP-01..12, NFR-MCP-01/02, TR-MCP-01, decision D8

## Decision

- **Inside the backend** with the official SDK (`@modelcontextprotocol/sdk` 1.32, zod schemas
  for tool input): same process, repositories and domain package as the REST API (AR-05).
  Invoice detail, new-draft defaults and the customer check moved to `invoices/detail.ts` so
  the editor and the tools give identical totals and § 14 checklists.
- **Transport:** Streamable HTTP at `POST /mcp`, **stateless** (`sessionIdGenerator:
undefined`, JSON responses): a fresh `McpServer` per request, bound to the token's user. No
  session state in memory (Raspberry Pi), nothing to clean up; `GET`/`DELETE` answer 405. The
  route is registered only with `MCP_ENABLED=true` (HA option `mcp_enabled`, default off).
- **Authentication:** personal API tokens `sim_<43 chars base64url>` (256 random bits), stored
  as SHA-256 (no stretching needed for random secrets), prefix kept for display, scope
  `mcp:drafts`, optional expiry, revocation instead of deletion (AI-created records keep their
  token reference). `/mcp` reads only `Authorization: Bearer`; cookies are ignored. The `/api`
  guard reads only cookies, so a token opens no other route. Deactivated users' tokens stop
  working. Bearer headers are redacted from logs.
- **Draft-only (FR-MCP-02)** is structural: the tool set has no finalize, number, pay, cancel,
  user or settings tool; every changing tool checks `status = DRAFT` and the version (409 → tool
  error "re-read"), and `saveDraft` checks again under a row lock. Tool results are plain data,
  so injected text in a customer name cannot escalate (NFR-MCP-02).
- **Lookup rule (D8)** in `packages/domain/src/matching.ts` (pure, 100 % covered):
  - customers: names normalized (case, accents incl. ł/ß, legal forms GmbH/UG/Sp. z o.o.,
    salutations); names are compared word by word (fuzzy, any order); a name whose words are
    all contained in the other counts 0.85 ("Góralewicz" → "Anna Góralewicz"); the
    whole-name character similarity counts only from 0.9 ("Omicron Service" =
    "Omicronservice"), so long names sharing most words stay apart. Compared against company
    name and contact person; a matching ZIP/city adds 0.05, a different one subtracts 0.25
    (same name elsewhere = another customer). Threshold 0.8. Best active match is used, other
    matches are returned as `alternatives`, archived matches as `archivedMatches` (never used).
  - catalogue: same type and compatible unit required; meaningful title words (units, numbers
    and filler words in de/pl/en removed) compared with the entry's title (and, weighted 0.9,
    title + description). Threshold 0.6. New positions that are similar to each other in one
    request create one entry.
  - All candidates are scored in memory (≤ 5 000 customers, a few hundred catalogue entries –
    well under the 500 ms budget); no fuzzy SQL needed.
- **Values:** amounts and quantities only as decimal strings with a dot (`"48.00"`, `"2.5"`),
  parsed by `parseDecimalAmount` / `parseDecimalQuantity`; units as codes or common names
  (`parseUnit`). A matched catalogue entry's values are copied; a stated price, quantity, unit
  or description applies to this invoice only. New catalogue entries need a price. All
  positions are validated before anything is created.
- **AI-created marker (FR-MCP-10):** `created_via` (`UI`/`MCP`), `created_via_token_id`,
  `ai_reviewed_at` on invoice, customer and catalogue item (migration 0006). "Von KI erstellt"
  = `created_via = 'MCP' AND ai_reviewed_at IS NULL`. Saves from the app, finalizing and the
  "Geprüft" endpoints (`POST …/reviewed`) set `ai_reviewed_at`; saves through MCP do not.
- **Links** in tool results use `PUBLIC_URL` (HA option `public_url`) or the address of the MCP
  request (`#/invoices/<id>`).
- **Limits:** 60 tool requests per token and minute (in-memory fixed window, 429 +
  `Retry-After`), 256 KB request body. Every tool call is logged with user, token, tool and
  affected ids – never the arguments' free text.
- **Export condition renamed** to `sim-source` (from `source`): the SDK's dependency
  `eventsource-parser` publishes a `source` condition with TypeScript files that Vitest then
  tried to load.

## Consequences

- MCP clients reach the app through the direct port (Ingress needs a browser login), so the
  port must be published and protected by HTTPS or kept in the home network – `DOCS.md` says so.
- The rate limit resets on restart (same accepted risk as the login limiter).
- Matching thresholds are heuristics; wrong matches are visible (`alternatives`, badges) and a
  person checks every draft before it becomes an invoice.
