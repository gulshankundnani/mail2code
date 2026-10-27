# Release-readiness report

Date: 2026-10-24 · Branch `phase-2` · Verified on the committed state
`4ab0d20` from a fresh clone, plus the Phase 7 additions (compatibility tests
and fixtures) · Windows 11 x64, Node 24.14.1.

## Update — "Open in Claude" (later on 2026-10-24)

After this report, the product changed at the owner's request. **Send to Claude** now analyses the email locally and opens Claude Code on the computer via `claude://code/new` / `claude-cli://open`, with Settings for destination, mode and optional AI summaries. Differences from the figures below:

- **Permissions:** an **optional** host permission `https://api.anthropic.com/*` (not granted at install) and CSP `connect-src https://api.anthropic.com`, both used only for opt-in Claude API summaries.
- **Runtime dependencies:** 9 (the official Anthropic SDK and its dependencies; all permissive licenses) instead of 1.
- **Bundle:** about 705 kB per build; the background script is 478 kB (115 kB gzipped) because MV3 service workers can't lazy-load the SDK. The Gmail content script is 34 kB.
- **Tests:** 158 unit and 66 E2E (33 per browser), all passing. Secret scan, license check, `npm audit` (0 / 0) and `web-ext lint` (0 errors) are clean.
- **Verified manually:** the `claude://code/new?q=` link opens a new local Claude app session with the prompt filled in (owner's Windows PC).
- **Not yet tested:** `claude-cli://` and SSH links, live Claude API summaries, on-device AI, and live Gmail.

The store-release blockers below still apply, plus testing the items above.

## Verdict

| Question | Answer |
|---|---|
| Ready for **public review as a GitHub repository**? | **Yes**, once the owner creates the repository and the first CI run on GitHub passes (CI has never run: nothing has been pushed). |
| Ready for **browser-store release**? | **No.** The blockers are listed below. |
| Anything published, pushed or uploaded? | **No.** |

### Blockers before a store release

1. **Live Gmail** has never been tested. All automated tests use synthetic pages, so someone needs to do the manual check in [browser-compatibility.md](browser-compatibility.md).
2. **Real-browser testing** for every browser the listing will claim. Only Chromium (Playwright build) and Microsoft Edge on Windows are tested. Google Chrome (branded), Brave and Firefox are built but untested.
3. **Firefox add-on ID**: confirm `{034066bd-772c-43e5-b155-6a7e030ac512}` or replace it before the first addons.mozilla.org submission. It can't change afterwards.
4. **Product name**: "Mail2Code" is still a working name (decision D1). Settle the final name before creating store listings.
5. **First green CI run** on GitHub (Windows, macOS, Linux).
6. **Release mechanics**: version 0.1.0, changelog entry, store listings and privacy disclosures, all following [release-process.md](release-process.md).
7. **Explicit owner approval** to publish.

## Checks run

| Check | Result |
|---|---|
| Fresh clone → `npm ci` (lockfile) | ✅ installed, 0 vulnerabilities |
| `npm run typecheck` (packages + extension) | ✅ |
| Unit tests (Vitest) | ✅ **119 / 119** (fresh clone: 115 / 115 before the Phase 7 compatibility tests were added) |
| Build Chrome, Edge, Firefox (MV3) | ✅ |
| `npm run check:manifests` | ✅ 3 manifests: MV3, `storage` only, Gmail content script only, strict CSP |
| Browser tests (Playwright, no network) | ✅ **48 / 48**: 24 in Chromium 156, 24 in Microsoft Edge 155 (fresh clone) |
| `npm run scan:secrets` | ✅ no credentials (87 files) |
| `npm run licenses:check` | ✅ the only runtime dependency is zod 4.6.7 (MIT) |
| `npm audit --omit=dev` / `npm audit` | ✅ 0 / 0 vulnerabilities |
| `web-ext lint` 10.8.0 (Firefox) | ✅ 0 errors; 2 warnings, both `DANGEROUS_EVAL` from zod's code generation, which is disabled at runtime (`jitless`) and blocked by the CSP |
| Documentation links | ✅ all relative links resolve |
| CI on GitHub | ⏳ not run (no repository yet) |

## Permission audit

| Declared | Used by | Needed? |
|---|---|---|
| `storage` | `browser.storage.session` (drafts between the button and the review page) | Yes |
| content script `https://mail.google.com/*` | Button and capture on click | Yes |
| `action` (manifest key, not a permission) | Toolbar button opens a small menu: Task dashboard, Settings | Yes |

APIs used without any permission: `runtime.*` (messages, `getURL`,
`openOptionsPage`, `onStartup`, `onInstalled`), `tabs.create`, clipboard
writes after a click, IndexedDB, Web Crypto, and blob downloads.

No `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists in the
source. Extension pages have `connect-src 'none'`. There are no host
permissions, optional permissions, web-accessible resources or
`externally_connectable` entries. Nothing is unused and nothing is missing.

## Backup compatibility

- **Golden v1 backups** in `fixtures/backups/` (one plain, one encrypted with
  the production 600,000-iteration settings) validate, decrypt and restore
  with every safety rule applied:
  - the approved/in-progress task comes back **Blocked**;
  - its approval is history only;
  - the retention setting is restored.
  - Tests: `golden.test.ts` and `compatibility.test.ts`.
- **Records written by the Phase 2 build**, which lack later fields, still
  export to valid v1 files, accept context refreshes, start the retention
  clock when closed, and purge.
- **Round-trips across separate profiles** (plain and encrypted) pass in both
  browsers.
- There's no earlier public release to compare against. The golden files are
  now the compatibility baseline for future versions.

## Bundle size (production builds)

| Build | Total on disk | Sum of gzip-compressed files | Gmail content script (raw / gzip) | Background (raw / gzip) | Store zip |
|---|---|---|---|---|---|
| Chrome / Brave (`chrome-mv3`) | 298.0 kB | 91.8 kB | 11.3 / 4.5 kB | 107.6 / 30.3 kB | 93.0 kB |
| Edge (`edge-mv3`) | 298.0 kB | 91.8 kB | 11.3 / 4.5 kB | 107.6 / 30.3 kB | 93.0 kB (byte-identical to Chrome) |
| Firefox (`firefox-mv3`) | 298.2 kB | 91.9 kB | 11.3 / 4.5 kB | 107.6 / 30.3 kB | 93.1 kB + 48.3 kB sources zip |

The only code loaded on Gmail pages is the 11 kB content script. Most of the
rest is the zod validation library, used in the background and on extension
pages. `zod/mini` is a possible later reduction.

## Tested vs. untested

✅ automated test · 🔧 built and statically checked · ❌ not tested · — not applicable

| Feature | Chromium (Win) | Edge (Win) | Chrome | Brave | Firefox 140+ | macOS / Linux | Live Gmail |
|---|---|---|---|---|---|---|---|
| Button, navigation, accessibility | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ (CI will run Chromium on Linux) | ❌ |
| Capture message / thread, refusal cases | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | ❌ |
| Hostile email rendered as text | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | ❌ |
| Credential redaction | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | — |
| Task, brief, clipboard, open claude.ai | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | — |
| Plan, approval binding, stale-tab refusal | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | — |
| Filters, search, context refresh | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | ❌ (refresh) |
| Retention and deletion | ✅ (unit + E2E) | ✅ | 🔧 | 🔧 | 🔧 | ❌ | — |
| Export / import / encryption / migration | ✅ | ✅ | 🔧 | 🔧 | 🔧 | ❌ | — |
| Manifest least privilege, CSP, no network | ✅ | ✅ | ✅ (same build) | ✅ (same build) | ✅ (manifest check + lint) | — | — |
| Logic packages (state machine, backup, extraction) | ✅ unit tests (OS-independent; CI runs them on all three OSes) | | | | | | |

## Definition of done (from the brief)

| # | A new user can… | Status |
|---|---|---|
| 1 | Install only the extension | ✅ (load unpacked; no store listing yet) |
| 2 | Open Gmail and click the button | ✅ on synthetic Gmail; ❌ live Gmail not verified |
| 3 | Select an email or conversation | ✅ (expanded messages only) |
| 4 | Review what is transferred | ✅ |
| 5 | Hand off via a supported mechanism | ✅ browser handoff (clipboard + claude.ai); the Managed Agents option was a no-go |
| 6 | Understand whether local execution is available | ✅ shown as "Unknown — cannot verify from the browser" |
| 7 | Track tasks without false progress | ✅ user-reported states are labelled |
| 8 | Review, approve or reject a plan | ✅ recorded; **not enforceable** on Claude's side (documented) |
| 9 | Export task history | ✅ |
| 10 | Import on another computer | ✅ (two-profile E2E) |
| 11 | Reconnect Gmail, update repository references | ✅ nothing to reconnect (no Google sign-in); repository references are editable text |
| 12 | Run the documented tests | ✅ |
| 13 | Understand privacy and security limits | ✅ README, permissions-and-privacy, threat model, claude-integrations |

## Known limitations (by design or deferred)

- The extension can't detect, start or control **Claude Code on the user's computer**; that would need extra software, which is out of scope.
- **Approvals are recorded, not enforced**: Claude in claude.ai can act before approval.
- **Managed Agents** integration: no-go as designed (cross-origin requests from an extension page are blocked).
- **Automatic summaries** of requirements, decisions and deadlines aren't built (they would need a language model).
- **Collapsed Gmail messages** aren't captured. There's no Gmail API access and no reply monitoring.
- **Safari** isn't supported.
- **No formatter or linter** beyond TypeScript strict mode (open decision).
- **Byte-identical builds across operating systems** haven't been verified.

## Incidents during development (resolved)

- Before a DNS kill switch was added, a few browser-test runs opened the real
  `claude.ai/code` and `claude.ai/new`. These were plain GET requests with no
  task content, account or email data. Tests now can't reach any host.
- Bugs found by tests and fixed:
  - a timing race on the backup page lost an early file selection;
  - the clock-skew rule now makes local approvals take precedence over imported ones;
  - the credential detector produced false positives;
  - the `chrome-extension:` origin check failed because `URL.origin` returns `"null"` for that scheme.

## Open decisions for the owner

1. Final product name (D1).
2. Firefox add-on ID.
3. Whether to adopt a formatter or linter.
4. Whether to install Firefox and Brave locally for real-browser testing, or test elsewhere.
5. When to create the GitHub repository and push. That needs explicit approval, and creating it is the only way to get the first CI run.
