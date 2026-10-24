import {
  HandoffCreateSchema,
  idempotencyMaterial,
  type CapturedConversation,
  type HandoffCreate,
  type Priority,
} from "@inbox-handoff/protocol";

export interface ReviewForm {
  scope: "message" | "thread";
  selectedMessageId: string;
  projectId: string;
  title: string;
  instructions: string;
  priority: Priority;
  dueDate: string; // yyyy-mm-dd from <input type="date">, or ""
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type BuildResult = { ok: true; handoff: HandoffCreate } | { ok: false; error: string };

// Builds the exact payload shown to the user in the review page and sent on
// confirmation. Validated against the shared protocol schema.
export async function buildHandoff(draft: CapturedConversation, form: ReviewForm): Promise<BuildResult> {
  const chosen = form.scope === "thread" ? draft.messages : draft.messages.filter((m) => m.messageId === form.selectedMessageId);
  if (chosen.length === 0) return { ok: false, error: "Choose a message." };
  if (!form.projectId) return { ok: false, error: "Choose a project." };
  const messages = chosen.map((m) => ({ messageId: m.messageId, subject: draft.subject, from: m.from, date: m.date, bodyText: m.bodyText }));
  const instructions = form.instructions.trim();
  const candidate = {
    idempotencyKey: await sha256Hex(
      idempotencyMaterial({ threadId: draft.threadId, messageIds: messages.map((m) => m.messageId), projectId: form.projectId, instructions }),
    ),
    scope: form.scope,
    threadId: draft.threadId,
    threadUrl: draft.threadUrl,
    messages,
    projectId: form.projectId,
    title: form.title.trim() || draft.subject.trim() || "(no subject)",
    instructions,
    priority: form.priority,
    dueAt: form.dueDate ? new Date(`${form.dueDate}T23:59:59Z`).toISOString() : null,
  };
  const parsed = HandoffCreateSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return { ok: true, handoff: parsed.data };
}
