import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PlanContent, PlanDecision, TaskStatus } from "@inbox-handoff/protocol";
import { planHash } from "./plan-hash.ts";

export const NONCE_TTL_MS = 24 * 60 * 60 * 1000;

export function issueNonce(): string {
  return randomBytes(32).toString("base64url");
}

export interface PlanRecord {
  id: string;
  taskId: string;
  projectId: string;
  version: number;
  hash: string;
  content: PlanContent;
}

export interface NonceRecord {
  nonce: string;
  taskId: string;
  planVersion: number;
  planHash: string;
  issuedAt: number;
  consumedAt: number | null;
}

export interface ApprovalRecord {
  taskId: string;
  planId: string;
  planHash: string;
  projectId: string;
  projectPathHash: string;
  installId: string;
  origin: "local" | "imported";
  decidedAt: number;
  supersededAt: number | null;
}

export type DecisionRejection =
  | "task_not_awaiting_approval"
  | "no_plan"
  | "stale_plan_version"
  | "plan_hash_mismatch"
  | "plan_tampered"
  | "unknown_nonce"
  | "nonce_already_used"
  | "nonce_expired"
  | "nonce_bound_to_other_plan";

export type Verdict<R extends string> = { ok: true } | { ok: false; reason: R };

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyPlanIntegrity(plan: PlanRecord): boolean {
  const expected = planHash({ taskId: plan.taskId, projectId: plan.projectId, version: plan.version, content: plan.content });
  return safeEqual(expected, plan.hash);
}

// Validates a user's approve/reject/request-changes decision against the
// current task, its latest plan and the one-time nonce issued for that plan.
export function verifyDecision(input: {
  decision: PlanDecision;
  taskStatus: TaskStatus;
  latestPlan: PlanRecord | null;
  nonce: NonceRecord | null;
  now: number;
}): Verdict<DecisionRejection> {
  const { decision, taskStatus, latestPlan, nonce, now } = input;
  if (taskStatus !== "AwaitingApproval") return { ok: false, reason: "task_not_awaiting_approval" };
  if (!latestPlan || latestPlan.taskId !== decision.taskId) return { ok: false, reason: "no_plan" };
  if (decision.planVersion !== latestPlan.version) return { ok: false, reason: "stale_plan_version" };
  if (!safeEqual(decision.planHash, latestPlan.hash)) return { ok: false, reason: "plan_hash_mismatch" };
  if (!verifyPlanIntegrity(latestPlan)) return { ok: false, reason: "plan_tampered" };
  if (!nonce || !safeEqual(nonce.nonce, decision.nonce)) return { ok: false, reason: "unknown_nonce" };
  if (nonce.consumedAt !== null) return { ok: false, reason: "nonce_already_used" };
  if (now - nonce.issuedAt > NONCE_TTL_MS) return { ok: false, reason: "nonce_expired" };
  if (nonce.taskId !== decision.taskId || nonce.planVersion !== latestPlan.version || !safeEqual(nonce.planHash, latestPlan.hash)) {
    return { ok: false, reason: "nonce_bound_to_other_plan" };
  }
  return { ok: true };
}

export type ExecutionRejection =
  | "task_not_in_progress"
  | "no_plan"
  | "plan_tampered"
  | "no_approval"
  | "approval_imported"
  | "approval_other_install"
  | "approval_superseded"
  | "approval_for_other_plan"
  | "approval_for_other_project"
  | "project_path_changed";

// Checked by the PreToolUse hook on every single tool call during implementation.
export function authorizeExecution(input: {
  taskId: string;
  taskStatus: TaskStatus;
  projectId: string;
  currentProjectPathHash: string;
  installId: string;
  latestPlan: PlanRecord | null;
  approval: ApprovalRecord | null;
}): Verdict<ExecutionRejection> {
  const { taskStatus, latestPlan, approval } = input;
  if (taskStatus !== "InProgress") return { ok: false, reason: "task_not_in_progress" };
  if (!latestPlan || latestPlan.taskId !== input.taskId) return { ok: false, reason: "no_plan" };
  if (!verifyPlanIntegrity(latestPlan)) return { ok: false, reason: "plan_tampered" };
  if (!approval || approval.taskId !== input.taskId) return { ok: false, reason: "no_approval" };
  if (approval.origin !== "local") return { ok: false, reason: "approval_imported" };
  if (approval.installId !== input.installId) return { ok: false, reason: "approval_other_install" };
  if (approval.supersededAt !== null) return { ok: false, reason: "approval_superseded" };
  if (approval.planId !== latestPlan.id || !safeEqual(approval.planHash, latestPlan.hash)) {
    return { ok: false, reason: "approval_for_other_plan" };
  }
  if (approval.projectId !== input.projectId) return { ok: false, reason: "approval_for_other_project" };
  if (!safeEqual(approval.projectPathHash, input.currentProjectPathHash)) return { ok: false, reason: "project_path_changed" };
  return { ok: true };
}
