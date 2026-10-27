import { canonicalJson } from "@mail2code/protocol";

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Binds a plan to its task and version, so an approval for one task's plan
// can never match another task or a later revision.
export function planHash(input: { taskId: string; version: number; text: string }): Promise<string> {
  return sha256Hex(canonicalJson({ domain: "mail2code/plan/v1", ...input }));
}
