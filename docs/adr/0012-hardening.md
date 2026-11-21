# ADR 0012 – Hardening: headers, route audit, export, memory, migration tests

- **Status:** accepted (M8, 2026-11-21)
- **Requirements:** NFR-SEC-01, NFR-DATA-01/02, NFR-OPS-01, NFR-PERF-01, NFR-UX-04, NFR-MAINT-01

## Decision

- **Secure headers** via one `onSend` hook (no extra dependency): strict CSP without
  `unsafe-inline`/`unsafe-eval` (the Vite build has no inline scripts), `frame-ancestors 'self'`
  and `X-Frame-Options: SAMEORIGIN` because Home Assistant Ingress embeds the app in an iframe
  on the same origin; `blob:` allowed for frames/images (style preview).
- **Route audit as a test:** `buildApp` records every route with its `public`/`admin` flags; the
  security test fixes the list of public routes and the admin areas and calls every route
  anonymously (401) and as a normal user (403 on admin routes). New routes must be added to the
  expected lists on purpose.
- **Export (NFR-DATA-02):** `GET /api/admin/export/data` (JSON, all business tables, snapshots
  as objects, _no_ password hashes, _no_ sessions) and `GET /api/admin/export/pdfs` (ZIP,
  stored PDFs byte-identical, `YYYY/<reference file name>`). The ZIP is produced by a small
  streaming writer (stored entries, UTF-8 names, CRC32 from `node:zlib`) – no dependency, one
  file in memory at a time.
- **Unused logo uploads** are removed at startup after 24 h; invoice PDFs are never deleted.
- **No database triggers** to protect finalized invoices: they would need extra privileges in
  the HA MariaDB app (binary logging) and could break installations; protection stays in the
  application and its tests (D5).
- **Memory:** `NODE_OPTIONS=--max-old-space-size=160` in the image – measured with 1 CPU /
  512 MB: idle 78–111 MiB, peak 129 MiB (docs/performance.md).
- **Migrations** are tested from every earlier schema version with data to the latest one.
- **Accessibility:** axe (WCAG 2.0/2.1 A+AA) runs on seven main screens in the E2E suite on
  phone and desktop; no violations.
- `npm audit --omit=dev --audit-level=high` runs in CI.
