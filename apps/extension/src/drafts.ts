import { CapturedConversationSchema, type CapturedConversation } from "@mail2code/protocol";
import type { DraftStore } from "./router.ts";

export const DRAFT_TTL_MS = 60 * 60 * 1000;

interface KV {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}

// Drafts live in storage.session: memory only, cleared when the browser
// closes, and not readable by content scripts by default.
export function createDraftStore(kv: KV, now: () => number = Date.now): DraftStore {
  const key = (id: string) => `draft:${id}`;
  return {
    async put(conversation) {
      const id = crypto.randomUUID();
      await kv.set({ [key(id)]: { conversation, createdAt: now() } });
      return id;
    },
    async get(id) {
      const stored = (await kv.get(key(id)))[key(id)] as { conversation: unknown; createdAt: number } | undefined;
      if (!stored) return null;
      if (now() - stored.createdAt > DRAFT_TTL_MS) {
        await kv.remove(key(id));
        return null;
      }
      const parsed = CapturedConversationSchema.safeParse(stored.conversation);
      return parsed.success ? (parsed.data satisfies CapturedConversation) : null;
    },
    async delete(id) {
      await kv.remove(key(id));
    },
  };
}
