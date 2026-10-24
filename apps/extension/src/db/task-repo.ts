import {
  CLOSED_STATUSES,
  DEFAULT_RETENTION_DAYS,
  PlanDecisionSchema,
  RecordedPlanInputSchema,
  RetentionDaysSchema,
  TaskCreateSchema,
  type BlockReason,
  type CapturedConversation,
  type PlanDecision,
  type RecordedPlanInput,
  type RetentionDays,
  type TaskCreate,
  type TaskStatus,
} from "@inbox-handoff/protocol";
import {
  assertTransition,
  hasCurrentApproval,
  planHash,
  verifyDecision,
  verifyPlanIntegrity,
  type ApprovalRecord,
  type CurrentApprovalRejection,
  type DecisionRejection,
  type PlanRecord,
  type TransitionCause,
  type Verdict,
} from "@inbox-handoff/task-core";
import { inTx, openDb, req } from "./idb.ts";
import { DB_NAME, DB_VERSION, upgrade, type EventRecord, type SettingRecord, type SnapshotRecord, type TaskRecord } from "./schema.ts";

export class TaskError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Statuses in which a recorded approval still counts.
const APPROVAL_LIVE: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress", "Completed"]);
// Statuses where new context invalidates the go-ahead and needs a fresh review.
const CONTEXT_SENSITIVE: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress"]);
// No context refresh into finished tasks: start a new task instead.
const REFRESH_CLOSED: ReadonlySet<TaskStatus> = new Set(["Completed", "Cancelled"]);

const ALL = ["tasks", "snapshots", "plans", "approvals", "events", "settings"];

export interface RefreshResult {
  added: string[];
  blocked: boolean;
}

export class TaskRepo {
  readonly db: IDBDatabase;
  private readonly now: () => number;

  private constructor(db: IDBDatabase, now: () => number) {
    this.db = db;
    this.now = now;
  }

  static async open(factory: IDBFactory = indexedDB, opts: { name?: string; now?: () => number } = {}): Promise<TaskRepo> {
    return new TaskRepo(await openDb(factory, opts.name ?? DB_NAME, DB_VERSION, upgrade), opts.now ?? Date.now);
  }

  close(): void {
    this.db.close();
  }

  // ---- settings ---------------------------------------------------------------

  async getRetentionDays(): Promise<RetentionDays> {
    return inTx(this.db, ["settings"], "readonly", (tx) => this.retentionInTx(tx));
  }

  async setRetentionDays(days: RetentionDays): Promise<void> {
    const value = RetentionDaysSchema.parse(days);
    await inTx(this.db, ["settings"], "readwrite", async (tx) => {
      const rec: SettingRecord = { key: "retentionDays", value };
      await req(tx.objectStore("settings").put(rec));
    });
  }

  // ---- tasks ----------------------------------------------------------------

  async createTask(input: TaskCreate): Promise<{ task: TaskRecord; created: boolean }> {
    const t = TaskCreateSchema.parse(input);
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const existing = await req(tx.objectStore("tasks").index("idempotencyKey").get(t.idempotencyKey) as IDBRequest<TaskRecord | undefined>);
      if (existing) return { task: existing, created: false };
      const now = this.now();
      const task: TaskRecord = {
        id: crypto.randomUUID(),
        title: t.title,
        status: "Captured",
        blockReason: null,
        priority: t.priority,
        dueAt: t.dueAt,
        repositoryRef: t.repositoryRef,
        instructions: t.instructions,
        scope: t.scope,
        threadId: t.threadId,
        threadUrl: t.threadUrl,
        sources: t.messages.map((m) => ({ messageId: m.messageId, subject: m.subject, from: m.from, date: m.date, addedAt: now })),
        idempotencyKey: t.idempotencyKey,
        origin: "local",
        createdAt: now,
        updatedAt: now,
        lastRefreshAt: null,
        handoff: { preparedAt: null, openedAt: null, destination: null },
        contextChangedAt: null,
      };
      await req(tx.objectStore("tasks").add(task));
      const snap: SnapshotRecord = { taskId: task.id, messages: t.messages.map((m) => ({ messageId: m.messageId, bodyText: m.bodyText })), closedAt: null, purgedAt: null };
      await req(tx.objectStore("snapshots").add(snap));
      await this.event(tx, task.id, "task.captured", { scope: t.scope, messageCount: t.messages.length });
      return { task, created: true };
    });
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    return inTx(this.db, ["tasks"], "readonly", async (tx) => (await req(tx.objectStore("tasks").get(id) as IDBRequest<TaskRecord | undefined>)) ?? null);
  }

  async listTasks(): Promise<TaskRecord[]> {
    const all = await inTx(this.db, ["tasks"], "readonly", (tx) => req(tx.objectStore("tasks").getAll() as IDBRequest<TaskRecord[]>));
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Other tasks captured from the same Gmail conversation (duplicate warning).
  async tasksForThread(threadId: string): Promise<TaskRecord[]> {
    return inTx(this.db, ["tasks"], "readonly", (tx) => req(tx.objectStore("tasks").index("threadId").getAll(threadId) as IDBRequest<TaskRecord[]>));
  }

  async getSnapshot(taskId: string): Promise<SnapshotRecord | null> {
    return inTx(this.db, ["snapshots"], "readonly", async (tx) => (await req(tx.objectStore("snapshots").get(taskId) as IDBRequest<SnapshotRecord | undefined>)) ?? null);
  }

  async transition(taskId: string, to: TaskStatus, cause: TransitionCause, data: Record<string, unknown> = {}, blockReason?: BlockReason): Promise<TaskRecord> {
    return inTx(this.db, ALL, "readwrite", (tx) => this.transitionInTx(tx, taskId, to, cause, data, blockReason));
  }

  // The brief was built and copied (Captured/Failed/Rejected/HandoffOpened -> ReadyForHandoff).
  async markBriefPrepared(taskId: string): Promise<TaskRecord> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      if (task.status !== "ReadyForHandoff") await this.transitionInTx(tx, taskId, "ReadyForHandoff", "user_action");
      return this.patch(tx, taskId, (t) => ({ ...t, handoff: { ...t.handoff, preparedAt: this.now() } }));
    });
  }

  async markHandoffOpened(taskId: string, destination: string): Promise<TaskRecord> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      await this.transitionInTx(tx, taskId, "HandoffOpened", "user_action", { destination });
      return this.patch(tx, taskId, (t) => ({ ...t, handoff: { ...t.handoff, openedAt: this.now(), destination } }));
    });
  }

  // Adds messages from a fresh Gmail capture of the same conversation. Only
  // messages the task doesn't already have are added. New context never
  // approves anything: an approved or in-progress task is blocked for review.
  async refreshContext(taskId: string, capture: CapturedConversation, selectedIds: readonly string[]): Promise<RefreshResult> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      if (capture.threadId !== task.threadId) throw new TaskError("wrong_thread", "This capture is from a different Gmail conversation.");
      if (REFRESH_CLOSED.has(task.status)) throw new TaskError("task_closed", "This task is closed. Create a new task instead.");
      const known = new Set(task.sources.map((s) => s.messageId));
      const fresh = capture.messages.filter((m) => selectedIds.includes(m.messageId) && !known.has(m.messageId));
      const now = this.now();
      if (fresh.length > 0) {
        const snap = (await req(tx.objectStore("snapshots").get(taskId) as IDBRequest<SnapshotRecord | undefined>)) ?? { taskId, messages: [], closedAt: null, purgedAt: null };
        await req(tx.objectStore("snapshots").put({ ...snap, messages: [...snap.messages, ...fresh.map((m) => ({ messageId: m.messageId, bodyText: m.bodyText }))] }));
      }
      await this.event(tx, taskId, "context.refreshed", { added: fresh.map((m) => m.messageId), offered: capture.messages.length });
      await this.patch(tx, taskId, (t) => ({
        ...t,
        sources: [...t.sources, ...fresh.map((m) => ({ messageId: m.messageId, subject: capture.subject, from: m.from, date: m.date, addedAt: now }))],
        lastRefreshAt: now,
        contextChangedAt: fresh.length > 0 ? now : (t.contextChangedAt ?? null),
      }));
      const blocked = fresh.length > 0 && CONTEXT_SENSITIVE.has(task.status);
      if (blocked) await this.transitionInTx(tx, taskId, "Blocked", "system", { addedMessages: fresh.length }, "context_changed");
      return { added: fresh.map((m) => m.messageId), blocked };
    });
  }

  // ---- retention and deletion ---------------------------------------------------

  // Deletes stored email text for tasks closed longer than the retention
  // period. Runs when the browser starts and when extension pages open; there
  // is no background timer. Task metadata and Gmail links are kept.
  async purgeExpired(): Promise<number> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const days = await this.retentionInTx(tx);
      if (days === null) return 0;
      const cutoff = this.now() - days * DAY_MS;
      let purged = 0;
      for (const snap of await req(tx.objectStore("snapshots").getAll() as IDBRequest<SnapshotRecord[]>)) {
        if (snap.closedAt == null || snap.closedAt > cutoff || snap.messages.length === 0) continue;
        await this.purgeInTx(tx, snap, "retention");
        purged++;
      }
      return purged;
    });
  }

  async purgeSnapshot(taskId: string): Promise<void> {
    await inTx(this.db, ALL, "readwrite", async (tx) => {
      await this.requireTask(tx, taskId);
      const snap = await req(tx.objectStore("snapshots").get(taskId) as IDBRequest<SnapshotRecord | undefined>);
      if (snap && snap.messages.length > 0) await this.purgeInTx(tx, snap, "user");
    });
  }

  // When stored email text will be deleted, or null if it won't be.
  async retentionDeadline(taskId: string): Promise<number | null> {
    return inTx(this.db, ["snapshots", "settings"], "readonly", async (tx) => {
      const days = await this.retentionInTx(tx);
      const snap = await req(tx.objectStore("snapshots").get(taskId) as IDBRequest<SnapshotRecord | undefined>);
      if (days === null || !snap || snap.closedAt == null || snap.messages.length === 0) return null;
      return snap.closedAt + days * DAY_MS;
    });
  }

  // Permanently removes the task and everything recorded about it.
  async deleteTask(taskId: string): Promise<void> {
    await inTx(this.db, ALL, "readwrite", async (tx) => {
      await this.requireTask(tx, taskId);
      await req(tx.objectStore("tasks").delete(taskId));
      await req(tx.objectStore("snapshots").delete(taskId));
      for (const store of ["plans", "approvals", "events"]) {
        const keys = await req(tx.objectStore(store).index("taskId").getAllKeys(taskId));
        for (const k of keys) await req(tx.objectStore(store).delete(k));
      }
    });
  }

  // ---- plans and approvals ------------------------------------------------------

  async getPlans(taskId: string): Promise<PlanRecord[]> {
    const plans = await inTx(this.db, ["plans"], "readonly", (tx) => req(tx.objectStore("plans").index("taskId").getAll(taskId) as IDBRequest<PlanRecord[]>));
    return plans.sort((a, b) => a.version - b.version);
  }

  async getLatestPlan(taskId: string): Promise<PlanRecord | null> {
    return (await this.getPlans(taskId)).at(-1) ?? null;
  }

  async getApprovals(taskId: string): Promise<ApprovalRecord[]> {
    const list = await inTx(this.db, ["approvals"], "readonly", (tx) => req(tx.objectStore("approvals").index("taskId").getAll(taskId) as IDBRequest<ApprovalRecord[]>));
    return list.sort((a, b) => a.decidedAt - b.decidedAt);
  }

  // Records a (new version of the) plan the user pasted in. Any earlier
  // approval is superseded: a changed plan always needs a fresh approval.
  async recordPlan(taskId: string, input: RecordedPlanInput): Promise<PlanRecord> {
    const parsed = RecordedPlanInputSchema.parse(input);
    const prev = await this.getLatestPlan(taskId);
    const version = (prev?.version ?? 0) + 1;
    // Hash before the write transaction: awaiting crypto inside it would commit it early.
    const hash = await planHash({ taskId, version, text: parsed.text });
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      if (!["Planning", "AwaitingApproval", "Blocked"].includes(task.status)) {
        throw new TaskError("plan_not_allowed", `A plan can't be recorded while the task is ${task.status}.`);
      }
      const latest = (await req(tx.objectStore("plans").index("taskId").getAll(taskId) as IDBRequest<PlanRecord[]>)).reduce((m, p) => Math.max(m, p.version), 0);
      if (latest !== version - 1) throw new TaskError("concurrent_change", "The plan changed in another tab. Reload and try again.");
      const plan: PlanRecord = { id: crypto.randomUUID(), taskId, version, hash, text: parsed.text, source: parsed.source, recordedAt: this.now() };
      await req(tx.objectStore("plans").add(plan));
      await this.supersedeApprovals(tx, taskId);
      await this.event(tx, taskId, "plan.recorded", { version, hash, source: parsed.source });
      if (task.status !== "AwaitingApproval") await this.transitionInTx(tx, taskId, "AwaitingApproval", "user_action", { planVersion: version });
      return plan;
    });
  }

  async decide(input: PlanDecision): Promise<TaskRecord> {
    const decision = PlanDecisionSchema.parse(input);
    const latest = await this.getLatestPlan(decision.taskId);
    if (latest && !(await verifyPlanIntegrity(latest))) throw new TaskError("plan_tampered", "The stored plan doesn't match its fingerprint. Record the plan again.");
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, decision.taskId);
      const plans = await req(tx.objectStore("plans").index("taskId").getAll(decision.taskId) as IDBRequest<PlanRecord[]>);
      const current = plans.sort((a, b) => a.version - b.version).at(-1) ?? null;
      const verdict: Verdict<DecisionRejection> = verifyDecision({ decision, taskStatus: task.status, latestPlan: current });
      if (!verdict.ok) throw new TaskError(verdict.reason, decisionMessage(verdict.reason));
      const record: ApprovalRecord = {
        id: crypto.randomUUID(),
        taskId: task.id,
        planId: current!.id,
        planVersion: current!.version,
        planHash: current!.hash,
        decision: decision.decision,
        comment: decision.comment ?? null,
        origin: "local",
        decidedAt: this.now(),
        supersededAt: null,
      };
      await req(tx.objectStore("approvals").add(record));
      const to: TaskStatus = decision.decision === "approve" ? "Approved" : decision.decision === "reject" ? "Rejected" : "Planning";
      return this.transitionInTx(tx, task.id, to, "user_approval", { decision: decision.decision, planVersion: current!.version, planHash: current!.hash });
    });
  }

  // The user reports that implementation started (we cannot observe it).
  // Only allowed with a current local approval of the latest plan.
  async reportStarted(taskId: string): Promise<TaskRecord> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const plans = await req(tx.objectStore("plans").index("taskId").getAll(taskId) as IDBRequest<PlanRecord[]>);
      const latestPlan = plans.sort((a, b) => a.version - b.version).at(-1) ?? null;
      const approvals = await req(tx.objectStore("approvals").index("taskId").getAll(taskId) as IDBRequest<ApprovalRecord[]>);
      const approval = approvals.filter((a) => a.decision === "approve").sort((a, b) => a.decidedAt - b.decidedAt).at(-1) ?? null;
      const verdict: Verdict<CurrentApprovalRejection> = hasCurrentApproval({ latestPlan, approval });
      if (!verdict.ok) throw new TaskError(verdict.reason, "Implementation can only be marked as started after you approve the current plan.");
      return this.transitionInTx(tx, taskId, "InProgress", "user_action");
    });
  }

  async addNote(taskId: string, text: string): Promise<void> {
    const note = text.trim().slice(0, 5_000);
    if (!note) return;
    await inTx(this.db, ["tasks", "events"], "readwrite", async (tx) => {
      await this.requireTask(tx, taskId);
      await this.event(tx, taskId, "note", { text: note });
    });
  }

  async getEvents(taskId: string): Promise<EventRecord[]> {
    const list = await inTx(this.db, ["events"], "readonly", (tx) => req(tx.objectStore("events").index("taskId").getAll(taskId) as IDBRequest<EventRecord[]>));
    return list.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  // ---- internals ------------------------------------------------------------------

  private async transitionInTx(
    tx: IDBTransaction,
    taskId: string,
    to: TaskStatus,
    cause: TransitionCause,
    data: Record<string, unknown> = {},
    blockReason?: BlockReason,
  ): Promise<TaskRecord> {
    const task = await this.requireTask(tx, taskId);
    assertTransition(task.status, to, cause);
    if (!APPROVAL_LIVE.has(to)) await this.supersedeApprovals(tx, taskId);
    await this.updateRetentionClock(tx, taskId, task.status, to);
    await this.event(tx, taskId, "task.transition", { from: task.status, to, cause, ...(blockReason ? { blockReason } : {}), ...data });
    return this.patch(tx, taskId, (t) => ({ ...t, status: to, blockReason: to === "Blocked" ? (blockReason ?? "blocked_by_user") : null }));
  }

  // Starts the retention countdown when a task closes; stops it if retried.
  private async updateRetentionClock(tx: IDBTransaction, taskId: string, from: TaskStatus, to: TaskStatus): Promise<void> {
    const closing = CLOSED_STATUSES.has(to) && !CLOSED_STATUSES.has(from);
    const reopening = CLOSED_STATUSES.has(from) && !CLOSED_STATUSES.has(to);
    if (!closing && !reopening) return;
    const store = tx.objectStore("snapshots");
    const snap = await req(store.get(taskId) as IDBRequest<SnapshotRecord | undefined>);
    if (snap) await req(store.put({ ...snap, closedAt: closing ? this.now() : null }));
  }

  private async purgeInTx(tx: IDBTransaction, snap: SnapshotRecord, reason: "retention" | "user"): Promise<void> {
    await req(tx.objectStore("snapshots").put({ ...snap, messages: [], purgedAt: this.now() }));
    await this.event(tx, snap.taskId, "context.purged", { reason, messageCount: snap.messages.length });
  }

  private async retentionInTx(tx: IDBTransaction): Promise<RetentionDays> {
    const rec = await req(tx.objectStore("settings").get("retentionDays") as IDBRequest<SettingRecord | undefined>);
    const parsed = RetentionDaysSchema.safeParse(rec?.value);
    return rec && parsed.success ? parsed.data : DEFAULT_RETENTION_DAYS;
  }

  private async patch(tx: IDBTransaction, taskId: string, fn: (t: TaskRecord) => TaskRecord): Promise<TaskRecord> {
    const next = { ...fn(await this.requireTask(tx, taskId)), updatedAt: this.now() };
    await req(tx.objectStore("tasks").put(next));
    return next;
  }

  private async supersedeApprovals(tx: IDBTransaction, taskId: string): Promise<void> {
    const store = tx.objectStore("approvals");
    for (const a of await req(store.index("taskId").getAll(taskId) as IDBRequest<ApprovalRecord[]>)) {
      if (a.supersededAt === null) await req(store.put({ ...a, supersededAt: this.now() }));
    }
  }

  private async event(tx: IDBTransaction, taskId: string, type: string, data: Record<string, unknown>): Promise<void> {
    const e: EventRecord = { taskId, at: this.now(), type, data };
    await req(tx.objectStore("events").add(e));
  }

  private async requireTask(tx: IDBTransaction, id: string): Promise<TaskRecord> {
    const t = await req(tx.objectStore("tasks").get(id) as IDBRequest<TaskRecord | undefined>);
    if (!t) throw new TaskError("unknown_task", "This task no longer exists.");
    return t;
  }
}

function decisionMessage(reason: DecisionRejection): string {
  switch (reason) {
    case "task_not_awaiting_approval":
      return "This task isn't waiting for approval.";
    case "no_plan":
      return "There's no plan to decide on.";
    case "stale_plan_version":
    case "plan_hash_mismatch":
      return "The plan changed since this page loaded. Review the current plan before deciding.";
  }
}
