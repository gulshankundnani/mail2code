// Files exchanged between a requester and another person who approves plans.
// They travel however the users like (email attachment, chat, USB), so every
// field is validated strictly and nothing in them is ever executed.
//
//   approver card     approver -> requester, once: name, email, public key
//   approval request  requester -> approver: task title + one plan version
//   approval response approver -> requester: the decision, signed
//   progress update   requester -> approver: task status after approval, signed
//                     with the requester key named in the original request
import { z } from "zod";
import { LIMITS } from "./limits.ts";
import { TASK_STATUSES } from "./task.ts";

export const APPROVER_CARD_FORMAT = "mail2code-approver-card";
export const APPROVAL_REQUEST_FORMAT = "mail2code-approval-request";
export const APPROVAL_RESPONSE_FORMAT = "mail2code-approval-response";
export const PROGRESS_UPDATE_FORMAT = "mail2code-progress-update";

// A request carries one plan (up to LIMITS.maxPlanChars), so it can't be tiny.
export const MAX_APPROVAL_FILE_BYTES = 512 * 1024;
export const APPROVAL_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_APPROVER_NAME_CHARS = 100;

const iso = z.iso.datetime();
const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
// SHA-256 of the approver's public key (SPKI bytes), lowercase hex.
export const FingerprintSchema = sha256;
// ECDSA P-256 public key, SPKI DER, base64 (91 bytes -> 124 characters).
const publicKey = z.string().regex(/^[A-Za-z0-9+/]{120,200}={0,2}$/);
// ECDSA P-256 signature in IEEE P1363 form (64 bytes -> 88 characters).
const signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/);
const name = z.string().trim().min(1).max(MAX_APPROVER_NAME_CHARS);
// Used only as the To: address of draft emails; never as proof of identity.
export const EmailAddressSchema = z.string().trim().max(254).regex(/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/);

export const ApproverCardSchema = z.strictObject({
  format: z.literal(APPROVER_CARD_FORMAT),
  version: z.literal(1),
  name,
  email: EmailAddressSchema,
  publicKey,
  fingerprint: FingerprintSchema,
});

export const ApprovalRequestSchema = z.strictObject({
  format: z.literal(APPROVAL_REQUEST_FORMAT),
  version: z.literal(1),
  requestId: uuid,
  // The one approver this request is addressed to.
  approverFingerprint: FingerprintSchema,
  requesterName: z.string().trim().max(MAX_APPROVER_NAME_CHARS),
  // The requester's public key: later progress updates on this task must be
  // signed with it, so only the person who asked can update the approver.
  requesterKey: publicKey,
  task: z.strictObject({ id: uuid, title: z.string().min(1).max(LIMITS.maxTitleChars) }),
  plan: z.strictObject({ version: z.number().int().positive(), hash: sha256, text: z.string().min(1).max(LIMITS.maxPlanChars) }),
  createdAt: iso,
  expiresAt: iso,
});

export const APPROVAL_DECISIONS = ["approve", "request_changes", "reject"] as const;

// Exactly what the approver signs. It names the request, the task, the plan
// version and its fingerprint, so a signature can't be reused for anything else.
export const ApprovalResponsePayloadSchema = z.strictObject({
  requestId: uuid,
  taskId: uuid,
  planVersion: z.number().int().positive(),
  planHash: sha256,
  approverFingerprint: FingerprintSchema,
  decision: z.enum(APPROVAL_DECISIONS),
  comment: z.string().max(LIMITS.maxNoteChars).nullable(),
  decidedAt: iso,
});

export const ApprovalResponseSchema = z.strictObject({
  format: z.literal(APPROVAL_RESPONSE_FORMAT),
  version: z.literal(1),
  // Shown to the requester; never used to identify the approver.
  approverName: name,
  payload: ApprovalResponsePayloadSchema,
  signature,
});

// What the requester signs for each progress update.
export const ProgressUpdatePayloadSchema = z.strictObject({
  requestId: uuid,
  taskId: uuid,
  planVersion: z.number().int().positive(),
  status: z.enum(TASK_STATUSES),
  note: z.string().max(LIMITS.maxNoteChars).nullable(),
  // Increases with every update for this request; older or repeated ones are ignored.
  seq: z.number().int().positive().max(1_000_000),
  sentAt: iso,
});

export const ProgressUpdateSchema = z.strictObject({
  format: z.literal(PROGRESS_UPDATE_FORMAT),
  version: z.literal(1),
  requesterName: z.string().trim().max(MAX_APPROVER_NAME_CHARS),
  taskTitle: z.string().min(1).max(LIMITS.maxTitleChars),
  payload: ProgressUpdatePayloadSchema,
  signature,
});

export type ApproverCard = z.infer<typeof ApproverCardSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalResponsePayload = z.infer<typeof ApprovalResponsePayloadSchema>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export type ProgressUpdatePayload = z.infer<typeof ProgressUpdatePayloadSchema>;
export type ProgressUpdate = z.infer<typeof ProgressUpdateSchema>;

export class ApprovalFileError extends Error {
  readonly code: "too_large" | "not_json" | "wrong_kind" | "invalid";
  constructor(code: ApprovalFileError["code"], message: string) {
    super(message);
    this.name = "ApprovalFileError";
    this.code = code;
  }
}

const KIND_LABEL = {
  [APPROVER_CARD_FORMAT]: "an approver card",
  [APPROVAL_REQUEST_FORMAT]: "an approval request",
  [APPROVAL_RESPONSE_FORMAT]: "an approval response",
  [PROGRESS_UPDATE_FORMAT]: "a progress update",
} as const;

// Parses one approval file of the expected kind, with size and shape checks.
export function parseApprovalFile<S extends z.ZodType>(text: string, schema: S, format: keyof typeof KIND_LABEL): z.infer<S> {
  if (new TextEncoder().encode(text).length > MAX_APPROVAL_FILE_BYTES) throw new ApprovalFileError("too_large", "This file is too large to be a Mail2Code approval file.");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ApprovalFileError("not_json", "This file isn't valid JSON, so it isn't a Mail2Code approval file.");
  }
  const actual = typeof doc === "object" && doc !== null ? (doc as { format?: unknown }).format : undefined;
  if (actual !== format) {
    const known = typeof actual === "string" && actual in KIND_LABEL ? KIND_LABEL[actual as keyof typeof KIND_LABEL] : null;
    throw new ApprovalFileError("wrong_kind", known ? `This file is ${known}, not ${KIND_LABEL[format]}.` : `This file isn't ${KIND_LABEL[format]}.`);
  }
  const parsed = schema.safeParse(doc);
  if (!parsed.success) throw new ApprovalFileError("invalid", `This ${KIND_LABEL[format].replace(/^an? /, "")} is damaged or was changed.`);
  return parsed.data;
}
