# Changelog

## 0.9.1

### Patch Changes

- [`85c6d06`](https://github.com/hasisunkid/SimpleInvoiceManager/commit/85c6d06161ba5678822a7b5ef51b98e28edecc84) Thanks [@hasisunkid](https://github.com/hasisunkid)! - Security hardening: the app now limits how many requests a single session, AI access key or
  address can send per minute, and some input checks (logo upload, e-mail addresses, PDF file
  names) were rewritten so that specially crafted input can no longer slow the app down. The
  development and test tools were updated to fix reported security issues; this does not change
  the installed app.

## 0.9.0

### Minor Changes

- [`d7592ce`](https://github.com/hasisunkid/SimpleInvoiceManager/commit/d7592cedf2dd02be3c2646f1f43385d59a52f29b) Thanks [@hasisunkid](https://github.com/hasisunkid)! - AI assistants such as Claude can now write invoice drafts for you (optional, switched off by
  default). Create a personal access key under _Mehr → Mein Profil → KI-Zugänge_ and connect your
  assistant to the app's direct port. The assistant reuses similar existing customers and
  catalogue entries and only creates new ones when nothing similar exists. Everything it creates
  is marked "Von KI erstellt" until you check it, and it can never finalize, pay or cancel an
  invoice. See the documentation for the setup.

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
