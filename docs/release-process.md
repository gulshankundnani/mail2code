# Release process

Nothing is published automatically. CI builds and tests every change and
uploads zip files as temporary workflow artifacts; it never creates tags,
releases or store submissions. Each release is a deliberate, manual decision
by the maintainer.

## Versioning

Semantic Versioning, starting at `0.1.0` for the first public release. The
version lives in `apps/extension/package.json` (WXT copies it into every
manifest). Bump the backup `schemaVersion` only when the export format changes,
and add a migration for the previous version (see
[backup-format.md](backup-format.md)).

## Release checklist

### Prepare

- [ ] All changes for the release are merged and CI is green on Windows, macOS and Linux.
- [ ] `CHANGELOG.md`: move items from **Unreleased** to the new version with the date.
- [ ] Bump `version` in `apps/extension/package.json`.
- [ ] `npm run licenses` — commit `docs/dependencies.md` if it changed; runtime licenses all allowed.
- [ ] `npm audit --omit=dev` reports no vulnerabilities.

### Verify locally

- [ ] `npm ci`, `npm run typecheck`, `npm test`.
- [ ] `npm run test:e2e` (Chromium and Edge).
- [ ] `npm run -w @inbox-handoff/extension build:all`, then `npm run check:manifests`.
- [ ] `npm run scan:secrets`.
- [ ] `npx web-ext@10.8.0 lint --source-dir apps/extension/dist/firefox-mv3` — 0 errors.
- [ ] Bundle sizes recorded in [browser-compatibility.md](browser-compatibility.md).
- [ ] A backup exported by the previous release imports correctly.

### Manual checks (record results in browser-compatibility.md)

- [ ] **Live Gmail**: button appears once, follows navigation, captures the right message and the whole conversation.
- [ ] Each target browser you claim: Chrome, Edge, Brave, Firefox — install the release build and run through capture → task → brief → plan → approval → export/import.
- [ ] Permissions shown at install match [permissions-and-privacy.md](permissions-and-privacy.md).

### Package

- [ ] `npm run -w @inbox-handoff/extension zip:all` produces
      `inbox-handoff-<version>-chrome.zip`, `-edge.zip`, `-firefox.zip` and
      `-sources.zip` (Firefox reviewers need the sources zip).
- [ ] Record SHA-256 checksums of the zips in the release notes.

### Publish (maintainer, manually)

- [ ] Get explicit approval to publish.
- [ ] Create the Git tag `v<version>` and a GitHub release with the zips, checksums and changelog section.
- [ ] Store submissions (each needs its own developer account, kept outside this repository):
  - Chrome Web Store — `-chrome.zip` (Brave users install from there too).
  - Microsoft Edge Add-ons — `-edge.zip`.
  - addons.mozilla.org — `-firefox.zip` plus `-sources.zip`. **Before the first submission, confirm the Firefox add-on ID** (`FIREFOX_ADDON_ID` in `apps/extension/wxt.config.ts`); it can never change afterwards.
- [ ] Store listings: describe exactly what the extension does and doesn't do, matching the README table; privacy practices: no data collected or transmitted.
- [ ] Update the README "From a browser store" section with links once listings are live.

## Credentials and signing

Store accounts, API keys for store uploads and any signing keys stay outside
the repository and outside CI secrets unless a future, separately approved
release workflow needs them. Chrome and Edge sign packages on submission;
Firefox signs through addons.mozilla.org.

## Reproducibility

Dependencies are pinned to exact versions in `package-lock.json`; CI installs
with `npm ci` on Node 24. Builds are produced by WXT/Vite from the tagged
commit; rebuilding the same commit with the same lockfile and Node major
version should produce equivalent bundles. Byte-identical output across
operating systems is not guaranteed and has not been verified.
