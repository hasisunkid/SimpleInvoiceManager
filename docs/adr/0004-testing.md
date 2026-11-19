# ADR 0004 – Testing: Vitest projects, Testcontainers MariaDB

- **Status:** accepted (M0, 2026-11-19)
- **Requirements:** TR-01, TR-02, TR-08

## Decision

- **Vitest** for all unit and integration tests, one root config with a project per workspace.
  `fast-check` for property-based tests of the domain package. Coverage gate ≥ 90 % on
  `packages/domain` (`npm run test:coverage`).
- Integration tests run against a **real MariaDB 11.4** started by **Testcontainers** – no
  mocks of the database. Each test file uses its own database.
- To reuse an existing server instead (faster local loops), set `TEST_DB_HOST`,
  `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`, e.g. the compose DB with root.
- Frontend component tests run in `jsdom` with `@vue/test-utils`.
- E2E (Playwright, TR-06) is added in M6.

## Consequences

- `npm test` requires a running Docker daemon (or `TEST_DB_*`).
