# Golden backup fixtures

Synthetic backups, one pair per format version, that every future version
must keep importing.

| File | Contents |
|---|---|
| `v1-plain.json` | Three tasks (awaiting approval, in progress with an approval, completed with email text), two plans, one approval, history, retention 90 days |
| `v1-encrypted.json` | The same backup encrypted with PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM. Passphrase: `synthetic fixture passphrase` |
| `v2-plain.json` | Format v2 (approval by another person): the same three tasks, plus one trusted approver (public key only), a task that requires that approver, and a signed decision in the history |
| `v2-encrypted.json` | The v2 backup, encrypted the same way, same passphrase |

Tested by `packages/backup/test/golden.test.ts` and
`apps/extension/test/compatibility.test.ts`.

If a format change breaks these tests, add a migration in
`packages/backup/src/validate.ts` (`MIGRATIONS`). Don't regenerate the
fixtures to make a failing compatibility test pass. They were generated once
with `scripts/make-backup-fixtures.mjs`, and regenerated once before the first
release when the format identifiers were renamed from `inbox-handoff-*` to
`mail2code-*` (no version had been published, so no real backups existed).
