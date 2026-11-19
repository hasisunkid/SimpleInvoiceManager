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
- `docker compose up --build --wait` – full system on http://localhost:8099

Before reporting work as done: `npm run lint && npm run typecheck && npm test` must pass.

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
- Frontend calls go through `api` in `apps/frontend/src/api.ts` (adds the CSRF header).
- Migrations: add a new file in `apps/backend/src/migrations/` and register it in `index.ts`.
  Never edit a released migration.
- Integration tests use a real MariaDB (`test/helpers/db.ts`), no DB mocks.
