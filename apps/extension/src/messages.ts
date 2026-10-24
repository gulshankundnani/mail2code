import { z } from "zod";
import { CapturedConversationSchema } from "@inbox-handoff/protocol";

// Runtime messages to the background script. Tasks themselves live in the
// extension's IndexedDB, which Gmail's content script cannot reach at all.

export const GmailMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("capture"), conversation: CapturedConversationSchema }),
]);

export const PageMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft.get"), draftId: z.string().uuid() }),
  z.object({ kind: z.literal("draft.discard"), draftId: z.string().uuid() }),
]);

export type GmailMessage = z.infer<typeof GmailMessageSchema>;
export type PageMessage = z.infer<typeof PageMessageSchema>;

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
