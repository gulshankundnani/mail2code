import type { BlockReason, Priority, TaskStatus } from "@inbox-handoff/protocol";
import type { ApprovalRecord, PlanRecord } from "@inbox-handoff/task-core";

export const DB_NAME = "inbox-handoff";
export const DB_VERSION = 1;

export interface SourceRef {
  messageId: string;
  subject: string;
  from: string;
  date: string;
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
}

// Email bodies live apart from tasks so they can be purged on their own.
export interface SnapshotRecord {
  taskId: string;
  messages: { messageId: string; bodyText: string }[];
  retainedUntil: number | null;
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
