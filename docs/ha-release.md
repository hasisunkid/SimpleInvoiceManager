# Releasing and testing the Home Assistant App

## One-time setup

1. The repository is https://github.com/hasisunkid/SimpleInvoiceManager. It must be **public**,
   so Home Assistant can read `repository.yaml` and pull the images anonymously.
2. Images: `ghcr.io/hasisunkid/simpleinvoice-manager-{amd64,aarch64}` (set in
   `ha-app/config.yaml`; the release workflow derives the owner from the repository).
3. After the first release, open the two packages on GitHub
   (`simpleinvoice-manager-amd64`, `simpleinvoice-manager-aarch64`) → Package settings →
   **Change visibility → Public**. Otherwise the Supervisor cannot pull them.

## Release

1. Raise `version` in `ha-app/config.yaml` and add an entry to `ha-app/CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.7.0 && git push origin main v0.7.0`.
3. The **Release** workflow checks tag = config version, builds both images (amd64 and aarch64
   via QEMU) and pushes them to GHCR. Home Assistant shows the update afterwards.

## Acceptance test on HA OS (milestone M7 "done when")

Run on one amd64 and one aarch64 (Raspberry Pi 4/5) installation:

- [ ] MariaDB app installed and started.
- [ ] Repository URL added, app installed, `initial_admin_password` set, app started.
- [ ] Log shows `Starting with database 'simpleinvoice'` and `migrations applied`.
- [ ] "Rechnungen" in the sidebar opens the login page; login as `admin`, forced password change.
- [ ] Company details, start number, one customer, one catalogue item; create an invoice,
      preview, finalize, open the PDF, mark as paid.
- [ ] Same on the phone in the Companion app (remote access): PDF opens, "PDF teilen" works.
- [ ] Restart the app – still logged in, invoice and PDF still there.
- [ ] In the MariaDB app (or phpMyAdmin): database `simpleinvoice` exists, `homeassistant`
      unchanged.
- [ ] Create a backup containing **both** apps; restore it on a test system.
- [ ] Optional: publish port 8099 on the Network tab and open `http://<ha>:8099/` directly.

## Local simulation (what CI / development can check)

The image's HA mode can be exercised without Home Assistant: run MariaDB and a fake Supervisor
that answers `GET /services/mysql` (with `Authorization: Bearer <token>`), mount a directory with
`options.json` as `/data`, start the image built with `--target ha` with `SUPERVISOR_TOKEN`
set, and run the E2E `ingress` project against it (`E2E_REUSE=1 E2E_APP_PORT=… npx playwright
test -c e2e/playwright.config.ts --project=ingress`). This was done for M7: all ingress E2E
tests passed against the HA-mode container, the `homeassistant` database stayed untouched,
restarts kept sessions and files.
