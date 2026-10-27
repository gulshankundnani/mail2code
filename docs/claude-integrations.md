# Claude integrations: what the extension can and cannot do

Last reviewed 2026-10-24.

## How "Open in Claude" reaches Claude Code on your computer

The extension can't run programs. Instead it uses the **links that Claude's own apps register with your operating system** (like `mailto:` opens your mail app). Both formats are documented by Anthropic:

| Destination | Link | Documented in | Status |
|---|---|---|---|
| **Claude app** (desktop, Code) | `claude://code/new?q=<prompt>` | code.claude.com/docs/en/desktop — "Open an SSH session from a link" | **Verified on the owner's Windows PC:** opens a new local session with the prompt filled in, not sent |
| **Claude app over SSH** | `claude://code/new?ssh_host=…&ssh_port=…&ssh_folder=…&q=…` | same | Built; not tested (needs an SSH host). The app asks you to confirm the connection first |
| **Claude Code in a terminal** | `claude-cli://open?q=…&repo=owner/name` or `&cwd=<absolute folder>` | code.claude.com/docs/en/deep-links | Built; not tested here (the handler isn't registered on the dev PC). One-time setup: run `claude` once and send any prompt |

What always happens, by design of Claude's apps and your browser:

- **The prompt is pre-filled, never sent automatically.** You read it and press Enter. Claude Code also shows "Prompt from an external link" under the input box.
- **Your browser asks before opening an external app** the first time (you can tick "Always allow").
- **The extension can't tell whether Claude opened.** If nothing happens, the app isn't installed or the link handler isn't registered.
- `claude-cli://` prompts are limited to **5,000 characters**; the extension keeps prompts under 4,500 for both destinations.

## What goes into the prompt

Not the whole email. The extension **analyses the thread on your computer** (`packages/analysis`):

1. Removes quoted earlier messages, signatures and legal disclaimers.
2. Redacts likely credentials (on by default).
3. Extracts requests, decisions, deadlines, open questions, links and attachment names, each attributed to its sender and date.
4. Optionally adds a short summary — from **Chrome's on-device AI** (stays on your computer; only used if the model is already downloaded) or the **Claude API** (opt-in; sends the cleaned text to Anthropic with your own key).
5. Composes a structured prompt with the email extract fenced as **untrusted**, plus the instruction to propose a plan first and wait for approval.

Rule-based extraction is deterministic and works best for English. It finds candidate sentences; it doesn't understand the email.

## Approval

The extension can't control Claude Code's behaviour from a link: neither link format accepts a mode or permissions. Two layers remain:

- **Claude Code's own setting `permissions.defaultMode`.** Settings → *Default mode and permissions* generates the snippet. With **`plan`**, every new session starts in plan mode: Claude Code can read and plan but **can't edit files until you approve the plan in Claude Code** — enforced by Claude Code itself. (It applies to all new Claude Code sessions, not only email ones.)
- **The prompt** asks Claude to plan first and to get separate permission for email, deployment, publishing and deletion — a request, not a control.

The task page still records plans and decisions for your own tracking; those records don't control Claude.

## Claude API (optional summaries)

- Off by default. Settings → *Email analysis* → *Claude API summary*.
- Your own Anthropic API key; billed to it. Default model `claude-opus-5-5` (Sonnet 5.5 and Haiku 5.5 selectable), effort `low`, server-side refusal fallback for Opus/Sonnet.
- Uses the official `@anthropic-ai/sdk` from the extension's background script only.
- Needs **"Allow access to api.anthropic.com"** (an optional browser permission requested from Settings; **Remove key** withdraws it again).
- **Not tested against the live API** — no key was available during development.

## Managed Agents

An earlier probe showed cross-origin requests from an extension page without host permission are blocked (see git history of this file). The Claude API option above now uses an optional host permission instead; Managed Agents integration remains unbuilt.
