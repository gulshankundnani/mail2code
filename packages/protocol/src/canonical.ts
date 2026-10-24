// Deterministic JSON: object keys sorted recursively, no whitespace. Pure so it
// runs in both the extension and the bridge; callers pick their own SHA-256.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("non-finite number");
    if (value === undefined) throw new TypeError("undefined is not serialisable");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// Input to the handoff idempotency key: the same messages sent to the same
// project with the same instructions are treated as a duplicate.
export function idempotencyMaterial(h: { threadId: string; messageIds: string[]; projectId: string; instructions: string }): string {
  return canonicalJson({ domain: "inbox-handoff/handoff/v1", ...h, messageIds: [...h.messageIds].sort() });
}
