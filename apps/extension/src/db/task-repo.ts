import {
  PlanDecisionSchema,
  RecordedPlanInputSchema,
  TaskCreateSchema,
  type BlockReason,
  type PlanDecision,
  type RecordedPlanInput,
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
import { DB_NAME, DB_VERSION, upgrade, type EventRecord, type SnapshotRecord, type TaskRecord } from "./schema.ts";

export class TaskError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
  }
}

// Statuses in which a recorded approval still counts.
const APPROVAL_LIVE: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress", "Completed"]);

const ALL = ["tasks", "snapshots", "plans", "approvals", "events"];

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
        sources: t.messages.map((m) => ({ messageId: m.messageId, subject: m.subject, from: m.from, date: m.date })),
        idempotencyKey: t.idempotencyKey,
        origin: "local",
        createdAt: now,
        updatedAt: now,
        lastRefreshAt: null,
        handoff: { preparedAt: null, openedAt: null, destination: null },
      };
      await req(tx.objectStore("tasks").add(task));
      const snap: SnapshotRecord = { taskId: task.id, messages: t.messages.map((m) => ({ messageId: m.messageId, bodyText: m.bodyText })), retainedUntil: null };
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
    await this.event(tx, taskId, "task.transition", { from: task.status, to, cause, ...(blockReason ? { blockReason } : {}), ...data });
    return this.patch(tx, taskId, (t) => ({ ...t, status: to, blockReason: to === "Blocked" ? (blockReason ?? "blocked_by_user") : null }));
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
