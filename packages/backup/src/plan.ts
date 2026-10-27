import { canonicalJson } from "@mail2code/protocol";
import type { ExportData, ExportFile, ExportTask } from "./format.ts";

export type ImportStrategy = "restore" | "merge" | "replace";
export type ConflictResolution = "keep-existing" | "use-imported";

// new: not in this browser. identical: same id and same content.
// conflict: same id, different content. duplicate-key: a different task in
// this browser was created from the same handoff (same messages, repository
// and instructions).
export type TaskImportKind = "new" | "identical" | "conflict" | "duplicate-key";

export interface TaskPreview {
  id: string;
  title: string;
  status: ExportTask["status"];
  kind: TaskImportKind;
  existingTitle: string | null;
}

export interface ImportPreview {
  exportedAt: string;
  includesEmailContent: boolean;
  tasks: TaskPreview[];
  counts: Record<TaskImportKind, number> & { total: number; plans: number; decisions: number; events: number };
  existingTaskCount: number;
  settingsDiffer: boolean;
}

// Content comparison ignores email text, which may or may not be exported.
function comparable(t: ExportTask): string {
  const { emailContent: _ignored, ...rest } = t;
  return canonicalJson(rest);
}

export function previewImport(file: ExportFile, existing: ExportData): ImportPreview {
  const byId = new Map(existing.tasks.map((t) => [t.id, t]));
  const byKey = new Map(existing.tasks.map((t) => [t.idempotencyKey, t]));
  const tasks: TaskPreview[] = file.data.tasks.map((t) => {
    const same = byId.get(t.id);
    if (same) return { id: t.id, title: t.title, status: t.status, kind: comparable(same) === comparable(t) ? "identical" : "conflict", existingTitle: same.title };
    const dup = byKey.get(t.idempotencyKey);
    if (dup) return { id: t.id, title: t.title, status: t.status, kind: "duplicate-key", existingTitle: dup.title };
    return { id: t.id, title: t.title, status: t.status, kind: "new", existingTitle: null };
  });
  const count = (k: TaskImportKind) => tasks.filter((t) => t.kind === k).length;
  return {
    exportedAt: file.exportedAt,
    includesEmailContent: file.includesEmailContent,
    tasks,
    counts: {
      total: tasks.length,
      new: count("new"),
      identical: count("identical"),
      conflict: count("conflict"),
      "duplicate-key": count("duplicate-key"),
      plans: file.data.plans.length,
      decisions: file.data.approvals.length,
      events: file.data.events.length,
    },
    existingTaskCount: existing.tasks.length,
    settingsDiffer: file.data.settings.retentionDays !== existing.settings.retentionDays,
  };
}

export interface ImportSelection {
  // Delete every task in this browser first (replace strategy).
  replaceAll: boolean;
  // Existing tasks to delete before writing their imported versions.
  deleteTaskIds: string[];
  // Imported tasks to write, with their plans, decisions and history.
  writeTaskIds: string[];
  skipped: { id: string; title: string; reason: string }[];
  applySettings: boolean;
}

export class ImportStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportStrategyError";
  }
}

// Decides exactly what an import will change. Never silently overwrites:
// replacing existing tasks requires either the replace strategy (which the UI
// confirms explicitly) or the "use imported" resolution for conflicts.
export function selectImport(preview: ImportPreview, strategy: ImportStrategy, resolution: ConflictResolution = "keep-existing"): ImportSelection {
  if (strategy === "restore" && preview.existingTaskCount > 0) {
    throw new ImportStrategyError("Restore only works in an empty installation. Use merge or replace instead.");
  }
  if (strategy === "replace" || strategy === "restore") {
    return { replaceAll: strategy === "replace", deleteTaskIds: [], writeTaskIds: preview.tasks.map((t) => t.id), skipped: [], applySettings: true };
  }
  const sel: ImportSelection = { replaceAll: false, deleteTaskIds: [], writeTaskIds: [], skipped: [], applySettings: false };
  for (const t of preview.tasks) {
    switch (t.kind) {
      case "new":
        sel.writeTaskIds.push(t.id);
        break;
      case "identical":
        sel.skipped.push({ id: t.id, title: t.title, reason: "already in this browser" });
        break;
      case "duplicate-key":
        sel.skipped.push({ id: t.id, title: t.title, reason: `same handoff as existing task "${t.existingTitle}"` });
        break;
      case "conflict":
        if (resolution === "use-imported") {
          sel.deleteTaskIds.push(t.id);
          sel.writeTaskIds.push(t.id);
        } else {
          sel.skipped.push({ id: t.id, title: t.title, reason: "kept the version in this browser" });
        }
        break;
    }
  }
  return sel;
}
