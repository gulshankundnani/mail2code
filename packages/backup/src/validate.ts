import { planHash } from "@inbox-handoff/task-core";
import { dataChecksum } from "./checksum.ts";
import {
  CURRENT_SCHEMA_VERSION,
  ENCRYPTED_FORMAT,
  EXPORT_FORMAT,
  EncryptedFileSchema,
  ExportFileSchema,
  MAX_BACKUP_BYTES,
  type EncryptedFile,
  type ExportFile,
} from "./format.ts";

export type BackupErrorCode =
  | "too_large"
  | "not_json"
  | "not_a_backup"
  | "newer_version"
  | "invalid_structure"
  | "checksum_mismatch"
  | "broken_references";

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

export type ParsedBackup = { kind: "encrypted"; file: EncryptedFile } | { kind: "plain"; raw: Record<string, unknown> };

// Older schema versions are upgraded step by step before validation:
// MIGRATIONS[n] turns a version-n document into version n+1. None yet.
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseBackupText(text: string): ParsedBackup {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new BackupError("too_large", "This file is larger than 50 MB, the maximum for a backup.");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new BackupError("not_json", "This file isn't valid JSON, so it isn't an Inbox Handoff backup.");
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new BackupError("not_a_backup", "This file isn't an Inbox Handoff backup.");
  const rec = doc as Record<string, unknown>;
  if (rec.format === ENCRYPTED_FORMAT) {
    const enc = EncryptedFileSchema.safeParse(rec);
    if (!enc.success) throw new BackupError("invalid_structure", "This encrypted backup is damaged or uses unsupported settings.");
    return { kind: "encrypted", file: enc.data };
  }
  if (rec.format !== EXPORT_FORMAT) throw new BackupError("not_a_backup", "This file isn't an Inbox Handoff backup.");
  return { kind: "plain", raw: rec };
}

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".") || "(file)"}: ${i.message}`)
    .join("; ");
}

export interface ValidatedBackup {
  file: ExportFile;
  warnings: string[];
}

// Full validation: version, structure, checksum, and references between
// records. Nothing in the file is ever executed; it is only data.
export async function validateExport(raw: Record<string, unknown>): Promise<ValidatedBackup> {
  let doc = raw;
  const version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : NaN;
  if (!Number.isInteger(version) || version < 1) throw new BackupError("invalid_structure", "The backup has no valid schema version.");
  if (version > CURRENT_SCHEMA_VERSION) throw new BackupError("newer_version", `This backup was made by a newer version of Inbox Handoff (format v${version}). Update the extension and try again.`);
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new BackupError("invalid_structure", `Backups in format v${v} can't be upgraded.`);
    doc = { ...step(doc), schemaVersion: v + 1 };
  }

  const parsed = ExportFileSchema.safeParse(doc);
  if (!parsed.success) throw new BackupError("invalid_structure", `The backup's contents aren't valid: ${describeIssues(parsed.error.issues)}`);
  const file = parsed.data;

  if ((await dataChecksum(file.data)) !== file.checksum.value) {
    throw new BackupError("checksum_mismatch", "The backup's checksum doesn't match its contents. The file may be damaged or incomplete.");
  }

  const { tasks, plans, approvals, events } = file.data;
  const problems: string[] = [];
  const unique = (label: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) problems.push(`duplicate ${label}`);
  };
  unique("task ids", tasks.map((t) => t.id));
  unique("duplicate keys", tasks.map((t) => t.idempotencyKey));
  unique("plan ids", plans.map((p) => p.id));
  unique("approval ids", approvals.map((a) => a.id));
  unique("plan versions", plans.map((p) => `${p.taskId}#${p.version}`));
  const taskIds = new Set(tasks.map((t) => t.id));
  const planById = new Map(plans.map((p) => [p.id, p]));
  if (plans.some((p) => !taskIds.has(p.taskId))) problems.push("plans that belong to no task");
  if (events.some((e) => !taskIds.has(e.taskId))) problems.push("history entries that belong to no task");
  if (approvals.some((a) => !taskIds.has(a.taskId) || planById.get(a.planId)?.taskId !== a.taskId)) problems.push("decisions that belong to no plan");
  for (const t of tasks) {
    const known = new Set(t.sources.map((s) => s.messageId));
    if (t.emailContent?.some((m) => !known.has(m.messageId))) problems.push(`email text for unknown messages in "${t.title}"`);
  }
  if (problems.length > 0) throw new BackupError("broken_references", `The backup is inconsistent: ${problems.join(", ")}.`);

  const warnings: string[] = [];
  for (const p of plans) {
    if ((await planHash({ taskId: p.taskId, version: p.version, text: p.text })) !== p.hash) {
      warnings.push(`Plan version ${p.version} of task ${p.taskId} doesn't match its fingerprint. It is imported as history; record the plan again before approving.`);
    }
  }
  const hasEmail = tasks.some((t) => (t.emailContent?.length ?? 0) > 0);
  if (hasEmail !== file.includesEmailContent) warnings.push("The backup's email-content flag doesn't match its contents.");
  return { file, warnings };
}
