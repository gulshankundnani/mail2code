import { z } from "zod";
import { LIMITS } from "./limits.ts";
import { PrioritySchema } from "./task.ts";

export const PROTOCOL_VERSION = 1;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

// Gmail ids are opaque; accept a conservative character set only.
const gmailId = z.string().regex(/^[A-Za-z0-9:#_-]{1,200}$/);

export const EmailMessageSchema = z.object({
  messageId: gmailId,
  subject: z.string().max(LIMITS.maxSubjectChars),
  from: z.string().max(1_000),
  date: z.string().max(200),
  bodyText: z.string().max(LIMITS.maxMessageBodyChars),
});
export type EmailMessage = z.infer<typeof EmailMessageSchema>;

export const HandoffCreateSchema = z
  .object({
    idempotencyKey: sha256Hex,
    scope: z.enum(["message", "thread"]),
    threadId: gmailId,
    threadUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://mail.google.com/"), "thread URL must be a Gmail URL"),
    messages: z.array(EmailMessageSchema).min(1).max(LIMITS.maxMessagesPerHandoff),
    projectId: id,
    title: z.string().trim().min(1).max(LIMITS.maxTitleChars),
    instructions: z.string().max(LIMITS.maxInstructionsChars),
    priority: PrioritySchema,
    dueAt: z.iso.datetime().nullable(),
  })
  .refine(
    (h) => h.messages.reduce((n, m) => n + m.bodyText.length, 0) <= LIMITS.maxHandoffChars,
    "handoff exceeds total size limit",
  )
  .refine((h) => h.scope === "thread" || h.messages.length === 1, "message scope carries one message");
export type HandoffCreate = z.infer<typeof HandoffCreateSchema>;

export const PlanDecisionSchema = z.object({
  taskId: id,
  planVersion: z.number().int().positive(),
  planHash: sha256Hex,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  decision: z.enum(["approve", "reject", "request_changes"]),
  comment: z.string().max(LIMITS.maxInstructionsChars).optional(),
});
export type PlanDecision = z.infer<typeof PlanDecisionSchema>;

export const RequestSchema = z.discriminatedUnion("type", [
  z.object({ v: z.literal(PROTOCOL_VERSION), requestId: id, type: z.literal("handoff.create"), payload: HandoffCreateSchema }),
  z.object({ v: z.literal(PROTOCOL_VERSION), requestId: id, type: z.literal("plan.decide"), payload: PlanDecisionSchema }),
  z.object({ v: z.literal(PROTOCOL_VERSION), requestId: id, type: z.literal("task.get"), payload: z.object({ taskId: id }) }),
  z.object({ v: z.literal(PROTOCOL_VERSION), requestId: id, type: z.literal("task.list"), payload: z.object({}) }),
]);
export type Request = z.infer<typeof RequestSchema>;

// Requests that may change approval state. The extension's background script
// must refuse to forward these from content scripts (Gmail pages).
export const PRIVILEGED_REQUEST_TYPES: ReadonlySet<Request["type"]> = new Set(["plan.decide"]);
