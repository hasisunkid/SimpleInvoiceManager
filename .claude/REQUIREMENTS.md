# SimpleInvoice Manager – Requirements Specification

> **Audience:** Claude Code (implementation agent) and the product owner.
> **Status:** v1.0 – 2026-11-19
> **Rule for the implementer:** Requirements are identified by IDs (`AR-`, `FR-`, `NFR-`, `TR-`). Reference these IDs in commit messages, tests and code comments where useful. If a requirement is ambiguous or two requirements conflict, **stop and ask the product owner** instead of guessing. Where this document says *"Implementer's choice"*, pick the simplest robust option and record it in `docs/adr/` as a short ADR.

---

## 1. Purpose and Scope

SimpleInvoice Manager is a small web application that lets **non-technical tradespeople (Handwerker)** write, manage and track invoices, mainly from a **smartphone**. Invoices are always produced as **PDF** and must look like the reference invoices in Appendix A.

The application runs as a **Home Assistant App** (formerly "add-on") and uses the existing **Home Assistant MariaDB app** for persistence. For development and testing it also runs standalone with Docker Compose.

### 1.1 Users

| Persona | Description |
|---|---|
| **Normal User** | Tradesperson or family member doing the office work. Little IT knowledge. Uses a phone at the construction site and occasionally a PC. Languages: German, Polish, English. |
| **Admin** | Sets up the installation: users, invoice look (logo), invoice number range. Usually the business owner or a technically savvy relative. |

### 1.2 Product decisions (confirmed by product owner)

| # | Decision |
|---|---|
| D1 | **Single business per installation.** All users share one company profile, one customer base, one invoice list and one number range. No multi-tenancy. |
| D2 | **Plain PDF in v1**, but the data model must already hold every field needed for **ZUGFeRD / EN 16931** so that e-invoicing can be added later **without a schema migration of existing data** (see §8). |
| D3 | **Tax variants in v1:** standard VAT (19 % / 7 %, 0 % allowed per line) and **Kleinunternehmer § 19 UStG**. |
| D4 | **Access via Home Assistant Ingress.** The app keeps its **own user management** in addition (no SSO, no federation). |
| D5 | Full legal compliance (GoBD etc.) is **not** a goal; reasonable, cheap safeguards (immutable finalized invoices, gap-free numbering) **are** required. |
| D6 | **Logo and invoice style are Admin-only** (resolves the conflict between FR 2.2 and user story #2). |
| D7 | **Normal users may cancel (storno) invoices** – no admin role required (FR-INV-13). Confirmed 2026-11-19. |
| D8 | **MCP server (§4.10) confirmed** 2026-11-22: every user may use it with an own API token; remote clients via Streamable HTTP only (no stdio bridge); personal API tokens (no OAuth in v1.1). **Lookup rule:** the LLM uses a *similar* existing customer / catalogue entry if one is found; only if nothing similar exists, a new one is created automatically and marked as AI-created. The invoice stays a draft, so a human checks and corrects everything before finalizing. |
| D9 | **Release notes with Changesets (§3.4) confirmed** 2026-11-22: release notes are written in **English**; releases go through the automated **"Version Packages" pull request**; the running **version is visible in the UI**. |

### 1.3 Out of scope for v1 (roadmap, design must not block these)

- § 13b UStG reverse charge (used in reference invoices 104 and 115) → **v1.1, high priority**
- Abschlagsrechnung / Schlussrechnung (partial and final invoices, ref. invoice 115-1) → **v1.1, high priority**
- ZUGFeRD / XRechnung output
- Sending invoices by e-mail from the app
- Quotes (Angebote), dunning (Mahnungen), DATEV export
- Multiple currencies (EUR only)
- Receiving / parsing incoming e-invoices
- **MCP server for AI assistants** (LLM creates invoice *drafts*, §4.10) → **v1.1 – confirmed (D8), milestone M9**
- **Automated release notes with Changesets** (§3.4) → **next milestone (M10) – confirmed (D9)**

---

## 2. Glossary

| Term (EN) | German | Polish | Meaning |
|---|---|---|---|
| Invoice | Rechnung | Faktura | The document sent to the customer |
| Position / line item | Position | Pozycja | One line of the invoice |
| Work | Arbeit / Lohn | Robocizna | Labour position |
| Material | Material | Materiał | Material position |
| Catalogue item | Leistungskatalog-Eintrag | Pozycja katalogowa | Reusable position template |
| Company profile | Firmenstammdaten | Dane firmy | Sender data on every invoice (header + footer) |
| Site address | Baustellenadresse | Adres budowy | Where the work was done |
| Service date | Leistungsdatum | Data wykonania usługi | When the work was done (mandatory § 14 UStG) |
| Payment term | Zahlungsziel | Termin płatności | Days until due |
| Tax number | Steuernummer | Numer podatkowy | St.-Nr. from the Finanzamt |
| VAT ID | USt-IdNr. | NIP UE | EU VAT identification number |
| Small business | Kleinunternehmer (§ 19 UStG) | Mały przedsiębiorca | No VAT is charged |

---

## 3. Architecture Requirements

### 3.1 Technology stack

| ID | Requirement |
|---|---|
| **AR-01** | Web application, usable in current mobile and desktop browsers (Chrome/Edge, Safari iOS, Firefox; last 2 major versions). |
| **AR-02** | **Backend:** Node.js (current LTS) with **TypeScript** (strict mode). Framework is implementer's choice; recommended: **Fastify** (small footprint) or NestJS. |
| **AR-03** | **Persistence:** MariaDB ≥ 10.6. Use an ORM/query builder with **versioned migrations** (recommended: Drizzle or Knex; Prisma acceptable if it runs on aarch64). Migrations run automatically at startup. |
| **AR-04** | **Frontend:** SPA framework is implementer's choice (recommended: Vue 3 or React + Vite). Mobile-first UI component library allowed. Built statically and **served by the backend** (one container). |
| **AR-05** | **Shared domain package:** invoice calculation (totals, VAT, rounding) is implemented **once** in a framework-free TypeScript package used by backend and frontend. Prefer pure functions and immutable data structures. |
| **AR-06** | **PDF generation** runs server-side. It must work on **aarch64 (Raspberry Pi 4/5) with ≤ 512 MB RAM** for the app container. A pure-JS renderer (e.g. pdfmake / pdfkit) is preferred over headless Chromium for footprint. PDF rendering sits behind an interface (`InvoiceRenderer`) so a ZUGFeRD renderer can be added later. |
| **AR-07** | REST/JSON API, documented as **OpenAPI 3** (generated from code or schema). Validation of all input with a schema library (e.g. Zod / TypeBox). |
| **AR-08** | Money is stored and calculated as **integer cents** (or `DECIMAL(12,2)` in the DB with a decimal library in code). **Never use binary floating point** for money. |

### 3.2 Containerization and Home Assistant App

| ID | Requirement |
|---|---|
| **AR-10** | One Docker image contains backend + built frontend. Multi-stage build. Target architectures: **amd64 and aarch64**. |
| **AR-11** | The repository contains a Home Assistant App definition (`ha-app/config.yaml`, `Dockerfile` or `build.yaml`, `run.sh`, `DOCS.md`, `CHANGELOG.md`, icon/logo) installable via a custom app repository URL. |
| **AR-12** | The HA App declares `services: ["mysql:need"]` and on startup reads host, port, username and password of the MariaDB app from the Supervisor services API (e.g. via `bashio::services mysql ...`). It then creates its **own database** (default name `simpleinvoice`, configurable) if it does not exist. It must **never** touch the `homeassistant` recorder database. |
| **AR-13** | **Ingress:** `ingress: true`. The app must run under the dynamic base path provided in the `X-Ingress-Path` header: all frontend asset URLs and API calls must be relative or prefixed with the ingress path; cookies must use the correct path. |
| **AR-14** | Optional direct port (disabled by default in `config.yaml`), so the same image can also be reached without Ingress. |
| **AR-15** | Persistent files (logo, generated PDFs) are stored under `/data` (included in HA backups). `DOCS.md` must state that the **MariaDB app must also be part of the backup**, since invoice data lives there. |
| **AR-16** | Configuration in standalone mode via environment variables: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DATA_DIR`, `SESSION_SECRET`, `INITIAL_ADMIN_PASSWORD`, `PORT`, `LOG_LEVEL`. In HA mode `run.sh` maps the HA options and service credentials onto these variables, so **the application code has one configuration path only**. |
| **AR-17** | `docker-compose.yml` for local development/testing: MariaDB + app (+ optional Adminer). `docker compose up` must produce a working system with a seeded admin and demo data (demo data only when `SEED_DEMO=true`). |
| **AR-18** | Health endpoint `GET /api/health` (DB reachable, migrations applied). Structured JSON logging to stdout. Graceful shutdown. |

### 3.3 Suggested repository layout (implementer may adapt)

```
/apps/backend        Fastify/Nest API, migrations, PDF renderer
/apps/frontend       SPA (mobile-first)
/packages/domain     pure TS: calculation, validation rules, number formatting
/packages/i18n       translation files de / pl / en (UI + PDF labels)
/ha-app              Home Assistant App packaging
/docs/adr            architecture decision records
/e2e                 Playwright tests
docker-compose.yml
```

### 3.4 Release management and release notes (Changesets, confirmed – D9, milestone M10)

> **Goal:** every user-visible change is described when it is made; release notes, version
> numbers and the Home Assistant changelog are then generated automatically instead of being
> written by hand at release time.

| ID | Requirement |
|---|---|
| **AR-20** | The repository uses **[Changesets](https://github.com/changesets/changesets)** (`@changesets/cli`) to record changes: every user-visible change (feature, fix, breaking change) comes with a changeset file in `.changeset/` describing it in plain language and its semver bump (patch / minor / major). |
| **AR-21** | **One product version:** the released unit is the Home Assistant App. `ha-app/` becomes a private workspace package (`package.json`, never published to npm) that Changesets versions; the internal packages (`@sim/*`) are not versioned separately. After `changeset version`, a script syncs the new version into `ha-app/config.yaml` and the release notes into `ha-app/CHANGELOG.md`, the changelog Home Assistant shows on the app page. |
| **AR-22** | **Automated flow (GitHub Actions, `changesets/action`, D9):** pushes to `main` with pending changesets open or update a **"Version Packages" pull request** containing the version bump, `config.yaml` and the generated changelog. Merging it creates the tag `vX.Y.Z`, which triggers the existing release workflow (images to GHCR) and creates a **GitHub Release** whose text is the changelog entry. No manual version edits or tags. |
| **AR-23** | **Changelog content:** release notes in **English** (D9), grouped by Major / Minor / Patch changes, written for users (no internal jargon), with links to the commit/PR (`@changesets/changelog-github`). Existing entries (0.7.0) are kept. |
| **AR-24** | **CI guard:** a check fails when a change to `apps/`, `packages/` or `ha-app/` is pushed or proposed without a changeset (`changeset status`), except for changes explicitly marked as internal (empty changeset via `changeset --empty`). |
| **AR-25** | `CLAUDE.md` and `README.md` describe the workflow: `npx changeset` after each user-visible change; the implementer (Claude Code) adds changesets for its own milestones. |
| **AR-26** | **Version visible in the UI (D9):** the running version (e.g. `0.8.0`) is shown on the login screen and on the *Mehr* page, linked to the GitHub release notes of that version, and returned by `GET /api/health` (`version`). Single source of truth is the Changesets-managed version: it is passed into the image at build time (`BUILD_VERSION`), so UI, health endpoint, `config.yaml` and image tag always match; local builds show `dev`. |

**Tests / acceptance**

| ID | Requirement |
|---|---|
| **TR-20** | In CI and locally: `changeset version` on a test changeset bumps `ha-app/package.json`, `ha-app/config.yaml` and `ha-app/CHANGELOG.md` consistently (the release workflow's tag check passes). |
| **TR-22** | The UI shows the version from the build (unit test: version label on login and *Mehr*; integration test: `/api/health` returns the `BUILD_VERSION` of the image; E2E: the version in the UI equals the image tag). |
| **TR-21** | Acceptance: one real change goes through the flow – changeset → Version PR → merge → tag → images on GHCR → Home Assistant shows the update with the new release notes. |

---

## 4. Functional Requirements

### 4.1 Authentication and user management (FR 1, FR 2)

| ID | Requirement |
|---|---|
| **FR-AUTH-01** | The app has its own user store (username + password). No self-registration, no SSO, no OAuth. |
| **FR-AUTH-02** | Two roles: `USER` and `ADMIN`. An admin can do everything a user can. |
| **FR-AUTH-03** | **Bootstrap:** on first start with an empty user table, an `admin` account is created with the password from `INITIAL_ADMIN_PASSWORD` (HA option). If none is set, a random password is generated and printed **once** to the log. The admin must change it on first login. |
| **FR-AUTH-04** | Admin can create, edit, deactivate and reactivate users, set the role and reset passwords (user must change a reset password at next login). The last active admin cannot be deactivated or demoted. |
| **FR-AUTH-05** | Every user can change their own password and their **UI language**. |
| **FR-AUTH-06** | Passwords hashed with **argon2id** (or bcrypt cost ≥ 12). Minimum length 10. Login rate limiting (e.g. 5 failures → 1 min lock per username/IP). |
| **FR-AUTH-07** | Session-based authentication with HttpOnly, SameSite=Strict cookie; CSRF protection on state-changing requests. Session lifetime 30 days with "stay logged in" (phone use), otherwise 12 h. |
| **FR-AUTH-08** | All actions on invoices store `created_by` / `updated_by` and timestamps. |

> **Note (Ingress, D4):** With Ingress every person also needs a Home Assistant account and HA remote access (Nabu Casa or own reverse proxy) for use outside the home network. Users will therefore log in twice (HA + app). This is accepted for v1. AR-14 keeps the option of direct access open.

### 4.2 Internationalisation

| ID | Requirement |
|---|---|
| **FR-I18N-01** | UI available in **German, Polish, English**. Default = browser language, fallback German. User can override in profile. |
| **FR-I18N-02** | **Invoice document language** is independent of UI language: each customer has a preferred invoice language (default German); it can be overridden per invoice. All fixed PDF labels ("Rechnung", "Datum", "Zahlungsziel", "Zwischensumme", ...) exist in de/pl/en. Free texts entered by the user are printed as entered. |
| **FR-I18N-03** | Number and date formatting follows the document language (de: `1.755,00 €`, `22.05.2024`). |
| **FR-I18N-04** | All translation keys are complete in all three languages – enforced by an automated test (TR-05). |
| **FR-I18N-05** | Fonts in UI and PDF must support Polish and German characters (ą ć ę ł ń ó ś ź ż ä ö ü ß). The owner's own name (*Góralewicz*) is a test case. |

### 4.3 Company profile (invoice header and footer – FR 4.1)

| ID | Requirement |
|---|---|
| **FR-COMP-01** | Exactly one company profile, editable by **every user** (FR 4). Fields: company/display name, owner name, street, ZIP, city, country (default DE), phone, mobile, e-mail, website (optional), **Steuernummer**, **USt-IdNr.** (optional), bank name, IBAN, BIC, account holder (default owner). |
| **FR-COMP-02** | Tax mode: `REGULAR` (VAT is charged) or `SMALL_BUSINESS_19` (Kleinunternehmer). This is a **company-level** setting, not per invoice. |
| **FR-COMP-03** | Defaults: payment term in days (default 30), default VAT rate (19 %), default intro text, default closing text (e.g. "Wir bedanken uns für den Auftrag ..."), signature name. Each default text can be maintained in de/pl/en. |
| **FR-COMP-04** | Validation: IBAN checksum (mod 97), BIC format, either Steuernummer or USt-IdNr. required before the first invoice can be finalized. |
| **FR-COMP-05** | **Snapshot:** when an invoice is finalized, the full company profile **and** customer address are copied into the invoice. Later changes to the profile or customer never change finalized invoices. |

### 4.4 Invoice style and number range (Admin – FR 2.2, US #2, US #7)

| ID | Requirement |
|---|---|
| **FR-STYLE-01** | Admin uploads a **logo** (PNG, JPG or SVG, max 2 MB). It is shown top-left/top-right (configurable) on the PDF. Without a logo, the company name is printed as large text (as in the reference invoices). |
| **FR-STYLE-02** | Admin can set an **accent colour** (default `#3A7CA5`, the blue of the reference invoices) used for lines, table header and footer text. |
| **FR-STYLE-03** | **Live preview:** admin sees a sample PDF with the current settings before saving. |
| **FR-NUM-01** | Admin configures the invoice number range: **start number** (required, US #7), optional prefix (e.g. `RE-`), optional year placeholder (`{YYYY}`), optional yearly reset. Default format = plain integer as in the reference invoices (`104`). |
| **FR-NUM-02** | Numbers are assigned **only when an invoice is finalized**, never to drafts – this keeps the sequence gap-free. |
| **FR-NUM-03** | Assignment is atomic and concurrency-safe (DB transaction with row lock on the sequence row). Two parallel finalizations never get the same number (covered by test). |
| **FR-NUM-04** | The next number can be raised but **not lowered** below the highest number already used. |

### 4.5 Customers (US #3, US #4)

| ID | Requirement |
|---|---|
| **FR-CUST-01** | Users can create, edit, search and archive customers. Fields: customer type (`BUSINESS` / `PRIVATE`), company name, contact person ("Z. Hd."), street, ZIP, city, country, e-mail, phone, USt-IdNr. (optional), preferred invoice language, notes. |
| **FR-CUST-02** | Search as you type over name, company, contact person, city (≥ 2 characters, result within 300 ms for 5 000 customers). |
| **FR-CUST-03** | Customer detail page lists **all invoices of this customer** with status and amount, plus open total (US #4). |
| **FR-CUST-04** | Customers with invoices cannot be deleted, only archived (hidden from selection, still visible on old invoices). Customers without invoices can be deleted. |
| **FR-CUST-05** | A customer can be **quick-created from the invoice editor** with only name + address (mobile flow, US #5). |

### 4.6 Position catalogue (reusable positions – FR 4.2, 4.3)

| ID | Requirement |
|---|---|
| **FR-CAT-01** | Users manage a catalogue of reusable positions: **type `WORK` or `MATERIAL`** (mandatory), short title, description (multi-line), unit, default unit price (net), default VAT rate, active flag. |
| **FR-CAT-02** | Units: predefined list (Std. / h, Stk. / pcs, m, m², m³, kg, pauschal / lump sum) mapped internally to UN/ECE Rec. 20 codes (`HUR`, `H87`, `MTR`, `MTK`, `MTQ`, `KGM`, `LS`) for later ZUGFeRD use. |
| **FR-CAT-03** | When adding a position to an invoice, the user can search the catalogue and insert an item; values are **copied** – later catalogue edits do not change existing invoices. |
| **FR-CAT-04** | A position typed in an invoice can be saved to the catalogue with one tap ("Save as template"). |

### 4.7 Invoices (FR 3, FR 4, US #1, #5, #6, #8)

#### 4.7.1 Invoice content

| ID | Requirement |
|---|---|
| **FR-INV-01** | An invoice has: customer, invoice date, service date or service period (from–to), payment term (days) → computed due date, document language, optional site address (multi-line), optional subject/description block (multi-line, e.g. "Renovierung nach Wasserschaden – Putzarbeiten – Trockenbau"), intro text, closing text, positions, totals. |
| **FR-INV-02** | **Invoice date** defaults to today and can be changed (US #8). **Service date** defaults to the invoice date and can be changed. |
| **FR-INV-03** | Each position: type `WORK` / `MATERIAL` (FR 4.3), description (multi-line), quantity (3 decimals), unit, unit price net, VAT rate (19 / 7 / 0 %), line total. **Lump-sum positions** (quantity 1, unit "pauschal") must be easy because the reference invoices use them. |
| **FR-INV-04** | **Work and material are kept separate** on the invoice: positions are grouped into the sections *Arbeit/Work/Robocizna* and *Material/Materiał*, each with a subtotal. For **private customers** the PDF additionally prints the labour share including VAT ("Enthaltene Arbeitskosten inkl. MwSt.: x €") – this is what customers need for the tax deduction under **§ 35a EStG**, and it is the main practical reason for the work/material split. |
| **FR-INV-05** | Positions can be reordered (drag & drop on desktop, up/down buttons on mobile), duplicated and deleted. Position numbers are generated. |
| **FR-INV-06** | **Calculation** (in the shared domain package): line total = round(qty × unit price, 2, half-up); net total = Σ line totals; VAT per rate = round(Σ net of that rate × rate, 2); gross = net + Σ VAT. In `SMALL_BUSINESS_19` mode, no VAT is calculated and the text *"Gemäß § 19 UStG wird keine Umsatzsteuer berechnet."* (translated) is printed. |
| **FR-INV-07** | Before finalizing, the app checks the **mandatory invoice fields of § 14 Abs. 4 UStG** and blocks with a clear, translated message if missing: full name/address of seller and buyer, Steuernummer or USt-IdNr., invoice date, invoice number (assigned automatically), quantity and description of service, service date/period, net amount per tax rate, tax rate and tax amount (or § 19 note). *Note: the reference invoices 104 and 115 lack an explicit service date – the app must not reproduce that gap.* |
| **FR-INV-08** | **Copy invoice:** create a new draft from any invoice (same customer and positions, new dates, no number). |

#### 4.7.2 Lifecycle and status (US #1, US #6)

```
DRAFT ──finalize / export PDF──► OPEN (waiting for payment) ──mark paid──► PAID
  │                                 │
  └─ delete                         └─ cancel ──► CANCELLED
```

| ID | Requirement |
|---|---|
| **FR-INV-10** | Status values: `DRAFT` ("not sent"), `OPEN` ("waiting for payment"), `PAID`, `CANCELLED`. **Overdue** is not a status but a derived flag (`OPEN` and due date < today), shown as a red badge. |
| **FR-INV-11** | **Finalize = "Create PDF"** (US #6): assigns the number (FR-NUM-02), takes the snapshot (FR-COMP-05), generates and stores the PDF, sets status `OPEN`. Requires a confirmation dialog ("After this, the invoice can no longer be changed"). |
| **FR-INV-12** | **Preview** of a draft as PDF is always possible without changing status; preview PDFs carry a diagonal **"ENTWURF / DRAFT / SZKIC"** watermark and no number. |
| **FR-INV-13** | Finalized invoices (`OPEN`, `PAID`, `CANCELLED`) are **read-only**. Corrections: cancel the invoice (reason required) and create a corrected copy (FR-INV-08). Cancelled invoices keep their number. Drafts can be deleted, finalized invoices cannot. |
| **FR-INV-14** | **Mark as paid** with payment date (default today); can be undone back to `OPEN` (e.g. wrong click). Every status change is logged with user and timestamp. |
| **FR-INV-15** | The stored PDF is the reference copy; re-downloading returns **the same file** (byte-identical), not a re-render. |

#### 4.7.3 Overview (US #1, US #4)

| ID | Requirement |
|---|---|
| **FR-INV-20** | Start screen after login (mobile-first): counters/tiles for *Drafts*, *Open*, *Overdue*, *Paid this year*, with sum of open amounts; tap filters the list. |
| **FR-INV-21** | Invoice list: filter by status, customer, date range; search by number or customer name; sort by date/number/amount. Each row shows number, customer, date, gross amount, status badge. |
| **FR-INV-22** | Prominent **"New invoice"** button reachable with one tap from every main screen (US #5). |

### 4.8 PDF layout (FR 3 – see Appendix A)

| ID | Requirement |
|---|---|
| **FR-PDF-01** | A4 portrait, layout following the reference invoices: accent line + company name (or logo) on top; sender line above the recipient address; recipient block positioned for a **DIN 5008 window envelope**; right side: date, invoice number, service date, payment term / due date; centred title ("Rechnung" / "Faktura" / "Invoice"); position table *POS – Beschreibung – Menge – Einzelpreis – Gesamtpreis*; totals block (Zwischensumme, MwSt. x %, Gesamt); intro/closing texts and signature; footer in three columns (address | phone + St.-Nr. | bank, IBAN, BIC) in the accent colour. |
| **FR-PDF-02** | Multi-page: table header repeated, footer and "Seite x von y" on each page, no position split across pages. |
| **FR-PDF-03** | Fonts embedded (FR-I18N-05). Output is text-based (searchable, copyable), not images. |
| **FR-PDF-04** | File name pattern as in the reference files: `RechnungsNr_{number}_{customerShortName}_{dd.MM.yyyy}.pdf` (localised prefix for pl/en, unsafe characters removed). |
| **FR-PDF-05** | On mobile, the PDF opens in the browser's viewer and can be shared via the OS share sheet (Web Share API where available, otherwise download). |

### 4.9 Traceability: user stories → requirements

| User story | Covered by |
|---|---|
| #1 Check invoice status on mobile | FR-INV-10, FR-INV-20, FR-INV-21, NFR-UX-01 |
| #2 Upload logo | FR-STYLE-01..03 (Admin only, decision D6) |
| #3 Manage / search customers | FR-CUST-01, -02, -05 |
| #4 Invoices per customer | FR-CUST-03 |
| #5 Start an invoice from mobile | FR-INV-22, FR-CUST-05, FR-CAT-03, NFR-UX-02 |
| #6 Export PDF → status "waiting" | FR-INV-11, FR-INV-15 |
| #7 Admin sets start number | FR-NUM-01..04 |
| #8 Date set automatically, editable | FR-INV-02 |
| #9 Dictate an invoice to an AI assistant ("Write a new invoice to customer X with positions …") – always as draft | FR-MCP-01..12 |


### 4.10 MCP server – AI assistants create invoice drafts (US #9, v1.1, confirmed – D8)

> **Status:** confirmed 2026-11-22 (decision D8).
> **Goal:** an LLM client (Claude Code and other remote-capable MCP clients) connects to the app
> and creates invoices from a natural-language request such as *"Write a new invoice to
> Omicronservice: 3 hours plastering at 48 €, material lump sum 640 €"*. The customer and the
> positions are looked up; similar existing entries are preferred, missing ones are created and
> marked as AI-created. **The LLM can only ever create and change
> drafts** – finalizing, numbering, payment and cancellation stay with humans in the app.

**Example flow (what the LLM does with the tools):**

```
User: "Write a new invoice to Omicronservice for the renovation: 3 h plastering at 48 €,
       material lump sum 640 €, service 13.–17.05."
LLM → create_invoice_draft(customer "Omicronservice", positions …, servicePeriod …)
      server: customer → similar "Omicronservice GmbH" found → reused (id 12)
      server: "Material pauschal" → catalogue entry found → reused
      server: "Putzarbeiten Stunde" → nothing similar → new catalogue entry, marked AI-created
                                                    → draft #57, totals, missing items: none
LLM: "Draft #57 for Omicronservice GmbH: 3 h plastering 144,00 € (new catalogue entry),
      material 640,00 €, total 932,96 € incl. 19 % VAT. Please check it here and create
      the PDF: <link>"
```

| ID | Requirement |
|---|---|
| **FR-MCP-01** | The app provides an **MCP server** (Model Context Protocol, current spec) implemented in Node/TypeScript with the official SDK, inside the existing backend (same container, same domain package and validation – AR-05). Transport: **Streamable HTTP** at `/mcp` only – no stdio bridge (D8). |
| **FR-MCP-02** | **Draft-only guarantee:** MCP tools can create and change invoices **only in status `DRAFT`**. There are no MCP tools to finalize, assign numbers, mark paid, cancel, delete finalized invoices, or change users, company settings, style or number range. Enforced on the server (tool set + checks in the domain/service layer), not by prompting. |
| **FR-MCP-03** | **Authentication:** per-user **API tokens** for MCP, created and revoked by the user in *Profil* (admins can revoke all). Tokens are shown once, stored hashed, carry the scope `mcp:drafts`, an optional expiry and a name ("Claude on laptop"). Every MCP action runs **as that user** (`created_by`/`updated_by`, FR-AUTH-08). Login sessions/cookies are not accepted on `/mcp`. No OAuth in v1.1 (D8). |
| **FR-MCP-04** | **Tools – lookup (read-only):** `search_customers(query)`, `get_customer(id)`, `search_catalog(query, type?)`, `get_company_defaults()` (tax mode, default VAT rate, payment term, document languages, units), `list_invoices(status?, customer?, query?, limit)` and `get_invoice(id)` (drafts and finalized, read-only). |
| **FR-MCP-05** | **Customer lookup rule (D8): prefer existing, otherwise create.** Tool `find_or_create_customer` (name, type, contact person, address, e-mail, invoice language): the server first searches **similar** customers (case- and accent-insensitive; company names normalized without legal forms such as GmbH/UG/Sp. z o.o.; same name with same ZIP/city counts as a match; also archived customers are reported but not used). If one or more similar customers exist, the **best match is used** and returned with `matched: true` and the alternatives – no new customer is created. Only if nothing similar exists, a new customer is created with the given data and **marked as AI-created** (FR-MCP-10). The LLM can still look up explicitly with `search_customers` and pass a `customerId`. |
| **FR-MCP-06** | **Tool `create_invoice_draft`**: customer (id, or the data for `find_or_create_customer`), positions, optional invoice date, service date or period, payment term, document language, subject, site address, intro/closing text. Each position is described by the LLM (title/description, type WORK/MATERIAL, quantity, unit, unit price, VAT rate optional) and resolved with the **catalogue lookup rule** (FR-MCP-08); the values are then **copied** into the invoice (FR-CAT-03). If the user stated a different price or quantity than the catalogue entry, the stated value is used **in this invoice only** – the catalogue entry is not changed. Defaults as in the editor (today, customer language, company texts, FR-INV-02). Returns draft id, for each position whether a catalogue entry was **matched** or **newly created**, line totals, totals (FR-INV-06), the § 14 checklist (FR-INV-07) and a **link to open the draft in the app**. |
| **FR-MCP-07** | **Tools to refine a draft:** `update_invoice_draft(id, version, changes)`, `add_positions(id, version, positions)`, `remove_position(id, version, index)`, `delete_invoice_draft(id, version)` – drafts only, with the optimistic version check of the editor (409 → the LLM must re-read). |
| **FR-MCP-08** | **Catalogue lookup rule (D8): prefer existing, otherwise create.** For every position the server searches **similar** active catalogue entries (same type, normalized title/description words, compatible unit). If one is found, it is **used** (`matched: true`, alternatives listed). Only if nothing similar exists, a **new catalogue entry is created** from the position (title, description, type, unit, unit price, VAT rate) and **marked as AI-created**. A separate tool `search_catalog` lets the LLM look up explicitly and pass a `catalogItemId`. |
| **FR-MCP-09** | **Numbers without floating point (AR-08):** amounts and quantities are passed as **decimal strings** (`"1755.00"`, `"2.5"`) or integer cents/thousandths and parsed by the domain package; invalid values are rejected with a clear message. VAT rate only 19 / 7 / 0; in `SMALL_BUSINESS_19` mode no VAT. Units as the predefined list (FR-CAT-02). |
| **FR-MCP-10** | **AI-created marker (D8):** drafts, customers **and catalogue entries** created via MCP are marked (`created_via = MCP`, token name, time) and shown with a badge **"Von KI erstellt"** in lists, the editor, the customer page and the catalogue, plus a filter "Von KI erstellt" in each list. The marker stays until a human edits and saves the record or confirms it ("Geprüft"); finalizing an invoice also clears the invoice's marker. Every MCP tool call is logged (user, token, tool, affected ids – no full prompts). |
| **FR-MCP-11** | **Tool descriptions** are written for LLMs (English, precise, with examples) and state the draft-only rule, the lookup-first workflow and the number formats. Optional **MCP prompt** `create_invoice` that guides the LLM through *lookup customer → lookup/collect positions → create draft → summarize and link*. |
| **FR-MCP-12** | **Reachability:** Home Assistant Ingress requires a browser login, which MCP clients cannot do. The MCP endpoint is therefore served on the **direct port** (AR-14) and must be put behind HTTPS (HA remote access via own reverse proxy / Cloudflare tunnel, or local network only). The MCP server can be switched off completely (app option `mcp_enabled`, default **off**). |

**Non-functional / tests for the MCP server**

| ID | Requirement |
|---|---|
| **NFR-MCP-01** | Rate limit per token (e.g. 60 tool calls/min); request size limits; a token cannot reach any non-MCP API route. |
| **NFR-MCP-02** | Prompt-injection safety by design: tool results are data; no tool can escalate beyond drafts, so a manipulated customer name or catalogue text cannot cause a finalized invoice, payment or settings change. |
| **TR-MCP-01** | Integration tests with an MCP client (SDK) against the real backend + MariaDB: list tools (no finalize/pay/cancel tools); full flow "customer by name → draft with positions → totals correct"; **lookup rule**: a similar customer (other spelling, accents, legal form) and a similar catalogue entry are **reused**, unknown ones are **created and marked AI-created**; a stated price overrides the catalogue price only in the invoice; version conflict; token scope/expiry/revocation; draft-only enforcement (attempts to change a finalized invoice fail). |
| **TR-MCP-02** | Manual acceptance with Claude Desktop/Claude Code: the example flow above produces a correct draft that a human finalizes in the app. |

---

## 5. Non-functional Requirements

| ID | Requirement |
|---|---|
| **NFR-UX-01** | Mobile-first, responsive from 360 px width. Touch targets ≥ 44 px. Works in the HA Companion app web view. |
| **NFR-UX-02** | Creating a simple invoice (existing customer, one catalogue position) takes **≤ 6 taps** after "New invoice". Drafts are **auto-saved** (debounced) – no data loss when the phone locks. |
| **NFR-UX-03** | Plain language, no technical terms in the UI; destructive actions need confirmation; error messages say what to do. |
| **NFR-UX-04** | Basic accessibility: semantic HTML, labels on all inputs, sufficient contrast (WCAG 2.1 AA for text). |
| **NFR-PERF-01** | On a Raspberry Pi 4: page/API response < 500 ms (p95) for lists of 5 000 invoices; PDF generation < 3 s for a 3-page invoice; idle memory < 200 MB, peak < 512 MB. |
| **NFR-SEC-01** | OWASP Top 10 basics: parameterised queries only, output encoding, CSRF protection, secure headers (CSP), upload validation (type sniffing, size, SVG sanitising), no secrets in logs, authorization check on every endpoint (role and resource). |
| **NFR-DATA-01** | Finalized invoices and their PDFs are never hard-deleted (retention 10 years in German tax law). |
| **NFR-DATA-02** | Admin can export all data (JSON) and all PDFs (ZIP) for backup or migration. |
| **NFR-OPS-01** | Database migrations are forward-only, idempotent and tested against an empty DB and against the previous release's schema. |
| **NFR-MAINT-01** | ESLint + Prettier, TypeScript `strict`, no `any` in domain package. README with setup, architecture overview and HA installation guide. |

---

## 6. Test Requirements

| ID | Requirement |
|---|---|
| **TR-01** | **Unit tests** (Vitest or Jest) for the domain package: calculation, rounding, VAT grouping, § 19 mode, work/material subtotals, § 35a labour share, number formatting, IBAN validation. Property-based tests (e.g. fast-check) for calculation invariants (gross = net + VAT; sum of lines = net). Coverage ≥ 90 % for `packages/domain`. |
| **TR-02** | **Integration tests** for the API against a **real MariaDB** (Testcontainers or the compose DB): auth, role checks (USER must get 403 on admin endpoints), CRUD, status transitions incl. forbidden transitions, read-only enforcement of finalized invoices. |
| **TR-03** | **Concurrency test** for number assignment: N parallel finalizations → N distinct, consecutive numbers, no gaps. |
| **TR-04** | **PDF tests:** generate the three reference scenarios (Appendix A, adapted to v1 tax variants) and assert via text extraction that all mandatory fields, totals and Polish characters are present; snapshot test of the layout (rendered page image diff with tolerance) is optional. |
| **TR-05** | **i18n test:** all keys present in de, pl and en; no hard-coded UI strings (lint rule). |
| **TR-06** | **E2E tests** (Playwright) on a mobile viewport (e.g. iPhone 13) and desktop: login, create customer, create invoice from catalogue, preview, finalize, download PDF, mark paid, admin creates user, admin uploads logo. Includes one run **under an ingress-like base path** (e.g. `/api/hassio_ingress/abc123/`) to catch absolute URLs. |
| **TR-07** | **Container test:** `docker compose up` in CI, wait for `/api/health`, run E2E suite against it. Build for amd64 and aarch64 (buildx / QEMU) must succeed. |
| **TR-08** | All tests run with a single command (`npm test` for unit+integration, `npm run test:e2e` for E2E). CI pipeline (GitHub Actions) runs lint, type-check, tests and image build on every push. |

---

## 7. Data Model (logical, implementer may refine)

```
user(id, username, display_name, password_hash, role, ui_language, active,
     must_change_password, created_at, updated_at)

company_profile(id=1, name, owner_name, street, zip, city, country_code,
     phone, mobile, email, website, tax_number, vat_id,
     bank_name, iban, bic, account_holder, tax_mode,
     default_payment_term_days, default_vat_rate, signature_name, updated_by, updated_at)
company_text(company_id, kind[INTRO|CLOSING], language, text)

invoice_style(id=1, logo_file_id, logo_position, accent_color, updated_by, updated_at)

number_sequence(id=1, prefix, pattern, next_value, reset_yearly, current_year)

customer(id, type, company_name, contact_person, street, zip, city, country_code,
     email, phone, vat_id, invoice_language, notes, archived, created_at, updated_at)

catalog_item(id, type[WORK|MATERIAL], title, description, unit_code,
     unit_price_cents, vat_rate, active)

invoice(id, number NULL UNIQUE, status, customer_id, document_language,
     invoice_date, service_date_from, service_date_to, payment_term_days, due_date,
     site_address, subject, intro_text, closing_text,
     tax_mode, currency='EUR',
     net_total_cents, vat_total_cents, gross_total_cents,
     seller_snapshot JSON, buyer_snapshot JSON,
     -- reserved for later (D2 / roadmap):
     invoice_type[INVOICE|PARTIAL|FINAL|CANCELLATION] default INVOICE,
     related_invoice_id NULL, buyer_reference NULL,
     pdf_file_id NULL, pdf_sha256 NULL,
     finalized_at, finalized_by, paid_at, cancelled_at, cancel_reason,
     created_by, created_at, updated_by, updated_at)

invoice_position(id, invoice_id, sort_order, type[WORK|MATERIAL], description,
     quantity, unit_code, unit_price_cents, vat_rate, vat_category_code,
     line_total_cents)

invoice_status_history(id, invoice_id, from_status, to_status, user_id, at, note)

stored_file(id, kind[LOGO|INVOICE_PDF], path, mime_type, size, sha256, created_at)

-- v1.1 MCP (§4.10, D8):
api_token(id, user_id, name, token_hash, scopes, expires_at, last_used_at, revoked_at, created_at)
-- invoice / customer / catalog_item: created_via[UI|MCP] default UI, created_via_token_id NULL, ai_reviewed_at NULL
```

---

## 8. E-invoicing readiness (decision D2)

The data model must hold everything needed for a ZUGFeRD (EN 16931 / profile EN16931) export so that it can be added in a later release:

- ISO 3166 country codes for seller and buyer, ISO 4217 currency
- UN/ECE Rec. 20 unit codes per position (FR-CAT-02)
- VAT category code per position (`S` standard, `Z` zero, `E` exempt for § 19; `AE` reserved for § 13b)
- Seller tax number and/or VAT ID; buyer VAT ID for B2B
- Buyer reference field (Leitweg-ID for public customers)
- Invoice type code (380 invoice, 381 credit/cancellation, 326 partial – reserved)
- Due date and payment means (IBAN/BIC)

**Context for the product owner:** from **1 Jan 2028** (from 1 Jan 2027 if previous-year revenue > 800 000 €) domestic **B2B** invoices must be structured e-invoices; a plain PDF is then no longer a valid invoice for business customers. Invoices to private customers (B2C) and invoices of Kleinunternehmer are exempt. ZUGFeRD is still a PDF (with embedded XML), so requirement FR 3 ("always a PDF") stays compatible.

---

## 9. Delivery plan (milestones for Claude Code)

Each milestone ends with green tests, an updated README and a short demo note. Do not start the next milestone with failing tests.

| # | Milestone | Content | Done when |
|---|---|---|---|
| M0 | Skeleton | Monorepo, TS config, lint, Vitest, Fastify + SPA hello world, MariaDB via compose, migrations, `/api/health`, CI | `docker compose up` shows login page; CI green |
| M1 | Auth & users | FR-AUTH-*, i18n framework (FR-I18N-01, -04) | Admin bootstrap, user CRUD, role tests pass |
| M2 | Company, style, numbering | FR-COMP-*, FR-STYLE-*, FR-NUM-* | Concurrency test TR-03 passes |
| M3 | Customers & catalogue | FR-CUST-*, FR-CAT-* | Search and quick-create work on mobile viewport |
| M4 | Invoice editor & calculation | FR-INV-01..08, domain package, auto-save | TR-01 coverage reached |
| M5 | PDF | FR-PDF-*, FR-INV-11, -12, -15 | TR-04 passes, visual check against Appendix A |
| M6 | Lifecycle & overview | FR-INV-10, -13, -14, -20..22 | E2E TR-06 passes |
| M7 | Home Assistant App | AR-10..16, DOCS.md | Installs from repo URL on HA OS (amd64 + aarch64), works via Ingress with HA MariaDB |
| M8 | Hardening | NFR-*, export (NFR-DATA-02), security review | All TR green, README complete |
| M9 | MCP server (v1.1, decided – D8) | FR-MCP-*, NFR-MCP-*, API tokens, lookup-or-create rule, "Von KI erstellt" badges and filters | TR-MCP-01 green; TR-MCP-02 accepted by product owner |
| M10 | Release notes with Changesets (decided – D9) | AR-20..26: Changesets setup, `ha-app` as versioned package, config.yaml/CHANGELOG sync, Version-PR + tag + GitHub Release automation, CI guard, version shown in the UI | TR-20 and TR-22 green; TR-21 done once with a real release |

---

## 10. Open points / assumptions to confirm

1. **§ 13b and Abschlagsrechnung** are out of v1 although two of three reference invoices use them. Confirm this is intended – otherwise move to M4/M5.
2. Should the invoice also be **sendable by e-mail** (SMTP config by admin)? Currently out of scope.
3. Is a **quote (Angebot)** that converts into an invoice wanted later? It would reuse the same editor.
4. ~~Should a **normal user** be allowed to cancel (storno) invoices, or only admins?~~ **Resolved → D7:** all users may cancel.
5. ~~**MCP – who may use it?**~~ **Resolved → D8:** every user with an own token.
6. ~~**MCP – which clients?**~~ **Resolved → D8:** Streamable HTTP only, no stdio bridge.
7. ~~**MCP – authentication:**~~ **Resolved → D8:** personal API tokens.
8. ~~**MCP – may the LLM create new customers and catalogue items?**~~ **Resolved → D8:** yes – similar existing entries are preferred, otherwise new ones are created and marked AI-created.
9. ~~**Release notes language?**~~ **Resolved → D9:** English.
10. ~~**Release flow?**~~ **Resolved → D9:** automated "Version Packages" pull request.

---

## Appendix A – Reference invoices (layout source)

Files in the project: `RechnungsNr_102_Illing_05.03.2024.pdf`, `RechnungsNr_104_Karaca_22.05.2024.pdf`, `RechnungsNr_115-1 Abschlag_Karaca_18.11.2024.pdf`. Copy them to `docs/reference/` in the repository.

| Invoice | Characteristics |
|---|---|
| **102** (Illing) | Private customer, one lump-sum position (garden waste disposal on 28.02.2024 – service date inside description), net 80,00 €, **19 % VAT 15,20 €**, gross 95,20 €. → v1 scenario "standard VAT, B2C". |
| **104** (Karaca / Omicronservice) | Business customer, site address + subject block ("Renovierung nach Wasserschaden – Putzarbeiten – Trockenbau – Streichen"), two lump-sum positions **Arbeit 1.755,00 €** and **Material 640,00 €**, § 13b text, 0 % VAT. → v1 test scenario adapted to 19 % VAT; original variant in v1.1. |
| **115-1** (Karaca, Abschlag) | Partial invoice: total contract 5.200 €, "Abschlag für Material 50 %" = 2.600,00 €, § 13b. → v1.1. |

**Common layout elements:** blue accent line and company name in caps at top; sender line; recipient with "Z. Hd."; right column with Datum, Rechnungsnummer, Zahlungsziel: 30 Tage; centred blue title; table with blue header row and dotted grid; totals rows Zwischensumme / MwSt. / Gesamt; thank-you text and "Mit freundlichen Grüßen" + name; footer line with three columns (address | Mobil + St.Nr | bank, IBAN, BIC) in blue.
