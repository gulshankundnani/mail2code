// Approval emails handed over from Gmail. After the user clicks "Review" or
// "Check and record" on the card, the content script passes the sealed block
// to the background, which keeps it here (storage.session: memory only,
// cleared when the browser closes) until the extension page opens it.
// Nothing here is trusted: the pages unseal, validate and verify it.
import { z } from "zod";
import { MAX_SEALED_CHARS } from "@mail2code/protocol";

export const INBOX_TTL_MS = 60 * 60 * 1000;

export const ApprovalBlockSchema = z.strictObject({
  kind: z.enum(["request", "response", "update"]),
  block: z.string().min(1).max(MAX_SEALED_CHARS),
  // Sender of the Gmail message ("Name <address>"), used only to address the reply.
  from: z.string().max(1_000),
  // Gmail account index of the tab, so a reply draft opens in the same account.
  account: z.number().int().min(0).max(99),
});
export type ApprovalBlock = z.infer<typeof ApprovalBlockSchema>;

export interface ApprovalInbox {
  put(item: ApprovalBlock): Promise<string>;
  get(id: string): Promise<ApprovalBlock | null>;
  delete(id: string): Promise<void>;
}

interface KV {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}

export function createApprovalInbox(kv: KV, now: () => number = Date.now): ApprovalInbox {
  const key = (id: string) => `approval:${id}`;
  return {
    async put(item) {
      const id = crypto.randomUUID();
      await kv.set({ [key(id)]: { item, createdAt: now() } });
      return id;
    },
    async get(id) {
      const stored = (await kv.get(key(id)))[key(id)] as { item: unknown; createdAt: number } | undefined;
      if (!stored) return null;
      if (now() - stored.createdAt > INBOX_TTL_MS) {
        await kv.remove(key(id));
        return null;
      }
      const parsed = ApprovalBlockSchema.safeParse(stored.item);
      return parsed.success ? parsed.data : null;
    },
    async delete(id) {
      await kv.remove(key(id));
    },
  };
}

// "Priya Example <priya@example.test>" -> "priya@example.test" (or "" if none).
export function addressOf(from: string): string {
  const m = /<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>\s*$/.exec(from) ?? /^([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/.exec(from.trim());
  return m ? m[1]! : "";
}
