# Contributing

Thanks for helping. This project values honesty about what it can do over
features: please read [docs/claude-integrations.md](docs/claude-integrations.md)
and [docs/threat-model.md](docs/threat-model.md) before proposing changes to
how tasks reach Claude or how approvals work.

## Setup

Requirements: Node.js 24+, npm, Git. Then:

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm test
```

Browser tests need Playwright's Chromium (one-time download, ~120 MB):

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

On Windows the browser tests also run in an installed Microsoft Edge; remove
the `msedge` project in `playwright.config.ts` locally if you don't have it.

## Repository layout

| Path | Contents |
|---|---|
| `apps/extension` | The WXT browser extension: content script, background, pages (`entrypoints/`), IndexedDB store and UI logic (`src/`) |
| `packages/protocol` | Shared zod schemas, limits and canonical JSON |
| `packages/task-core` | Task state machine, plan hashing, approval checks (browser-safe, no DOM) |
| `packages/gmail-extract` | Gmail DOM extraction; all selectors in `selectors.ts` |
| `packages/backup` | Export format, encryption, validation, import planning |
| `fixtures/synthetic-gmail` | Hand-written Gmail-like pages with invented data |
| `tests/e2e` | Playwright tests |
| `scripts` | Manifest check, secret scan, license inventory |

## Ground rules

- **Synthetic data only.** Never commit real emails, addresses, tokens or
  backups. Fixtures use `example.test` addresses and obviously fake values.
- **No network in tests.** The Playwright fixture blocks DNS for everything
  (`--host-resolver-rules`); keep it that way.
- **Least privilege.** New permissions, host permissions, network access or
  `web_accessible_resources` need an issue and maintainer agreement first;
  `npm run check:manifests` fails otherwise.
- **Text, never HTML.** Render email- and user-derived text with
  `textContent`. No `innerHTML`, `eval` or remote code.
- **Approval semantics.** Anything that changes when a task counts as
  approved, or that could let imported or background data authorize work,
  must come with tests in `packages/task-core` or `apps/extension/test`.
- **Honest status.** Don't label a state as verified unless the extension
  actually observed it. Keep "reported by you" wording where it applies.
- **Small dependencies.** Prefer platform APIs. Runtime dependencies must use
  an allowed license (`npm run licenses:check`).
- **Gmail changes.** If Gmail's markup changes, update
  `packages/gmail-extract/src/selectors.ts` and add or adjust a fixture.

## Before opening a pull request

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run check:manifests
```

```bash
npm run scan:secrets
```

If dependencies changed, also run `npm run licenses` and commit
`docs/dependencies.md`.

Describe what you changed, why, and how you tested it, including which
browsers. Update `CHANGELOG.md` under **Unreleased** for user-visible changes.

## Reporting security issues

Please don't open public issues for vulnerabilities — see
[SECURITY.md](SECURITY.md).
