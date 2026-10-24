# Browser compatibility

Status is evidence-based. "Tested" means an automated or manual run actually
happened on the stated version; everything else is "planned" or "built".

## Extension (Phases 2–5)

| Browser | Status | Evidence |
|---|---|---|
| Chromium (Playwright build 156.0.8078.x), Windows 11 | **Tested** against synthetic fixtures | `npm run test:e2e`, 24/24 passing, 2026-10-24 |
| Microsoft Edge 155.0.4283.62, Windows 11 | **Tested** against synthetic fixtures | `npm run test:e2e`, 24/24 passing (installed Edge, headless), 2026-10-24 |
| Google Chrome 156 (branded) | Built, not automated | Branded Chrome no longer honours `--load-extension`; automation uses Playwright's Chromium. Manual unpacked load not yet done |
| Brave | Built (same Chromium MV3 build as Chrome), not tested | Brave runs Chromium extensions unchanged; no Brave-specific APIs are used. Not installed on the dev machine |
| Firefox 140+ (desktop), 142+ (Android) | Built and linted, not tested | `wxt build -b firefox --mv3`; `web-ext lint` 10.8.0: 0 errors, 2 warnings (zod's `Function` code path, disabled at runtime and blocked by CSP). Not installed on the dev machine; Playwright can't load Firefox extensions |
| Safari | Deferred (decision D7) | Needs macOS + Xcode |
| macOS, Linux (any browser) | Planned | No hardware or CI run yet |

## What the automated tests cover

Gmail button (presence, no duplicates, SPA navigation, ambiguous pages,
unidentifiable messages, keyboard), message vs. thread capture, hostile email
rendered as inert text, review page payload, task creation and duplicate
detection, brief copied to the clipboard, "Open Claude" URL (no task content in
it), user-reported submission, plan recording, approval, refusal of an approval
from a tab showing an older plan, user-reported start, task list, and the
honest integration-status panel; search and status/date filters (persisted in the URL), context refresh into an existing task (only new messages added; an approved task is blocked for review), the retention setting, deleting stored email text, deleting a task; plain and encrypted export downloads, wrong passphrase, migration into a second separate browser profile (restored tasks blocked for review, fresh approval required), damaged/foreign files, and the REPLACE confirmation; credential redaction; least-privilege manifests and CSP for all three builds; no network requests from extension pages.

### Network isolation in tests

The test browser runs with `--host-resolver-rules=MAP * ~NOTFOUND`, so no
hostname resolves and nothing can reach the internet. Synthetic Gmail is served
by Playwright's request routing. Tabs opened by the extension itself
(`tabs.create`) are not intercepted by routing, so those tests assert the URL
the extension requested instead of loading a page.

> Before this kill switch was added (2026-10-24), a few test runs opened the
> real `https://claude.ai/code` and `https://claude.ai/new` with plain GET
> requests (no task content in the URL, no account, no email data).

## Important limitation: synthetic Gmail only

All automated tests use hand-written fixtures in `fixtures/synthetic-gmail/`.
Gmail's real DOM is undocumented and may differ. **Compatibility with live
Gmail has not been verified.** Manual check:

1. Load `apps/extension/dist/chrome-mv3` (or `edge-mv3`) unpacked.
2. Open a real conversation; confirm one **Send to Claude** button next to the subject.
3. Click it; check subject, sender, date and text for one message and for the whole conversation.
4. Navigate between conversations and the inbox; confirm the button follows correctly.

## Bundle size (production Chrome build, after Phase 4, 2026-10-24)

| File | Raw | gzip | Loaded when |
|---|---|---|---|
| `content-scripts/gmail.js` | 11.1 kB | 4.4 kB | On every Gmail page |
| `background.js` | 107.6 kB | 30.4 kB | Service worker, on demand |
| shared page chunk (`ui-*.js`) | 111.2 kB | 31.3 kB | Extension pages only |
| backup / task / review / options pages | 19.2 / 12.0 / 5.8 / 4.6 kB | 6.6 / 4.7 / 2.4 / 2.2 kB | Extension pages only |
| **Whole extension** | **294.8 kB** | — | — |

Most of the background and page code is the zod validation library. The Gmail
content script deliberately does not include it (the background re-validates
every capture). Switching to `zod/mini` is a possible later reduction.

## Loading the unpacked extension (development)

```bash
npm run -w @inbox-handoff/extension build:all
```

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist/chrome-mv3`
- Edge: `edge://extensions` → Developer mode → Load unpacked → `apps/extension/dist/edge-mv3`

## Firefox notes

- Manifest: MV3, add-on ID `{034066bd-772c-43e5-b155-6a7e030ac512}` (a GUID, so no domain is claimed; confirm it before the first addons.mozilla.org submission, after which it can't change), `data_collection_permissions: none`, minimum Firefox 140 / Firefox for Android 142.
- Every API the extension uses exists in Firefox 140: `storage.session`, `action`, `runtime.openOptionsPage`, `tabs.create`, IndexedDB, Web Crypto, clipboard writes after a click, blob downloads.
- To verify in a real Firefox: users can switch off Gmail site access (the button then disappears), and the button's constructable stylesheet may not attach from a content script. It then falls back to an inline `<style>`, which a strict Gmail CSP could block.
- Load for testing: `about:debugging` → This Firefox → Load Temporary Add-on → `apps/extension/dist/firefox-mv3/manifest.json`.
- Lint: `npx web-ext@10.8.0 lint --source-dir apps/extension/dist/firefox-mv3` (not a project dependency: it pulls in dev-only packages with open security advisories).
