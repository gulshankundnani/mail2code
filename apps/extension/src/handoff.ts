import { TaskCreateSchema, idempotencyMaterial, type CapturedConversation, type Priority, type TaskCreate } from "@inbox-handoff/protocol";
import { sha256Hex } from "@inbox-handoff/task-core";

export interface ReviewForm {
  scope: "message" | "thread";
  selectedMessageId: string;
  repositoryRef: string;
  title: string;
  instructions: string;
  priority: Priority;
  dueDate: string; // yyyy-mm-dd from <input type="date">, or ""
}

export type BuildResult = { ok: true; task: TaskCreate } | { ok: false; error: string };

// Builds the task exactly as shown in the review page. Validated against the
// shared schema.
export async function buildTaskCreate(draft: CapturedConversation, form: ReviewForm): Promise<BuildResult> {
  const chosen = form.scope === "thread" ? draft.messages : draft.messages.filter((m) => m.messageId === form.selectedMessageId);
  if (chosen.length === 0) return { ok: false, error: "Choose a message." };
  const messages = chosen.map((m) => ({ messageId: m.messageId, subject: draft.subject, from: m.from, date: m.date, bodyText: m.bodyText }));
  const instructions = form.instructions.trim();
  const repositoryRef = form.repositoryRef.trim();
  const candidate = {
    idempotencyKey: await sha256Hex(idempotencyMaterial({ threadId: draft.threadId, messageIds: messages.map((m) => m.messageId), repositoryRef, instructions })),
    scope: form.scope,
    threadId: draft.threadId,
    threadUrl: draft.threadUrl,
    messages,
    repositoryRef,
    title: form.title.trim() || draft.subject.trim() || "(no subject)",
    instructions,
    priority: form.priority,
    dueAt: form.dueDate ? new Date(`${form.dueDate}T23:59:59Z`).toISOString() : null,
  };
  const parsed = TaskCreateSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return { ok: true, task: parsed.data };
}
