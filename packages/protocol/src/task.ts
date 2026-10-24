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

export const BLOCK_REASONS = ["imported_requires_review", "plan_needs_changes", "blocked_by_user", "context_changed"] as const;
export const BlockReasonSchema = z.enum(BLOCK_REASONS);
export type BlockReason = z.infer<typeof BlockReasonSchema>;

// Statuses after which stored email text starts its retention countdown.
// Failed and Rejected count as closed; retrying a task stops the countdown.
export const CLOSED_STATUSES: ReadonlySet<TaskStatus> = new Set(["Completed", "Cancelled", "Rejected", "Failed"]);

// Days to keep stored email text after a task closes; null = keep until deleted.
export const RetentionDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]);
export type RetentionDays = z.infer<typeof RetentionDaysSchema>;
export const DEFAULT_RETENTION_DAYS: RetentionDays = 30;
