import { randomUUID } from "node:crypto";
import {
  PlanContentSchema,
  TaskStatusSchema,
  type BlockReason,
  type HandoffCreate,
  type PlanContent,
  type PlanDecision,
  type Priority,
  type TaskStatus,
} from "@inbox-handoff/protocol";
import {
  assertTransition,
  authorizeExecution,
  issueNonce,
  planHash,
  verifyDecision,
  type ApprovalRecord,
  type DecisionRejection,
  type ExecutionRejection,
  type NonceRecord,
  type PlanRecord,
  type TransitionCause,
  type Verdict,
} from "@inbox-handoff/task-core";
import { openDatabase, transaction, type Db } from "./db.ts";
import { migrate } from "./migrations.ts";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  blockReason: BlockReason | null;
  priority: Priority;
  dueAt: string | null;
  projectId: string;
  instructions: string;
  origin: "local" | "imported";
  createdAt: number;
  updatedAt: number;
}

export interface ProjectPath {
  path: string;
  pathHash: string;
  status: "ok" | "needs_configuration" | "missing";
}

export class DecisionRejectedError extends Error {
  readonly reason: DecisionRejection;
  constructor(reason: DecisionRejection) {
    super(`Plan decision rejected: ${reason}`);
    this.name = "DecisionRejectedError";
    this.reason = reason;
  }
}

type Row = Record<string, unknown>;

// Statuses in which a recorded approval may still authorize execution.
const APPROVAL_LIVE_STATES: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress"]);

export class TaskStore {
  readonly db: Db;
  readonly installId: string;
  private readonly now: () => number;

  private constructor(db: Db, now: () => number) {
    this.db = db;
    this.now = now;
    migrate(db);
    const row = db.prepare("SELECT id FROM install LIMIT 1").get() as { id: string } | undefined;
    if (row) {
      this.installId = row.id;
    } else {
      this.installId = randomUUID();
      db.prepare("INSERT INTO install (id, created_at) VALUES (?, ?)").run(this.installId, now());
    }
  }

  static open(path: string, opts: { now?: () => number } = {}): TaskStore {
    return new TaskStore(openDatabase(path), opts.now ?? Date.now);
  }

  close(): void {
    this.db.close();
  }

  // ---- projects -----------------------------------------------------------

  upsertProject(p: { id: string; displayName: string }): void {
    this.db
      .prepare("INSERT INTO projects (id, display_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name")
      .run(p.id, p.displayName);
  }

  // pathHash must be computed by the caller from the *resolved real path* so
  // that pointing the project somewhere else invalidates existing approvals.
  setProjectPath(projectId: string, path: string, pathHash: string): void {
    this.db
      .prepare(
        `INSERT INTO project_paths (project_id, install_id, path, path_hash, status) VALUES (?, ?, ?, ?, 'ok')
         ON CONFLICT(project_id, install_id) DO UPDATE SET path = excluded.path, path_hash = excluded.path_hash, status = 'ok'`,
      )
      .run(projectId, this.installId, path, pathHash);
  }

  getProjectPath(projectId: string): ProjectPath | null {
    const row = this.db
      .prepare("SELECT path, path_hash, status FROM project_paths WHERE project_id = ? AND install_id = ?")
      .get(projectId, this.installId) as Row | undefined;
    return row ? { path: String(row.path), pathHash: String(row.path_hash), status: row.status as ProjectPath["status"] } : null;
  }

  // ---- tasks --------------------------------------------------------------

  createTaskFromHandoff(h: HandoffCreate): { task: Task; created: boolean } {
    return transaction(this.db, () => {
      const existing = this.db.prepare("SELECT id FROM tasks WHERE idempotency_key = ?").get(h.idempotencyKey) as { id: string } | undefined;
      if (existing) return { task: this.requireTask(existing.id), created: false };
      if (!this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(h.projectId)) throw new Error(`Unknown project ${h.projectId}`);

      const id = randomUUID();
      const t = this.now();
      this.db
        .prepare(
          `INSERT INTO tasks (id, title, status, priority, due_at, project_id, instructions, idempotency_key, origin, created_at, updated_at)
           VALUES (?, ?, 'Captured', ?, ?, ?, ?, ?, 'local', ?, ?)`,
        )
        .run(id, h.title, h.priority, h.dueAt, h.projectId, h.instructions, h.idempotencyKey, t, t);
      const src = this.db.prepare(
        "INSERT INTO task_sources (task_id, gmail_message_id, gmail_thread_id, thread_url, subject, sender, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const snap = this.db.prepare("INSERT INTO email_snapshots (task_id, gmail_message_id, body_text) VALUES (?, ?, ?)");
      for (const m of h.messages) {
        src.run(id, m.messageId, h.threadId, h.threadUrl, m.subject, m.from, m.date);
        snap.run(id, m.messageId, m.bodyText);
      }
      this.appendEvent(id, "task.captured", { scope: h.scope, messageCount: h.messages.length });
      return { task: this.requireTask(id), created: true };
    });
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return row ? toTask(row) : null;
  }

  getEmailMessages(taskId: string): { messageId: string; subject: string; from: string; date: string; bodyText: string }[] {
    const rows = this.db
      .prepare(
        `SELECT s.gmail_message_id, s.subject, s.sender, s.sent_at, e.body_text
         FROM task_sources s LEFT JOIN email_snapshots e USING (task_id, gmail_message_id)
         WHERE s.task_id = ? ORDER BY s.rowid`,
      )
      .all(taskId) as Row[];
    return rows.map((r) => ({
      messageId: String(r.gmail_message_id),
      subject: String(r.subject),
      from: String(r.sender),
      date: String(r.sent_at),
      bodyText: r.body_text == null ? "" : String(r.body_text),
    }));
  }

  transition(taskId: string, to: TaskStatus, cause: TransitionCause, data: Record<string, unknown> = {}, blockReason?: BlockReason): Task {
    return transaction(this.db, () => this.transitionInTx(taskId, to, cause, data, blockReason));
  }

  // ---- plans and approvals -------------------------------------------------

  addPlan(taskId: string, content: PlanContent): PlanRecord {
    const parsed = PlanContentSchema.parse(content);
    return transaction(this.db, () => {
      const task = this.requireTask(taskId);
      if (task.status !== "Planning") throw new Error(`Plans can only be added while Planning (task is ${task.status})`);
      const prev = this.db.prepare("SELECT MAX(version) AS v FROM plans WHERE task_id = ?").get(taskId) as { v: number | null };
      const version = (prev.v ?? 0) + 1;
      const hash = planHash({ taskId, projectId: task.projectId, version, content: parsed });
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO plans (id, task_id, version, hash, content_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, taskId, version, hash, JSON.stringify(parsed), this.now());
      this.supersedeApprovals(taskId);
      this.appendEvent(taskId, "plan.created", { version, hash });
      return { id, taskId, projectId: task.projectId, version, hash, content: parsed };
    });
  }

  getLatestPlan(taskId: string): PlanRecord | null {
    const row = this.db
      .prepare("SELECT p.*, t.project_id FROM plans p JOIN tasks t ON t.id = p.task_id WHERE p.task_id = ? ORDER BY version DESC LIMIT 1")
      .get(taskId) as Row | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      projectId: String(row.project_id),
      version: Number(row.version),
      hash: String(row.hash),
      // Re-validate on read: stored rows are not trusted blindly.
      content: PlanContentSchema.parse(JSON.parse(String(row.content_json))),
    };
  }

  // Called when the approval screen is shown. Each nonce authorizes at most one
  // decision on exactly one plan version.
  issueApprovalNonce(taskId: string): { nonce: string; planVersion: number; planHash: string } {
    return transaction(this.db, () => {
      const task = this.requireTask(taskId);
      if (task.status !== "AwaitingApproval") throw new Error(`Task is ${task.status}, not AwaitingApproval`);
      const plan = this.getLatestPlan(taskId);
      if (!plan) throw new Error("Task has no plan");
      const nonce = issueNonce();
      this.db
        .prepare("INSERT INTO approval_nonces (nonce, task_id, plan_version, plan_hash, issued_at) VALUES (?, ?, ?, ?, ?)")
        .run(nonce, taskId, plan.version, plan.hash, this.now());
      return { nonce, planVersion: plan.version, planHash: plan.hash };
    });
  }

  decide(decision: PlanDecision): Task {
    return transaction(this.db, () => {
      const task = this.requireTask(decision.taskId);
      const plan = this.getLatestPlan(decision.taskId);
      const nonce = this.getNonce(decision.nonce);
      const now = this.now();
      const verdict = verifyDecision({ decision, taskStatus: task.status, latestPlan: plan, nonce, now });
      if (!verdict.ok) {
        this.appendEvent(task.id, "approval.rejected_request", { reason: verdict.reason });
        throw new DecisionRejectedError(verdict.reason);
      }
      const projectPath = this.getProjectPath(task.projectId);
      if (decision.decision === "approve" && projectPath?.status !== "ok") throw new Error("Project path is not configured on this machine");

      this.db.prepare("UPDATE approval_nonces SET consumed_at = ? WHERE nonce = ?").run(now, decision.nonce);
      this.db
        .prepare(
          `INSERT INTO approvals (id, task_id, plan_id, plan_hash, project_id, project_path_hash, install_id, decision, comment, origin, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?)`,
        )
        .run(
          randomUUID(),
          task.id,
          plan!.id,
          plan!.hash,
          task.projectId,
          projectPath?.pathHash ?? "",
          this.installId,
          decision.decision,
          decision.comment ?? null,
          now,
        );
      const to: TaskStatus = decision.decision === "approve" ? "Approved" : decision.decision === "reject" ? "Rejected" : "ReadyForPlanning";
      return this.transitionInTx(task.id, to, "user_approval", { decision: decision.decision, planVersion: plan!.version, planHash: plan!.hash });
    });
  }

  // Audit-only: approvals restored from a backup. The executor never honours
  // these (authorizeExecution rejects origin 'imported').
  insertImportedApproval(a: Omit<ApprovalRecord, "origin" | "supersededAt"> & { decision: PlanDecision["decision"] }): void {
    this.db
      .prepare(
        `INSERT INTO approvals (id, task_id, plan_id, plan_hash, project_id, project_path_hash, install_id, decision, origin, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?)`,
      )
      .run(randomUUID(), a.taskId, a.planId, a.planHash, a.projectId, a.projectPathHash, a.installId, a.decision, a.decidedAt);
  }

  // ---- execution ------------------------------------------------------------

  startImplementation(taskId: string): Task {
    return transaction(this.db, () => {
      const task = this.transitionInTx(taskId, "InProgress", "executor");
      const verdict = this.authorizeInTx(taskId);
      if (!verdict.ok) throw new Error(`Implementation not authorized: ${verdict.reason}`); // rolls back the transition
      return task;
    });
  }

  // The single question the PreToolUse hook asks before every tool call.
  authorizeImplementation(taskId: string): Verdict<ExecutionRejection | "unknown_task"> {
    return this.authorizeInTx(taskId);
  }

  getEvents(taskId: string): { type: string; data: Record<string, unknown>; at: number }[] {
    return (this.db.prepare("SELECT type, data_json, at FROM task_events WHERE task_id = ? ORDER BY seq").all(taskId) as Row[]).map((r) => ({
      type: String(r.type),
      data: JSON.parse(String(r.data_json)) as Record<string, unknown>,
      at: Number(r.at),
    }));
  }

  appendEvent(taskId: string, type: string, data: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO task_events (task_id, at, type, data_json) VALUES (?, ?, ?, ?)").run(taskId, this.now(), type, JSON.stringify(data));
  }

  // ---- internals --------------------------------------------------------------

  private authorizeInTx(taskId: string): Verdict<ExecutionRejection | "unknown_task"> {
    const task = this.getTask(taskId);
    if (!task) return { ok: false, reason: "unknown_task" };
    return authorizeExecution({
      taskId,
      taskStatus: task.status,
      projectId: task.projectId,
      currentProjectPathHash: this.getProjectPath(task.projectId)?.pathHash ?? "",
      installId: this.installId,
      latestPlan: this.getLatestPlan(taskId),
      approval: this.getActiveApproval(taskId),
    });
  }

  private transitionInTx(taskId: string, to: TaskStatus, cause: TransitionCause, data: Record<string, unknown> = {}, blockReason?: BlockReason): Task {
    const task = this.requireTask(taskId);
    assertTransition(task.status, to, cause);
    this.db
      .prepare("UPDATE tasks SET status = ?, block_reason = ?, updated_at = ? WHERE id = ?")
      .run(to, to === "Blocked" ? (blockReason ?? null) : null, this.now(), taskId);
    if (!APPROVAL_LIVE_STATES.has(to)) this.supersedeApprovals(taskId);
    if (task.status === "AwaitingApproval") {
      this.db.prepare("UPDATE approval_nonces SET consumed_at = ? WHERE task_id = ? AND consumed_at IS NULL").run(this.now(), taskId);
    }
    this.appendEvent(taskId, "task.transition", { from: task.status, to, cause, ...(blockReason ? { blockReason } : {}), ...data });
    return this.requireTask(taskId);
  }

  private supersedeApprovals(taskId: string): void {
    this.db.prepare("UPDATE approvals SET superseded_at = ? WHERE task_id = ? AND superseded_at IS NULL").run(this.now(), taskId);
  }

  private getActiveApproval(taskId: string): ApprovalRecord | null {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE task_id = ? AND decision = 'approve' ORDER BY decided_at DESC, rowid DESC LIMIT 1")
      .get(taskId) as Row | undefined;
    if (!row) return null;
    return {
      taskId: String(row.task_id),
      planId: String(row.plan_id),
      planHash: String(row.plan_hash),
      projectId: String(row.project_id),
      projectPathHash: String(row.project_path_hash),
      installId: String(row.install_id),
      origin: row.origin as ApprovalRecord["origin"],
      decidedAt: Number(row.decided_at),
      supersededAt: row.superseded_at == null ? null : Number(row.superseded_at),
    };
  }

  private getNonce(nonce: string): NonceRecord | null {
    const row = this.db.prepare("SELECT * FROM approval_nonces WHERE nonce = ?").get(nonce) as Row | undefined;
    if (!row) return null;
    return {
      nonce: String(row.nonce),
      taskId: String(row.task_id),
      planVersion: Number(row.plan_version),
      planHash: String(row.plan_hash),
      issuedAt: Number(row.issued_at),
      consumedAt: row.consumed_at == null ? null : Number(row.consumed_at),
    };
  }

  private requireTask(id: string): Task {
    const t = this.getTask(id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  }
}

function toTask(r: Row): Task {
  return {
    id: String(r.id),
    title: String(r.title),
    status: TaskStatusSchema.parse(r.status),
    blockReason: (r.block_reason as BlockReason | null) ?? null,
    priority: r.priority as Priority,
    dueAt: r.due_at == null ? null : String(r.due_at),
    projectId: String(r.project_id),
    instructions: String(r.instructions),
    origin: r.origin as Task["origin"],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}
