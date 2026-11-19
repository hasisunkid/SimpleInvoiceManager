# ADR 0003 – Frontend: Vue 3 + Vite, relative URLs and hash routing for Ingress

- **Status:** accepted (M0, 2026-11-19)
- **Requirements:** AR-04, AR-13, FR-I18N-01, TR-05, NFR-UX-01

## Context

Under Home Assistant Ingress the app is reached at `/api/hassio_ingress/<token>/`; the token
differs per installation and the proxy strips the prefix before forwarding. The same image
must also work at `/` (direct port, AR-14).

## Decision

- **Vue 3 + Vite**, built statically and served by the backend (one container).
- Vite `base: './'` → all asset URLs in `index.html` are relative.
- All API calls use **document-relative** paths (`fetch('api/health')`, no leading slash).
- **Hash history** (`#/login`) – the document URL always stays at the base path, so the
  server needs no SPA fallback and no knowledge of the ingress path for routing.
- The backend still reads and sanitizes `X-Ingress-Path` into `request.basePath` – needed
  for cookie paths (FR-AUTH-07, M1).
- Translations live in `@sim/i18n` as typed TS objects (German is the reference shape), used
  by `vue-i18n` in the UI and later by the PDF renderer. `vue/no-bare-strings-in-template`
  forbids hard-coded UI strings (TR-05).

## Consequences

- URLs contain `#/…`; acceptable for an internal tool.
- Never use absolute paths (`/api/…`, `/assets/…`) in frontend code – the E2E run under an
  ingress-like base path (TR-06) will catch regressions.
