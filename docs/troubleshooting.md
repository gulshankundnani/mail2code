# Troubleshooting

## The Send to Claude button doesn't appear

- Open a single conversation; the button doesn't appear in the inbox list.
- If two conversations are visible at once (some split-pane layouts), the
  button is hidden on purpose because the right one can't be identified.
- Reload the Gmail tab after installing or updating the extension.
- Firefox: check the add-on is allowed on `mail.google.com` (Add-ons and
  themes → Mail2Code → Permissions).
- Gmail changes its page structure from time to time. If none of the above
  helps, please open an issue: the selectors in
  `packages/gmail-extract/src/selectors.ts` may need updating.

## "…couldn't be identified reliably"

The extension couldn't find a stable id for the conversation or a message,
so it stopped rather than guess. Reload Gmail and try again. If it keeps
happening, please report it (without email content).

## "No message is expanded" / collapsed messages missing

Only messages expanded on screen are captured. Expand the ones you need in
Gmail (or use Gmail's "expand all"), then click the button again.

## "This capture has expired or was already used"

The review page keeps a capture for an hour, and only until you create or
cancel the task. Click **Send to Claude** in Gmail again.

## Copy brief does nothing

Clipboard writes need a real click on the button. If your browser blocks
clipboard access for extensions, open **Brief that will be copied**, select the
text and copy it manually.

## Claude acted before I approved the plan

The browser handoff can't prevent that: the extension can't see or control
your Claude conversation. It records your decisions only. Keep asking Claude to
plan first, and see [claude-integrations.md](claude-integrations.md).

## "The plan changed since this page loaded"

Another tab recorded a newer plan version. Review the current plan on the page
(it has reloaded) and decide again.

## A task is Blocked

The reason is shown next to the status:

- **New email messages arrived after approval** — review the plan; record a
  revised one if needed, then approve again.
- **Restored from a backup** — imported tasks that were approved or in progress
  need a fresh approval on this computer.
- **Blocked by you** — click **Back to review** when ready.

## The brief says "(content not retained)"

The stored email text was deleted (retention setting or by you), or the
backup you imported didn't include it. Open the conversation in Gmail, click
**Send to Claude** and choose **Add to an existing task**.

## Import problems

| Message | What to do |
|---|---|
| "isn't valid JSON" / "isn't a Mail2Code backup" | Choose the file the extension exported (`mail2code-backup-….json`). |
| "Wrong passphrase, or the file has been changed or damaged" | Check the passphrase. A modified encrypted file can't be opened. |
| "checksum doesn't match" | The file is damaged or incomplete; export again. |
| "made by a newer version" | Update the extension, then import. |
| "Restore only works in an empty installation" | Use **Merge** or **Replace**. |

A failed import changes nothing.

## Collecting details for a bug report

Include the browser and version, how you installed the extension, the exact
message shown, and steps to reproduce with made-up data. Please never attach
real emails or backups.
