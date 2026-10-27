# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will
use [Semantic Versioning](https://semver.org/) from its first release.

## [Unreleased]

First public version in preparation. Nothing has been released yet.

### Added

- **Name: Mail2Code** (was "Inbox Handoff"), including the package scope,
  the IndexedDB name and the backup format identifiers (`mail2code-export`).
- **Toolbar menu** with **Task dashboard** and **Settings**; the same two
  links sit at the bottom of the Send to Claude card, and the dashboard has
  a section bar (tasks, settings, backup).
- **Approval by another person** — a named person (for example a team lead)
  can approve a plan from their own browser. They create an approver identity
  (a signing key that never leaves their browser) and send you their card;
  you add it after checking the fingerprint with them. **Ask by email** opens
  a pre-filled Gmail draft; the approver clicks the Mail2Code icon on that
  email to review and sign, and a reply draft opens; clicking the icon on the
  reply lets you check and record it. Signatures, the request, the plan
  version and a 7-day expiry are all checked; email wording never counts. A
  task can require one named approver. Long plans go via the clipboard; files
  work as a fallback. See docs/approvals.md.
- **Task updates for approvers** — after another person approves a plan, the
  task page offers to send them a progress update after each status change
  (plus a manual button), as a Gmail draft with an optional note. Updates are
  signed with a requester key created automatically, so only the original
  requester can update the approver's new **Approved by me** list on the
  Task dashboard. Old, repeated or forged updates are ignored. Storage v3.
- **Backup format v2** — adds trusted approvers (public keys only), the
  required approver per task and who signed each decision. v1 backups still
  import. Approvers restored from a backup must be confirmed again.
- **Icon** — the Gmail button is a round icon (an envelope with `</>`), with
  "Send to Claude" as its tooltip and accessible name; the same mark is the
  toolbar icon.
- **On-device summaries name their language** — requests to Chrome's
  Summarizer now set the output language (the browser's language when it is
  English, German, Spanish, French or Japanese, otherwise English). Settings
  has a **Test on-device AI** button and explains when Chrome has the model
  but hasn't finished setting it up.
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

### Added — Open in Claude

- **One click to Claude Code on this computer** — the Gmail button opens a preview card; **Open in Claude** uses the officially documented links `claude://code/new` (Claude app; also over SSH) or `claude-cli://open` (Claude Code in a terminal) to start a new session with the prompt filled in. You press Enter in Claude.
- **Local email analysis** instead of whole texts — quotes, signatures and disclaimers removed; requests, decisions, deadlines, questions, links and attachments extracted; prompt kept under 4,500 characters.
- **Optional summaries** — Chrome on-device AI (only when already downloaded) or the Claude API with your own key (off by default; optional permission for api.anthropic.com).
- **Settings** — default destination, terminal folder, SSH host/port/folder, default Claude Code mode (with a generated `permissions.defaultMode` snippet; plan mode recommended), analysis engine, API key and model.
- **Security** — validated and encoded link parameters, keystrokes isolated from Gmail, trusted-click checks, API key confined to the extension background, CSP limited to api.anthropic.com.

### Known limitations

- Live Gmail, Google Chrome, Brave, Firefox, macOS and Linux have not been
  tested in a real browser yet.
- The extension can't detect whether Claude is installed, can't auto-send the prompt (by Claude's design), and can't set Claude Code's mode from a link (use the settings snippet).
- The terminal and SSH links and live Claude API summaries haven't been tested yet; the Claude app link was verified on Windows.
