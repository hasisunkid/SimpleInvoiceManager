# ADR 0010 – Status lifecycle, overview and E2E setup

- **Status:** accepted (M6, 2026-11-21)
- **Requirements:** FR-INV-10, -13, -14, -20, -21, -22, NFR-PERF-01, TR-06, TR-07

## Decision

### Lifecycle

- Transitions are a table in the domain package (`nextStatus`, `allowedActions`):
  `DRAFT→OPEN` (finalize), `OPEN→PAID` (pay), `PAID→OPEN` (undo payment), `OPEN→CANCELLED`
  (cancel). Everything else answers `409 INVALID_STATUS_CHANGE`.
- A **paid invoice cannot be cancelled directly** – the diagram in the requirements only allows
  cancelling `OPEN` invoices; "undo payment" first makes the extra step explicit.
- Pay: payment date defaults to today, must lie between invoice date and today.
  Cancel: reason required (stored and logged); every user may cancel (decision D7).
- Every change uses the row lock + version check of the editor and writes
  `invoice_status_history` (user, time, note = payment date or reason); the editor shows it.
- "Overdue" stays derived (`OPEN` and due date before today in Europe/Berlin).

### Overview

- `GET /api/invoices/summary` – one aggregate query for the dashboard tiles.
- `GET /api/invoices` filters: status incl. `OVERDUE`, customer, invoice-date range, search
  (number or customer name, case/accent-insensitive), sort by date / number / amount.
  Number sort is "natural" (`CHAR_LENGTH`, then value) so 99 < 100. Measured with 5 000 invoices
  in the integration tests: well below 500 ms per request.
- The list keeps its filters in the URL query, so dashboard tiles link to it and "back" works.

### UI fixes found by E2E

- `RouterView` renders the component keyed by route name + params: "new X" → "edit X" uses the
  same component and must mount fresh; list query changes must not remount.
- The save area of long forms is no longer `position: sticky` – on phones it covered buttons
  and fields.

### E2E (Playwright)

- `npm run test:e2e` builds the image and starts a **separate** compose project (`sim-e2e`,
  own volumes, ports 8199/3399) with demo data, changes the bootstrap admin password once,
  runs the tests and tears the stack down (`E2E_REUSE=1` / `E2E_KEEP=1` for local loops).
- Three projects on Chromium: `mobile` (iPhone 13 viewport, touch, UA), `desktop`, and
  `ingress` – a tiny Node proxy serves the app under `/api/hassio_ingress/abc123/`, strips the
  prefix and sends `X-Ingress-Path`, so any absolute URL breaks the run (AR-13).
- Headless Chromium downloads PDFs instead of showing them, so the preview test checks the
  request the new tab makes and fetches the same URL with the session.
- CI runs the suite in its own job after lint/type-check/tests (TR-07).
