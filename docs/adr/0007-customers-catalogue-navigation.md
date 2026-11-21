# ADR 0007 – Customer search, delete protection, catalogue copies, navigation

- **Status:** accepted (M3, 2026-11-19)
- **Requirements:** FR-CUST-01..05, FR-CAT-01..04, NFR-UX-01, NFR-PERF-01, AR-17

## Decision

- **Customer model:** `type` BUSINESS / PRIVATE. Business customers need a company name
  (`contact_person` is the "Z. Hd."); private customers need a person's name in
  `contact_person`. Only type and name are mandatory, so the invoice editor can quick-create
  customers (FR-CUST-05); the full address is enforced when an invoice is finalized (§ 14 UStG).
- **Search** (FR-CUST-02): every word of the query must match company, contact person or city
  (`LIKE '%word%'`, wildcards escaped). The column collation `utf8mb4_unicode_ci` makes it case-
  and accent-insensitive ("lukasz" finds "Łukasz"). Measured in the test suite with 5 000
  customers: well below 300 ms. No full-text index needed at this size.
- **Delete vs. archive** (FR-CUST-04): invoices will reference customers with
  `ON DELETE RESTRICT`; the API maps the database's refusal to `409 CUSTOMER_HAS_INVOICES`.
  The database is the single source of truth – no race between "check" and "delete".
- **Catalogue** values are **copied** into invoice positions (FR-CAT-03), so editing or
  deleting catalogue items never changes invoices. Units are stored as UN/ECE Rec. 20 codes.
- **Navigation:** the bottom bar has four tabs (Start, Kunden, Leistungen, Mehr) to fit 360 px
  screens with ≥ 44 px targets; company data, profile and admin settings live under "Mehr".
  "Rechnungen" joins the bar with M4/M6.
- **Demo data** (`SEED_DEMO=true`): only added when there are no customers and no catalogue
  items; company profile and number range are only filled if still empty/unconfigured.
