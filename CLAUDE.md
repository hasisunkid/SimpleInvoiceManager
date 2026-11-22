# CLAUDE.md

SimpleInvoice Manager – invoice web app for tradespeople, packaged as a Home Assistant App.

## Source of truth

- Requirements: @.claude/REQUIREMENTS.md – reference requirement IDs (AR-, FR-, NFR-, TR-) in
  commits, tests and comments. If a requirement is ambiguous or conflicting, **ask** instead
  of guessing.
- Work milestone by milestone (§9). Do not start the next milestone with failing tests.
  Update the milestone table and demo note in README.md when one is done.
- "Implementer's choice" decisions → short ADR in `docs/adr/` (next free number).

## Commands

- `npm test` – all unit + integration tests (needs Docker: MariaDB via Testcontainers)
- `npm run test:coverage` – plus coverage gate (≥ 90 % for packages/domain)
- `npm run lint` / `npm run format` – ESLint + Prettier
- `npm run typecheck` – tsc -b + vue-tsc
- `npm run test:e2e` – Playwright E2E on a fresh, separate compose stack (needs Docker; ~1–2 min)
- `docker compose up --build --wait` – full system on http://localhost:8099

Before reporting work as done: `npm run lint && npm run typecheck && npm test` must pass.

## Release notes (Changesets, AR-20..26)

- After each user-visible change run `npx changeset` (package `@sim/ha-app`, the only versioned
  package; patch = fix, minor = feature, major = breaking) and write the text **in English, for
  users** – no internal jargon. Internal-only changes: `npx changeset --empty`. CI fails on
  changes to `apps/`, `packages/` or `ha-app/` without one. Add changesets for your milestones.
- Never edit versions, `ha-app/config.yaml` `version:` or `ha-app/CHANGELOG.md` by hand and never
  push tags: merging the "Version Packages" PR releases (docs/ha-release.md).
- The version reaches the app only via `BUILD_VERSION` → `APP_VERSION` (`config.version`).

## Conventions

- ESM everywhere, TypeScript strict. No `any` in `packages/domain`.
- Money is **integer cents** (`Cents` from `@sim/domain`); never floats.
- Invoice calculation lives **only** in `packages/domain` (pure functions), used by backend
  and frontend.
- Frontend: no hard-coded UI strings – add keys to `packages/i18n/src/de.ts` first, then pl
  and en (the type system enforces completeness). Only relative URLs (`api/...`, never
  `/api/...`) – the app runs under a dynamic Ingress base path.
- Backend: every route has a TypeBox schema (validation + OpenAPI). Config only via
  `loadConfig()` / env vars.
- Auth is default-deny (ADR 0005): routes need a session unless `config: { public: true }`;
  admin-only routes set `config: { admin: true }`. Errors are `{ error: CODE, message }` and
  every new CODE needs an `errors.CODE` text in all three languages.
- New API routes: `test/security.test.ts` fixes the public routes and admin areas – adding a
  public or admin route means updating its expected lists on purpose.
- MCP (`apps/backend/src/mcp/`, ADR 0014): tools may only read, or create/change **drafts** –
  never add a tool that finalizes, numbers, pays, cancels or changes settings (FR-MCP-02;
  `test/mcp.test.ts` pins the tool list). Amounts/quantities are decimal strings parsed by the
  domain package; similarity rules live in `packages/domain/src/matching.ts`. Records created
  via MCP pass `Origin { via: 'MCP' }`; saves by people clear the marker, MCP saves pass
  `review: false`.
- Frontend calls go through `api` in `apps/frontend/src/api.ts` (adds the CSRF header).
- PDF output goes through `InvoiceRenderer` (`apps/backend/src/pdf/`); build an
  `InvoiceDocument` with final amounts – renderers never calculate. PDF labels come from the
  `pdf.*` keys via `translate()` from `@sim/i18n`.
- "Today" / the current year on the server: use `businessToday()` / `businessYear()`
  (Europe/Berlin), never `new Date()` directly.
- DB connections run in READ COMMITTED (ADR 0009): serialize with explicit `forUpdate()` row
  locks, and wrap write transactions that may run in parallel in `transactionWithRetry()`.
- Issued invoices are immutable: never re-render or change a finalized invoice; the stored PDF
  (`pdf_file_id`) is the reference copy.
- Migrations: add a new file in `apps/backend/src/migrations/` and register it in `index.ts`.
  Never edit a released migration.
- Integration tests use a real MariaDB (`test/helpers/db.ts`), no DB mocks.
