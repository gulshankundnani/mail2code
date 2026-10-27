# Approval by another person

A plan can be approved by someone other than you, such as a team lead.
Their approval is **signed in their own browser**. Mail2Code checks that it
really came from them and that it's for exactly the plan version you asked
about. Requests and replies travel as ordinary Gmail emails.

Mail2Code has no server, so it doesn't notify anyone and there's no chat.
People hear about a request when the email arrives.

## One-time setup

**The approver** (for example Priya):

1. Installs Mail2Code.
2. Opens **Settings → Approvers → My approver identity**, enters a name and
   email address and clicks **Create my approver identity**.
   - A signing key is created in her browser (ECDSA P-256, Web Crypto). It
     can't be read out of the browser, not even into a backup.
3. Clicks **Email my approver card**, which opens a Gmail draft containing
   her card (name, email, public key and fingerprint), and sends it to you.

**You:**

1. Paste the card into **Settings → Approvers → Add a trusted approver**.
2. **Check the fingerprint with Priya directly**, in person or by phone, and
   tick the box. This step is what stops someone else from sending a card in
   Priya's name.

## Each request

1. **Ask.** On the task page (plan recorded, waiting for approval), choose
   Priya and click **Ask by email**. A Gmail draft to Priya opens with the
   plan and a sealed request block. Press Send.
   - If the plan is too long for a draft link, the draft says where to paste
     and the sealed block is copied to your clipboard. Press Ctrl+V (⌘V) there.
   - **Download request file** is the fallback for other channels.
2. **Review.** Priya opens the email in Gmail and clicks the Mail2Code icon
   next to the subject. The card says *Approval request* →
   **Review request**, which opens a Mail2Code page with the plan.
   - She chooses Approve, Request changes or Reject, then
     **Sign and reply by email**. A reply draft to you opens. She presses Send.
   - A request received as a file can be opened at **Settings → Approvers →
     Review an approval request**.
3. **Record.** You open her reply and click the Mail2Code icon. The card says
   *Approval response* → **Check and record**, which opens the task.
   - Click **Check and record**. If every check passes, the task shows
     **Approved by Priya (signature verified)**.

**Optional:** under **Whose approval counts for this task**, choose
**Only Priya (signed approval)**. Your own **Approve** button is then
disabled for that task. You can still request changes or reject.

## Progress updates

After a signed approval is recorded, the task page offers to tell the
approver about each status change; there's also a manual
**Send progress update** button. The update opens as a Gmail draft. The
approver clicks the Mail2Code icon on it, and their **Approved by me** list
(on the Task dashboard) shows the new status, with notes and a timeline.

- **Signed:** each update is signed with a *requester key* that Mail2Code
  creates automatically the first time you send an approval request. Its
  public part travels inside the request, and the approver's browser stores
  it when they sign. Only updates signed with that key count.
- **In order:** updates carry a sequence number, so older or repeated ones
  are ignored.
- **Reported, not observed:** the status is what the requester recorded.
- **Not in backups yet:** the requester key can't be exported, so after
  moving computers, ask for approval again before sending updates. The
  approver's **Approved by me** list isn't included in backups yet either.

## What is checked before anything is recorded

- **The data:** the sealed block unseals to a valid response (strict format,
  size limits).
- **The signature:** it's valid for the key you confirmed for Priya. Any key
  or name inside the email itself is ignored.
- **The request:** the response answers a request sent from this browser, to
  Priya, that hasn't been answered yet. Each request can be used once.
- **The plan:** the response is for the task's current plan version and
  fingerprint. A response to an older version is refused.
- **Timing:** the request isn't older than 7 days, and the task is still
  waiting for approval.

The wording of an email never counts. An email that just says "approved"
does nothing.

## What it doesn't do

- **It doesn't stop Claude.** Like your own approval, a signed approval is a
  record. Claude Code's Plan mode is what holds Claude back until you approve
  in Claude Code.
- **No background reading.** Mail2Code reads an email only when you click its
  icon.
- **Approval emails are stored by Gmail.** The plan text (not the original
  email text) is in the request email, in both people's Gmail accounts.
- **Trust rests on the fingerprint check.** Someone could create an approver
  identity in a second browser and approve their own requests. Only trust
  fingerprints you've checked with the person. A response signed by your own
  identity is refused.
- **Pending requests stay on one computer.** They are not included in
  backups. After moving computers, send a new request. Trusted approvers move
  with backups but must be confirmed again.
- **Deleting an identity is final.** The approver can't sign as that identity
  again. Approvals already recorded stay valid.

## Not yet tested

- The real Gmail draft window and how long a draft link Gmail accepts.
- Whether Gmail shows the reply in the same conversation.
- The flow between two real people on two computers.

The automated tests cover the whole round trip in two browser profiles
against synthetic Gmail pages.
