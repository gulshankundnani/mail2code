// Best-effort detection of credentials pasted into emails, so they can be
// redacted before a task is saved or a brief is copied. Patterns are
// deliberately specific to keep false positives low; this cannot find every
// secret, and the review page says so.

export interface SecretKind {
  id: string;
  label: string;
  pattern: RegExp;
  // Capture group to replace; 0 = the whole match. Used to keep the key name
  // in a "password = <value>" assignment and the user name in URLs.
  group?: number;
  // Extra check on the captured value, to skip prose and code such as
  // "password: reset" or "passphrase: string".
  accept?: (value: string) => boolean;
}

// At least 8 characters mixing two or more of: lower case, upper case, digits, symbols.
function looksLikeSecretValue(v: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(v)).length;
  return v.length >= 8 && classes >= 2;
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
    pattern: /\b(?:password|passwd|pwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?([^\s"',;()]{6,})/gi,
    group: 1,
    accept: looksLikeSecretValue,
  },
];

function* matches(text: string, k: SecretKind): Generator<RegExpMatchArray> {
  for (const m of text.matchAll(k.pattern)) {
    const value = k.group ? m[k.group] : m[0];
    if (value !== undefined && (!k.accept || k.accept(value))) yield m;
  }
}

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
    const found = [...matches(remaining, k)];
    if (found.length) {
      out.push({ kind: k.id, label: k.label, count: found.length });
      // Don't count the same text again under a broader pattern.
      for (const m of found) remaining = remaining.replace(m[0], " ");
    }
  }
  return out;
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const k of SECRET_KINDS) {
    for (const m of [...matches(result, k)]) {
      const value = k.group ? m[k.group]! : m[0];
      result = result.replace(m[0], k.group ? m[0].replace(value, REDACTED) : REDACTED);
    }
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
