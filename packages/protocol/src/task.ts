import { z } from "zod";

export const TASK_STATUSES = [
  "Captured",
  "ReadyForPlanning",
  "Planning",
  "AwaitingApproval",
  "Approved",
  "InProgress",
  "Blocked",
  "Completed",
  "Rejected",
  "Cancelled",
  "Failed",
] as const;

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const PrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const BLOCK_REASONS = [
  "needs_approval_for_operation",
  "imported_requires_review",
  "recovered_after_restart",
  "project_unavailable",
  "plan_needs_changes",
] as const;
export const BlockReasonSchema = z.enum(BLOCK_REASONS);
export type BlockReason = z.infer<typeof BlockReasonSchema>;
