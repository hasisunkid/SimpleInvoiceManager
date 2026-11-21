# ADR 0009 – Finalizing in one transaction, stored PDFs, READ COMMITTED

- **Status:** accepted (M5, 2026-11-21)
- **Requirements:** FR-INV-11, -12, -15, FR-NUM-02/03, FR-COMP-05, FR-PDF-01..05, TR-03, TR-04

## Decision

### Finalize = one transaction

`POST /api/invoices/:id/finalize { version }` runs **one** database transaction:

1. lock the invoice row; it must be a `DRAFT` with exactly the version the user saw;
2. § 14 check (FR-INV-07) – otherwise `400 INVOICE_INCOMPLETE` with the list of problems;
3. assign the number (sequence row lock, FR-NUM-02/03);
4. freeze seller and buyer snapshots and the tax mode (FR-COMP-05);
5. render the PDF and store it under `DATA_DIR/invoice_pdf/<sha256>.pdf` with a `stored_file`
   row (checksum also on the invoice);
6. status `OPEN`, history entry `DRAFT → OPEN`, version + 1.

If anything fails – including rendering – everything is rolled back and the number is free
again: no gaps (tested with a failing renderer). Rendering inside the transaction serializes
finalizations behind the sequence lock (~0.2 s each), which is acceptable for a small business.
A PDF file written before a rollback stays on disk unreferenced (content-addressed, harmless).

### Stored PDF is the reference copy (FR-INV-15)

`GET /api/invoices/:id/pdf` returns the stored bytes (checksum verified on read), never a
re-render. Later changes to company data, customer, style or the renderer cannot change an
issued invoice. `GET /api/invoices/:id/preview` renders drafts with the "ENTWURF / SZKIC /
DRAFT" watermark (document language) and no number; for finalized invoices it returns the
stored file. Both are GET requests so the browser's own PDF viewer can open them (FR-PDF-05);
the session cookie authenticates, relative URLs keep Ingress working.

File name (FR-PDF-04): `RechnungsNr_{number}_{short name}_{dd.MM.yyyy}.pdf` with localized
prefix; short name = last word of the person (private customer's name or the business contact),
otherwise first word of the company. Unsafe characters become "-"; letters such as "ł", "ä"
stay and are sent via `filename*=UTF-8''…` (RFC 6266) with an ASCII fallback.

### PDF content details

- Title is just "Rechnung" / "Faktura" / "Invoice" (as in the reference invoices); the number
  is in the information block.
- Work and material are separate table sections with subtotals when both occur (FR-INV-04);
  private customers get "Enthaltene Arbeitskosten inkl. MwSt.: …" (§ 35a EStG).
- Service periods are printed compactly ("13.–17.05.2024") so they fit the DIN information block.

### Transaction isolation: READ COMMITTED

Parallel saves of _different_ drafts deadlocked under InnoDB's default REPEATABLE READ (gap
locks from deleting and re-inserting positions). All app connections now use
`READ COMMITTED` (set in the pool's `afterCreate`); everything that must be serialized already
uses explicit `SELECT … FOR UPDATE` row locks (number sequence, invoice row, last admin), which
behave the same. Write transactions for drafts and finalizing additionally retry up to three
times on `ER_LOCK_DEADLOCK` / `ER_LOCK_WAIT_TIMEOUT` (`transactionWithRetry`).
