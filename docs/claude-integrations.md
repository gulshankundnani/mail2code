# Claude integrations: what an extension can and cannot do

Last reviewed 2026-10-24.

| Integration | Status | Why |
|---|---|---|
| Claude Code on the user's computer | **Unknown — cannot verify from the browser** | Extensions cannot run programs, read the PATH or inspect files. Reaching a local CLI needs native messaging, which requires installing a separate program, which this project rules out. |
| Browser handoff (default) | **Available** | Copy brief to clipboard, open `claude.ai/code` (GitHub repositories) or `claude.ai/new`. The user pastes and sends. No task content is put in the URL. |
| Claude Managed Agents (optional) | **Not built — no-go as designed** | See probe below. |

## Approval gate: what is and isn't enforced

With the browser handoff the extension **cannot see or control** the Claude
conversation. It enforces its own records only:

- A decision is bound to the exact plan version and SHA-256 fingerprint the
  user was looking at; a tab showing an older plan cannot approve a newer one.
- Recording a changed plan supersedes earlier approvals.
- "Implementation started" can only be recorded after a current, local
  approval. Imported approvals never count.

It does **not** prevent Claude in claude.ai from acting before approval. The
UI says so on the task page, and the brief asks Claude to wait — a request,
not a control.

## Managed Agents probe (2026-10-24)

`tests/probe/managed-agents-probe.mjs` sent two unauthenticated requests (no
API key, body `{}`) to `POST https://api.anthropic.com/v1/agents` from a real
extension page (`chrome-extension://` origin), with and without the
`anthropic-dangerous-direct-browser-access: true` header. All other hosts were
blocked.

| Attempt | Result |
|---|---|
| Without the header | `net::ERR_FAILED` — no readable response |
| With the header | `net::ERR_FAILED` — no readable response |

The hostname resolved (the failure is not `ERR_NAME_NOT_RESOLVED`), so the
browser blocked the response — consistent with a cross-origin (CORS)
rejection of extension origins.

**Verdict:** not usable from an extension page without a host permission. A
future version would need `optional_host_permissions: ["https://api.anthropic.com/*"]`
granted by the user at runtime, and an authenticated test with the user's own
API key, to confirm the API accepts the request and that tool restrictions
(`enabled: false`, `permission_policy: always_ask`) behave as documented.
That is a product decision and has not been started.
