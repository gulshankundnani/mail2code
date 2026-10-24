import type { PlanDecision, TaskStatus } from "@inbox-handoff/protocol";
import { planHash } from "./plan-hash.ts";

export interface PlanRecord {
  id: string;
  taskId: string;
  version: number;
  hash: string;
  text: string;
  source: "pasted";
  recordedAt: number;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  planId: string;
  planVersion: number;
  planHash: string;
  decision: PlanDecision["decision"];
  comment: string | null;
  // Imported approvals are history only and never count as current.
  origin: "local" | "imported";
  decidedAt: number;
  supersededAt: number | null;
}

export type Verdict<R extends string> = { ok: true } | { ok: false; reason: R };

export async function verifyPlanIntegrity(plan: PlanRecord): Promise<boolean> {
  return (await planHash({ taskId: plan.taskId, version: plan.version, text: plan.text })) === plan.hash;
}

export type DecisionRejection = "task_not_awaiting_approval" | "no_plan" | "stale_plan_version" | "plan_hash_mismatch";

// Checks that the user decided on exactly the plan that is current. A page left
// open on an older version cannot approve a plan that has since changed.
export function verifyDecision(input: { decision: PlanDecision; taskStatus: TaskStatus; latestPlan: PlanRecord | null }): Verdict<DecisionRejection> {
  const { decision, taskStatus, latestPlan } = input;
  if (taskStatus !== "AwaitingApproval") return { ok: false, reason: "task_not_awaiting_approval" };
  if (!latestPlan || latestPlan.taskId !== decision.taskId) return { ok: false, reason: "no_plan" };
  if (decision.planVersion !== latestPlan.version) return { ok: false, reason: "stale_plan_version" };
  if (decision.planHash !== latestPlan.hash) return { ok: false, reason: "plan_hash_mismatch" };
  return { ok: true };
}

export type CurrentApprovalRejection = "no_plan" | "no_approval" | "approval_imported" | "approval_superseded" | "approval_for_other_plan";

// Whether the latest plan carries a current, local approval. Required before
// the user can report that implementation started.
export function hasCurrentApproval(input: { latestPlan: PlanRecord | null; approval: ApprovalRecord | null }): Verdict<CurrentApprovalRejection> {
  const { latestPlan, approval } = input;
  if (!latestPlan) return { ok: false, reason: "no_plan" };
  if (!approval || approval.decision !== "approve") return { ok: false, reason: "no_approval" };
  if (approval.origin !== "local") return { ok: false, reason: "approval_imported" };
  if (approval.supersededAt !== null) return { ok: false, reason: "approval_superseded" };
  if (approval.planId !== latestPlan.id || approval.planHash !== latestPlan.hash) return { ok: false, reason: "approval_for_other_plan" };
  return { ok: true };
}
