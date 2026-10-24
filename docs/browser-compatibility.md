# Browser compatibility

Status is evidence-based. "Tested" means an automated or manual run actually
happened on the stated version; everything else is "planned" or "built".

## Extension (Phase 2c scope: button, extraction, review page)

| Browser | Status | Evidence |
|---|---|---|
| Chromium (Playwright build 156.0.8078.x) on Windows 11 | **Tested** against synthetic fixtures | `npm run test:e2e`, 9/9 passing, 2026-10-24 |
| Microsoft Edge 155.0.4283.62 on Windows 11 | **Tested** against synthetic fixtures | `npm run test:e2e`, 9/9 passing (installed Edge, headless), 2026-10-24 |
| Google Chrome 156 (branded) | Built, not automated | Branded Chrome no longer honours `--load-extension`, so automation uses Playwright's Chromium. Manual unpacked load not yet done |
| Brave | Planned (Phase 6) | — |
| Firefox | Planned (Phase 6) | — |
| Safari | Deferred (decision D6) | — |
| macOS, Linux (any browser) | Planned (Phase 6) | No hardware or CI run yet |

## Important limitation: synthetic Gmail only

All automated tests run against hand-written fixtures in
`fixtures/synthetic-gmail/` served at `https://mail.google.com/` by Playwright.
Gmail's real DOM is undocumented and may differ. **Compatibility with live
Gmail has not been verified.** Before it is claimed, someone must manually:

1. Load `apps/extension/dist/chrome-mv3` (or `edge-mv3`) as an unpacked
   extension.
2. Open a real conversation in Gmail and confirm the button appears once, next
   to the subject.
3. Click it and check the review page shows the right subject, sender, date and
   text for the current message and for the whole conversation.
4. Navigate between conversations and back to the inbox and confirm the button
   follows correctly.

Selector strategies live in `packages/gmail-extract/src/selectors.ts`; a Gmail
change should only need edits there plus a new fixture.

## Loading the unpacked extension (development)

```bash
npm run -w @inbox-handoff/extension build:all
```

- Chrome: `chrome://extensions` → Developer mode → Load unpacked →
  `apps/extension/dist/chrome-mv3`
- Edge: `edge://extensions` → Developer mode → Load unpacked →
  `apps/extension/dist/edge-mv3`

Until the desktop bridge exists (Phase 2d), the review page works but sending
is disabled.
