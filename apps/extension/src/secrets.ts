// Best-effort detection of credentials pasted into emails, so they can be
// redacted before a task is saved or a brief is copied. Patterns are
// deliberately specific to keep false positives low; this cannot find every
// secret, and the review page says so.

export interface SecretKind {
  id: string;
  label: string;
  pattern: RegExp;
  // Capture group to replace; 0 = the whole match. Used to keep the key name
  // in "password: hunter2" and the user name in URLs.
  group?: number;
}

export const SECRET_KINDS: readonly SecretKind[] = [
  { id: "private-key", label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { id: "anthropic", label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "aws", label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "github", label: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { id: "slack", label: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: "google", label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "stripe", label: "Stripe key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: "jwt", label: "access token (JWT)", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    id: "url-credentials",
    label: "password in a URL",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/gi,
    group: 1,
  },
  {
    id: "assignment",
    label: "password or secret value",
    pattern: /\b(?:password|passwd|pwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?([^\s"',;]{6,})/gi,
    group: 1,
  },
];

export const REDACTED = "[REDACTED]";

export interface SecretFinding {
  kind: string;
  label: string;
  count: number;
}

// Counts per kind. Never returns the secret values themselves.
export function findSecrets(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  let remaining = text;
  for (const k of SECRET_KINDS) {
    const matches = remaining.match(k.pattern);
    if (matches?.length) {
      out.push({ kind: k.id, label: k.label, count: matches.length });
      // Don't count the same text again under a broader pattern.
      remaining = remaining.replace(k.pattern, " ");
    }
  }
  return out;
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const k of SECRET_KINDS) {
    result = result.replace(k.pattern, (match: string, ...rest: unknown[]) => {
      if (!k.group) return REDACTED;
      const value = rest[k.group - 1];
      return typeof value === "string" ? match.replace(value, REDACTED) : REDACTED;
    });
  }
  return result;
}

export function mergeFindings(lists: SecretFinding[][]): SecretFinding[] {
  const byKind = new Map<string, SecretFinding>();
  for (const f of lists.flat()) {
    const prev = byKind.get(f.kind);
    byKind.set(f.kind, prev ? { ...prev, count: prev.count + f.count } : { ...f });
  }
  return [...byKind.values()];
}
