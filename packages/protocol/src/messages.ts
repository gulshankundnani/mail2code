import { z } from "zod";
import { LIMITS } from "./limits.ts";
import { PrioritySchema } from "./task.ts";

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

// A repository URL or free-text project name. Never used as a path or command.
export const RepositoryRefSchema = z.string().trim().max(LIMITS.maxRepositoryRefChars);

export const TaskCreateSchema = z
  .object({
    idempotencyKey: sha256Hex,
    scope: z.enum(["message", "thread"]),
    threadId: gmailId,
    threadUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://mail.google.com/"), "thread URL must be a Gmail URL"),
    messages: z.array(EmailMessageSchema).min(1).max(LIMITS.maxMessagesPerHandoff),
    repositoryRef: RepositoryRefSchema,
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
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const PlanDecisionSchema = z.object({
  taskId: z.string().uuid(),
  planVersion: z.number().int().positive(),
  planHash: sha256Hex,
  decision: z.enum(["approve", "reject", "request_changes"]),
  comment: z.string().max(LIMITS.maxNoteChars).optional(),
});
export type PlanDecision = z.infer<typeof PlanDecisionSchema>;
