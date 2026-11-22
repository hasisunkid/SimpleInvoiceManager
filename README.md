# SimpleInvoice Manager

Small web app for tradespeople (Handwerker) to write, manage and track invoices – mainly from a
smartphone. Runs as a **Home Assistant App** on top of the HA MariaDB app, or standalone with
Docker Compose. Requirements: [.claude/REQUIREMENTS.md](.claude/REQUIREMENTS.md).

**Status:** milestones **M0–M10** done (M9 awaiting the manual acceptance with an AI client) –
see [Milestones](#milestones).

## Features

- Users with roles (admin / user), own login, German / Polish / English UI
- Company details, invoice design (logo, accent colour, live PDF preview), gap-free numbering
- Customers (business / private) and a catalogue of reusable work and material positions
- Mobile invoice editor with live totals, auto-save, § 14 UStG completeness check
- Standard VAT (19 / 7 / 0 %) or Kleinunternehmer (§ 19 UStG); § 35a labour share for private
  customers; work and material sections
- Finalize as PDF (DIN 5008 window envelope layout, de / pl / en), stored as the reference copy;
  share or download on the phone
- Status tracking (open, overdue, paid, cancelled) with history, dashboard and filtered lists
- Data backup: all data as JSON, all PDFs as ZIP
- AI assistants (MCP, optional): dictate an invoice to Claude & co. – it creates a **draft**,
  reusing similar customers and catalogue entries; everything it creates is marked
  "Von KI erstellt" until a person checks it
- Runs as a Home Assistant App (Ingress, MariaDB app) or standalone with Docker Compose

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
| `node scripts/perf.mjs` | Performance measurement against a running stack (NFR-PERF-01)     |
| `npx changeset`         | Describe a user-visible change for the release notes (AR-20)      |
| `npm run release:check` | ha-app version, `config.yaml` and changelog agree (TR-20)         |

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
| `APP_VERSION`             | `dev`           | Set by the image build (`BUILD_VERSION`), shown in the UI   |
| `MCP_ENABLED`             | `false`         | MCP server for AI assistants at `POST /mcp` (FR-MCP-12)     |
| `PUBLIC_URL`              | –               | App address used in links returned to AI assistants         |

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

## Quality and operations

| Topic                             | Where                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests                             | Unit + integration (Vitest, real MariaDB via Testcontainers, 100 % line coverage of `packages/domain`), E2E (Playwright on iPhone-13 viewport, desktop and an ingress-like base path, incl. axe accessibility checks). CI runs lint, type-check, `npm audit`, all tests, E2E, the HA app linter and the multi-arch image build. |
| Security                          | [docs/security.md](docs/security.md) – review against NFR-SEC-01; every endpoint's access rule is checked by a test.                                                                                                                                                                                                            |
| Performance                       | [docs/performance.md](docs/performance.md) – p95 ≤ 22 ms with 5 000 invoices, 3-page PDF < 1 s, 78–129 MiB memory (1 CPU / 512 MB container).                                                                                                                                                                                   |
| Backups                           | Home Assistant backup of **both** apps (MariaDB + SimpleInvoice Manager); in addition _Mehr → Verwaltung → Datensicherung_ downloads all data (JSON) and all PDFs (ZIP).                                                                                                                                                        |
| Releases                          | [docs/ha-release.md](docs/ha-release.md) – Changesets: `npx changeset` per change, merge the "Version Packages" PR to release (tag, images, GitHub Release); acceptance checklist for HA OS.                                                                                                                                    |
| Open points for the product owner | Requirements §10: § 13b reverse charge and partial invoices (v1.1), e-mail sending, quotes.                                                                                                                                                                                                                                     |

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
| M8  | Hardening                    | ✅ done  |
| M9  | MCP server (v1.1)            | ✅ done³ |
| M10 | Release notes (Changesets)   | ✅ done² |

¹ Verified in a local HA simulation; installation on real HA OS (amd64 + aarch64) is the
acceptance step in [docs/ha-release.md](docs/ha-release.md).
² TR-21 done with release v0.8.0 (Version PR → tag → images → GitHub Release); the Home
Assistant update check is the last manual step.
³ TR-MCP-01 is automated; TR-MCP-02 (the example flow with Claude Desktop / Claude Code, then a
person finalizes the draft) is the product owner's acceptance – setup in
[ha-app/DOCS.md](ha-app/DOCS.md#ai-assistants-mcp-optional).

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

### M8 demo note

- Every response carries a strict Content Security Policy and other secure headers; a test walks
  all API routes and proves that only five are public and every admin route refuses normal users.
- _Mehr → Verwaltung → Datensicherung_ downloads all data as JSON (without password hashes) and
  all invoice PDFs as ZIP, sorted by year.
- Migrations are tested from every earlier schema version with data; unused logo uploads are
  cleaned up automatically; the Node heap is capped for small devices.
- No WCAG 2.1 A/AA violations on the main screens (axe, phone and desktop); performance measured
  with 5 000 invoices on a container limited to 1 CPU / 512 MB – see docs/performance.md.

### M10 demo note

- Every user-visible change now comes with a changeset (`npx changeset`): a short English text
  for users and the kind of change (fix / feature / breaking). CI refuses changes to the app
  without one.
- On every push to `main`, GitHub keeps a **"Version Packages"** pull request up to date: new
  version, `ha-app/config.yaml` and the release notes in `ha-app/CHANGELOG.md` (the changelog
  Home Assistant shows). Merging it tags `vX.Y.Z`, publishes the images and a GitHub Release.
- The running version is shown on the login screen and on _Mehr_ (linked to its release notes)
  and returned by `/api/health`; local builds show `dev`.

### M9 demo note

- _Mehr → Mein Profil → KI-Zugänge_: create a personal access key (shown once, revocable;
  admins see all keys under _Verwaltung → KI-Zugänge_).
- With `MCP_ENABLED=true`, an MCP client connects to `POST /mcp` (Streamable HTTP) with
  `Authorization: Bearer <key>`, e.g.
  `claude mcp add --transport http rechnungen http://localhost:8099/mcp --header "Authorization: Bearer sim_…"`.
- "Write an invoice to omicron service: 3 h plastering at 48 €, material lump sum 640 €" →
  the existing "Omicronservice GmbH" and the catalogue entry "Material" are reused, a new
  entry "Putzarbeiten" is created – draft with 932,96 € incl. 19 % VAT and a link to open it.
- Lists of invoices, customers and catalogue show "Von KI erstellt" with a filter; saving or
  "Geprüft" removes the mark. The assistant has no tool to finalize, pay or cancel – and its
  draft tools refuse finalized invoices.
