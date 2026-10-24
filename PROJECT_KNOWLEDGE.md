# Gmail-to-Claude Code Bridge — Project Knowledge

> Source of truth for the project's requirements and the working rules every
> contributor (human or agent) follows. Distilled from the original project
> brief (2026-10-24). If the brief and this file disagree, ask the project owner.

## ⚠ Current direction (2026-10-24): extension-only — supersedes the bridge plan

The owner replaced the original brief with an **extension-only** brief: users
install one browser extension and nothing else (no desktop bridge, native
messaging host, daemon, local server or runtime). Everything below that
assumes a desktop bridge, native messaging, local Claude Code execution or
SQLite (§3, §6, §7, the bridge parts of §8, and P2–P14) is **superseded**.
The working rules in §0 still apply.

Approved decisions (recommended defaults, 2026-10-24):
- **D1** Name: working name "Inbox Handoff", button "Send to Claude" (Anthropic branding rules don't allow "Claude Code" in a third-party product name).
- **D2** Optional Managed Agents adapter only if a browser test confirms it works → probe result: **no-go as designed** (see `docs/claude-integrations.md`).
- **D3** Browser handoff records approval but cannot enforce it; the UI says so.
- **D4** Handoff opens `claude.ai/code` for GitHub repositories, otherwise `claude.ai/new`; no task content in the URL.
- **D5** License: owner will choose later; no LICENSE until then.
- **D6** Stored email bodies deleted 30 days after a task closes (to implement in Phase 3).
- **D7** Safari deferred.
- **D8** Local-CLI code removed (still in git history at `bfa5966`).

Status:
- **Phase 2 done (not yet committed):** Gmail button and capture, review page, IndexedDB task store, task page (copy brief, open Claude, user-reported submission, plan recording, recorded approval bound to plan version and hash, user-reported progress), task list with honest integration status.
- **Evidence:** 64 unit tests and 20 E2E tests (10 each in Chromium 156 and Edge 155 on Windows) against synthetic Gmail, all passing.
- **Not verified:** live Gmail, branded Chrome, Brave, Firefox, macOS, Linux.
- **Next:** Phase 3 (filters, search, context refresh, retention).

Current layout: `apps/extension` (WXT, MV3), `packages/protocol` (zod schemas),
`packages/task-core` (state machine, plan hash, approval checks; browser-safe),
`packages/gmail-extract` (DOM extraction), `fixtures/synthetic-gmail`, `tests/e2e`.

## 0. Working rules (process)

- **Phase-gated.** Work proceeds phase by phase (see §17). Each phase needs the
  owner's explicit approval before it starts.
- **Re-approval triggers.** Stop and ask again before any material change to
  architecture, security, privacy, permissions or the approval gate.
- **No external side effects without explicit approval:** no publishing,
  uploading, deploying, tagging, releasing, pushing, or package publishing.
- **No license assumption.** Create `LICENSE` only after the owner picks one.
- **No invented identity.** Never invent a repo URL, owner, contact address or
  private infrastructure. No hard-coded personal data, paths or usernames.
- **Evidence only.** Never claim a browser/OS/version is tested, an installer is
  verified, or a store listing exists without actual evidence. Never fabricate
  test results. Distinguish verified behaviour from untested assumptions.
- **No undocumented Claude Code features.** Verify every CLI flag / SDK option
  against the installed version and current official docs.
- **Synthetic data only** in tests. Never touch real mailboxes or unrelated
  projects; no destructive commands.

## 1. Product vision

A browser extension adds a **Send to Claude Code** button to Gmail. Clicking it
hands the open email (current message or full thread) to the user's **own local
Claude Code installation** via a local desktop bridge, which gets a plan,
**waits for explicit approval**, then implements, tracking everything in a
local task dashboard with export/import for machine migration.

Workflow:
1. Install extension (+ desktop bridge).
2. Open an email in Gmail.
3. Click **Send to Claude Code**.
4. Choose current message or full thread.
5. Review the exact content to be transferred.
6. Pick a configured local project; optional instructions, priority, due date.
7. Confirm the handoff.
8. Bridge prepares the task for Claude Code.
9. Claude Code inspects permitted project context and produces a plan.
10. Plan is displayed; system waits for explicit approval.
11. Only after approval may implementation begin.
12. Dashboard records progress, errors, changed files, results.
13. User can refresh email context, export data, migrate machines.

Approachable for non-experts; secure and configurable for developers.

### Core principles
User-triggered only · no background inbox surveillance · local-first ·
least privilege · transparent data handling · explicit approval before
implementation · cross-browser & cross-platform · portable data formats ·
publicly maintainable · no personal info or owner-run infrastructure.

**The project must not depend on the owner's computer, email account,
credentials, or any server the owner controls.**

## 2. Browsers

Chrome, Edge, Brave, Firefox; Safari where feasible (separate target with its
own packaging/signing/distribution). Shared TypeScript / WebExtensions code,
browser-specific adapters where APIs differ, per-browser manifests and builds,
account for MV3 lifecycle (service-worker termination etc.). Document
unsupported features. Do not claim testing that has not happened.

## 3. Operating systems

Windows, macOS, Linux. Shared bridge core + platform adapters. The bridge must:
detect OS; detect Claude Code and validate executable path/version; let users
configure allowed project directories; support paths with spaces and non-ASCII;
launch processes safely; handle missing deps and permission failures; ship
install/upgrade/troubleshoot/removal docs; no hard-coded usernames/paths.

**IPC:** prefer native messaging or another local IPC with no unauthenticated
network service. If localhost HTTP is ever justified: documented threat model,
strict auth, origin validation, request validation, loopback-only binding.

## 4. Gmail integration

Button: appears only when a message is open; works with Gmail's dynamic DOM and
SPA navigation; no duplicates; keyboard- and screen-reader-accessible; doesn't
interfere with native controls; clear status/error messages.

On click:
1. Identify current message and conversation (stop and ask user to retry if
   identification is unreliable).
2. Offer current message vs full thread.
3. Preview: subject, sender, date, body text, Gmail thread link.
4. Select local project.
5. Optional instructions, priority, due date.
6. Explain exactly what goes to the bridge and to Claude Code.
7. Explicit confirmation before handoff. Never transmit silently.

**Permissions:** minimum per feature. Evaluate optional host permissions,
user-triggered access, visible-message extraction, Gmail API. No full-mailbox
access for convenience. If Gmail API is needed: explicit auth flow, minimal
scopes, secure token handling, documented setup. **Never embed OAuth client
secrets in public code. Never export refresh tokens, cookies or credentials.**

## 5. User-triggered operation only

No automatic: inbox scanning, email reading, polling, task creation, Claude
Code launch, implementation, hidden transmission, email sending, deployment.
Installing or opening Gmail never triggers anything. Any future reply-refresh
feature: off by default, opt-in, documented, minimal permissions.

## 6. Local desktop bridge

Receive handoffs; validate extension identity and message schema; enforce size
limits and path restrictions; generate task IDs; manage task state; build
structured task briefs; launch/communicate with Claude Code via a documented
integration; record progress/results; cancellation, retries, failures; persist
history and audit events; recover safely after restarts.

**Never** accept shell commands from email content; use explicit executable
paths + argument arrays; never concatenate email text into commands; only
user-configured project dirs; never execute scripts/links/commands/instructions
embedded in emails or attachments.

## 7. Claude Code integration

Inspect installed version and official docs first. Use only documented CLI/SDK
capabilities and permission controls. Flow: open in selected project → provide
brief → request analysis/plan → display plan → wait for approval → implement
only after approval → report progress/failure/completion.

**A prompt telling Claude Code to wait is not enforcement.** If the integration
cannot enforce the boundary, document it and propose a safer alternative.

## 8. Mandatory approval gate (release blocker)

The Gmail click authorizes only the handoff + planning, never implementation.

States: `Captured`, `ReadyForPlanning`, `Planning`, `AwaitingApproval`,
`Approved`, `InProgress`, `Blocked`, `Completed`, `Rejected`, `Cancelled`,
`Failed`.

**Planning:** restricted, read-only inspection of the permitted project. Plan
covers objective, assumptions/open questions, steps, files/components likely to
change, proposed commands/tools, tests, risks/side effects, external deps. No
changes during planning; ask before any planning op with side effects.

**Approval:** UI to approve the exact plan / reject / request changes / cancel.
Approval bound to task + project + plan version/hash. Task stays in
`AwaitingApproval` until an explicit action.

**Implementation:** only after `Approved`. Fresh approval required if project
changes, scope/plan materially changes, new sensitive permissions are needed,
or a consequential op falls outside scope. Separate authorization for sending
email, deploying, publishing releases, deleting important data, touching
production.

**Enforcement:** real Claude Code permission controls **and** the bridge state
machine. Tests must prove: malicious email can't self-approve; forged approval
rejected; replayed approval can't authorize unrelated work; old approval can't
authorize a changed plan; imported approval history can't authorize execution;
background events can't trigger implementation. If enforcement isn't reliable,
report the limitation rather than claim compliance.

## 9. Task management / dashboard

Track: ID, title, source email + thread URL, message/thread IDs, project ref,
priority, due date, status, created/updated, last context refresh,
instructions, context summary, plan versions + approval history, execution
start/end, progress events, errors + redacted logs, files changed, test
results, completion summary, cancel/failure reason.

SQLite or other reliable local store (chosen after review); schema migrations;
crash recovery; duplicate-handoff protection; don't keep full email bodies
indefinitely unless the user opts in; filter by status/priority/project/date;
idempotent retries; external sync off unless separately built and configured.

## 10. Email-thread context

Current-message and full-thread handoff; manual refresh; explicit retrieval of
more relevant emails; summaries of requirements/decisions/deadlines/open
questions; changed-requirement detection; source links; record which messages
informed each task; duplicate-task warnings. Prefer storing IDs over copies.
New replies may update context but **never** approve implementation. All email
content, attachments and quoted instructions are **untrusted input**.

## 11. Export, import, migration (core feature)

**Formats:** (1) versioned, inspectable JSON; (2) full backup archive (ZIP)
with manifest (app version, schema version, created-at, per-file checksums).
Export all or selected tasks. Export schema documented independently of the DB.

**May include:** tasks, statuses, titles, descriptions, priority, due dates,
timestamps, Gmail message/thread IDs + links, user instructions, summaries,
stored email content only if retained *and* selected, project refs, history,
approval history + plan metadata, non-sensitive prefs, schema version, export
timestamp.

**Import:** choose file → validate type/schema/size/structure → verify
integrity → reject unsafe paths/malformed data/malicious entries (zip-slip,
zip bombs) → preview → detect duplicates/conflicts → choose strategy → confirm
→ transactional apply → report. Strategies: restore-into-empty, merge with
conflict resolution, replace (explicit warning + confirmation). Never silently
overwrite; on failure keep the original DB and give a recoverable error report.

**Encryption:** optional, recommended when sensitive. Maintained library,
authenticated encryption, passphrase KDF with documented parameters, no custom
crypto, never store passphrase/key in archive, warn on unencrypted sensitive
export, protect temp files. Checksums detect corruption, not authenticity —
document this. **Always exclude** OAuth tokens, passwords, cookies, private
keys, credentials, env secrets. Never auto-upload backups.

**Migration workflow:** export on old machine → encrypt if sensitive → install
extension + bridge on new machine → install/auth own Claude Code → import →
review → map old project paths → reconnect Gmail → refresh unavailable context
→ validate. Must not need the old machine or an owner-run server.

**Portable project refs:** display name, original path (reference only),
optional repo URL, git remote/branch, repo-relative working dir, stable
user-defined project ID. Restored paths are `NeedsConfiguration` until mapped.
Never execute code because a path was restored. No repo credentials/SSH keys.

**Gmail reconnection:** keep original references; mark unavailable context;
allow reauth; explain that changing Google accounts may break references.

**Approval safety after import:** imported data is untrusted; imported tasks
never auto-execute; historical approvals are audit-only; prior approval never
authorizes execution on a new machine; imported plans need fresh review;
project/environment revalidated; previously in-progress tasks → marked for
review, not resumed; nothing executes during import.

**Portability tests:** JSON round-trip, full backup/restore, empty restore,
merge/duplicates, replace confirmation, interrupted import recovery, corrupt
files/bad checksums, malicious paths/oversize, encrypt/decrypt, wrong
passphrase, old-schema migration, cross-platform path mapping, missing repos,
unavailable threads, credential exclusion, audit preservation, fresh-approval
enforcement after migration.

## 12. Privacy & security

Least-privilege permissions · explicit handoff confirmation · local-first ·
no telemetry by default · no automatic ingestion · no hidden cloud
transmission · strict validation · safe process invocation · path restrictions
· secure extension↔bridge channel · replay protection · size limits · secret
redaction · prompt-injection protection · approval-state validation · audit
history · safe error handling · secure config/token storage.

Document threat model, trust boundaries, data flows, permissions, limitations,
and exactly what goes to Claude Code vs what stays local. Any hosted service,
analytics, sync or third-party processing: documented and opt-in.

## 13. Public repository

Suggested layout (adjust if simpler is justified):
```
apps/extension/        browser extension
apps/desktop-bridge/   local desktop service
packages/shared/       types, schemas, protocol
packages/task-core/    lifecycle + approval engine
packages/backup/       export/import/migration
tests/                 automated tests
docs/                  architecture, security, install, troubleshooting
.github/workflows/     CI and release checks
```
Required docs: README, CONTRIBUTING, SECURITY, CHANGELOG, .gitignore,
.editorconfig, .env.example (if needed), and in `docs/`: architecture,
threat-model, permissions-and-privacy, installation, troubleshooting,
browser-compatibility, data-portability, backup-format, release-process.
Plus dependency / third-party license info. LICENSE only after owner chooses.

Install paths: **developer** (clone, install, build, configure bridge, test;
load unpacked extension) and **end-user** (store listing when available +
documented/verified bridge installers). No owner-run server required.

## 14. CI & release

GitHub Actions (after approval): lint/format, typecheck, unit + integration
tests, extension + bridge builds, manifest validation, dependency vuln scan,
secret scan, per-platform builds, archive/backup tests, license inventory,
artifacts. Minimal workflow permissions; pin actions to commit SHAs. No
publishing/tags/releases/pushes without approval. Signing keys outside repo.
Document reproducible builds and limits.

## 15. Testing requirements

Gmail button + message identification; message vs thread selection; handoff
confirm/cancel; permission denial; unavailable bridge; duplicate requests;
process-launch security; path traversal/unauthorized projects; malicious email
& prompt injection; approval enforcement; changed-plan reapproval;
rejected/cancelled; persistence & crash recovery; retries; secret redaction;
context refresh; export/import; encrypted backups; schema migrations;
cross-platform path mapping; browser-specific and platform-specific behaviour;
credential exclusion; install/removal. Mock external services, isolated test
repos.

## 16. Technology guidance (recommendations, not mandates)

TypeScript; WebExtensions-compatible build; per-browser adapters/manifests;
cross-platform desktop runtime; native messaging; SQLite; typed protocol;
modular Claude Code adapter; versioned JSON + documented archive format;
established crypto library; automated tests; platform packaging. Prefer the
simplest architecture; no microservices or hosted infra; minimal deps.

## 17. Milestones

1. **Inspection & planning** (read-only) → approval.
2. **Minimal prototype:** Gmail button, message/thread selection, preview,
   secure handoff, project selection, planning integration, persistent approval
   gate, demonstrable block on pre-approval implementation.
3. **Task management:** persistence, status, progress, history, context refresh.
4. **Data portability:** JSON export, archives, import, conflicts, encryption,
   migration docs.
5. **Security hardening.**
6. **Cross-platform packaging** and install/removal docs.
7. **Public repo prep:** docs, contributing, license, CI, dependency inventory,
   release checklist.
8. **Release readiness:** tests, permission audit, backup compatibility,
   tested-vs-untested report. No publication without approval.

## 18. Coding standards

Strong types; small modules; minimal deps; meaningful tests; explicit error
handling; never swallow security errors; config outside source; structured,
redacted logs; document non-obvious security decisions; preserve user work;
inspect before changing; no destructive cleanup; private data out of Git;
maintain migrations; never fabricate results.

## 19. Definition of done

A new developer can: clone → follow setup → build extension → configure bridge
→ connect own Claude Code → click Send to Claude Code in Gmail → choose
message/thread → review & confirm → pick allowed project → receive plan →
approve/reject that specific plan → verify implementation can't start before
approval → track progress → export → restore/merge on another machine →
remap project paths → run tests → understand the privacy/security model. All
claims backed by evidence.

## 20. Highest priorities

User-triggered only · no background monitoring · one-click initiation with
confirmation · cross-browser/cross-platform · secure local execution ·
genuinely enforced approval gate · persistent task/conversation tracking ·
reliable export/import & migration · privacy-preserving defaults · public
GitHub readiness · no external side effects without explicit approval.

---

# Phase 1 — Inspection findings and proposed plan (2026-10-24)

Status: **APPROVED 2026-10-24** with recommended defaults for D1–D9 (license
deferred). Phase 2a done; 2b spike written, live run **skipped by owner**
(no Claude Code credentials on the dev machine) — see
`docs/phase-2b-spike-report.md`. **Open release blocker:** `npm run spike:real`
must pass before claiming live enforcement. Phase 2c done (2026-10-24): Gmail
button, extraction, review page; synthetic-fixture E2E passing on Chromium and
Edge (Windows) — live Gmail not yet verified, see `docs/browser-compatibility.md`.
Next: 2d (native host shim, daemon, planning run, approval UI).

Resolved decisions (recommended defaults):
- D1: working name **Inbox Handoff**, button **"Send to Claude"** (placeholder).
- D2: user's own Anthropic API key is the default auth path.
- D3: DOM-only extraction for the MVP; Gmail API deferred, opt-in.
- D4: license deferred — owner will choose; no LICENSE file until then.
- D5: stored email bodies deleted 30 days after a task closes; IDs/summaries kept.
- D6: Safari deferred.
- D7: bridge requires Node ≥ 24 for now; single binary later.
- D8: exact-match plan-declared command allowlist; anything else escalates.
- D9: WXT for the extension (introduced in 2c).

## P1. Environment assessment (verified on the dev machine)

| Item | Finding |
|---|---|
| OS | Windows 11 Pro 10.0.26200, x64 |
| Workspace | `D:\ClaudePlugin` — empty apart from this file; not a Git repo |
| Node / npm | Node v24.14.1, npm 11.11.0 (pnpm, yarn, bun not installed) |
| Git | 2.49.0 |
| Python | 3.13.14 |
| .NET | 10.0.402 |
| Rust / Go | not installed |
| sqlite3 CLI, zip, 7z | not installed |
| Claude Code | 2.1.295, global npm package `@anthropic-ai/claude-code` |
| Chrome | 156.0.8078.47 installed |
| Edge | 155.0.4283.62 installed |
| Brave, Firefox, Safari | not found (Safari impossible on Windows) |

**Testing reach from this machine:** Chrome and Edge on Windows only.
Firefox/Brave can be installed later if the owner wants. macOS, Linux and
Safari can only be built and tested in CI runners or on other hardware, and
docs must say so until that happens.

### Claude Code capabilities verified (local `claude --help` + official docs)

- CLI: `-p/--print`, `--output-format text|json|stream-json`,
  `--input-format stream-json`, `--permission-mode
  acceptEdits|auto|bypassPermissions|manual|dontAsk|plan`,
  `--permission-prompts host|none`, `--tools`, `--allowed-tools`,
  `--disallowed-tools`, `--settings`, `--setting-sources`, `--json-schema`,
  `--restricted`, `--strict-mcp-config`, `--no-session-persistence`,
  `--max-budget-usd`, `--add-dir`, `--session-id`.
- Agent SDK (`@anthropic-ai/claude-agent-sdk`) permission evaluation order:
  **hooks → deny rules → ask rules → permission mode → allow rules →
  `canUseTool`**. A `PreToolUse` hook `deny` holds in every mode, including
  `bypassPermissions`. Deny rules hold in every mode. Bare-name deny removes the
  tool from the model's context entirely.
- `plan` mode: read-only tools run normally; file edits and file-modifying shell
  commands always go to `canUseTool`, even if an allow rule or hook says allow.
  Read-only Bash commands still run in plan mode. **So plan mode alone is not
  a sufficient planning sandbox.**
- `dontAsk` mode: anything that would prompt is denied without calling
  `canUseTool`.
- A `PreToolUse` hook that times out **blocks** the tool call (fail-closed).
- Subagents inherit `plan` mode from the parent.
- Docs warn that a user-installed **mod** "can still approve some calls" in
  `dontAsk`. This must be tested and neutralised (see P7).

### Policy findings that affect the product (official docs)

1. **Authentication:** the Agent SDK overview states that, unless previously
   approved, Anthropic does not allow third-party developers to offer
   claude.ai login or rate limits for their products, including agents built on
   the Agent SDK; API key authentication is to be used instead. → Owner
   decision D2.
2. **Branding:** for products built on the Agent SDK, the guidelines do **not
   permit** naming a product "Claude Code" or "Claude Code Agent"; allowed forms
   include "Claude Agent" or "{Name} Powered by Claude". The working name
   "Gmail-to-Claude Code Bridge" and button text "Send to Claude Code" likely
   conflict. → Owner decision D1.

### Native messaging facts (official docs)

- Chrome-family: host manifest with `allowed_origins` (no wildcards),
  `type: "stdio"`; Windows registry key under
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>`; host→browser
  messages max **1 MB**, browser→host max 64 MiB; host receives the caller
  origin as argv[1]. `connectNative` keeps one host process alive for the
  port; `sendNativeMessage` spawns one per message.
- Firefox: `allowed_extensions` (add-on IDs) instead of `allowed_origins`;
  registry key under `HKCU\Software\Mozilla\NativeMessagingHosts\<name>`;
  `nativeMessaging` can be an **optional** permission; 1 MB host→extension.
- Edge and Brave manifest/registry locations: **to verify** during Phase 6.
- Safari Web Extensions cannot use these host manifests; native messaging goes
  to the extension's containing macOS app. Needs a small Swift container app
  that relays to the bridge, plus Apple signing. → Separate target (D6).

## P2. Recommended architecture

```
 ┌──────────────────────── Browser ────────────────────────┐
 │  Gmail tab (mail.google.com)                            │
 │   content script: button + DOM extraction (no network)  │
 │        │ runtime.sendMessage (handoff draft only)       │
 │        ▼                                                │
 │  background (MV3 service worker / FF event page)        │
 │   - validates sender, routes messages                   │
 │   - NEVER forwards approve/implement from a content     │
 │     script                                              │
 │        ▲                                                │
 │  Extension pages: Handoff review · Dashboard · Approval │
 │  · Settings · Backup  (chrome-extension:// origin)      │
 └────────│────────────────────────────────────────────────┘
          │ native messaging (stdio, length-prefixed JSON)
          ▼
 ┌──── native host shim (short-lived, spawned by browser) ─┐
 │  checks caller origin against installed allowlist       │
 │  starts daemon if absent; relays frames                 │
 └────────│────────────────────────────────────────────────┘
          │ local IPC: Windows named pipe / Unix domain socket
          │ (user-only ACL / 0600) + per-install secret
          ▼
 ┌──── bridge daemon (Node/TS, per user) ──────────────────┐
 │  protocol validation (zod) · size limits · replay guard │
 │  task-core state machine + approval verifier            │
 │  SQLite store (tasks, plans, approvals, audit log)      │
 │  project registry (allowed roots, realpath checks)      │
 │  claude-adapter (Agent SDK) + tool policy hook          │
 │  backup/import engine                                   │
 └────────│────────────────────────────────────────────────┘
          │ Agent SDK → user's own Claude Code binary
          ▼
   Claude Code, cwd = selected project, tools gated by the
   daemon's PreToolUse hook + deny rules + mode
```

Why this shape:
- **No network listener at all.** Browser↔bridge is native messaging; the
  dashboard is an extension page, so no localhost HTTP server is needed.
- **Shim + daemon** because a native host dies when the browser closes its
  port; implementation runs can take a long time and must survive that, and
  crash recovery needs one owner of the database.
- **Bridge in TypeScript on Node** so it can use the official TypeScript Agent
  SDK with in-process hooks and `canUseTool`, and share types with the
  extension. Node 24 is already installed.

Data flow on a handoff: Gmail DOM → content script extracts visible message(s)
→ review page shows the exact payload → user confirms → background sends
`handoff.create` (with idempotency key) → shim → daemon validates, stores task
in `Captured` → user (or auto, configurable) moves to `ReadyForPlanning` →
planning run → plan stored + hashed → `AwaitingApproval` → user approves in the
dashboard → `Approved` → implementation run → `InProgress` → `Completed` /
`Failed` / `Blocked`.

What leaves the machine: only what Claude Code itself sends to the model
provider (the task brief incl. selected email text, plus files Claude reads).
Nothing goes to any server run by this project.

## P3. Proposed repository structure

npm workspaces (npm already installed; avoids adding a package manager).

```
apps/
  extension/            WXT-based MV3 extension (Chrome/Edge/Brave/Firefox;
                        Safari later). entrypoints: content (gmail),
                        background, pages (review, dashboard, approval,
                        settings, backup)
  bridge/               daemon, native-host shim, CLI (`bridge doctor`,
                        `bridge install-host`, `bridge approve` optional)
packages/
  protocol/             zod schemas + TS types for every message, versioned
  task-core/            pure state machine, plan hashing, approval verifier
  claude-adapter/       Agent SDK wrapper, phase policies, PreToolUse hook
  gmail-extract/        pure DOM parsing functions, tested on fixtures
  backup/               JSON export, ZIP archive, encryption, import planner
  storage/              SQLite access layer + migrations
installers/
  windows/ macos/ linux/  native-host registration scripts (per browser)
fixtures/
  synthetic-gmail/      static HTML snapshots resembling Gmail (synthetic data)
  malicious/            prompt-injection emails, zip-slip archives, etc.
tests/
  e2e/                  Playwright: unpacked extension vs synthetic Gmail
  integration/          shim↔daemon, adapter with fake runner, opt-in real
                        Claude Code test in a temp repo
docs/                   all docs required in §13
.github/workflows/      CI (Phase 7)
```

## P4. Browser / OS compatibility plan

| Target | Plan | Notes |
|---|---|---|
| Chrome (Win/mac/Linux) | Primary, Phase 2 | Testable here on Windows |
| Edge | Phase 2 | Testable here on Windows; registry path to verify |
| Brave | Phase 6 | Chromium build; host manifest path to verify |
| Firefox | Phase 6 | `allowed_extensions`, gecko ID, event-page background |
| Safari (macOS) | Phase 6+ / optional | Needs Swift container app, Apple Developer signing, macOS hardware |
| Windows bridge | Phase 2 | Named pipe, HKCU registration |
| macOS bridge | Phase 6 | UDS, per-browser NativeMessagingHosts dirs; notarisation if shipped as binary |
| Linux bridge | Phase 6 | UDS, `~/.config/<browser>/NativeMessagingHosts` |

The compatibility doc will have a per-cell status: *planned / built / tested
(version, date, how)*. Nothing is marked tested without evidence.

## P5. Gmail permission strategy

- Required: `host_permissions: ["https://mail.google.com/*"]` for the content
  script (needed to draw the button), `nativeMessaging`, `storage`.
  Firefox: `nativeMessaging` optional, requested on first use.
- **No `identity`, no Gmail API, no OAuth in the MVP.**
- Current message: extracted from the rendered DOM of the open conversation,
  only after the click. Message IDs from Gmail's DOM attributes where present;
  if the message cannot be identified with confidence, abort and ask to retry.
- Full thread: the content script asks the user to expand collapsed messages
  (or offers an "Expand all" click on Gmail's own control) and extracts what is
  rendered; the preview lists exactly which messages were captured and flags
  any that appear collapsed or truncated.
- Optional later (D3): Gmail API with `gmail.readonly` for complete threads and
  refresh. This is a Google **restricted** scope (verification + security
  assessment for a public client), so the design would have each user supply
  their own OAuth client ID (PKCE, no client secret in code), tokens stored only
  in extension storage, never exported. Off by default.
- Gmail DOM is undocumented and changes; extraction lives in one package with
  fixture tests and multiple selector strategies, and fails safe.

## P6. Desktop bridge and Claude Code integration

- Detection: find `claude` on PATH / known install locations, run
  `claude --version` with an argument array (no shell), record path + version,
  compare to a minimum supported version.
- Process launch: Agent SDK `query()` with `pathToClaudeCodeExecutable` pointed
  at the validated binary (to be confirmed in the SDK reference), `cwd` =
  realpath of an allowed project root, explicit env allowlist.
- Email text only ever goes into the prompt body, wrapped in clearly delimited
  "untrusted email content" blocks, never into argv, env or shell strings.
- Two separate runs per task: **planning run** and **implementation run**
  (fresh session; the approved plan is passed in as trusted context).
- Structured plan output via JSON schema (objective, assumptions, questions,
  steps, files, commands, tests, risks, external deps).

## P7. Approval enforcement (the release blocker)

Defence in depth; prompt wording is not relied on.

**Layer 1 — tool surface per phase (Claude Code controls)**
- Planning: `tools: ["Read","Glob","Grep"]`; bare-name deny of `Bash`,
  `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`,
  `Agent`, `mcp__*`; `permissionMode: "dontAsk"` (or `plan`, decided by the
  spike); `settingSources: []` so project/user settings can't add allow rules
  or hooks; no MCP servers; plugins disabled; `canUseTool` always denies.
- Implementation: `permissionMode: "default"`; tools limited to what the plan
  declares; dangerous categories hard-denied (`git push`, publish, deploy,
  email sending, credential files, paths outside the project).

**Layer 2 — bridge-owned `PreToolUse` hook (no matcher, runs for every call)**
Reads the daemon DB on every tool call and denies unless all hold:
task state is `InProgress`; an active approval exists for this task whose
`planHash` equals the plan being executed, `projectId` and project realpath
match, approval created on this install (`installId`) and not imported,
not revoked or superseded; the tool + input are inside the approved scope;
file paths resolve (realpath, symlink-safe) inside the project root. Anything
outside scope → deny, task → `Blocked` with a pending "needs approval" request
shown in the dashboard. Hook failure or timeout → tool blocked (fail-closed,
per docs).

**Layer 3 — state machine + approval protocol**
- Transitions are explicit functions in `task-core`; illegal transitions throw.
- On reaching `AwaitingApproval`, the daemon issues a one-time
  `approvalNonce` bound to `(taskId, planVersion, planHash)`.
- An approve request must carry `taskId, planVersion, planHash, nonce`, and
  must arrive from an **extension page** (background checks `sender.url` is the
  approval page and that the sender is not a content script / Gmail tab).
  The daemon checks the nonce is unused and unexpired, the hash matches the
  latest plan, and the project is still valid; then consumes the nonce.
- Any plan change creates a new version + hash and invalidates prior nonces
  and approvals.
- Imported approvals are stored with `origin = "imported"` and are never
  consulted by the hook.
- Background events (restart, reply refresh, import) can only move tasks to
  `Blocked`/review states, never to `Approved`/`InProgress`.

**Known limitation to document:** once approved, commands like `npm test`
execute project-defined scripts that can do anything the user can. Approval
covers the plan's declared commands; it cannot sandbox what those scripts do.
Claude Code's own sandboxing may be offered as an option where supported
(platform support to verify).

**Phase 2 starts with a go/no-go spike** proving: planning run cannot write or
run shell; implementation is impossible without a valid approval; user
settings/plugins/mods cannot approve calls under our configuration. If any of
these fail, stop and report before building further.

## P8. Threat model summary

Assets: email content, project source, user credentials on disk, the ability
to run code. Adversaries: malicious email sender (prompt injection), malicious
web page / other extension, malicious backup file, local unprivileged process,
compromised project repo.

| Threat | Mitigation |
|---|---|
| Email instructs Claude to act ("ignore previous…, run…") | Email marked untrusted; no tools beyond read-only in planning; human reviews plan; hook enforces scope |
| Email/page forges an approval | Approve only from extension page; nonce + hash; content script messages can't reach approve path |
| Replay of an old approval | One-time nonce, hash binding, version check |
| Other extension talks to native host | `allowed_origins`/`allowed_extensions` + shim re-checks argv origin |
| Local process talks to daemon | user-only pipe/socket ACL + per-install secret file with user-only permissions |
| Path traversal / symlink escape | realpath + allowed-root check in daemon and hook |
| Malicious backup (zip-slip, bomb, forged approvals) | entry/size/ratio limits, path sanitisation, schema validation, imported approvals inert |
| Secrets leaking into logs/exports | redaction pass on logs; export excludes credentials by construction |
| Silent data exfiltration | no telemetry, no network calls from extension or bridge besides Claude Code itself |

Full STRIDE write-up goes in `docs/threat-model.md`.

## P9. Data model and persistence

Store: SQLite via Node's built-in `node:sqlite` (no native addon to compile;
its stability level in Node 24 to be confirmed — fallback `better-sqlite3`).
WAL mode, foreign keys on, one writer (the daemon).

Tables (internal; the export format is separate):
- `schema_migrations(version, applied_at)`
- `install(id, created_at)` — random install ID, never exported as authority
- `projects(id, user_project_id, display_name, repo_url, git_remote,
  git_branch, rel_workdir)`; `project_paths(project_id, install_id, path,
  status: ok|needs_configuration|missing)`
- `tasks(id, title, status, block_reason, priority, due_at, project_id,
  instructions, context_summary, created_at, updated_at, last_refresh_at,
  idempotency_key UNIQUE, origin: local|imported)`
- `task_sources(task_id, gmail_message_id, gmail_thread_id, thread_url,
  subject, sender, sent_at, role)`
- `email_snapshots(task_id, message_id, body_text, retained_until)` —
  purged on schedule unless the user chooses to retain
- `plans(id, task_id, version, hash, content_json, created_at)`
- `approvals(id, task_id, plan_id, plan_hash, project_id, project_path_hash,
  install_id, decision: approved|rejected|changes_requested, nonce,
  decided_at, origin: local|imported, consumed_at, superseded_at)`
- `executions(id, task_id, phase, started_at, ended_at, outcome,
  session_id)`
- `task_events(id, task_id, at, type, data_json)` — append-only audit log
- `file_changes(execution_id, path, change)`; `test_results(execution_id, …)`
- `settings(key, value)` — non-secret only

Idempotency key = hash(thread ID + message IDs + project ID + instructions)
to block duplicate handoffs; a deliberate duplicate needs explicit confirm.
Imported tasks that were `Approved`/`InProgress` become `Blocked` with
`block_reason = imported_requires_review`.

## P10. Export / import / encryption / migration

- **JSON export:** `{ format: "g2cc-export", schemaVersion, appVersion,
  exportedAt, tasks[], projects[], plans[], approvals[] (audit only),
  events[], settings{} }`, documented in `docs/backup-format.md` with a JSON
  Schema file.
- **Archive:** ZIP containing `manifest.json` (app/schema version, created
  time, file list with SHA-256), `data/export.json`, optional
  `attachments/…`.
- **Encryption:** wrap the archive in the **age** format (passphrase →
  scrypt, authenticated encryption) using the maintained `age-encryption`
  JS library. Benefit: users can decrypt with the standard `age` tool without
  this app. Parameters documented. Library choice to be re-verified before
  use.
- **Import pipeline:** size cap → type sniff → (decrypt to memory, not disk) →
  ZIP entry validation (no absolute paths, `..`, drive letters, symlinks,
  duplicate/case-colliding names; entry count, total size and ratio caps) →
  checksum verify → schema validate + migrate older versions → build an
  import plan (new / duplicate / conflict per record) → preview → strategy
  (empty-restore / merge / replace with typed confirmation) → single SQLite
  transaction, with a DB file backup taken first → report.
- Credentials are excluded **by construction**: the exporter reads from an
  explicit allowlist of fields, not "everything except secrets".
- Project paths arrive as `needs_configuration` for the new install; a
  mapping screen lets the user pick local folders.
- Checksums detect corruption only; age's authentication (with the
  passphrase) is what detects tampering. Documented.

## P11. Test strategy and CI

- Unit (Vitest): state machine (incl. property tests with fast-check over
  random event sequences: no path reaches `InProgress` without a valid local
  approval), plan hashing, approval verifier, path checks, redaction,
  protocol schemas, backup round-trips, malicious archives, migrations.
- Gmail extraction: fixture HTML snapshots (synthetic content) for current
  message, multi-message threads, collapsed messages, RTL/non-ASCII.
- Integration: shim↔daemon framing and auth; adapter against a **fake Claude
  runner** that tries forbidden tools; one **opt-in** real Claude Code test
  (env flag, user's own auth, temp Git repo) proving denials actually happen.
- E2E (Playwright, Chromium): load unpacked extension, open the synthetic
  Gmail fixture, click button, review, confirm, see task created. Real Gmail
  is never automated.
- CI (Phase 7): GitHub Actions matrix windows/macos/ubuntu; lint, format,
  typecheck, tests, extension builds per browser, manifest validation,
  `npm audit`, secret scan, license inventory, artifact upload. Minimal
  `permissions:`, actions pinned to commit SHAs. No publishing.

## P12. Milestones (refined)

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 2a | Scaffold monorepo, protocol, task-core, storage | Unit tests green |
| 2b | **Enforcement spike** (adapter + hook) | Go/no-go evidence report |
| 2c | Gmail button + extraction + review page (Chrome/Edge) | Fixture + E2E tests green |
| 2d | Shim, daemon, Windows host registration, planning run, approval UI | Demo: plan shown; implementation blocked until approval |
| 3 | Dashboard, progress events, history, refresh, retries | Crash-recovery tests |
| 4 | Export/import/encryption/migration | Portability test list in §11 |
| 5 | Security hardening + threat-model review | Threat tests green |
| 6 | Firefox, Brave, macOS, Linux; Safari if approved | Per-cell evidence in compat doc |
| 7 | Docs, CI, license, dependency inventory | CI green |
| 8 | Release-readiness report | Tested vs untested list |

## P13. Decisions needed from the owner

- **D1 Name/branding.** Rename to comply with Anthropic's branding guidance
  (e.g. button "Send to Claude", product "<Name> Powered by Claude")?
- **D2 Authentication.** Default to the user's own Anthropic API key (the
  documented path for SDK-based tools), or drive the user's already-logged-in
  Claude Code CLI? The second may conflict with the policy quoted above
  unless Anthropic approves it.
- **D3 Full-thread retrieval.** DOM-only MVP (recommended) vs adding opt-in
  Gmail API with user-supplied OAuth client later.
- **D4 License** (MIT / Apache-2.0 / GPL-3.0 / other).
- **D5 Email retention default** (e.g. delete stored bodies 30 days after task
  closes; IDs and summaries kept).
- **D6 Safari** in scope for Phase 6, or deferred.
- **D7 Bridge distribution.** Require Node installed (simplest), or ship a
  single binary (Node SEA) per OS.
- **D8 Implementation-phase shell policy.** Plan-declared command allowlist
  with escalation for anything else (recommended), or stricter/looser.
- **D9 Extension framework.** WXT (recommended: multi-browser manifests,
  MV3 handling) vs hand-rolled Vite build.

## P14. Known limitations (to carry into docs)

- Gmail's DOM is undocumented and may change; extraction can break.
- DOM-only extraction captures only rendered messages.
- Approved commands run project scripts with the user's privileges.
- Anything Claude Code reads is sent to the model provider by Claude Code.
- macOS/Linux/Safari/Firefox/Brave untested until hardware/CI is available.
- Chrome/Edge store IDs differ from unpacked IDs; host registration must list
  each, and developer builds need a pinned key.
