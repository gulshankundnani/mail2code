# Data portability: backups and moving to another computer

Everything Inbox Handoff knows is stored in your browser (IndexedDB). Backups
are files you download and keep yourself; nothing is uploaded, and moving to
a new computer needs neither the old computer nor any server.

## Making a backup

Open the task list (toolbar button), then **Export or import your tasks**.

- **All tasks** or **Selected tasks**.
- **Include stored email text**: off by default. Only text still stored is
  included (see the retention setting). Plans, decisions and history are always
  included.
- **Encrypt with a passphrase**: recommended whenever email text is included.
  If you include email text without encryption, you must confirm that you
  understand anyone with the file can read it.

The file is named `inbox-handoff-backup-YYYY-MM-DD.json` (or
`…-encrypted.json`). See [backup-format.md](backup-format.md) for its contents.

## Moving to another computer

1. **Export** a backup on the old computer.
2. **Encrypt** it if it contains email text or anything private.
3. **Install** the extension on the new computer (no other software is needed).
4. **Import** the backup: choose the file, enter the passphrase if encrypted,
   review the preview, and choose **Restore into this empty installation**.
5. **Review** the restored tasks. Tasks that were approved or in progress come
   back as **Blocked — restored from a backup**: their old approvals are kept
   as history only and you must approve again on this computer.
6. **Update repository references** if your repositories moved (they are text
   only; the extension never opens them).
7. **Gmail**: the extension doesn't connect to your Google account, so there is
   nothing to reconnect. Gmail links in tasks open in whichever account you are
   signed in to. If you use a different Google account now, some links may not
   resolve.
8. **Refresh missing email context** where the backup didn't include email text:
   open the conversation in Gmail, click **Send to Claude**, and choose
   **Add to an existing task**.
9. **Check** the task history and the email-retention setting.

## Import strategies

| Strategy | When available | What it does |
|---|---|---|
| Restore | Only when this browser has no tasks | Imports everything, including the retention setting |
| Merge | Always | Adds new tasks. Tasks already here unchanged are skipped. Tasks that exist here with different content keep **this browser's version** unless you choose **Use the version from the backup**. A backup task that is the same handoff as a different task here is skipped. The retention setting is not changed. |
| Replace | Always | Deletes all tasks in this browser, then imports everything. Requires typing `REPLACE`. |

Imports happen in a single database transaction. If anything fails, nothing
is changed and your existing data stays as it was.

## Safety rules for imported data

- Imported data is untrusted: it is validated strictly and only ever stored
  and shown as text. Nothing in a backup is executed.
- Imported approvals are history only. They never authorize work, on any
  computer.
- Tasks that were approved or in progress are blocked for review.
- Closed tasks start a fresh email-retention countdown from the import date.

## What's not covered

- ZIP archives: not needed, because tasks have no attachments. Backups are a
  single JSON file.
- Automatic or cloud backups: never. You decide where backup files go.
