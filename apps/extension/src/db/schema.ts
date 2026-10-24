import type { BlockReason, Priority, TaskStatus } from "@inbox-handoff/protocol";
import type { ApprovalRecord, PlanRecord } from "@inbox-handoff/task-core";

export const DB_NAME = "inbox-handoff";
export const DB_VERSION = 1;

export interface SourceRef {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  // When the message was added to the task (capture or refresh). Absent on Phase 2 records.
  addedAt?: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  blockReason: BlockReason | null;
  priority: Priority;
  dueAt: string | null;
  repositoryRef: string;
  instructions: string;
  scope: "message" | "thread";
  threadId: string;
  threadUrl: string;
  sources: SourceRef[];
  idempotencyKey: string;
  origin: "local" | "imported";
  createdAt: number;
  updatedAt: number;
  lastRefreshAt: number | null;
  handoff: { preparedAt: number | null; openedAt: number | null; destination: string | null };
  // Set when a context refresh added messages; compared with the latest plan's
  // time to warn that the plan may no longer fit. Absent on Phase 2 records.
  contextChangedAt?: number | null;
}

// Email bodies live apart from tasks so they can be purged on their own.
// Optional fields are absent on records written by the Phase 2 build, which
// also carry an unused `retainedUntil: null`.
export interface SnapshotRecord {
  taskId: string;
  messages: { messageId: string; bodyText: string }[];
  // When the task entered a closed status; the retention countdown starts here.
  // null while the task is open (or after it was retried).
  closedAt?: number | null;
  purgedAt?: number | null;
}

export interface SettingRecord {
  key: "retentionDays";
  value: unknown;
}

export interface EventRecord {
  seq?: number;
  taskId: string;
  at: number;
  type: string;
  data: Record<string, unknown>;
}

export type { ApprovalRecord, PlanRecord };

export function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const tasks = db.createObjectStore("tasks", { keyPath: "id" });
    tasks.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
    tasks.createIndex("threadId", "threadId");
    tasks.createIndex("status", "status");
    tasks.createIndex("updatedAt", "updatedAt");
    db.createObjectStore("snapshots", { keyPath: "taskId" });
    db.createObjectStore("plans", { keyPath: "id" }).createIndex("taskId", "taskId");
    db.createObjectStore("approvals", { keyPath: "id" }).createIndex("taskId", "taskId");
    db.createObjectStore("events", { keyPath: "seq", autoIncrement: true }).createIndex("taskId", "taskId");
    db.createObjectStore("settings", { keyPath: "key" });
  }
}
