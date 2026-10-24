import { z } from "zod";

export const TASK_STATUSES = [
  "Captured",
  "ReadyForHandoff",
  "HandoffOpened",
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

export const BLOCK_REASONS = ["imported_requires_review", "plan_needs_changes", "blocked_by_user"] as const;
export const BlockReasonSchema = z.enum(BLOCK_REASONS);
export type BlockReason = z.infer<typeof BlockReasonSchema>;
