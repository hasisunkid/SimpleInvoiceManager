# Releasing and testing the Home Assistant App

## One-time setup

1. The repository is https://github.com/hasisunkid/SimpleInvoiceManager. It must be **public**,
   so Home Assistant can read `repository.yaml` and pull the images anonymously.
2. Images: `ghcr.io/hasisunkid/simpleinvoice-manager-{amd64,aarch64}` (set in
   `ha-app/config.yaml`; the release workflow derives the owner from the repository).
3. After the first release, open the two packages on GitHub
   (`simpleinvoice-manager-amd64`, `simpleinvoice-manager-aarch64`) → Package settings →
   **Change visibility → Public**. Otherwise the Supervisor cannot pull them.

## Release (Changesets, AR-20..AR-26)

Releases are automated; nobody edits versions or pushes tags by hand.

1. **With every user-visible change** run `npx changeset`, choose `@sim/ha-app`, the bump
   (patch = fix, minor = new feature, major = breaking change) and write one or two sentences
   **in English, for users**. Commit the generated `.changeset/*.md` with the change.
   Internal-only changes: `npx changeset --empty`. The CI job _Changeset present_ fails without
   one (AR-24).
2. **On every push to `main`** the _Changesets_ workflow opens or updates the pull request
   **"Version Packages"**: it runs `npm run version-packages` (new version in
   `ha-app/package.json`, `ha-app/config.yaml` synced, release notes added to
   `ha-app/CHANGELOG.md` with links to the PRs/commits, lockfile updated).
3. **Merge that pull request when you want to release.** The workflow then tags `vX.Y.Z` and
   calls the _Release_ workflow: it checks that tag, `package.json`, `config.yaml` and the
   changelog agree, builds both images (amd64 and aarch64 via QEMU) with
   `BUILD_VERSION=X.Y.Z`, pushes them to GHCR and creates the **GitHub Release** with the
   changelog entry as text.
4. Home Assistant shows the update with the new changelog (Settings → Apps → SimpleInvoice
   Manager). Home Assistant reads `config.yaml` from `main`, so the update can appear a few
   minutes before the images are pushed – installing in that window fails; just retry.

The running version is shown on the login screen and on _Mehr_ (linked to the GitHub release)
and returned by `GET /api/health`; local builds show `dev`.

### One-time GitHub settings for the flow

- Settings → Actions → General → Workflow permissions: **Read and write permissions** and
  **Allow GitHub Actions to create and approve pull requests** (otherwise the Version PR
  cannot be opened).
- Pull requests opened by the workflow (`GITHUB_TOKEN`) do not start the CI workflow by
  themselves. The Version PR only touches release files that `npm run release:check` covers on
  `main` after the merge; to run CI on it anyway, close and reopen the PR, or add a personal
  access token as described in the changesets/action documentation.

### Manual fallback

A tag pushed by hand (`git tag vX.Y.Z && git push origin vX.Y.Z`) still runs the _Release_
workflow; the tag must match `ha-app/package.json` and `config.yaml`
(`npm run release:check -- --tag vX.Y.Z`).

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
