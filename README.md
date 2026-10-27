# Mail2Code

A browser extension that turns a Gmail conversation you choose into a task
brief for Claude, and keeps track of the plan you approve.

> **Working name.** Mail2Code is an independent open-source project. It is
> not made, endorsed or supported by Anthropic or Google.

## What it does — and doesn't

| It does | It doesn't |
|---|---|
| Add a **Send to Claude** button to Gmail | Read your inbox in the background, poll, or watch for replies |
| Analyse the open message or conversation **on your computer, only when you click** | Send whole email texts anywhere |
| Open **Claude Code on your computer** — the Claude app (local or SSH) or a terminal — with a new session and the prompt filled in, using Claude's official `claude://` / `claude-cli://` links | Send the prompt for you: Claude's apps always wait for you to press Enter (by design) |
| Recommend Claude Code's **plan mode** (Settings generates the setting), so Claude can't edit files until you approve its plan | Set Claude Code's mode or permissions from a link — links can't carry them |
| Redact likely credentials and mark email content as untrusted | Detect whether Claude is installed |
| Optionally add a summary from Chrome's on-device AI or the Claude API (your key, off by default) | Contact any server unless you turn on Claude API summaries — then only `api.anthropic.com` |
| Track tasks, export and import your data | Require a server, account or companion app besides Claude itself |
| Let another person approve a plan by email, with a **signature** Mail2Code verifies ([how](docs/approvals.md)) | Treat the wording of an email as an approval |

## How it works

1. Open a conversation in Gmail and click the **Send to Claude** button: the envelope-with-`</>` icon next to the subject.
2. A preview card shows the **analysis** — requests, decisions, deadlines, questions — and the exact prompt (under 5,000 characters). Optionally pick the latest message or the whole thread, the destination, a repository, and add instructions.
3. Click **Open in Claude**. Your browser hands the link to Claude on your computer (the first time it asks for permission), and a new Claude Code session opens with the prompt filled in. The task is saved in your task list.
4. Read the prompt in Claude and press **Enter**. With plan mode set (Settings → *Default mode and permissions*), Claude proposes a plan and can't change files until you approve it in Claude Code.

One-time setup: install the Claude app (or Claude Code), and for terminal links run `claude` once and send any prompt. **More options…** on the card opens the full review page (copy-and-paste flow, task tracking).

## Install

### From a browser store

Not available yet.

### For development (load unpacked)

Requirements: Node.js 24 or later, npm, Git.

```bash
git clone <repository-url> mail2code
```

```bash
cd mail2code
```

```bash
npm ci
```

```bash
npm run -w @mail2code/extension build:all
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

Analysis happens on your computer. The extension has one permission
(`storage`), a content script on `mail.google.com`, and one **optional** host
permission (`api.anthropic.com`) that's only requested if you turn on Claude API
summaries. The prompt goes to Claude on your computer through a local link; Claude
sends nothing until you press Enter. Email text kept with tasks is deleted 30 days
after a task closes by default. See
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
- [User guide (with screenshots)](docs/user-guide.md) · [Approval by another person](docs/approvals.md)
- [Browser compatibility](docs/browser-compatibility.md) · [Dependencies](docs/dependencies.md)
- [Release process](docs/release-process.md) · [Release readiness](docs/release-readiness.md) · [Changelog](CHANGELOG.md) · [Security policy](SECURITY.md)

## License

[MIT](LICENSE) © 2026 Gulshan Kundnani
