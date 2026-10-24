# Security policy

## Supported versions

The project hasn't had a release yet. Security fixes go into the main branch.
Once releases exist, only the latest release is supported.

## Reporting a vulnerability

Please report vulnerabilities **privately** using GitHub's private
vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Don't open a public issue or pull request for a
vulnerability before it is fixed.

Include, if you can:

- what an attacker can do and under which conditions;
- steps to reproduce, ideally with synthetic data;
- the browser, extension build and version.

You should get an acknowledgement within a week. We'll agree a disclosure
timeline with you and credit you in the changelog if you wish.

## Scope

In scope, for example:

- email or backup content executing as code, or being rendered as HTML;
- a web page, Gmail content or another extension triggering task creation,
  approval, export or import;
- an approval counting for a different task, plan version or after import;
- data leaving the browser without the user pasting or saving it;
- credentials surviving redaction in formats the detector claims to handle;
- permission or CSP regressions in the built manifests.

Not vulnerabilities (documented limitations — see
[docs/claude-integrations.md](docs/claude-integrations.md) and
[docs/threat-model.md](docs/threat-model.md)):

- Claude in claude.ai acting before you approve a plan. The browser handoff
  can only record approvals, not enforce them.
- Prompt injection affecting Claude's behaviour after you paste a brief.
- Credentials in unusual formats not being detected (detection is best-effort).
- Attacks requiring control of the user's browser profile or operating system.

## Handling secrets in this repository

No credentials, signing keys or store tokens belong in this repository. CI
runs `npm run scan:secrets` on every change. Release signing and store
credentials are kept outside the repository (see
[docs/release-process.md](docs/release-process.md)).
