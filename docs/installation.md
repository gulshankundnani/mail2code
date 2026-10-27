# Installation

The extension is the only thing you install. No desktop app, server, runtime
or account is needed to use it.

## From a browser store

Not available yet. This page will link to store listings once they exist.

## From source (developers and early testers)

### 1. Build

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

This creates `apps/extension/dist/chrome-mv3`, `edge-mv3` and `firefox-mv3`.

### 2. Load it into your browser

**Chrome or Brave**

1. Open `chrome://extensions` (Brave: `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `apps/extension/dist/chrome-mv3`.

**Microsoft Edge**

1. Open `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `apps/extension/dist/edge-mv3`.

**Firefox 140 or later**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `apps/extension/dist/firefox-mv3/manifest.json`.
3. Temporary add-ons are removed when Firefox restarts. If the button doesn't
   appear in Gmail, open the add-on's settings and allow access to
   `mail.google.com`.

### 3. Check it works

1. Open Gmail and open a conversation. A round **Send to Claude** button (an envelope with `</>`) appears next to the subject; hover it to see its name.
2. Pin Mail2Code to the toolbar (puzzle-piece icon → pin). Clicking it shows **Task dashboard** and **Settings**; the same two links are at the bottom of the Send to Claude card in Gmail.

## Updating

Pull the latest code, run `npm ci` and the build again, then click the reload
icon on the extension in your browser's extensions page. Your tasks are kept.

## Removing

Remove the extension from your browser's extensions page. This deletes all of
its data from that browser, including tasks and stored email text. Export a
backup first if you want to keep them (see [data-portability.md](data-portability.md)).
