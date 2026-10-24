# Backup format (v1)

Inbox Handoff backups are UTF-8 JSON files. There are two kinds: a **plain
export** and an **encrypted export** that wraps a plain export. The format is
defined in `packages/backup/src/format.ts` (zod schemas, validated strictly:
unknown fields are rejected) and is independent of the extension's internal
IndexedDB layout.

## Plain export

```json
{
  "format": "inbox-handoff-export",
  "schemaVersion": 1,
  "appVersion": "0.0.0",
  "exportedAt": "2026-10-24T12:00:00.000Z",
  "includesEmailContent": false,
  "data": {
    "tasks": [ … ],
    "plans": [ … ],
    "approvals": [ … ],
    "events": [ … ],
    "settings": { "retentionDays": 30 }
  },
  "checksum": { "algorithm": "SHA-256", "value": "<64 hex chars>" }
}
```

All timestamps are ISO 8601 strings in UTC.

### `data.tasks[]`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Stable task identifier |
| `title`, `instructions`, `repositoryRef` | string | User-written; `repositoryRef` is text only (URL or project name) |
| `status` | enum | `Captured`, `ReadyForHandoff`, `HandoffOpened`, `Planning`, `AwaitingApproval`, `Approved`, `InProgress`, `Blocked`, `Completed`, `Rejected`, `Cancelled`, `Failed` |
| `blockReason` | enum \| null | `imported_requires_review`, `plan_needs_changes`, `blocked_by_user`, `context_changed` |
| `priority` | enum | `low`, `normal`, `high`, `urgent` |
| `dueAt` | ISO \| null | |
| `scope` | `message` \| `thread` | What was captured originally |
| `threadId`, `threadUrl` | string | Gmail conversation id and link (`https://mail.google.com/…` only) |
| `sources[]` | object | `messageId`, `subject`, `from`, `date`, `addedAt` — which messages informed the task |
| `idempotencyKey` | 64 hex | Identifies the same handoff (messages + repository + instructions) for duplicate detection |
| `createdAt`, `updatedAt`, `lastRefreshAt`, `contextChangedAt` | ISO (\| null) | |
| `handoff` | object | `preparedAt`, `openedAt`, `destination` |
| `emailContent[]` | optional | `messageId`, `bodyText`. **Only present if the user chose "Include stored email text"** and the text was still stored. |

### `data.plans[]`

`id`, `taskId`, `version`, `hash`, `text`, `source` (`pasted`), `recordedAt`.
`hash` is SHA-256 over the canonical JSON of
`{domain: "inbox-handoff/plan/v1", taskId, version, text}`. A mismatch is
reported as a warning on import; the extension refuses to approve such a plan
until it is recorded again.

### `data.approvals[]`

`id`, `taskId`, `planId`, `planVersion`, `planHash`, `decision`
(`approve` | `reject` | `request_changes`), `comment`, `decidedAt`,
`supersededAt`. These are **history**. On import they are stored as
"imported" and never count as a current approval.

### `data.events[]`

The task history: `taskId`, `at`, `type` (lower-case dotted name such as
`task.transition`, `plan.recorded`, `context.refreshed`, `note`) and `data`
(a JSON object, at most 20,000 characters when serialised).

### What is never included

Gmail session data, cookies, OAuth tokens, passwords, API keys, private keys
and environment secrets: the extension stores none of them, and the exporter
copies an explicit list of fields only. Unsaved review drafts
(`storage.session`) and internal fields (record origin, sequence numbers,
retention timestamps) are not exported either.

### Checksum

`checksum.value` is SHA-256 over the canonical JSON (keys sorted, no
whitespace) of `{domain: "inbox-handoff/export/v1", data}`. It **detects
accidental corruption** (truncated downloads, disk errors). It does **not**
prove who made the file: anyone who edits it can recompute the checksum. For
tamper detection use an encrypted backup.

## Encrypted export

```json
{
  "format": "inbox-handoff-encrypted-export",
  "version": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<16 bytes, base64>" },
  "cipher": { "name": "AES-GCM", "iv": "<12 bytes, base64>" },
  "ciphertext": "<base64>"
}
```

- Key: PBKDF2-HMAC-SHA-256 over the UTF-8 passphrase with a random 16-byte
  salt and 600,000 iterations, producing an AES-256 key.
- Cipher: AES-256-GCM with a random 12-byte IV. The plaintext is the complete
  plain-export JSON. The canonical JSON of `{format, version, kdf, cipher}` is
  passed as additional authenticated data, so changing any parameter makes
  decryption fail.
- Implemented with the browser's Web Crypto API; no custom cryptography.
- The passphrase and key are never stored. Passphrases must be at least 12
  characters. On import, `iterations` must be between 100,000 and 5,000,000.
- A wrong passphrase and a modified file produce the same error.

## Import validation order

1. Size (≤ 50 MB) and JSON syntax.
2. Format marker; encrypted files are decrypted in memory (nothing is written to disk).
3. Schema version: newer versions are refused; older ones are upgraded step by step (no older versions exist yet).
4. Strict schema validation of every record.
5. Checksum.
6. References between records: unique ids and duplicate keys; plans, decisions and history belong to tasks in the file; email text belongs to listed messages.
7. Plan fingerprints (warnings only).

Imported content is stored and displayed as text only. Nothing in a backup
is ever executed.

## Versioning

`schemaVersion` increases when the format changes incompatibly. The importer
keeps a migration for every older version (`MIGRATIONS` in
`packages/backup/src/validate.ts`) and refuses files from newer versions.
