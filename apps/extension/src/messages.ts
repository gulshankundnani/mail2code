import { z } from "zod";
import { CapturedConversationSchema, LIMITS, TaskCreateSchema } from "@mail2code/protocol";
import { ApprovalBlockSchema } from "./approval-inbox.ts";

// Runtime messages to the background script. Tasks themselves live in the
// extension's IndexedDB, which Gmail's content script cannot reach at all.

export const SummaryInputSchema = z.object({
  subject: z.string().max(LIMITS.maxSubjectChars),
  messages: z
    .array(z.object({ from: z.string().max(1_000), date: z.string().max(200), text: z.string().max(LIMITS.maxMessageBodyChars) }))
    .min(1)
    .max(LIMITS.maxMessagesPerHandoff),
});

export const GmailMessageSchema = z.discriminatedUnion("kind", [
  // Opens the full review page (the "More options" path).
  z.object({ kind: z.literal("capture"), conversation: CapturedConversationSchema }),
  // Optional Claude API summary. The background holds the key and decides
  // whether the feature is on; the content script never sees the key.
  z.object({ kind: z.literal("summarize"), input: SummaryInputSchema }),
  // Records the task when the user clicks "Open in Claude".
  z.object({ kind: z.literal("task.record"), task: TaskCreateSchema, destination: z.enum(["desktop", "desktop-ssh", "cli"]) }),
  // Opens the extension's own task dashboard or settings. Fixed pages only.
  z.object({ kind: z.literal("open.page"), page: z.enum(["tasks", "settings"]) }),
  // An approval request or response found in an email the user clicked on.
  // Only handed over: an extension page unseals, verifies and asks the user.
  z.object({ kind: z.literal("approval.block"), item: ApprovalBlockSchema }),
]);

export const PageMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft.get"), draftId: z.string().uuid() }),
  z.object({ kind: z.literal("draft.discard"), draftId: z.string().uuid() }),
  z.object({ kind: z.literal("approval.get"), itemId: z.string().uuid() }),
  z.object({ kind: z.literal("approval.discard"), itemId: z.string().uuid() }),
]);

export type GmailMessage = z.infer<typeof GmailMessageSchema>;
export type PageMessage = z.infer<typeof PageMessageSchema>;
export type SummaryInput = z.infer<typeof SummaryInputSchema>;

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
