# ADR 0006 – PDF rendering with pdfmake; logos rasterized to PNG

- **Status:** accepted (M2, 2026-11-19)
- **Requirements:** AR-06, FR-STYLE-01..03, FR-PDF-01..03, FR-I18N-05, NFR-SEC-01, NFR-PERF-01

## Decision

### PDF

- **pdfmake 0.3** (pure JS on top of pdfkit) instead of headless Chromium: ~0.2 s per invoice
  in the container on a laptop, no browser in the image. Declarative tables give repeated header
  rows, `dontBreakRows` (no position split across pages) and per-page footers with page count
  (FR-PDF-02) for free.
- Font: **Roboto** as bundled with pdfmake (Apache 2.0) – covers German and Polish characters;
  embedded as subset, text stays searchable (FR-PDF-03). Verified by text extraction in tests.
- Hardening: `setUrlAccessPolicy(() => false)` (no network access while rendering) and local
  file access limited to the font directory. Images are passed as data URLs.
- Rendering sits behind `InvoiceRenderer` (`render(InvoiceDocument) → Buffer`). The
  `InvoiceDocument` is a fully calculated, frozen snapshot; renderers never compute amounts.
  A ZUGFeRD renderer can implement the same interface later (AR-06, D2).
- Layout follows DIN 5008 form B (window address at 45 mm, information block at 125 mm,
  body from 98.5 mm) and the reference invoices (accent line, name in caps, dotted grid, footer
  in three columns in the accent colour).

### Logos

- Upload as **raw request body** (`Content-Type: image/png | image/jpeg | image/svg+xml`,
  2 MB body limit) instead of multipart – fewer dependencies, simpler limits.
- The type is **sniffed from the content**; the declared type is ignored.
- PNG/JPEG dimensions are read from the file header **before decoding**; more than 4000 px per
  side is rejected (a 2 MB file could otherwise decode to gigabytes on a 512 MB Pi).
- **SVG is rasterized to PNG** with resvg (Rust, prebuilt for musl amd64/arm64) at 1200 px on
  the longer side. Scripts, event handlers and external references cannot survive this.
  DTDs/entities and non-`data:` hrefs are rejected up front; extreme aspect ratios too.
  System fonts are not loaded – SVG text uses the bundled Roboto.
- Every accepted image is test-embedded with pdfmake, so corrupt files fail at upload, not later
  when an invoice is finalized.
- Files are stored content-addressed under `DATA_DIR/logo/<sha256>.png` with a `stored_file`
  row (checksum verified on read). Uploading does not activate a logo: the admin previews and
  then saves the style (FR-STYLE-03). Unused uploads stay on disk (a few KB each); cleanup can
  be added in M8.

### Numbers and dates

- Invoice numbers are assigned by a pure domain function inside the finalizing transaction,
  which locks the `number_sequence` row (`SELECT … FOR UPDATE`) – see FR-NUM-02/03, TR-03.
- The year used for numbers and "today" is the calendar date in **Europe/Berlin**, not the
  server time zone.
