# Permissions and privacy

## Permissions requested

| Permission | Why |
|---|---|
| `storage` | Keeps the short-lived capture between the Gmail button and the review page (`storage.session`, memory only) |
| Content script on `https://mail.google.com/*` | Draws the **Send to Claude** button and, **only when you click it**, reads the open conversation |

That's all. No host permissions for other sites, no `tabs`, `clipboardWrite`,
`downloads`, `identity`, `nativeMessaging`, `cookies` or `webRequest`. Opening
claude.ai in a new tab, copying to the clipboard after a click, and saving a
backup file need no extra permission.

In Firefox, the Gmail site access can be switched off in the add-on's
settings; the button then doesn't appear.

## What happens to your data

| Data | Where it goes | How long |
|---|---|---|
| Email text you capture | This browser only (IndexedDB) | Until the task closes + your retention setting (default 30 days), or until you delete it |
| Task details, plans, decisions, history | This browser only | Until you delete the task |
| The capture between clicking the button and the review page | Browser memory (`storage.session`) | Up to 1 hour, or until you create or cancel |
| The brief | Your clipboard, when you click **Copy brief** | Until you copy something else |
| Anything you paste into Claude | Anthropic, under your Claude account | Anthropic's terms apply |
| Backups | A file you save | Your decision |

The extension:

- never reads your inbox in the background, polls, or watches for replies;
- never sends anything over the network (extension pages are blocked from
  making network requests by their content security policy);
- has no analytics or telemetry;
- never reads Gmail cookies or tokens, and has no Google sign-in;
- cannot see or control what Claude does after you paste the brief.

## Credentials in emails

If a captured email seems to contain credentials (API keys, tokens, passwords,
private keys, passwords in URLs), the review page warns you and, by default,
replaces them with `[REDACTED]` before anything is saved. Detection is
best-effort. Check what you paste.

## Your controls

- **Retention:** task list → *Stored email text* (7, 30 or 90 days after a task closes, or keep).
- **Delete stored email text now** and **Delete this task** on each task page.
- **Export** your data at any time (JSON, optionally encrypted) and **import** it elsewhere — see [data-portability.md](data-portability.md).
- Removing the extension deletes all its data from the browser.
