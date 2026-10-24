// The export format, version 1. Documented in docs/backup-format.md and kept
// independent of the extension's IndexedDB layout: the extension maps its
// records to and from these shapes.
import { z } from "zod";
import { BLOCK_REASONS, LIMITS, PrioritySchema, RetentionDaysSchema, TASK_STATUSES } from "@inbox-handoff/protocol";

export const EXPORT_FORMAT = "inbox-handoff-export";
export const ENCRYPTED_FORMAT = "inbox-handoff-encrypted-export";
export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_TASKS = 10_000;

const iso = z.iso.datetime();
const isoOrNull = iso.nullable();
const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const gmailId = z.string().regex(/^[A-Za-z0-9:#_-]{1,200}$/);

export const ExportSourceSchema = z.strictObject({
  messageId: gmailId,
  subject: z.string().max(LIMITS.maxSubjectChars),
  from: z.string().max(1_000),
  date: z.string().max(200),
  addedAt: isoOrNull,
});

export const ExportTaskSchema = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(LIMITS.maxTitleChars),
  status: z.enum(TASK_STATUSES),
  blockReason: z.enum(BLOCK_REASONS).nullable(),
  priority: PrioritySchema,
  dueAt: isoOrNull,
  repositoryRef: z.string().max(LIMITS.maxRepositoryRefChars),
  instructions: z.string().max(LIMITS.maxInstructionsChars),
  scope: z.enum(["message", "thread"]),
  threadId: gmailId,
  threadUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://mail.google.com/"), "thread URL must be a Gmail URL"),
  sources: z.array(ExportSourceSchema).min(1).max(LIMITS.maxMessagesPerHandoff * 20),
  idempotencyKey: sha256,
  createdAt: iso,
  updatedAt: iso,
  lastRefreshAt: isoOrNull,
  contextChangedAt: isoOrNull,
  handoff: z.strictObject({ preparedAt: isoOrNull, openedAt: isoOrNull, destination: z.string().max(200).nullable() }),
  // Present only when the user chose to export stored email text.
  emailContent: z
    .array(z.strictObject({ messageId: gmailId, bodyText: z.string().max(LIMITS.maxMessageBodyChars) }))
    .max(LIMITS.maxMessagesPerHandoff * 20)
    .optional(),
});

export const ExportPlanSchema = z.strictObject({
  id: uuid,
  taskId: uuid,
  version: z.number().int().positive(),
  hash: sha256,
  text: z.string().min(1).max(LIMITS.maxPlanChars),
  source: z.enum(["pasted"]),
  recordedAt: iso,
});

// Approvals are exported as history. On import they are always stored as
// "imported" and never authorize anything.
export const ExportApprovalSchema = z.strictObject({
  id: uuid,
  taskId: uuid,
  planId: uuid,
  planVersion: z.number().int().positive(),
  planHash: sha256,
  decision: z.enum(["approve", "reject", "request_changes"]),
  comment: z.string().max(LIMITS.maxNoteChars).nullable(),
  decidedAt: iso,
  supersededAt: isoOrNull,
});

export const ExportEventSchema = z.strictObject({
  taskId: uuid,
  at: iso,
  type: z.string().regex(/^[a-z][a-z.]{1,40}$/),
  data: z.record(z.string().max(100), z.json()).refine((d) => JSON.stringify(d).length <= 20_000, "event data too large"),
});

export const ExportDataSchema = z.strictObject({
  tasks: z.array(ExportTaskSchema).max(MAX_TASKS),
  plans: z.array(ExportPlanSchema),
  approvals: z.array(ExportApprovalSchema),
  events: z.array(ExportEventSchema),
  settings: z.strictObject({ retentionDays: RetentionDaysSchema }),
});

export const ExportFileSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string().max(50),
  exportedAt: iso,
  includesEmailContent: z.boolean(),
  data: ExportDataSchema,
  checksum: z.strictObject({ algorithm: z.literal("SHA-256"), value: sha256 }),
});

export const EncryptedFileSchema = z.strictObject({
  format: z.literal(ENCRYPTED_FORMAT),
  version: z.literal(1),
  kdf: z.strictObject({
    name: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    // Bounded so a crafted file can't make the browser spin for minutes.
    iterations: z.number().int().min(100_000).max(5_000_000),
    salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/), // 16 bytes, base64
  }),
  cipher: z.strictObject({ name: z.literal("AES-GCM"), iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/) }), // 12 bytes
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export type ExportSource = z.infer<typeof ExportSourceSchema>;
export type ExportTask = z.infer<typeof ExportTaskSchema>;
export type ExportPlan = z.infer<typeof ExportPlanSchema>;
export type ExportApproval = z.infer<typeof ExportApprovalSchema>;
export type ExportEvent = z.infer<typeof ExportEventSchema>;
export type ExportData = z.infer<typeof ExportDataSchema>;
export type ExportFile = z.infer<typeof ExportFileSchema>;
export type EncryptedFile = z.infer<typeof EncryptedFileSchema>;
