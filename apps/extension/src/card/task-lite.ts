// Builds the task record in the Gmail content script without bundling zod.
// The background re-validates it with TaskCreateSchema before storing.
import type { CapturedConversation, TaskCreate } from "@mail2code/protocol";
import { idempotencyMaterial } from "@mail2code/protocol/canonical";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LiteTaskOptions {
  scope: "message" | "thread";
  messageIds: string[];
  title: string;
  repositoryRef: string;
  instructions: string;
}

export async function buildTaskLite(draft: CapturedConversation, o: LiteTaskOptions): Promise<TaskCreate> {
  const chosen = draft.messages.filter((m) => o.messageIds.includes(m.messageId));
  const messages = chosen.map((m) => ({ messageId: m.messageId, subject: draft.subject, from: m.from, date: m.date, bodyText: m.bodyText }));
  const instructions = o.instructions.trim().slice(0, 20_000);
  const repositoryRef = o.repositoryRef.trim().slice(0, 500);
  return {
    idempotencyKey: await sha256Hex(idempotencyMaterial({ threadId: draft.threadId, messageIds: messages.map((m) => m.messageId), repositoryRef, instructions })),
    scope: o.scope,
    threadId: draft.threadId,
    threadUrl: draft.threadUrl,
    messages,
    repositoryRef,
    title: (o.title.trim() || draft.subject.trim() || "(no subject)").slice(0, 300),
    instructions,
    priority: "normal",
    dueAt: null,
  };
}
