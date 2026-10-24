# Inbox Handoff

A browser extension that turns a Gmail conversation you choose into a task
brief for Claude, and keeps track of the plan you approve.

> **Working name.** Inbox Handoff is an independent open-source project. It is
> not made, endorsed or supported by Anthropic or Google.

## What it does — and doesn't

| It does | It doesn't |
|---|---|
| Add a **Send to Claude** button to Gmail | Read your inbox in the background, poll, or watch for replies |
| Capture the open message or conversation **only when you click** | Send anything over the network (extension pages can't make network requests) |
| Show exactly what will be saved before anything is saved | Detect, start or control Claude Code on your computer — browser extensions can't run programs |
| Build a brief that marks email text as untrusted and asks Claude to plan first | Enforce your approval on Claude's side: it **records** your decision, but can't stop Claude in claude.ai from acting |
| Copy the brief and open claude.ai; you paste and send it | Fill in claude.ai for you or put email text in a URL |
| Track tasks, plans, decisions and history in your browser | Require a server, account, desktop app or anything besides the extension |
| Redact likely credentials, delete old email text, export and import your data | Collect analytics or telemetry |

## How it works

1. Open a conversation in Gmail and click **Send to Claude**.
2. Review what was captured — one message or the whole conversation — and add instructions and an optional repository URL. Click **Create task**. It's saved in this browser only.
3. On the task page, **Copy brief**, **Open Claude** (claude.ai/code for GitHub repositories, otherwise a new chat), paste and send.
4. When Claude replies with a plan, paste it into **Record plan**.
5. **Approve**, **Request changes** or **Reject**. Your decision is tied to that exact plan version and fingerprint; a changed plan needs a fresh approval.
6. Copy the approval message back to Claude yourself, then record progress as it happens.

New replies in Gmail? Click **Send to Claude** again and choose **Add to an existing task** — only new messages are added, and an already-approved task goes back to review.

## Install

### From a browser store

Not available yet.

### For development (load unpacked)

Requirements: Node.js 24 or later, npm, Git.

```bash
git clone <repository-url> inbox-handoff
```

```bash
cd inbox-handoff
```

```bash
npm ci
```

```bash
npm run -w @inbox-handoff/extension build:all
```

Then load the build for your browser — see [docs/installation.md](docs/installation.md):

| Browser | Folder |
|---|---|
| Chrome, Brave | `apps/extension/dist/chrome-mv3` |
| Edge | `apps/extension/dist/edge-mv3` |
| Firefox 140+ | `apps/extension/dist/firefox-mv3` (temporary add-on) |

## Browser support

| Browser | Status |
|---|---|
| Chromium, Microsoft Edge (Windows) | Tested automatically against synthetic Gmail pages |
| Google Chrome, Brave | Built from the same Chromium package; not tested in those browsers yet |
| Firefox 140+ | Built and linted (`web-ext lint`: 0 errors); not tested in Firefox yet |
| Safari | Not supported |
| Live Gmail | **Not verified yet** — automated tests use synthetic pages |

Details and evidence: [docs/browser-compatibility.md](docs/browser-compatibility.md).

## Privacy

Everything stays in your browser. The extension has one permission
(`storage`) plus a content script on `mail.google.com`. Email text is kept only
with its task and deleted 30 days after the task closes by default. Only what
you paste into Claude leaves your browser. See
[docs/permissions-and-privacy.md](docs/permissions-and-privacy.md).

## Development

```bash
npm test
```

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript checks for every package and the extension |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Builds the extension and runs browser tests (Playwright; Chromium and installed Edge; no network) |
| `npm run check:manifests` | Least-privilege and CSP checks on built manifests |
| `npm run scan:secrets` | Looks for credentials in tracked files |
| `npm run licenses` | Regenerates [docs/dependencies.md](docs/dependencies.md) |

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Installation](docs/installation.md) · [Troubleshooting](docs/troubleshooting.md)
- [Claude integrations: what an extension can and cannot do](docs/claude-integrations.md)
- [Permissions and privacy](docs/permissions-and-privacy.md) · [Threat model](docs/threat-model.md)
- [Data portability](docs/data-portability.md) · [Backup format](docs/backup-format.md)
- [Browser compatibility](docs/browser-compatibility.md) · [Dependencies](docs/dependencies.md)
- [Release process](docs/release-process.md) · [Changelog](CHANGELOG.md) · [Security policy](SECURITY.md)

## License

[MIT](LICENSE) © 2026 Gulshan Kundnani
