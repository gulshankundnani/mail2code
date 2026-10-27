# Mail2Code user guide

Mail2Code turns a Gmail conversation into a task for **Claude Code on your
computer**:
1. You click one button in Gmail.
2. Mail2Code analyses the email in your browser.
3. Claude Code opens with a new session and the prompt already filled in.

Everything stays in your browser unless you choose otherwise.

> The screenshots use a synthetic mail page and made-up people
> (`*@example.test`). Real Gmail looks different around the button and the
> card, but the Mail2Code parts are the same. The screenshots are made by
> `scripts/docs-screenshots.mjs`.

**Contents**
1. [Before you start](#1-before-you-start)
2. [Send an email to Claude](#2-send-an-email-to-claude)
3. [The toolbar button: dashboard and settings](#3-the-toolbar-button-dashboard-and-settings)
4. [Settings](#4-settings)
5. [Track a task: plan, approval, progress](#5-track-a-task-plan-approval-progress)
6. [Ask someone else to approve](#6-ask-someone-else-to-approve) (and [keep them informed](#keep-your-approver-informed))
7. [Back up or move to another computer](#7-back-up-or-move-to-another-computer)
8. [Privacy in one minute](#8-privacy-in-one-minute)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Before you start

1. **Install Claude Code**, either the Claude desktop app or the `claude`
   terminal app.
   - For terminal links, run `claude` once and send any prompt. This teaches
     your computer how to open `claude-cli://` links.
2. **Install Mail2Code** (see [installation.md](installation.md)) and reload
   any open Gmail tabs.
3. **Pin Mail2Code to the toolbar.** Click the puzzle-piece icon in the
   browser toolbar, then the pin next to Mail2Code.
4. **Optional, recommended: turn on Claude Code's Plan mode.** In Settings,
   copy the snippet under **Default mode and permissions** into Claude Code's
   `settings.json`. Claude then can't change files until you approve its plan
   in Claude Code ([section 4](#4-settings)).

## 2. Send an email to Claude

Open a conversation in Gmail. A round **Send to Claude** button (an envelope
with `</>`) appears next to the subject. Hover over it to see its name.

![The Send to Claude button next to the email subject](images/01-gmail-button.png)

Click it. Mail2Code first opens every collapsed message in the conversation,
then reads the conversation **on your computer** and shows a preview card:

![The Send to Claude card with options and the prompt preview](images/02-send-to-claude-card.png)

| Part of the card | What it does |
|---|---|
| **Include** | **Latest message** or **Whole conversation**. A green note confirms every message was read; an amber note offers **Expand and try again** if Gmail kept some collapsed. |
| **Open in** | The Claude app on this computer, the Claude app over SSH (if set up), or Claude Code in a terminal. |
| **Repository** (optional) | `owner/name` or a GitHub URL, so Claude starts in the right project. |
| **Instructions** (optional) | Anything you want Claude to do, such as "fix it on a new branch". |
| **Prompt Claude will receive** | The exact text Claude gets: an *analysis* of the emails (requests, decisions, deadlines, questions), not the full emails, under 5,000 characters. Email content is marked as untrusted, so Claude treats it as information, not instructions. |
| **Possible credentials found** | Shown if the email seems to contain a password or key. These are redacted unless you untick **Redact them**. |

Then:

1. Click **Open in Claude app** (or **Open in Claude Code (terminal)**). The
   first time, your browser asks whether to open the app.
2. Claude Code opens a **new session with the prompt filled in**. Read it and
   press **Enter**. Claude's apps never send a pre-filled prompt by
   themselves. That's by design, and it's the one step Mail2Code can't do for
   you.
3. The task is saved in your **Task dashboard**.

Other buttons on the card:
- **Copy prompt** copies the prompt to paste elsewhere.
- **More options…** opens the full review page (task tracking with copy and
  paste).
- **Task dashboard** and **Settings** open those pages.
- **Esc** or **×** closes the card.

## 3. The toolbar button: dashboard and settings

Click the pinned Mail2Code icon in the browser toolbar:

![The toolbar popup with Task dashboard and Settings](images/03-toolbar-popup.png)

The **Task dashboard** lists your tasks with search and filters (status,
dates). The bar at the top jumps to **Settings**, **Approvers** or
**Backup and import**.

![The task dashboard](images/07-task-dashboard.png)

## 4. Settings

![Settings: destination, mode and email analysis](images/04-settings.png)

- **Where "Open in Claude" goes.** The default destination (you can still
  change it per email on the card).
  - A project folder for terminal links, used when the task has no GitHub
    repository.
  - An SSH host, port and folder for remote machines. The Claude app asks you
    to confirm before it connects. Keys and passwords are never put in links.
- **Default mode and permissions.** Links can't set Claude Code's mode, so
  Mail2Code generates the setting for you. Choose **Plan**, click
  **Copy settings snippet**, and add it to `~/.claude/settings.json` (macOS
  and Linux) or `%USERPROFILE%\.claude\settings.json` (Windows).
- **Email analysis:**
  - **Built-in analysis only (local).** The default. Works everywhere.
  - **+ on-device AI summary.** Uses Chrome's or Edge's built-in AI, only if
    it's already set up on this computer. **Test on-device AI** checks it. In
    Edge, see `edge://on-device-internals` for hardware support.
  - **+ Claude API summary.** Sends the cleaned email text (credentials
    redacted) to Anthropic with **your own API key**. Off by default. It needs
    the key and a click on **Allow access to api.anthropic.com**.
    **Remove key** deletes the key and withdraws that access.
- **Stored email text.** How long a closed task keeps its copy of the email
  text: 7, 30 or 90 days, or until you delete it.

Click **Save settings** when you're done.

## 5. Track a task: plan, approval, progress

Open a task from the dashboard. The task page records what happened. Mail2Code
can't see your Claude session, so you report each step:

![A task page with its status and details](images/05-task-page.png)

1. **Hand off to Claude.** Done automatically when you used
   **Open in Claude** on the card. On the full review page, **Copy brief** and
   **I've sent it to Claude** cover the copy-and-paste route.
2. **Record Claude's plan.** Paste the plan Claude proposed and click
   **Record plan**. Each change becomes a new version. A new version cancels
   any earlier approval.
3. **Approve or reject the plan.** Your decision is tied to that exact plan
   version.
   - **Copy approval message for Claude** gives you a message to paste into
     your Claude session.
   - The binding approval is still the one in Claude Code's Plan mode;
     Mail2Code keeps the record.

   ![Approving a recorded plan](images/06-approve-plan.png)

4. **Progress.** Mark **Implementation started**, then **Completed** or
   **Failed**. "Implementation started" is only possible once the current plan
   is approved.

Also on the task page:
- **Email context:** refresh the task from Gmail when new messages arrive.
  Mail2Code warns you if they arrived after the plan was approved.
- **Plan versions and decisions:** every version and decision.
- **History:** what happened, when.

## 6. Ask someone else to approve

A plan can be approved by another person, such as a team lead. Their decision
is **signed in their own browser**, and Mail2Code checks the signature before
recording it. Requests and replies travel as normal Gmail emails. Details:
[approvals.md](approvals.md).

**One-time setup, approver (for example Priya).** In **Settings → Approvers**,
she enters her name and email, clicks **Create my approver identity**, then
**Email my approver card** and sends the draft to you.

![Creating an approver identity](images/08-approver-identity.png)

**One-time setup, you.** Paste the card under **Add a trusted approver**.
**Check the fingerprint with Priya directly** (in person or by phone), tick
the box, and click **Add as trusted approver**.

![Adding a trusted approver after checking the fingerprint](images/09-add-approver.png)

**Each request:**

1. **Ask.** On the task page, under **Ask someone else to approve**, pick
   Priya and click **Ask by email**. A Gmail draft to her opens with the plan.
   Press Send.
   - If the plan is very long, the draft says where to paste and the request
     is on your clipboard.
   - Optionally, set **Whose approval counts for this task** to
     **Only Priya (signed approval)**.

   ![Asking another person to approve](images/10-ask-someone.png)

2. **Review.** Priya opens your email and clicks the Mail2Code icon. Her card
   says **Approval request**:

   ![The approval request card in the approver's mail](images/11-approval-request-card.png)

   **Review request** opens a Mail2Code page with the plan. She chooses a
   decision, adds a comment and clicks **Sign and reply by email**. A reply
   draft opens, and she presses Send.

   ![Reviewing and signing a plan](images/12-review-and-sign.png)

3. **Record.** You open her reply and click the Mail2Code icon. The card says
   **Approval response** → **Check and record**. The task page opens; click
   **Check and record**. If the signature and request check out, the task
   shows **Approved by Priya Example (signature verified)**.

   ![A task approved with a verified signature](images/13-approved-signed.png)

### Keep your approver informed

Once Priya has approved, the task page shows **Keep Priya informed**.

- **When you're offered an update:** after each status change
  (**Implementation started**, **Completed**, **Failed**, **Blocked**,
  **Cancelled**, or a new plan version), the page asks
  *"Let Priya know?"*.
- **Sending one:** add an optional note and click
  **Send progress update to Priya**. A Gmail draft opens; press Send.
- **The signature:** the update is signed with a key Mail2Code created for
  you automatically. Priya's list only accepts updates from the person who
  asked for the approval.

![Offering to send a progress update after a status change](images/15-send-progress-update.png)

Priya opens the update email and clicks the Mail2Code icon. The card says
**Progress update** → **Update my list**. Her dashboard has an
**Approved by me** section: every plan she signed, the latest reported status
and a timeline of updates with notes.

![The approver's "Approved by me" list with a verified update](images/16-approved-by-me.png)

Updates show what the requester recorded; Mail2Code can't see the work
itself. Old, repeated, changed or forged updates are ignored.

**Approval replies are refused when:**
- it was changed;
- it was signed by anyone other than the person you asked;
- it was already used;
- it's older than 7 days;
- it's for a plan version that has since changed.

The wording of an email never counts as approval.

## 7. Back up or move to another computer

Dashboard → **Backup and import**.

![The backup and import page](images/14-backup.png)

- **Export:**
  - Choose all tasks or selected ones.
  - Choose whether to include stored email text (off by default).
  - Choose whether to **encrypt with a passphrase**. Recommended whenever
    email text is included.
- **Import** on the new computer:
  - Choose the file, and enter the passphrase if it's encrypted.
  - Preview what will change, then **Restore**, **Merge** or **Replace**
    (Replace asks you to type REPLACE).
  - Approvals don't carry over as approvals. Approved tasks come back
    blocked for review.
  - Trusted approvers come back unconfirmed; confirm their fingerprints again.

More: [data-portability.md](data-portability.md).

## 8. Privacy in one minute

- **When email is read:** only when you click the Send to Claude button.
  Nothing runs in the background, and nothing scans your inbox.
- **What goes to Claude:** an analysis of the email, not the full text,
  through a link that opens Claude on **your computer**.
- **Network access:** none, unless you turn on Claude API summaries. Then
  only `api.anthropic.com` is contacted, with your key.
- **Where your data lives:** tasks, plans and decisions stay in this browser
  until you delete or export them.
- **Approval emails:** they contain the plan text (never the original email
  text), and you send them yourself.

Full details: [permissions-and-privacy.md](permissions-and-privacy.md).

## 9. Troubleshooting

| Problem | Try |
|---|---|
| No button in Gmail | Open a single conversation (not the inbox list) and reload the tab after installing or updating. |
| "N messages are still collapsed" | Click **Expand and try again** on the card. |
| Clicking **Open in Claude** does nothing | Install the Claude app or Claude Code. For terminal links, run `claude` once and send any prompt. Allow your browser to open the app when it asks. |
| Can't find the toolbar icon | Puzzle-piece icon → pin Mail2Code. |
| "On-device AI isn't available" | Your browser or computer doesn't offer it. Choose **Built-in analysis** in Settings to hide the note. |
| A signed reply is refused | Read the message: usually the plan changed, the request expired or was already used, or the approver isn't confirmed. Send a new request. |
| No "Keep … informed" box on a task | It appears only after another person's signed approval was recorded for that task. |
| An update is ignored | It's older than one Priya already has, was changed, or is for a plan she didn't approve in this browser. |

More: [troubleshooting.md](troubleshooting.md).
