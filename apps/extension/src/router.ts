import type { CapturedConversation, TaskCreate } from "@mail2code/protocol";
import type { ApprovalBlock, ApprovalInbox } from "./approval-inbox.ts";
import type { Destination } from "./deeplink.ts";
import { GmailMessageSchema, PageMessageSchema, type Reply, type SummaryInput } from "./messages.ts";
import type { SenderKind } from "./sender.ts";

export interface DraftStore {
  put(conversation: CapturedConversation): Promise<string>;
  get(draftId: string): Promise<CapturedConversation | null>;
  delete(draftId: string): Promise<void>;
}

export interface RouterDeps {
  drafts: DraftStore;
  openReview(draftId: string): Promise<void>;
  // Returns null when the Claude API summary is switched off.
  summarize(input: SummaryInput): Promise<Reply<{ summary: string } | null>>;
  recordTask(task: TaskCreate, destination: Destination): Promise<Reply<{ taskId: string; created: boolean }>>;
  openPage(page: ExtensionPage): Promise<void>;
  approvals: ApprovalInbox;
  // Opens the page that handles a handed-over approval email; rejects with a
  // message for the card when the block can't be read.
  openApproval(itemId: string, item: ApprovalBlock): Promise<Reply<null>>;
}

export type ExtensionPage = "tasks" | "settings";

// Capability matrix:
//   gmail-content-script -> capture, summarize (if the user enabled it),
//                           record a task (after a real click on "Open in Claude"),
//                           open the task dashboard or settings page,
//                           hand over an approval email (never approve)
//                           — never approvals, plans, exports, imports or settings
//   extension-page       -> read or discard a draft or handed-over approval email
//   untrusted            -> nothing
export async function routeMessage(raw: unknown, sender: SenderKind, deps: RouterDeps): Promise<Reply> {
  if (sender === "gmail-content-script") {
    const msg = GmailMessageSchema.safeParse(raw);
    if (!msg.success) return { ok: false, error: "invalid_message" };
    switch (msg.data.kind) {
      case "capture": {
        const draftId = await deps.drafts.put(msg.data.conversation);
        await deps.openReview(draftId);
        return { ok: true, value: { draftId } };
      }
      case "summarize":
        return deps.summarize(msg.data.input);
      case "task.record":
        return deps.recordTask(msg.data.task, msg.data.destination);
      case "open.page":
        await deps.openPage(msg.data.page);
        return { ok: true, value: null };
      case "approval.block": {
        const itemId = await deps.approvals.put(msg.data.item);
        const opened = await deps.openApproval(itemId, msg.data.item);
        if (!opened.ok) await deps.approvals.delete(itemId);
        return opened;
      }
    }
  }

  if (sender === "extension-page") {
    const msg = PageMessageSchema.safeParse(raw);
    if (!msg.success) return { ok: false, error: "invalid_message" };
    switch (msg.data.kind) {
      case "draft.get": {
        const draft = await deps.drafts.get(msg.data.draftId);
        return draft ? { ok: true, value: draft } : { ok: false, error: "draft_not_found" };
      }
      case "draft.discard":
        await deps.drafts.delete(msg.data.draftId);
        return { ok: true, value: null };
      case "approval.get": {
        const item = await deps.approvals.get(msg.data.itemId);
        return item ? { ok: true, value: item } : { ok: false, error: "approval_not_found" };
      }
      case "approval.discard":
        await deps.approvals.delete(msg.data.itemId);
        return { ok: true, value: null };
    }
  }

  return { ok: false, error: "sender_not_allowed" };
}
