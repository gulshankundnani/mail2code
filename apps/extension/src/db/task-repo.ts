import {
  APPROVAL_REQUEST_FORMAT,
  APPROVAL_REQUEST_TTL_MS,
  APPROVAL_RESPONSE_FORMAT,
  ApproverCardSchema,
  ApprovalResponseSchema,
  PROGRESS_UPDATE_FORMAT,
  ProgressUpdateSchema,
  CLOSED_STATUSES,
  DEFAULT_RETENTION_DAYS,
  EmailAddressSchema,
  MAX_APPROVER_NAME_CHARS,
  PlanDecisionSchema,
  RecordedPlanInputSchema,
  RetentionDaysSchema,
  TaskCreateSchema,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalResponsePayload,
  type ApproverCard,
  type BlockReason,
  type ProgressUpdate,
  type CapturedConversation,
  type PlanDecision,
  type RecordedPlanInput,
  type RetentionDays,
  type TaskCreate,
  type TaskStatus,
} from "@mail2code/protocol";
import {
  assertTransition,
  checkApprovalResponse,
  checkProgressUpdate,
  createApproverIdentity,
  createSigningKey,
  fingerprintOf,
  hasCurrentApproval,
  planHash,
  responseRejectionText,
  signResponsePayload,
  signUpdatePayload,
  updateRejectionText,
  verifyDecision,
  verifyPlanIntegrity,
  type ApprovalRecord,
  type CurrentApprovalRejection,
  type DecisionRejection,
  type GivenApproval,
  type PendingRequest,
  type PlanRecord,
  type TransitionCause,
  type TrustedApprover,
  type Verdict,
} from "@mail2code/task-core";
import { inTx, openDb, req } from "./idb.ts";
import {
  DB_NAME,
  DB_VERSION,
  upgrade,
  type EventRecord,
  type IdentityRecord,
  type RequesterKeyRecord,
  type SettingRecord,
  type SnapshotRecord,
  type TaskRecord,
} from "./schema.ts";

export class TaskError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LIMITS_NOTE = 5_000;

// Statuses in which a recorded approval still counts.
const APPROVAL_LIVE: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress", "Completed"]);
// Statuses where new context invalidates the go-ahead and needs a fresh review.
const CONTEXT_SENSITIVE: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress"]);
// No context refresh into finished tasks: start a new task instead.
const REFRESH_CLOSED: ReadonlySet<TaskStatus> = new Set(["Completed", "Cancelled"]);

const ALL = ["tasks", "snapshots", "plans", "approvals", "events", "settings", "approvers", "approvalRequests"];

// What pages may see of this browser's approver identity (never the key).
export type PublicIdentity = Omit<IdentityRecord, "privateKey" | "id">;

export interface RefreshResult {
  added: string[];
  blocked: boolean;
}

export interface DatabaseDump {
  tasks: TaskRecord[];
  snapshots: SnapshotRecord[];
  plans: PlanRecord[];
  approvals: ApprovalRecord[];
  events: EventRecord[];
  retentionDays: RetentionDays;
  approvers: TrustedApprover[];
}

export interface ImportOperation {
  replaceAll: boolean;
  deleteTaskIds: string[];
  tasks: TaskRecord[];
  snapshots: SnapshotRecord[];
  plans: PlanRecord[];
  approvals: ApprovalRecord[];
  events: EventRecord[];
  // undefined = leave the setting unchanged
  retentionDays?: RetentionDays;
  // Approvers from the backup that aren't in this browser yet. They arrive
  // unconfirmed: a crafted backup must not be able to add a trusted key.
  approvers?: TrustedApprover[];
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

  // The optional Anthropic API key. Stored in this origin's IndexedDB, which
  // the Gmail content script can't access. Not included in exports.
  async getApiKey(): Promise<string | null> {
    return inTx(this.db, ["settings"], "readonly", async (tx) => {
      const rec = await req(tx.objectStore("settings").get("anthropicApiKey") as IDBRequest<SettingRecord | undefined>);
      return typeof rec?.value === "string" && rec.value ? rec.value : null;
    });
  }

  async setApiKey(key: string | null): Promise<void> {
    const value = key?.trim() ?? "";
    if (value && !/^[\x21-\x7e]{20,300}$/.test(value)) throw new TaskError("invalid_api_key", "That doesn't look like an API key.");
    await inTx(this.db, ["settings"], "readwrite", async (tx) => {
      if (value) await req(tx.objectStore("settings").put({ key: "anthropicApiKey", value } satisfies SettingRecord));
      else await req(tx.objectStore("settings").delete("anthropicApiKey"));
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
      for (const store of ["plans", "approvals", "events", "approvalRequests"]) {
        const keys = await req(tx.objectStore(store).index("taskId").getAllKeys(taskId));
        for (const k of keys) await req(tx.objectStore(store).delete(k));
      }
    });
  }

  // ---- backup ------------------------------------------------------------------

  async dump(): Promise<DatabaseDump> {
    return inTx(this.db, ALL, "readonly", async (tx) => ({
      tasks: await req(tx.objectStore("tasks").getAll() as IDBRequest<TaskRecord[]>),
      snapshots: await req(tx.objectStore("snapshots").getAll() as IDBRequest<SnapshotRecord[]>),
      plans: await req(tx.objectStore("plans").getAll() as IDBRequest<PlanRecord[]>),
      approvals: await req(tx.objectStore("approvals").getAll() as IDBRequest<ApprovalRecord[]>),
      events: await req(tx.objectStore("events").getAll() as IDBRequest<EventRecord[]>),
      retentionDays: await this.retentionInTx(tx),
      approvers: await req(tx.objectStore("approvers").getAll() as IDBRequest<TrustedApprover[]>),
    }));
  }

  // Applies a prepared import in ONE transaction: if anything fails (for
  // example a duplicate key), nothing is changed and the existing data stays.
  async applyImport(op: ImportOperation): Promise<void> {
    await inTx(this.db, ALL, "readwrite", async (tx) => {
      if (op.replaceAll) {
        for (const store of ["tasks", "snapshots", "plans", "approvals", "events", "approvalRequests"]) await req(tx.objectStore(store).clear());
      }
      for (const id of op.deleteTaskIds) {
        await req(tx.objectStore("tasks").delete(id));
        await req(tx.objectStore("snapshots").delete(id));
        for (const store of ["plans", "approvals", "events", "approvalRequests"]) {
          for (const k of await req(tx.objectStore(store).index("taskId").getAllKeys(id))) await req(tx.objectStore(store).delete(k));
        }
      }
      for (const t of op.tasks) await req(tx.objectStore("tasks").add(t));
      for (const s of op.snapshots) await req(tx.objectStore("snapshots").add(s));
      for (const p of op.plans) await req(tx.objectStore("plans").add(p));
      for (const a of op.approvals) await req(tx.objectStore("approvals").add(a));
      for (const e of op.events) await req(tx.objectStore("events").add(e));
      const approvers = tx.objectStore("approvers");
      for (const a of op.approvers ?? []) {
        if (!(await req(approvers.get(a.fingerprint)))) await req(approvers.add({ ...a, confirmedAt: null, source: "backup" } satisfies TrustedApprover));
      }
      if (op.retentionDays !== undefined) {
        const rec: SettingRecord = { key: "retentionDays", value: RetentionDaysSchema.parse(op.retentionDays) };
        await req(tx.objectStore("settings").put(rec));
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
      // With a required approver, the user can still stop a plan, but only
      // that person's signed approval can approve it.
      if (decision.decision === "approve" && task.requiredApprover) {
        const who = await req(tx.objectStore("approvers").get(task.requiredApprover) as IDBRequest<TrustedApprover | undefined>);
        throw new TaskError("approver_required", `This task needs ${who?.name ?? "another person"}'s signed approval. Ask them to approve instead.`);
      }
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
  // Only allowed with a current approval of the latest plan made in this
  // browser: the user's own, or a verified signed one (the required
  // approver's, when the task names one).
  async reportStarted(taskId: string): Promise<TaskRecord> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      const plans = await req(tx.objectStore("plans").index("taskId").getAll(taskId) as IDBRequest<PlanRecord[]>);
      const latestPlan = plans.sort((a, b) => a.version - b.version).at(-1) ?? null;
      const approvals = await req(tx.objectStore("approvals").index("taskId").getAll(taskId) as IDBRequest<ApprovalRecord[]>);
      // Prefer approvals recorded in this browser: imported ones carry another
      // computer's clock, so "most recent by time" across both is meaningless.
      // Imported approvals are only considered to report why they don't count.
      const byTime = (a: ApprovalRecord, b: ApprovalRecord) => a.decidedAt - b.decidedAt;
      const required = task.requiredApprover ?? null;
      const approves = approvals.filter((a) => a.decision === "approve");
      const here = approves.filter((a) => a.origin !== "imported" && (!required || a.signedBy?.fingerprint === required));
      const approval = here.sort(byTime).at(-1) ?? approves.sort(byTime).at(-1) ?? null;
      const verdict: Verdict<CurrentApprovalRejection> = hasCurrentApproval({ latestPlan, approval, requiredApprover: required });
      if (!verdict.ok) {
        throw new TaskError(
          verdict.reason,
          required ? "Implementation can only be marked as started after the required approver approves the current plan." : "Implementation can only be marked as started after the current plan is approved.",
        );
      }
      return this.transitionInTx(tx, taskId, "InProgress", "user_action");
    });
  }

  // ---- approval by another person -------------------------------------------------

  async getIdentity(): Promise<PublicIdentity | null> {
    const rec = await inTx(this.db, ["identity"], "readonly", (tx) => req(tx.objectStore("identity").get("self") as IDBRequest<IdentityRecord | undefined>));
    if (!rec) return null;
    const { privateKey: _key, id: _id, ...pub } = rec;
    return pub;
  }

  async createIdentity(name: string, email: string): Promise<PublicIdentity> {
    const n = name.trim();
    if (!n || n.length > MAX_APPROVER_NAME_CHARS) throw new TaskError("invalid_name", `Enter your name (up to ${MAX_APPROVER_NAME_CHARS} characters).`);
    const e = EmailAddressSchema.safeParse(email);
    if (!e.success) throw new TaskError("invalid_email", "Enter a valid email address.");
    if (await this.getIdentity()) throw new TaskError("identity_exists", "This browser already has an approver identity.");
    // Key generation awaits crypto, so it happens before the write transaction.
    const id = await createApproverIdentity(n, e.data, this.now());
    if (await this.getApprover(id.fingerprint)) throw new TaskError("identity_exists", "That key is already a trusted approver here.");
    await inTx(this.db, ["identity"], "readwrite", async (tx) => {
      await req(tx.objectStore("identity").add({ id: "self", ...id } satisfies IdentityRecord));
    });
    const { privateKey: _key, ...pub } = id;
    return pub;
  }

  // Deleting the identity destroys the private key for good: approvals
  // already sent stay valid, but this browser can't sign as that person again.
  async deleteIdentity(): Promise<void> {
    await inTx(this.db, ["identity"], "readwrite", async (tx) => void (await req(tx.objectStore("identity").delete("self"))));
  }

  // The card the approver sends to people who will ask them for approvals.
  async approverCard(): Promise<ApproverCard> {
    const id = await this.getIdentity();
    if (!id) throw new TaskError("no_identity", "Create your approver identity first.");
    return { format: "mail2code-approver-card", version: 1, name: id.name, email: id.email, publicKey: id.publicKey, fingerprint: id.fingerprint };
  }

  // Signs a decision on an approval request addressed to this browser's identity.
  async signDecision(payload: Omit<ApprovalResponsePayload, "approverFingerprint" | "decidedAt">): Promise<ApprovalResponse> {
    const rec = await inTx(this.db, ["identity"], "readonly", (tx) => req(tx.objectStore("identity").get("self") as IDBRequest<IdentityRecord | undefined>));
    if (!rec) throw new TaskError("no_identity", "Create your approver identity first.");
    const full: ApprovalResponsePayload = { ...payload, approverFingerprint: rec.fingerprint, decidedAt: new Date(this.now()).toISOString() };
    return { format: APPROVAL_RESPONSE_FORMAT, version: 1, approverName: rec.name, payload: full, signature: await signResponsePayload(rec.privateKey, full) };
  }

  async listApprovers(): Promise<TrustedApprover[]> {
    const all = await inTx(this.db, ["approvers"], "readonly", (tx) => req(tx.objectStore("approvers").getAll() as IDBRequest<TrustedApprover[]>));
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getApprover(fingerprint: string): Promise<TrustedApprover | null> {
    return inTx(this.db, ["approvers"], "readonly", async (tx) => (await req(tx.objectStore("approvers").get(fingerprint) as IDBRequest<TrustedApprover | undefined>)) ?? null);
  }

  // Adds a trusted approver from their card. The caller must have the user
  // confirm the fingerprint with that person first (`confirmed`).
  async addApprover(card: ApproverCard, confirmed: boolean): Promise<TrustedApprover> {
    const c = ApproverCardSchema.parse(card);
    if (!confirmed) throw new TaskError("not_confirmed", "Check the fingerprint with this person, then tick the box to confirm.");
    if ((await fingerprintOf(c.publicKey)) !== c.fingerprint) throw new TaskError("bad_card", "This approver card is damaged: its fingerprint doesn't match its key.");
    if ((await this.getIdentity())?.fingerprint === c.fingerprint) throw new TaskError("own_identity", "That's your own approver card. Add other people's cards here.");
    return inTx(this.db, ["approvers"], "readwrite", async (tx) => {
      const store = tx.objectStore("approvers");
      const existing = await req(store.get(c.fingerprint) as IDBRequest<TrustedApprover | undefined>);
      const now = this.now();
      const rec: TrustedApprover = { fingerprint: c.fingerprint, name: c.name, email: c.email, publicKey: c.publicKey, addedAt: existing?.addedAt ?? now, confirmedAt: now, source: "card" };
      await req(store.put(rec));
      return rec;
    });
  }

  async confirmApprover(fingerprint: string): Promise<void> {
    await inTx(this.db, ["approvers"], "readwrite", async (tx) => {
      const store = tx.objectStore("approvers");
      const a = await req(store.get(fingerprint) as IDBRequest<TrustedApprover | undefined>);
      if (!a) throw new TaskError("unknown_approver", "This approver isn't in your list any more.");
      await req(store.put({ ...a, confirmedAt: this.now() }));
    });
  }

  async removeApprover(fingerprint: string): Promise<void> {
    await inTx(this.db, ["approvers", "tasks"], "readwrite", async (tx) => {
      for (const t of await req(tx.objectStore("tasks").getAll() as IDBRequest<TaskRecord[]>)) {
        if (t.requiredApprover === fingerprint) throw new TaskError("approver_in_use", `"${t.title}" requires this approver. Change that task first.`);
      }
      await req(tx.objectStore("approvers").delete(fingerprint));
    });
  }

  // null = anyone (including the user) may approve this task's plans.
  async setRequiredApprover(taskId: string, fingerprint: string | null): Promise<TaskRecord> {
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      let name: string | null = null;
      if (fingerprint) {
        const a = await req(tx.objectStore("approvers").get(fingerprint) as IDBRequest<TrustedApprover | undefined>);
        if (!a || a.confirmedAt === null) throw new TaskError("unknown_approver", "Choose a confirmed trusted approver.");
        name = a.name;
      }
      if ((task.requiredApprover ?? null) === fingerprint) return task;
      await this.event(tx, taskId, "approval.requirement", { approver: name });
      return this.patch(tx, taskId, (t) => ({ ...t, requiredApprover: fingerprint }));
    });
  }

  async getApprovalRequests(taskId: string): Promise<PendingRequest[]> {
    const list = await inTx(this.db, ["approvalRequests"], "readonly", (tx) => req(tx.objectStore("approvalRequests").index("taskId").getAll(taskId) as IDBRequest<PendingRequest[]>));
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  // Creates a request for the current plan, addressed to one trusted approver.
  // It carries only the task title and the plan (no email text).
  async createApprovalRequest(taskId: string, approverFingerprint: string, requesterName: string): Promise<ApprovalRequest> {
    const latest = await this.getLatestPlan(taskId);
    if (latest && !(await verifyPlanIntegrity(latest))) throw new TaskError("plan_tampered", "The stored plan doesn't match its fingerprint. Record the plan again.");
    const requesterKey = (await this.requesterKey()).publicKey;
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      if (task.status !== "AwaitingApproval" || !latest) throw new TaskError("task_not_awaiting_approval", "Record a plan first; only a plan waiting for approval can be sent.");
      const approver = await req(tx.objectStore("approvers").get(approverFingerprint) as IDBRequest<TrustedApprover | undefined>);
      if (!approver) throw new TaskError("unknown_approver", "Choose one of your trusted approvers.");
      if (approver.confirmedAt === null) throw new TaskError("approver_unconfirmed", `Confirm ${approver.name}'s fingerprint in Settings → Approvers first.`);
      const now = this.now();
      const pending: PendingRequest = {
        requestId: crypto.randomUUID(),
        taskId,
        planId: latest.id,
        planVersion: latest.version,
        planHash: latest.hash,
        approverFingerprint,
        createdAt: now,
        expiresAt: now + APPROVAL_REQUEST_TTL_MS,
        usedAt: null,
      };
      await req(tx.objectStore("approvalRequests").add(pending));
      await this.event(tx, taskId, "approval.requested", { approver: approver.name, planVersion: latest.version });
      return {
        format: APPROVAL_REQUEST_FORMAT,
        version: 1,
        requestId: pending.requestId,
        approverFingerprint,
        requesterName: requesterName.trim().slice(0, MAX_APPROVER_NAME_CHARS),
        requesterKey,
        task: { id: taskId, title: task.title },
        plan: { version: latest.version, hash: latest.hash, text: latest.text },
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(pending.expiresAt).toISOString(),
      };
    });
  }

  // Checks a signed response and, only if every check passes, records the
  // decision. The approver is looked up in this browser's trusted list by
  // fingerprint; any key or name inside the response is ignored.
  async importApprovalResponse(raw: ApprovalResponse): Promise<{ task: TaskRecord; decision: ApprovalResponsePayload["decision"]; approverName: string }> {
    const response = ApprovalResponseSchema.parse(raw);
    const p = response.payload;
    const load = async () =>
      inTx(this.db, ["tasks", "plans", "identity", "approvers", "approvalRequests"], "readonly", async (tx) => {
        const request = (await req(tx.objectStore("approvalRequests").get(p.requestId) as IDBRequest<PendingRequest | undefined>)) ?? null;
        const approver = (await req(tx.objectStore("approvers").get(p.approverFingerprint) as IDBRequest<TrustedApprover | undefined>)) ?? null;
        const own = (await req(tx.objectStore("identity").get("self") as IDBRequest<IdentityRecord | undefined>)) ?? null;
        const task = request ? ((await req(tx.objectStore("tasks").get(request.taskId) as IDBRequest<TaskRecord | undefined>)) ?? null) : null;
        const plans = request ? await req(tx.objectStore("plans").index("taskId").getAll(request.taskId) as IDBRequest<PlanRecord[]>) : [];
        return { request, approver, own, task, latestPlan: plans.sort((a, b) => a.version - b.version).at(-1) ?? null };
      });
    const s = await load();
    const verdict = await checkApprovalResponse({
      response,
      request: s.request,
      approver: s.approver,
      ownFingerprint: s.own?.fingerprint ?? null,
      taskStatus: s.task?.status ?? null,
      latestPlan: s.latestPlan,
      now: this.now(),
    });
    if (!verdict.ok) throw new TaskError(verdict.reason, responseRejectionText(verdict.reason, s.approver?.name));
    const approver = s.approver!;
    const request = s.request!;
    return inTx(this.db, ALL, "readwrite", async (tx) => {
      // Re-check what may have changed since the signature check (another tab).
      const fresh = await req(tx.objectStore("approvalRequests").get(request.requestId) as IDBRequest<PendingRequest | undefined>);
      if (!fresh || fresh.usedAt !== null) throw new TaskError("request_used", responseRejectionText("request_used"));
      const task = await this.requireTask(tx, request.taskId);
      const plans = await req(tx.objectStore("plans").index("taskId").getAll(request.taskId) as IDBRequest<PlanRecord[]>);
      const current = plans.sort((a, b) => a.version - b.version).at(-1);
      if (!current || current.id !== request.planId) throw new TaskError("stale_plan", responseRejectionText("stale_plan"));
      if (task.status !== "AwaitingApproval") throw new TaskError("task_not_awaiting_approval", responseRejectionText("task_not_awaiting_approval"));
      await req(tx.objectStore("approvalRequests").put({ ...fresh, usedAt: this.now() }));
      const record: ApprovalRecord = {
        id: crypto.randomUUID(),
        taskId: task.id,
        planId: current.id,
        planVersion: current.version,
        planHash: current.hash,
        decision: p.decision,
        comment: p.comment,
        origin: "signed",
        signedBy: { fingerprint: approver.fingerprint, name: approver.name },
        requestId: request.requestId,
        decidedAt: this.now(),
        supersededAt: null,
      };
      await req(tx.objectStore("approvals").add(record));
      await this.event(tx, task.id, "approval.signed", { approver: approver.name, fingerprint: approver.fingerprint, decision: p.decision, planVersion: current.version, signedAt: p.decidedAt });
      const to: TaskStatus = p.decision === "approve" ? "Approved" : p.decision === "reject" ? "Rejected" : "Planning";
      const updated = await this.transitionInTx(tx, task.id, to, "user_approval", { decision: p.decision, planVersion: current.version, planHash: current.hash, signedBy: approver.name });
      return { task: updated, decision: p.decision, approverName: approver.name };
    });
  }

  // ---- progress updates for approvers ------------------------------------------------

  // The key that signs this browser's progress updates, created on first use.
  async requesterKey(): Promise<{ publicKey: string; fingerprint: string }> {
    const get = () => inTx(this.db, ["requesterKey"], "readonly", (tx) => req(tx.objectStore("requesterKey").get("self") as IDBRequest<RequesterKeyRecord | undefined>));
    const existing = await get();
    if (existing) return { publicKey: existing.publicKey, fingerprint: existing.fingerprint };
    const key = await createSigningKey();
    await inTx(this.db, ["requesterKey"], "readwrite", async (tx) => {
      // Another tab may have created one meanwhile; keep the first.
      if (!(await req(tx.objectStore("requesterKey").get("self")))) await req(tx.objectStore("requesterKey").add({ id: "self", ...key, createdAt: this.now() } satisfies RequesterKeyRecord));
    });
    const rec = (await get())!;
    return { publicKey: rec.publicKey, fingerprint: rec.fingerprint };
  }

  // Who should hear about this task's progress: the approver of its most
  // recent signed approval, if that approver is still trusted here.
  async progressRecipient(taskId: string): Promise<{ approver: TrustedApprover; requestId: string } | null> {
    return inTx(this.db, ["approvals", "approvers", "approvalRequests"], "readonly", async (tx) => {
      const approvals = await req(tx.objectStore("approvals").index("taskId").getAll(taskId) as IDBRequest<ApprovalRecord[]>);
      const latest = approvals
        .filter((a) => a.origin === "signed" && a.decision === "approve" && a.requestId && a.signedBy)
        .sort((a, b) => a.decidedAt - b.decidedAt)
        .at(-1);
      if (!latest) return null;
      const approver = await req(tx.objectStore("approvers").get(latest.signedBy!.fingerprint) as IDBRequest<TrustedApprover | undefined>);
      const request = await req(tx.objectStore("approvalRequests").get(latest.requestId!) as IDBRequest<PendingRequest | undefined>);
      return approver && request ? { approver, requestId: request.requestId } : null;
    });
  }

  // A signed update with the task's current status and an optional note.
  async createProgressUpdate(taskId: string, note: string, requesterName: string): Promise<{ update: ProgressUpdate; approver: TrustedApprover }> {
    const target = await this.progressRecipient(taskId);
    if (!target) throw new TaskError("no_approver", "Only tasks approved by another person can send progress updates.");
    const keyRec = await inTx(this.db, ["requesterKey"], "readonly", (tx) => req(tx.objectStore("requesterKey").get("self") as IDBRequest<RequesterKeyRecord | undefined>));
    if (!keyRec) throw new TaskError("no_requester_key", "This browser no longer has the key the approver knows. Ask for approval again to send updates.");
    const draft = await inTx(this.db, ALL, "readwrite", async (tx) => {
      const task = await this.requireTask(tx, taskId);
      const store = tx.objectStore("approvalRequests");
      const request = (await req(store.get(target.requestId) as IDBRequest<PendingRequest | undefined>))!;
      const seq = (request.updateSeq ?? 0) + 1;
      await req(store.put({ ...request, updateSeq: seq }));
      const plans = await req(tx.objectStore("plans").index("taskId").getAll(taskId) as IDBRequest<PlanRecord[]>);
      const planVersion = plans.reduce((m, p) => Math.max(m, p.version), request.planVersion);
      const trimmed = note.trim().slice(0, LIMITS_NOTE);
      await this.event(tx, taskId, "progress.sent", { approver: target.approver.name, status: task.status, seq });
      return { task, payload: { requestId: request.requestId, taskId, planVersion, status: task.status, note: trimmed || null, seq, sentAt: new Date(this.now()).toISOString() } };
    });
    const update: ProgressUpdate = {
      format: PROGRESS_UPDATE_FORMAT,
      version: 1,
      requesterName: requesterName.trim().slice(0, MAX_APPROVER_NAME_CHARS),
      taskTitle: draft.task.title,
      payload: draft.payload,
      signature: await signUpdatePayload(keyRec.privateKey, draft.payload),
    };
    return { update, approver: target.approver };
  }

  // The approver's side: remember a plan this browser signed, so later
  // progress updates for it can be checked and shown.
  async recordGivenApproval(request: ApprovalRequest, response: ApprovalResponse, requesterEmail: string): Promise<GivenApproval> {
    const rec: GivenApproval = {
      requestId: request.requestId,
      taskId: request.task.id,
      taskTitle: request.task.title,
      requesterName: request.requesterName,
      requesterEmail,
      requesterKey: request.requesterKey,
      planVersion: request.plan.version,
      planHash: request.plan.hash,
      planText: request.plan.text,
      decision: response.payload.decision,
      comment: response.payload.comment,
      signedAt: this.now(),
      status: null,
      lastSeq: 0,
      updates: [],
    };
    await inTx(this.db, ["givenApprovals"], "readwrite", async (tx) => void (await req(tx.objectStore("givenApprovals").put(rec))));
    return rec;
  }

  async listGivenApprovals(): Promise<GivenApproval[]> {
    const all = await inTx(this.db, ["givenApprovals"], "readonly", (tx) => req(tx.objectStore("givenApprovals").getAll() as IDBRequest<GivenApproval[]>));
    const last = (g: GivenApproval) => g.updates.at(-1)?.receivedAt ?? g.signedAt;
    return all.sort((a, b) => last(b) - last(a));
  }

  async removeGivenApproval(requestId: string): Promise<void> {
    await inTx(this.db, ["givenApprovals"], "readwrite", async (tx) => void (await req(tx.objectStore("givenApprovals").delete(requestId))));
  }

  // Checks a progress update and adds it to the approver's list.
  async applyProgressUpdate(raw: ProgressUpdate): Promise<GivenApproval> {
    const update = ProgressUpdateSchema.parse(raw);
    const get = () =>
      inTx(this.db, ["givenApprovals"], "readonly", async (tx) => (await req(tx.objectStore("givenApprovals").get(update.payload.requestId) as IDBRequest<GivenApproval | undefined>)) ?? null);
    const verdict = await checkProgressUpdate(update, await get());
    if (!verdict.ok) throw new TaskError(verdict.reason, updateRejectionText(verdict.reason));
    return inTx(this.db, ["givenApprovals"], "readwrite", async (tx) => {
      const store = tx.objectStore("givenApprovals");
      const g = (await req(store.get(update.payload.requestId) as IDBRequest<GivenApproval | undefined>))!;
      const p = update.payload;
      if (p.seq <= g.lastSeq) throw new TaskError("old_update", updateRejectionText("old_update"));
      const next: GivenApproval = {
        ...g,
        status: p.status,
        lastSeq: p.seq,
        updates: [...g.updates, { seq: p.seq, status: p.status, note: p.note, planVersion: p.planVersion, sentAt: p.sentAt, receivedAt: this.now() }].slice(-200),
      };
      await req(store.put(next));
      return next;
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
