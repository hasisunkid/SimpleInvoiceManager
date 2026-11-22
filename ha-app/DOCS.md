# SimpleInvoice Manager

Write, manage and track invoices from your phone – made for tradespeople. Invoices are created
as PDF in German, Polish or English and look like classic printed invoices.

> **Kurz auf Deutsch:** Zuerst die offizielle **MariaDB**-App installieren und starten, dann
> diese App installieren, in der Konfiguration ein Start-Passwort für `admin` setzen und
> starten. Geöffnet wird sie über **Rechnungen** in der Seitenleiste. Beim ersten Anmelden muss
> das Passwort geändert werden. **Wichtig für Backups:** Die Rechnungsdaten liegen in der
> MariaDB-App – sie muss in jedem Backup enthalten sein.

## Installation

1. Install and start the official **MariaDB** app (Settings → Apps → App store → MariaDB).
   SimpleInvoice Manager creates its **own database** there (default `simpleinvoice`); it never
   touches the `homeassistant` database used by the recorder.
2. Add this repository: Settings → Apps → App store → ⋮ → **Repositories** →
   `https://github.com/hasisunkid/SimpleInvoiceManager`.
3. Install **SimpleInvoice Manager**.
4. On the **Configuration** tab, set `initial_admin_password` (at least 10 characters).
5. Start the app and open it with **Rechnungen** in the sidebar (or "Open web UI").
6. Log in as `admin` with that password. You are asked to choose a new password right away.

If you leave `initial_admin_password` empty, a random password is generated on the first start
and printed **once** in the app's **Log** tab.

## First steps

1. **Mehr → Firmendaten:** company name, address, tax number (Steuernummer or USt-IdNr.), bank
   details, Kleinunternehmer (§ 19 UStG) or regular VAT.
2. **Mehr → Verwaltung → Rechnungsnummern:** set the start number (e.g. the next number after
   your last paper invoice). Numbers are only assigned when an invoice is finalized, so there
   are no gaps.
3. **Mehr → Verwaltung → Rechnungsdesign:** upload your logo and choose the accent colour.
4. **Mehr → Verwaltung → Benutzer:** create accounts for everyone who writes invoices.

## Configuration

| Option                   | Default         | Meaning                                                                |
| ------------------------ | --------------- | ---------------------------------------------------------------------- |
| `database`               | `simpleinvoice` | Name of the app's own database in MariaDB. `homeassistant` is refused. |
| `initial_admin_password` | –               | Password of `admin` on the very first start only (min. 10 characters). |
| `log_level`              | `info`          | `trace`, `debug`, `info`, `warn`, `error` or `fatal`.                  |
| `mcp_enabled`            | `false`         | AI assistants may create invoice drafts (see below).                   |
| `public_url`             | –               | Optional address of the app, used in links for AI assistants.          |

Changing `initial_admin_password` later has no effect – users and passwords are managed inside
the app.

### Direct access without Home Assistant (optional)

Normally the app is used through Home Assistant (Ingress), so you log in to Home Assistant and
to the app. On the **Network** tab you can additionally publish port `8099` to reach the app
directly at `http://<home-assistant>:8099/` – only do this inside your home network or behind
your own HTTPS reverse proxy.

## AI assistants (MCP, optional)

An AI assistant such as Claude can write **invoice drafts** for you: _"Write an invoice to
Omicronservice: 3 hours plastering at 48 €, material lump sum 640 €"_. The assistant reuses
existing customers and catalogue entries when a similar one exists and creates new ones only
otherwise; everything it creates is marked **"Von KI erstellt"**. It can **never** finalize an
invoice, assign a number, mark it paid or cancel it – you check the draft in the app and create
the PDF yourself.

1. On the **Configuration** tab, switch on `mcp_enabled` (and optionally set `public_url` to the
   address you open the app with, so the assistant can link to the draft).
2. On the **Network** tab, publish port `8099`. AI assistants cannot log in to Home Assistant,
   so they use the direct port. Only do this in your home network or behind your own HTTPS
   reverse proxy / tunnel.
3. Restart the app. In the app, open **Mehr → Mein Profil → KI-Zugänge**, create an access key
   and copy it (it is shown once).
4. In your assistant, add an MCP server of type **Streamable HTTP** with the URL
   `http://<home-assistant>:8099/mcp` (or your HTTPS address + `/mcp`) and the header
   `Authorization: Bearer <access key>`. For Claude Code, for example:
   `claude mcp add --transport http rechnungen https://<your-address>/mcp --header "Authorization: Bearer <access key>"`

Keys can be revoked in the profile at any time; admins see and revoke all keys under
**Mehr → Verwaltung → KI-Zugänge**. Lists of invoices, customers and catalogue entries have a
filter "Von KI erstellt"; saving a record or tapping **Geprüft** removes the mark.

## Backups – important

- **Invoice data** (customers, invoices, users, settings) is stored in the **MariaDB app**.
  Always include the MariaDB app in your backups, otherwise a restore loses all invoices.
- **Files** (logo, the stored invoice PDFs) and the session key are stored in this app's own
  data folder and are part of this app's backup.

For a complete restore, restore **both** apps from the same backup. German tax law requires you
to keep invoices for 10 years – keep backups accordingly and also store them outside the
Home Assistant device.

## Phone use

Install the **Home Assistant Companion** app and enable remote access (Home Assistant Cloud or
your own reverse proxy) to write invoices at the construction site. PDFs open in the phone's
viewer and can be shared from there (e-mail, messenger).

## Troubleshooting

| Message in the log                     | What to do                                                 |
| -------------------------------------- | ---------------------------------------------------------- |
| `The MariaDB app is not available`     | Install and start the official MariaDB app, then restart.  |
| `Database 'homeassistant' is reserved` | Choose another `database` name in the configuration.       |
| `configuration error: …`               | Check the configuration tab; the message says which value. |
| Forgot the admin password              | Another admin can reset it under Verwaltung → Benutzer.    |

## Support

Issues and questions: https://github.com/hasisunkid/SimpleInvoiceManager/issues
