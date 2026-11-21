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

Changing `initial_admin_password` later has no effect – users and passwords are managed inside
the app.

### Direct access without Home Assistant (optional)

Normally the app is used through Home Assistant (Ingress), so you log in to Home Assistant and
to the app. On the **Network** tab you can additionally publish port `8099` to reach the app
directly at `http://<home-assistant>:8099/` – only do this inside your home network or behind
your own HTTPS reverse proxy.

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
