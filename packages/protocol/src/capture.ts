import { z } from "zod";
import { LIMITS } from "./limits.ts";

// What the Gmail content script captured from the rendered page after the user
// clicked the button. Nothing here has been sent anywhere yet.
export const CapturedMessageSchema = z.object({
  messageId: z.string().regex(/^[A-Za-z0-9:#_-]{1,200}$/),
  from: z.string().max(1_000),
  date: z.string().max(200),
  bodyText: z.string().max(LIMITS.maxMessageBodyChars),
  truncated: z.boolean(),
});
export type CapturedMessage = z.infer<typeof CapturedMessageSchema>;

export const CapturedConversationSchema = z.object({
  threadId: z.string().regex(/^[A-Za-z0-9:#_-]{1,200}$/),
  threadUrl: z.string().url().refine((u) => u.startsWith("https://mail.google.com/"), "thread URL must be a Gmail URL"),
  subject: z.string().max(LIMITS.maxSubjectChars),
  messages: z.array(CapturedMessageSchema).min(1).max(LIMITS.maxMessagesPerHandoff),
  // Messages Gmail shows collapsed: their bodies were not rendered, so not captured.
  collapsedCount: z.number().int().min(0),
  capturedAt: z.iso.datetime(),
});
export type CapturedConversation = z.infer<typeof CapturedConversationSchema>;
