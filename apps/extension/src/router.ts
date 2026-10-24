import type { CapturedConversation } from "@inbox-handoff/protocol";
import type { BridgeClient } from "./bridge.ts";
import { GmailMessageSchema, PageMessageSchema, type Reply } from "./messages.ts";
import type { SenderKind } from "./sender.ts";

export interface DraftStore {
  put(conversation: CapturedConversation): Promise<string>;
  get(draftId: string): Promise<CapturedConversation | null>;
  delete(draftId: string): Promise<void>;
}

export interface RouterDeps {
  drafts: DraftStore;
  bridge: BridgeClient;
  openReview(draftId: string): Promise<void>;
}

// Capability matrix:
//   gmail-content-script -> capture only (stores a draft, opens the review page)
//   extension-page       -> read/discard drafts, list projects, submit a handoff
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
    switch (msg.data.kind) {
      case "draft.get": {
        const draft = await deps.drafts.get(msg.data.draftId);
        return draft ? { ok: true, value: draft } : { ok: false, error: "draft_not_found" };
      }
      case "draft.discard":
        await deps.drafts.delete(msg.data.draftId);
        return { ok: true, value: null };
      case "projects.list":
        return deps.bridge.listProjects();
      case "handoff.submit": {
        // The handoff must describe messages that were actually captured in
        // this draft; the page cannot invent content or ids.
        const draft = await deps.drafts.get(msg.data.draftId);
        if (!draft) return { ok: false, error: "draft_not_found" };
        const h = msg.data.handoff;
        const byId = new Map(draft.messages.map((m) => [m.messageId, m]));
        const consistent =
          h.threadId === draft.threadId &&
          h.threadUrl === draft.threadUrl &&
          h.messages.every((m) => {
            const c = byId.get(m.messageId);
            return !!c && c.bodyText === m.bodyText && c.from === m.from && c.date === m.date && m.subject === draft.subject;
          });
        if (!consistent) return { ok: false, error: "handoff_does_not_match_capture" };
        const result = await deps.bridge.submitHandoff(h);
        if (result.ok) await deps.drafts.delete(msg.data.draftId);
        return result;
      }
    }
  }

  return { ok: false, error: "sender_not_allowed" };
}
