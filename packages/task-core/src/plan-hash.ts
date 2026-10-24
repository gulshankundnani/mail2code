import { createHash } from "node:crypto";
import { canonicalJson, type PlanContent } from "@inbox-handoff/protocol";

export { canonicalJson };

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// The hash binds the plan to its task, project and version, so an approval for
// one task's plan can never match another task or a later revision.
export function planHash(input: { taskId: string; projectId: string; version: number; content: PlanContent }): string {
  return sha256Hex(canonicalJson({ domain: "inbox-handoff/plan/v1", ...input }));
}
