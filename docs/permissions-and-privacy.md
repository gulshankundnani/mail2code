# Permissions and privacy

## Permissions

| Permission | Granted | Why |
|---|---|---|
| `storage` | At install | Preferences (`storage.local`) and the short-lived capture for the full review page (`storage.session`) |
| Content script on `https://mail.google.com/*` | At install | Draws the **Send to Claude** button and, **only when you click it**, reads the open conversation and shows the preview card |
| `https://api.anthropic.com/*` (optional) | **Only if you click "Allow access to api.anthropic.com"** in Settings | Optional Claude API summaries. Withdrawn by **Remove key** |

No `tabs`, `clipboardWrite`, `downloads`, `identity`, `nativeMessaging`, `cookies` or `webRequest`. Opening Claude through a `claude://` or `claude-cli://` link, copying after a click and saving backups need no extra permission. Extension pages may only connect to `https://api.anthropic.com` (content security policy) — and only once you've granted that host.

## Where your data goes

| Data | Where | When |
|---|---|---|
| Email text you capture | Your browser memory, then the prompt | Only after you click **Send to Claude** |
| The prompt (analysis of the email, not the full text) | The Claude app or Claude Code **on your computer**, via the link | Only when you click **Open in Claude**; nothing is sent to the model until you press Enter in Claude |
| Cleaned email text (credentials redacted) | **Anthropic's API** | **Only if you turned on Claude API summaries**, granted access and saved a key |
| On-device AI summary input | Stays on your computer (Chrome's built-in model) | Only if you chose on-device AI and the model is already downloaded |
| Approval requests and replies (task title, plan text, signed decision; never email text) | Gmail drafts that **you** send, so both people's Gmail accounts | Only when you click **Ask by email** or **Sign and reply by email**, and then press Send in Gmail |
| Your approver identity (name, email, public key) | The approver card you choose to send | Only when you send it |
| Your approver signing key | This browser only; it can't be read out, exported or backed up | Created when you click **Create my approver identity** |
| Tasks, plans, decisions, history, stored email text | This browser (IndexedDB) | Until deleted; stored email text is deleted 30 days after a task closes by default |
| Your Anthropic API key | This browser (IndexedDB, extension-only) | Until you click **Remove key**; never in backups, never sent to the Gmail page |
| Backups | A file you save | Your decision |

The extension never reads your inbox in the background, polls, watches for replies, reads Gmail cookies or tokens, or collects analytics.

## Credentials in emails

Likely credentials (API keys, tokens, passwords, private keys, passwords in URLs) are detected and replaced with `[REDACTED]` by default before analysis, before any API summary, and before anything is saved. Detection is best-effort.

## Your controls

- **Settings** (task list page): default destination, project folder, SSH, default Claude Code mode, analysis engine, API key and model.
- **Retention**, **Delete stored email text now**, **Delete this task**.
- **Export / import** — see [data-portability.md](data-portability.md).
- Removing the extension deletes all of its data from the browser, including the API key.
