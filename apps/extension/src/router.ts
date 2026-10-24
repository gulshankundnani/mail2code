import type { CapturedConversation } from "@inbox-handoff/protocol";
import { GmailMessageSchema, PageMessageSchema, type Reply } from "./messages.ts";
import type { SenderKind } from "./sender.ts";

export interface DraftStore {
  put(conversation: CapturedConversation): Promise<string>;
  get(draftId: string): Promise<CapturedConversation | null>;
  delete(draftId: string): Promise<void>;
}

export interface RouterDeps {
  drafts: DraftStore;
  openReview(draftId: string): Promise<void>;
}

// Capability matrix:
//   gmail-content-script -> capture only (stores a draft, opens the review page)
//   extension-page       -> read or discard a draft
//   untrusted            -> nothing
export async function routeMessage(raw: unknown, sender: SenderKind, deps: RouterDeps): Promise<Reply> {
  if (sender === "gmail-content-script") {
    const msg = GmailMessageSchema.safeParse(raw);
    if (!msg.success) return { ok: false, error: "invalid_message" };
    const draftId = await deps.drafts.put(msg.data.conversation);
    await deps.openReview(draftId);
    return { ok: true, value: { draftId } };
  }

  if (sender === "extension-page") {
    const msg = PageMessageSchema.safeParse(raw);
    if (!msg.success) return { ok: false, error: "invalid_message" };
    if (msg.data.kind === "draft.get") {
      const draft = await deps.drafts.get(msg.data.draftId);
      return draft ? { ok: true, value: draft } : { ok: false, error: "draft_not_found" };
    }
    await deps.drafts.delete(msg.data.draftId);
    return { ok: true, value: null };
  }

  return { ok: false, error: "sender_not_allowed" };
}
