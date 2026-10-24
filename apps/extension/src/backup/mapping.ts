// Maps between the extension's IndexedDB records and the documented export
// format (packages/backup). Export works from an explicit list of fields, so
// nothing that isn't listed here (drafts, browser storage, anything added to a
// record later) can leak into a backup.
import {
  CURRENT_SCHEMA_VERSION,
  EXPORT_FORMAT,
  dataChecksum,
  type ExportData,
  type ExportFile,
  type ExportTask,
  type ImportSelection,
} from "@inbox-handoff/backup";
import { CLOSED_STATUSES, type TaskStatus } from "@inbox-handoff/protocol";
import type { ApprovalRecord, EventRecord, PlanRecord, SnapshotRecord, TaskRecord } from "../db/schema.ts";
import type { DatabaseDump, ImportOperation } from "../db/task-repo.ts";

export const APP_VERSION = "0.0.0";

const toIso = (ms: number): string => new Date(ms).toISOString();
const toIsoOrNull = (ms: number | null | undefined): string | null => (ms == null ? null : toIso(ms));
const toMs = (iso: string): number => Date.parse(iso);
const toMsOrNull = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));

export interface ExportOptions {
  taskIds?: ReadonlySet<string>; // undefined = all tasks
  includeEmailContent: boolean;
}

export function toExportData(dump: DatabaseDump, opts: ExportOptions): ExportData {
  const tasks = dump.tasks.filter((t) => !opts.taskIds || opts.taskIds.has(t.id)).sort((a, b) => a.createdAt - b.createdAt);
  const ids = new Set(tasks.map((t) => t.id));
  const snapshots = new Map(dump.snapshots.map((s) => [s.taskId, s]));
  return {
    tasks: tasks.map((t): ExportTask => {
      const out: ExportTask = {
        id: t.id,
        title: t.title,
        status: t.status,
        blockReason: t.blockReason,
        priority: t.priority,
        dueAt: t.dueAt,
        repositoryRef: t.repositoryRef,
        instructions: t.instructions,
        scope: t.scope,
        threadId: t.threadId,
        threadUrl: t.threadUrl,
        sources: t.sources.map((s) => ({ messageId: s.messageId, subject: s.subject, from: s.from, date: s.date, addedAt: toIsoOrNull(s.addedAt) })),
        idempotencyKey: t.idempotencyKey,
        createdAt: toIso(t.createdAt),
        updatedAt: toIso(t.updatedAt),
        lastRefreshAt: toIsoOrNull(t.lastRefreshAt),
        contextChangedAt: toIsoOrNull(t.contextChangedAt),
        handoff: { preparedAt: toIsoOrNull(t.handoff.preparedAt), openedAt: toIsoOrNull(t.handoff.openedAt), destination: t.handoff.destination },
      };
      const stored = snapshots.get(t.id)?.messages ?? [];
      if (opts.includeEmailContent && stored.length > 0) out.emailContent = stored.map((m) => ({ messageId: m.messageId, bodyText: m.bodyText }));
      return out;
    }),
    plans: dump.plans
      .filter((p) => ids.has(p.taskId))
      .sort((a, b) => a.recordedAt - b.recordedAt)
      .map((p) => ({ id: p.id, taskId: p.taskId, version: p.version, hash: p.hash, text: p.text, source: p.source, recordedAt: toIso(p.recordedAt) })),
    approvals: dump.approvals
      .filter((a) => ids.has(a.taskId))
      .sort((a, b) => a.decidedAt - b.decidedAt)
      .map((a) => ({
        id: a.id,
        taskId: a.taskId,
        planId: a.planId,
        planVersion: a.planVersion,
        planHash: a.planHash,
        decision: a.decision,
        comment: a.comment,
        decidedAt: toIso(a.decidedAt),
        supersededAt: toIsoOrNull(a.supersededAt),
      })),
    events: dump.events
      .filter((e) => ids.has(e.taskId))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((e) => ({ taskId: e.taskId, at: toIso(e.at), type: e.type, data: e.data as ExportData["events"][number]["data"] })),
    settings: { retentionDays: dump.retentionDays },
  };
}

export async function buildExportFile(data: ExportData, now: Date = new Date()): Promise<ExportFile> {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    includesEmailContent: data.tasks.some((t) => (t.emailContent?.length ?? 0) > 0),
    data,
    checksum: { algorithm: "SHA-256", value: await dataChecksum(data) },
  };
}

// Statuses that implied a go-ahead. After import they need review again.
const NEEDS_REVIEW: ReadonlySet<TaskStatus> = new Set(["Approved", "InProgress"]);

// Converts selected imported tasks into database records. Imported data is
// treated as untrusted: approvals become history only, tasks that were
// approved or in progress are blocked for review, and nothing is executed.
export function toImportOperation(file: ExportFile, selection: ImportSelection, now: number): ImportOperation {
  const write = new Set(selection.writeTaskIds);
  const tasks: TaskRecord[] = [];
  const snapshots: SnapshotRecord[] = [];
  const events: EventRecord[] = [];
  for (const t of file.data.tasks) {
    if (!write.has(t.id)) continue;
    const blocked = NEEDS_REVIEW.has(t.status);
    tasks.push({
      id: t.id,
      title: t.title,
      status: blocked ? "Blocked" : t.status,
      blockReason: blocked ? "imported_requires_review" : t.blockReason,
      priority: t.priority,
      dueAt: t.dueAt,
      repositoryRef: t.repositoryRef,
      instructions: t.instructions,
      scope: t.scope,
      threadId: t.threadId,
      threadUrl: t.threadUrl,
      sources: t.sources.map((s) => ({ messageId: s.messageId, subject: s.subject, from: s.from, date: s.date, ...(s.addedAt ? { addedAt: toMs(s.addedAt) } : {}) })),
      idempotencyKey: t.idempotencyKey,
      origin: "imported",
      createdAt: toMs(t.createdAt),
      updatedAt: now,
      lastRefreshAt: toMsOrNull(t.lastRefreshAt),
      contextChangedAt: toMsOrNull(t.contextChangedAt),
      handoff: { preparedAt: toMsOrNull(t.handoff.preparedAt), openedAt: toMsOrNull(t.handoff.openedAt), destination: t.handoff.destination },
    });
    // Closed tasks start a fresh retention countdown from the import.
    snapshots.push({ taskId: t.id, messages: t.emailContent ?? [], closedAt: CLOSED_STATUSES.has(t.status) ? now : null, purgedAt: null });
    events.push(
      ...file.data.events.filter((e) => e.taskId === t.id).map((e): EventRecord => ({ taskId: e.taskId, at: toMs(e.at), type: e.type, data: e.data as Record<string, unknown> })),
      { taskId: t.id, at: now, type: "task.imported", data: { exportedAt: file.exportedAt, previousStatus: t.status, emailContentIncluded: (t.emailContent?.length ?? 0) > 0 } },
    );
    if (blocked) events.push({ taskId: t.id, at: now, type: "task.transition", data: { from: t.status, to: "Blocked", cause: "system", blockReason: "imported_requires_review" } });
  }
  const plans: PlanRecord[] = file.data.plans
    .filter((p) => write.has(p.taskId))
    .map((p) => ({ id: p.id, taskId: p.taskId, version: p.version, hash: p.hash, text: p.text, source: p.source, recordedAt: toMs(p.recordedAt) }));
  const approvals: ApprovalRecord[] = file.data.approvals
    .filter((a) => write.has(a.taskId))
    .map((a) => ({
      id: a.id,
      taskId: a.taskId,
      planId: a.planId,
      planVersion: a.planVersion,
      planHash: a.planHash,
      decision: a.decision,
      comment: a.comment,
      origin: "imported",
      decidedAt: toMs(a.decidedAt),
      // Every imported approval is history: none counts as current.
      supersededAt: a.supersededAt ? toMs(a.supersededAt) : now,
    }));
  return {
    replaceAll: selection.replaceAll,
    deleteTaskIds: selection.deleteTaskIds,
    tasks,
    snapshots,
    plans,
    approvals,
    events,
    ...(selection.applySettings ? { retentionDays: file.data.settings.retentionDays } : {}),
  };
}
