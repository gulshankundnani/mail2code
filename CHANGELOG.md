# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will
use [Semantic Versioning](https://semver.org/) from its first release.

## [Unreleased]

First public version in preparation. Nothing has been released yet.

### Added

- **Gmail button** — "Send to Claude" next to the subject of the open
  conversation; works with Gmail's in-page navigation, never duplicates,
  keyboard and screen-reader accessible, ignores script-generated clicks.
- **Capture on click only** — current message or whole conversation; refuses
  when a message or conversation can't be identified reliably; email HTML is
  reduced to plain text.
- **Review page** — shows exactly what will be saved; warns about duplicates;
  detects likely credentials and redacts them by default.
- **Tasks** — stored in the browser (IndexedDB); brief builder that marks email
  text as untrusted and asks Claude to plan first; copy brief and open
  claude.ai (no task content in URLs); record plans; approve, request changes
  or reject a specific plan version and fingerprint; user-reported progress
  labelled as such.
- **Task list** — search, status and date filters, honest integration status.
- **Context refresh** — add new messages from the same conversation to an
  existing task; approved tasks go back to review.
- **Retention** — stored email text deleted 7, 30 (default) or 90 days after a
  task closes, or kept; delete text or whole tasks on demand.
- **Backups** — versioned JSON export of all or selected tasks; optional
  encryption (PBKDF2-SHA256 + AES-256-GCM); import with preview, restore,
  merge or replace, in one transaction; imported approvals are history only.
- **Browsers** — Chrome/Edge/Brave (Chromium MV3) and Firefox 140+ (MV3) builds.
- **Security** — single `storage` permission, strict extension-page CSP with no
  network access, threat model and privacy documentation.
- **Project** — MIT license, CI (Windows, macOS, Linux), dependency and license
  inventory, contribution and security policies.

### Known limitations

- Live Gmail, Google Chrome, Brave, Firefox, macOS and Linux have not been
  tested in a real browser yet.
- The extension cannot detect or start Claude Code on your computer, and cannot
  enforce approvals on Claude's side.
