# ADR 0008 – Invoice calculation, draft auto-save and input rules

- **Status:** accepted (M4, 2026-11-21)
- **Requirements:** AR-05, AR-08, FR-INV-01..08, FR-CUST-03, NFR-UX-02, TR-01

## Decision

### Calculation (`packages/domain/src/calculation.ts`)

- One pure function `calculateInvoice(positions, taxMode)` used by the editor (instant totals)
  and the server (stored totals, later the PDF). Quantities are integer thousandths, amounts
  integer cents, products computed in `bigint`; rounding half-up exactly as FR-INV-06 says:
  line = round(qty × price), VAT per **rate** = round(Σ net of rate × rate).
- § 35a labour share incl. VAT is computed per rate with the same rounding; § 19 invoices
  force rate 0 and VAT category `E` (EN 16931). The category is stored per position (§8).
- Property-based tests (fast-check) guard the invariants gross = net + VAT,
  net = Σ lines = Σ sections, order independence.

### Drafts and auto-save

- A draft is created on "New invoice" (defaults: today, company payment term, customer
  language, company texts) – it may exist without customer so the flow can start immediately.
- The editor saves the full draft (`PUT /api/invoices/:id`) 800 ms after the last change, and
  immediately on `visibilitychange: hidden` / `pagehide` / route leave with a `keepalive`
  request – locking the phone does not lose input (NFR-UX-02).
- **Optimistic locking:** every save sends the `version` it is based on; the server compares it
  under a row lock and answers `409 INVOICE_CHANGED` if another device saved in between. The
  editor then stops saving and offers "reload" instead of silently overwriting.
- Server answers never replace what the user is typing; only version, totals and the § 14
  check are taken over.
- Drafts follow the **current** company tax mode; it is frozen when the invoice is finalized (M5).
- Only drafts are editable/deletable (`409 INVOICE_NOT_EDITABLE` / `INVOICE_NOT_DELETABLE`).

### Input rules (v1)

- Quantity > 0 with up to three decimals; unit price ≥ 0. Negative lines (discounts, credit
  lines) are not supported in v1 – corrections go through cancel + copy (FR-INV-13).
- Quantities are typed **without thousands separators**: "1,250" and "1.250" both mean 1.25.
  (Money input keeps accepting "1.755,00".)
- Up to 200 positions per invoice.

### UI

- Bottom bar: Start · Rechnungen · Kunden · Leistungen · Mehr; "New invoice" is a button on
  start, invoice list and customer pages and a floating button on the other main screens
  (FR-INV-22).
- Fastest path (existing customer, one catalogue item): New invoice → tap customer →
  "Aus Leistungen" → tap item = 3 taps; finalizing (M5) adds two more (NFR-UX-02: ≤ 6).
