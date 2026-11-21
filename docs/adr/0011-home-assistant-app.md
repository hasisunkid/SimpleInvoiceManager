# ADR 0011 – Home Assistant App packaging

- **Status:** accepted (M7, 2026-11-21)
- **Requirements:** AR-10..AR-16

## Decision

- **Prebuilt images** (`image: ghcr.io/<owner>/simpleinvoice-manager-{arch}` in
  `ha-app/config.yaml`), published by `.github/workflows/release.yml` on version tags. The
  Supervisor only builds from the app folder itself, which cannot see the monorepo, and
  building Node + Vite on a Raspberry Pi would take long and need much RAM.
- One Dockerfile, two targets: `runtime` (compose, development) and `ha` (adds `jq`, `curl`,
  `run.sh`, HA labels, runs as root because the Supervisor mounts `/data` owned by root).
  The repository's `ha-app/` folder holds `config.yaml`, `run.sh`, `DOCS.md`, `README.md`,
  `CHANGELOG.md`, icon/logo and option translations (de, en, pl); `repository.yaml` lives at
  the repository root.
- **`run.sh` instead of bashio:** a POSIX shell script reads `/data/options.json` with `jq` and
  the MariaDB credentials from `GET http://supervisor/services/mysql` (bearer
  `SUPERVISOR_TOKEN`, enabled by `services: [mysql:need]`), then exports exactly the AR-16
  variables – the application has one configuration path. It refuses reserved database names
  (the app checks again) and fails with a plain message when MariaDB is missing.
- The **session secret** is generated once and stored in `/data/session_secret`, so logins
  survive restarts and the secret is part of the app's backup. Logo and PDFs live in
  `/data/files`; the invoice data lives in the MariaDB app – `DOCS.md` says to back up both
  (AR-15).
- **Ingress** on port 8099 (`ingress: true`, panel "Rechnungen"); the direct port is declared
  but unmapped by default (AR-14). Health is reported by the image's Docker `HEALTHCHECK`
  (`/api/health`); the HA `watchdog` option is obsolete.
- Home Assistant's default `init` (Docker's tini as PID 1) forwards SIGTERM; the app shuts
  down gracefully. Keys with default values (`startup`, `boot`, `init`, `ingress_port`) are
  omitted, as the official app linter requires.

## Verification

- `config.yaml` validated against the schema of the official app linter (also run in CI).
- `run.sh` is shellcheck-clean (CI).
- Local HA simulation (MariaDB + fake Supervisor + `/data` mount): migrations, own database,
  `homeassistant` untouched, failure messages, restart with session kept, files under `/data`,
  and the full E2E `ingress` project passing against the HA-mode container.
- amd64 and arm64 images build; the arm64 image runs under QEMU (health, argon2 login, SVG logo
  via resvg, PDF via pdfmake). Timings/memory under emulation are not representative – real
  Raspberry Pi numbers (NFR-PERF-01) are measured in M8.
- Installation on real HA OS (amd64 + aarch64) is the acceptance step in `docs/ha-release.md`.
