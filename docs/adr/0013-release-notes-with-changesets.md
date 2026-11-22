# ADR 0013 – Release notes and versions with Changesets

- **Status:** accepted (M10, 2026-11-22)
- **Requirements:** AR-20..AR-26, TR-20, TR-22, decision D9

## Decision

- **One product version** lives in the private workspace package `@sim/ha-app`
  (`ha-app/package.json`). `.changeset/config.json` ignores the internal packages
  (`@sim/domain`, `@sim/i18n`, `@sim/backend`, `@sim/frontend`) and enables
  `privatePackages.version` (off by default in Changesets 3), with `tag: false` – tags are
  created by our workflow, not by `changeset publish`.
- `npm run version-packages` = `changeset version` + `scripts/release.mjs sync` (writes the
  version into `ha-app/config.yaml`, changing only that line) + lockfile update + Prettier.
  `ha-app/CHANGELOG.md` is the Changesets changelog of `@sim/ha-app`; Changesets inserts new
  entries above the existing ones, so the hand-written 0.7.0 entry stays (AR-23). Entries link to
  PRs/commits via `@changesets/changelog-github`.
- **Workflows:** `changesets.yml` (push to `main`) runs `changesets/action` to maintain the
  "Version Packages" PR. When no changesets are pending and the version has no tag yet (= the
  PR was merged), it creates the tag and **calls** `release.yml` as a reusable workflow – tags
  pushed with `GITHUB_TOKEN` do not trigger other workflows. `release.yml` builds the images and
  then creates the GitHub Release from the changelog entry (`release.mjs notes`); a hand-pushed
  tag still works as fallback.
- **CI guard (AR-24):** `release.mjs guard <base>` instead of `changeset status`: with only
  `@sim/ha-app` versioned, `changeset status` cannot see that a change to `apps/` belongs to the
  product. The guard needs an added `.changeset/*.md` (an empty one from `--empty` counts) when
  `apps/`, `packages/` or `ha-app/` changed; the Version-Packages commit (deletes changesets,
  bumps `ha-app/package.json`) is accepted.
- **Version in the app (AR-26):** the release workflow passes `BUILD_VERSION`; the runtime image
  stage turns it into `APP_VERSION` (declared late in the Dockerfile so new versions do not
  invalidate cached layers), read by `loadConfig()` (default `dev`). `GET /api/health` returns
  `version` and `releaseNotesUrl` (GitHub release, `null` for `dev`); the login screen and the
  _Mehr_ page show it. No separate public endpoint was added – the login page already calls
  `/api/health`.

## Consequences

- One changeset per user-visible change; texts in English for users.
- The repository setting "Allow GitHub Actions to create and approve pull requests" is required.
- Home Assistant may show the new version a few minutes before its images exist (it reads
  `config.yaml` from `main`); retrying the installation then succeeds.
