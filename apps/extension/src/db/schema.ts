import type { BlockReason, Priority, TaskStatus } from "@mail2code/protocol";
import type { ApprovalRecord, GivenApproval, KeyHandle, PendingRequest, PlanRecord, TrustedApprover } from "@mail2code/task-core";

export const DB_NAME = "mail2code";
export const DB_VERSION = 3;

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
  // Fingerprint of the one approver whose signed approval this task needs;
  // when set, the user's own approval doesn't count. Absent before v2.
  requiredApprover?: string | null;
}

// This browser's own approver identity (at most one, id "self"). The private
// key is a non-extractable CryptoKey: IndexedDB stores it, but it can't be
// read out, exported or included in a backup.
export interface IdentityRecord {
  id: "self";
  name: string;
  email: string;
  publicKey: string;
  fingerprint: string;
  privateKey: KeyHandle;
  createdAt: number;
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

// The requester key (at most one, id "self"): signs progress updates sent to
// approvers. Created automatically with the first approval request; the
// private key is non-extractable and never exported.
export interface RequesterKeyRecord {
  id: "self";
  publicKey: string;
  fingerprint: string;
  privateKey: KeyHandle;
  createdAt: number;
}

export interface SettingRecord {
  // anthropicApiKey: the user's own key for the optional Claude API summary.
  // Readable only by extension pages and the background (same origin); never
  // exported, logged or sent to the content script.
  key: "retentionDays" | "anthropicApiKey";
  value: unknown;
}

export interface EventRecord {
  seq?: number;
  taskId: string;
  at: number;
  type: string;
  data: Record<string, unknown>;
}

export type { ApprovalRecord, GivenApproval, PendingRequest, PlanRecord, TrustedApprover };

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
  if (oldVersion < 2) {
    db.createObjectStore("identity", { keyPath: "id" });
    db.createObjectStore("approvers", { keyPath: "fingerprint" });
    db.createObjectStore("approvalRequests", { keyPath: "requestId" }).createIndex("taskId", "taskId");
  }
  if (oldVersion < 3) {
    db.createObjectStore("requesterKey", { keyPath: "id" });
    db.createObjectStore("givenApprovals", { keyPath: "requestId" });
  }
}
