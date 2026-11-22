# Changelog

## 0.8.0

### Minor Changes

- [`6575be6`](https://github.com/hasisunkid/SimpleInvoiceManager/commit/6575be6e1069154752fc5b0764cf9276e4502d4b) Thanks [@hasisunkid](https://github.com/hasisunkid)! - The app now shows its version on the login screen and on the _Mehr_ page, with a link to the
  release notes of that version. Release notes like these are now published with every update.

## 0.7.0 – first Home Assistant App release

- Runs as a Home Assistant App with Ingress (sidebar panel "Rechnungen"), uses the official
  MariaDB app with its own database, optional direct port 8099.
- Users and roles (admin / user), login with "stay signed in", forced password change.
- Company details, invoice design (logo, accent colour, live preview), invoice number range.
- Customers and a catalogue of reusable work and material positions.
- Mobile invoice editor with live totals (VAT per rate, work/material subtotals, § 35a labour
  share, Kleinunternehmer § 19 UStG) and auto-save.
- Finalize as PDF (German, Polish, English) with gap-free numbers; stored PDF is the reference
  copy; preview with watermark; share and download on phones.
- Status tracking: open, overdue, paid, cancelled – with history and dashboard.
