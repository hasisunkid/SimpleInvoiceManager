# ADR 0002 – Backend: Fastify 5, TypeBox, Knex + mysql2

- **Status:** accepted (M0, 2026-11-19)
- **Requirements:** AR-02, AR-03, AR-07, AR-08, AR-12, AR-18, NFR-PERF-01

## Decision

- **Fastify 5** – small footprint for the Raspberry Pi target (idle RSS of the container
  measured at ~57 MiB in M0).
- **TypeBox** schemas (`@fastify/type-provider-typebox`) serve as validation, TypeScript
  types and **OpenAPI 3** source at once (`@fastify/swagger`, `GET /api/openapi.json`).
- **Knex 3 + mysql2** as query builder. Reasons: mature MariaDB support, `forUpdate()` row
  locks for the number sequence (FR-NUM-03), plain SQL when needed, no native binaries.
- **Migrations are registered explicitly** in `apps/backend/src/migrations/index.ts`
  (custom `MigrationSource`) instead of filesystem discovery, so the same list runs from TS
  sources and compiled JS. They run automatically at startup (AR-03), forward-only (NFR-OPS-01).
- The app **creates its own database** (`CREATE DATABASE IF NOT EXISTS`, utf8mb4) and refuses
  reserved names such as `homeassistant` (AR-12). This is done in application code so that
  standalone and HA mode share one code path (AR-16).
- Connection uses `utf8mb4` and UTC (`timezone: 'Z'`). Money columns will be integer cents
  (`INT`/`BIGINT`), never floats (AR-08).

## Consequences

- No ORM entity layer – repositories write explicit queries; types come from TypeBox schemas.
