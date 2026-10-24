# Synthetic Gmail fixtures

Hand-written HTML that **approximates** the parts of Gmail's conversation view
the extractor relies on (see `packages/gmail-extract/src/selectors.ts`). All
names, addresses and content are invented (`example.test`).

These fixtures are not copies of real Gmail markup and passing tests against
them does **not** prove compatibility with live Gmail. Live Gmail must be
checked manually (see `docs/browser-compatibility.md`).

| File | Models |
|---|---|
| `single-message.html` | One expanded message |
| `thread.html` | Older-messages bar, a collapsed message, expanded messages incl. RTL/non-ASCII, and a hidden stale conversation |
| `malicious.html` | Script tags, inline-hidden injection text, HTML in subject, `javascript:` link |
| `no-ids.html` | Expanded message without any id attribute |
| `two-conversations.html` | Two visible conversations (ambiguous) |
| `inbox.html` | Inbox list; a link opens a conversation without a page reload (SPA navigation) |
| `secrets.html` | Synthetic, non-working credentials (API key, password, database URL) for redaction tests |
