import { z } from "zod";
import { CapturedConversationSchema, HandoffCreateSchema } from "@inbox-handoff/protocol";

// Messages inside the extension (content script / pages -> background).

export const GmailMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("capture"), conversation: CapturedConversationSchema }),
]);

export const PageMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft.get"), draftId: z.string().uuid() }),
  z.object({ kind: z.literal("draft.discard"), draftId: z.string().uuid() }),
  z.object({ kind: z.literal("projects.list") }),
  z.object({ kind: z.literal("handoff.submit"), draftId: z.string().uuid(), handoff: HandoffCreateSchema }),
]);

export type GmailMessage = z.infer<typeof GmailMessageSchema>;
export type PageMessage = z.infer<typeof PageMessageSchema>;

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
