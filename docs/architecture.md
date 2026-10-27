# Architecture

Mail2Code is a single Manifest V3 browser extension. There is no server,
native host, desktop app or account. It needs no configuration files or
environment variables (so there is no `.env.example`).

```
┌──────────────── Gmail tab (mail.google.com) ────────────────┐
│ content script (isolated world, top frame)                  │
│  · keeps one "Send to Claude" button next to the subject    │
│  · on a real click: extracts the open conversation as text  │
└───────────────┬─────────────────────────────────────────────┘
                │ runtime message: { kind: "capture" } — the only one allowed
┌───────────────▼─────────────────────────────────────────────┐
│ background (service worker / Firefox event page)            │
│  · classifies the sender, validates with zod                │
│  · stores a draft in storage.session (memory, 1 h)          │
│  · opens the review page; purges old email text on startup  │
└───────────────┬─────────────────────────────────────────────┘
                │ extension pages (same origin, strict CSP, no network)
┌───────────────▼─────────────────────────────────────────────┐
│ review.html   create a task / add to an existing task       │
│ task.html     brief, handoff, plan, approval, progress      │
│ options.html  task list, filters, retention, integrations   │
│ backup.html   export / import / encryption                  │
│        └── IndexedDB "mail2code" (TaskRepo)             │
└───────────────┬─────────────────────────────────────────────┘
                │ user actions only
     clipboard + new tab (claude.ai)        backup files (disk)
```

## Packages

| Package | Role | Depends on |
|---|---|---|
| `packages/protocol` | zod schemas (task creation, plan decision, capture), limits, statuses, canonical JSON, zod `jitless` config | zod |
| `packages/task-core` | State machine (`canTransition`), status labels, plan hash (Web Crypto SHA-256), decision and current-approval checks | protocol |
| `packages/gmail-extract` | DOM → `CapturedConversation`; selector strategies; HTML → text | protocol (limits and types only, so the content script bundles no zod) |
| `packages/backup` | Export format v1, checksum, encryption, validation, import preview/selection | protocol, task-core, zod |
| `apps/extension` | WXT entrypoints, IndexedDB repository, mapping to/from the export format, UI | all of the above |

## Task lifecycle

```
Captured → ReadyForHandoff → HandoffOpened → Planning → AwaitingApproval
                                                           │  user_approval
                                   ┌───────────────────────┼────────────┐
                                   ▼                       ▼            ▼
                                Approved               Rejected   Planning (changes requested)
                                   │ user reports start (needs a current local approval)
                                   ▼
                               InProgress → Completed / Failed
Any active state → Cancelled (user) · Blocked (user, or system: context refresh, import)
Blocked → Planning / AwaitingApproval (review again, never straight back to work)
```

Rules enforced in `task-core` and `TaskRepo`:

- Only a `user_approval` reaches `Approved`, and only from `AwaitingApproval`.
- `system` causes (context refresh, import) can only move a task to `Blocked`.
- A decision must name the current plan version and fingerprint.
- Recording a plan, or leaving `Approved`/`InProgress`, supersedes approvals.
- Reporting "implementation started" requires a current, local approval of the latest plan.

With the browser handoff these rules govern the extension's own records. They
can't control Claude in claude.ai — see [claude-integrations.md](claude-integrations.md).

## Storage

IndexedDB database `mail2code` (version 3; older databases are upgraded in place):

| Store | Key | Contents |
|---|---|---|
| `tasks` | `id` | Task metadata, Gmail references, handoff timestamps; indexes on `idempotencyKey` (unique), `threadId`, `status`, `updatedAt` |
| `snapshots` | `taskId` | Stored email text, `closedAt` (retention clock), `purgedAt` |
| `plans` | `id` | Versions with SHA-256 fingerprints |
| `approvals` | `id` | Decisions; `origin` `local`, `signed` (another person's verified response, with `signedBy`) or `imported`; `supersededAt` |
| `events` | auto | Append-only history |
| `settings` | `key` | `retentionDays`, `anthropicApiKey` |
| `identity` | `id` (`self`) | v2. This browser's approver identity: name, email, public key, fingerprint and a **non-extractable** ECDSA P-256 private key |
| `approvers` | `fingerprint` | v2. Trusted approvers (public keys); `confirmedAt` is null until the user confirms the fingerprint |
| `approvalRequests` | `requestId` | v2. Requests sent from this browser: task, plan version and fingerprint, approver, expiry, `usedAt` (single use), `updateSeq` (last progress update); index on `taskId` |
| `requesterKey` | `id` (`self`) | v3. Non-extractable key that signs progress updates; its public part goes into approval requests |
| `givenApprovals` | `requestId` | v3. The approver's "Approved by me" list: what they signed, the requester's key, and the progress updates received |

Approval by another person ([approvals.md](approvals.md)) adds one route
from the Gmail content script, `approval.block`. After a real click on the
approval card, it hands a sealed block to the background, which keeps it in
`storage.session` and opens `approve.html` (requests) or the task page
(responses). Signing and recording happen only on those extension pages.

Writes that touch several stores run in one transaction (`inTx`), so a failure
leaves nothing half-written. The export format in
[backup-format.md](backup-format.md) is independent of this layout.

## Builds

WXT builds `chrome-mv3` (also used for Brave), `edge-mv3` and `firefox-mv3`.
Production builds add the strict extension-page CSP; Firefox builds add the
Gecko ID and `data_collection_permissions`. See
[browser-compatibility.md](browser-compatibility.md) for bundle sizes.
