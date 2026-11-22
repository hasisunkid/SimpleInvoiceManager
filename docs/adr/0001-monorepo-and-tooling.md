# ADR 0001 – Monorepo with npm workspaces, ESM and TypeScript project references

- **Status:** accepted (M0, 2026-11-19)
- **Requirements:** AR-02, AR-05, NFR-MAINT-01, TR-08

## Context

Backend, frontend and the shared domain / i18n packages must share code (AR-05) and be
built, linted and tested with single commands (TR-08).

## Decision

- **npm workspaces** (no extra tool such as pnpm/turbo – one less thing to install).
- Everything is **ES modules**, TypeScript `strict` + `noUncheckedIndexedAccess`.
- Workspace packages expose a custom **`sim-source` export condition** pointing at `src/*.ts`
  (named `source` until M9 – renamed because dependencies such as `eventsource-parser` publish
  their own `source` condition with TypeScript files).
  Vite, Vitest, `tsx` (dev) and `tsc` (`customConditions`) resolve the TypeScript sources
  directly; production Node resolves the compiled `dist/`. No watch builds of packages needed.
- `tsc -b` with project references builds `packages/*` and `apps/backend`; the frontend is
  type-checked with `vue-tsc` and bundled by Vite.
- **Pinned majors:** TypeScript 5.9 (typescript-eslint does not support TS ≥ 6.1 yet),
  ESLint 9, Vite 7, Vitest 3 – newer majors exist but bring no benefit for v1.
- One root `vitest.config.ts` runs all workspace test projects.

## Consequences

- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` work from the root.
- Upgrading TypeScript to 6/7 waits for typescript-eslint and vue-tsc support.
