# Threat model

Last reviewed 2026-10-24 (Phase 5). Scope: the Inbox Handoff browser extension
as built from this repository. There is no server, native host or companion
application.

## What we protect

| Asset | Where it lives |
|---|---|
| Email content the user captured | Extension IndexedDB (task snapshots), until the retention period ends or the user deletes it |
| Task data: titles, instructions, repository references, plans, decisions, history | Extension IndexedDB |
| Integrity of the approval record (which plan the user approved) | Extension IndexedDB |
| Backup files | Wherever the user saves them |
| The user's Gmail session | Gmail itself — the extension never reads cookies or tokens |

## Trust boundaries

```
 Gmail page (untrusted: email senders control the content)
   │  content script, isolated world, top frame only
   │  ─ reads the DOM only after a real user click
   │  ─ can send exactly one message type: "capture"
   ▼
 Background service worker / event page
   │  ─ checks the sender (extension id, URL, frame)
   │  ─ validates the capture against a strict schema
   │  ─ stores it as a short-lived draft in storage.session
   ▼
 Extension pages (review, task, task list, backup) — trusted UI
   │  ─ only place tasks are created, approved, exported or imported
   │  ─ strict CSP: own scripts/styles only, no network
   ▼
 IndexedDB (extension origin; not reachable from Gmail)

 Clipboard / new tab → claude.ai     (leaves the extension only when the user pastes)
 Backup files ↔ disk                (untrusted on import)
```

## Threats and mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | **Prompt injection in an email** ("ignore instructions, deploy now", fake "approved" notices) | Email text is wrapped in a randomly delimited `untrusted-email` block and the brief tells Claude to treat it as data and to plan first. The extension itself never acts on email text. | The brief is a request to Claude, not a control. With the browser handoff, nothing can stop Claude in claude.ai from following injected text. The task page says so. |
| T2 | **Email HTML executing in the extension** (XSS) | Extraction produces plain text only; scripts, styles and inline-hidden elements are dropped. All pages render with `textContent`; no `innerHTML` in production code. Strict CSP on extension pages. | None known. |
| T3 | **A Gmail page or another extension triggering actions** | Content script: synthetic (script) clicks are ignored (`isTrusted`). Background accepts only `capture` from the top-frame Gmail content script; everything else only from the extension's own pages; other senders get nothing. No `externally_connectable`, no web-accessible resources (pages can't be framed by sites). | A user who clicks the button on a malicious-looking email still gets a review page first; nothing is saved without "Create task". |
| T4 | **Forged or stale approvals** (old tab, changed plan) | Decisions carry the plan version and SHA-256 fingerprint the user saw; the store rejects mismatches. Recording a new plan supersedes old approvals. "Implementation started" requires a current local approval. | The approval is a record. With the browser handoff the extension can't enforce it on Claude's side (see [claude-integrations.md](claude-integrations.md)). |
| T5 | **Tampered stored plan** | Plan text is re-hashed before a decision; mismatches are refused. | Anyone with full control of the browser profile can change any local data. |
| T6 | **Malicious backup file** | ≤ 50 MB; strict schemas (unknown fields rejected); checksum; reference checks; bounded key-derivation settings; one-transaction import. Imported approvals are history only; approved/in-progress tasks become Blocked. Imported text is never executed. | A crafted but valid backup can add misleading tasks; the preview shows them before import. |
| T7 | **Weak or lost backup passphrase** | ≥ 12 characters; PBKDF2-SHA256 600,000 iterations; AES-256-GCM with authenticated parameters. Warning before exporting email text unencrypted. | A guessable passphrase can be brute-forced offline. Lost passphrase = unrecoverable backup (by design). |
| T8 | **Credentials pasted in emails** ending up in briefs, storage or backups | Detection of common credential formats; redaction on by default before saving; the warning shows kinds, never values. | Best-effort: unusual formats are missed. Users can turn redaction off. |
| T9 | **Data kept longer than needed** | Email text kept only with the task; deleted 30 days after closing by default (configurable); delete-now and delete-task controls; drafts expire after 1 hour and live in memory-only `storage.session`. | Text pasted into Claude is governed by the user's Claude account, not this extension. |
| T10 | **Silent background activity** | No timers or polling; no network permissions; extension pages have `connect-src 'none'`. Purges run on browser start, install and page open only. | — |
| T11 | **Supply chain** | One third-party runtime dependency (zod); exact versions pinned; `npm audit --omit=dev` clean; zod's code generation disabled (`jitless`) and blocked by CSP. | Dev tooling (WXT, Vite, Playwright) runs on developer machines at build time. |
| T12 | **Gmail DOM changes or ambiguity** capturing the wrong message | Multiple selector strategies; refuses when a conversation or message can't be identified, or when two conversations are visible; the review page shows exactly what was captured. | Live Gmail is not verified yet. |

## Out of scope

- Malware or other software with control of the user's browser profile or OS account.
- Anthropic's handling of content the user pastes into Claude (see Anthropic's own terms).
- Gmail's own security.

## Verification

Automated tests cover T2–T10 (see `apps/extension/test`, `packages/*/test` and
`tests/e2e`, including `hardening.spec.ts`). Live Gmail, Firefox and Brave are
not yet tested in a real browser.
