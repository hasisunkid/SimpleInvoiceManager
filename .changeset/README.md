# Changesets

Every user-visible change gets a changeset (AR-20): run `npx changeset`, choose
**@sim/ha-app** (the product – the only versioned package), pick the bump
(patch = fix, minor = new feature, major = breaking change) and describe the change
**in English, for users** (AR-23). Internal-only changes: `npx changeset --empty`.

Releases happen through the "Version Packages" pull request (AR-22, see
`docs/ha-release.md`).
