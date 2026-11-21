# SimpleInvoice Manager

Small web app for tradespeople (Handwerker) to write, manage and track invoices – mainly from a
smartphone. Runs as a **Home Assistant App** on top of the HA MariaDB app, or standalone with
Docker Compose. Requirements: [.claude/REQUIREMENTS.md](.claude/REQUIREMENTS.md).

**Status:** milestones **M0–M7** done (see [Milestones](#milestones)).

## Quick start (Docker Compose)

```bash
docker compose up --build --wait
open http://localhost:8099          # log in as admin / admin-local-dev (change it when asked)
curl http://localhost:8099/api/health
docker compose --profile tools up -d adminer   # optional DB UI on http://localhost:8080
```

Defaults are for local use only; override them in a `.env` file (see [.env.example](.env.example)).

## Home Assistant installation

1. Install and start the official **MariaDB** app.
2. Settings → Apps → App store → ⋮ → **Repositories** → add this repository's GitHub URL.
3. Install **SimpleInvoice Manager**, set `initial_admin_password`, start it and open
   **Rechnungen** in the sidebar.
4. **Backups:** invoice data lives in the MariaDB app – always back up both apps.

Details for users: [ha-app/DOCS.md](ha-app/DOCS.md). Publishing images and the acceptance test
on HA OS: [docs/ha-release.md](docs/ha-release.md).

## Development

Requirements: Node.js ≥ 24 (CI uses 26), Docker (for integration tests and the dev database).

```bash
npm install
docker compose up -d db                 # MariaDB on localhost:3306

# Terminal 1 – API on :8099 (TypeScript sources, auto-reload)
DB_HOST=127.0.0.1 DB_USER=simpleinvoice DB_PASSWORD=simpleinvoice npm run dev:backend
# Terminal 2 – UI on :5173 with /api proxied to :8099
npm run dev:frontend
```

| Command                 | What it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `npm test`              | Unit + integration tests (starts MariaDB via Testcontainers)      |
| `npm run test:coverage` | Same, with coverage gate ≥ 90 % for `packages/domain`             |
| `npm run lint`          | ESLint + Prettier check                                           |
| `npm run typecheck`     | `tsc -b` + `vue-tsc`                                              |
| `npm run build`         | Compile packages and backend, bundle frontend                     |
| `npm run format`        | Prettier write                                                    |
| `npm run test:e2e`      | Playwright E2E on a fresh compose stack (phone, desktop, ingress) |

To run integration tests against an already running MariaDB instead of a container:
`TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=root npm test`.

## Configuration (AR-16)

The app is configured **only** through environment variables. In Home Assistant mode,
`ha-app/run.sh` (M7) maps the HA options and MariaDB service credentials onto them.

| Variable                  | Default         | Meaning                                                     |
| ------------------------- | --------------- | ----------------------------------------------------------- |
| `DB_HOST` / `DB_PORT`     | – / `3306`      | MariaDB server (required host)                              |
| `DB_USER` / `DB_PASSWORD` | – / empty       | Credentials; user needs `CREATE DATABASE` or an existing DB |
| `DB_NAME`                 | `simpleinvoice` | Own database, created if missing. `homeassistant` refused.  |
| `DATA_DIR`                | `./.data`       | Logo and PDFs (`/data` in the container)                    |
| `SESSION_SECRET`          | random          | ≥ 32 chars; if unset, sessions end on restart               |
| `INITIAL_ADMIN_PASSWORD`  | random          | First-start password of `admin`; random one is logged once  |
| `PORT`                    | `8099`          | HTTP port                                                   |
| `LOG_LEVEL`               | `info`          | `fatal` … `trace`, `silent`                                 |
| `SEED_DEMO`               | `false`         | Demo customers/catalogue for an empty installation          |

## Architecture

```
apps/backend      Fastify 5 API, Knex migrations, PDF renderer (pdfmake) – serves the built SPA
apps/frontend     Vue 3 + Vite SPA, mobile-first, hash routing, relative URLs (Ingress)
packages/domain   Pure TypeScript: invoice calculation, money (integer cents), dates, IBAN/tax IDs, numbering
packages/i18n     de / pl / en translations for UI and PDF (German = reference shape)
docker/           Multi-stage Dockerfile (targets runtime and ha; amd64 + arm64)
ha-app/           Home Assistant App: config.yaml, run.sh, DOCS.md, icon, translations
e2e/              Playwright tests (phone, desktop, ingress path)
docs/adr/         Architecture decision records
```

- One container: backend serves `apps/frontend/dist` and the API under `/api`.
- `GET /api/health` – 200 when DB reachable and migrations applied, else 503.
- `GET /api/openapi.json` – OpenAPI 3 document generated from the route schemas.
- Migrations run automatically at startup, forward-only.
- Auth: own users (argon2id), DB sessions in an HttpOnly cookie, CSRF header, default-deny
  route guard, login throttling – see [ADR 0005](docs/adr/0005-authentication.md).
- PDFs: pdfmake with embedded Roboto, behind an `InvoiceRenderer` interface; logos are
  stored under `DATA_DIR` (SVG converted to PNG) – see [ADR 0006](docs/adr/0006-pdf-rendering-and-logos.md).
- Every error response is `{ "error": "<CODE>", "message": "…" }`; the UI translates the code.
- Logs are JSON on stdout; SIGTERM triggers a graceful shutdown.

Design decisions: [docs/adr/](docs/adr/).

## Milestones

| #   | Milestone                    | Status   |
| --- | ---------------------------- | -------- |
| M0  | Skeleton                     | ✅ done  |
| M1  | Auth & users                 | ✅ done  |
| M2  | Company, style, numbering    | ✅ done  |
| M3  | Customers & catalogue        | ✅ done  |
| M4  | Invoice editor & calculation | ✅ done  |
| M5  | PDF                          | ✅ done  |
| M6  | Lifecycle & overview (+ E2E) | ✅ done  |
| M7  | Home Assistant App           | ✅ done¹ |
| M8  | Hardening                    | next     |

¹ Verified in a local HA simulation; installation on real HA OS (amd64 + aarch64) is the
acceptance step in [docs/ha-release.md](docs/ha-release.md).

### M0 demo note

`docker compose up --build --wait` builds the image, starts MariaDB, creates the
`simpleinvoice` database, applies migration `0001_app_user`, and serves the (not yet functional)
login page in de/pl/en on http://localhost:8099. Health check: `{"status":"ok",...}`.

### M1 demo note

On first start the app creates `admin` (password from `INITIAL_ADMIN_PASSWORD`, or a random
one printed once in the log) and forces a password change at first login. Afterwards:

- **Users** tab (admins only): create users with a start password (they must change it at first
  login), edit name / role / language, reset passwords, deactivate and reactivate. The last
  active admin cannot be demoted or deactivated.
- **Profile** tab: own UI language (de / pl / en or "same as browser") and password change;
  changing the password signs out all other devices.
- "Stay signed in" keeps the session for 30 days, otherwise 12 hours. Five wrong passwords lock
  the username for one minute.

### M2 demo note

- **Company** tab (every user): address, contact, Steuernummer / USt-IdNr., VAT mode (regular or
  Kleinunternehmer § 19 UStG), bank details with IBAN/BIC check, defaults (payment term, VAT
  rate, signature) and intro/closing texts in de/pl/en. A checklist shows what is still missing
  before invoices can be finalized.
- **Settings → Invoice design** (admin): upload a logo (PNG/JPG/SVG ≤ 2 MB), choose left/right
  and the accent colour, and open a sample invoice PDF with the unsaved settings in any of the
  three languages.
- **Settings → Invoice numbers** (admin): start number (e.g. 104 as in the reference invoices),
  optional prefix with `{YYYY}`, zero padding and yearly restart, with a live example. Numbers
  are only assigned when an invoice is finalized (M5) – 25 parallel finalizations get 25
  consecutive numbers without gaps (TR-03).

### M3 demo note

- Bottom bar: **Start · Kunden · Leistungen · Mehr** (company, profile and admin settings are
  under "Mehr").
- **Kunden**: search as you type over name, company, contact person and city – case- and
  accent-insensitive ("lukasz" finds "Łukasz"). Business or private customers, invoice
  language per customer, archive / restore; delete is refused once invoices exist.
- **Leistungen**: catalogue of work and material positions with unit (Std., Stk., m, m², m³,
  kg, pauschal), net price and VAT rate; inactive items are hidden from the selection.
- The customer picker with quick create (name + address) is ready for the invoice editor (M4).
- `docker compose up` with `SEED_DEMO=true` adds three demo customers and five catalogue items
  to an empty installation.

### M4 demo note

- **Neue Rechnung** (start page, invoice list, customer page, floating button elsewhere) creates
  a draft with today's date, the default payment term and the customer's invoice language.
- Editor: pick or quick-create the customer, add positions from the catalogue (one tap) or as
  free lump-sum lines, edit description, quantity (3 decimals), unit, price and VAT, reorder
  (↑/↓ on phones, drag & drop on desktop), duplicate, delete, "save as template".
- Totals update instantly: work/material subtotals, VAT per rate, gross and – for private
  customers – the labour share incl. VAT for § 35a EStG; § 19 mode shows no VAT.
- Drafts save themselves (also when the phone locks); a change from another device is detected
  instead of being overwritten. A checklist shows what § 14 UStG still needs.
- Copy any invoice into a new draft; delete drafts. The customer page lists the customer's
  invoices with the open total; customers with invoices can no longer be deleted.
- Creating, finalizing as PDF and the status lifecycle follow in M5/M6.

### M5 demo note

- In the editor, **Vorschau (PDF)** opens the current draft as PDF with an "ENTWURF" watermark.
- **Rechnung erstellen (PDF)** (enabled once the § 14 checklist is empty) asks for confirmation,
  then assigns the next number, freezes company and customer data, stores the PDF and sets the
  status to "Offen". The invoice is read-only from then on.
- Finalized invoices offer **PDF öffnen** (browser viewer), **PDF teilen** (share sheet on
  phones) and **PDF herunterladen**; the file is always the stored original, named like
  `RechnungsNr_104_Karaca_22.05.2024.pdf`.
- The PDF follows the reference invoices: work and material sections with subtotals, VAT per
  rate, the § 35a labour share for private customers, the § 19 note for Kleinunternehmer, and
  labels/number formats in the document language (de/pl/en); long invoices continue over several
  pages with repeated table header and "Seite x von y".

### M6 demo note

- **Start** shows tiles for drafts, open (with sum), overdue (red) and paid this year; a tap
  opens the filtered invoice list.
- **Rechnungen**: search by number or customer, status filter (incl. overdue), invoice-date
  range and sorting by date, number or amount; filters stay in the URL.
- A finalized invoice can be **marked as paid** (payment date, default today), the payment can
  be **undone**, and an open invoice can be **cancelled** with a reason (by every user) – it
  keeps its number; "Korrigierte Kopie erstellen" starts the corrected draft. The history shows
  every status change with user and time.
- `npm run test:e2e` runs the Playwright suite against a fresh compose stack on an iPhone-13
  viewport, on desktop and behind an ingress-like base path (15 tests: login, customer, invoice
  from catalogue, preview, finalize, PDF download, mark paid, quick-create, admin creates user,
  logo upload).

### M7 demo note

- `ha-app/` is a complete Home Assistant App: Ingress panel "Rechnungen", MariaDB via the
  Supervisor services API with the app's own database, options for database name, initial admin
  password and log level (translated de/en/pl), optional direct port, watchdog, icon and logo.
- `docker build -f docker/Dockerfile --target ha .` builds the app image (amd64 and arm64); the
  release workflow publishes both to GHCR on a version tag.
- Simulated locally with MariaDB and a fake Supervisor: the E2E ingress suite passes against the
  HA-mode container, the `homeassistant` database stays untouched, sessions and files survive
  restarts, missing MariaDB / reserved names stop with clear messages.
