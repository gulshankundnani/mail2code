import { describe, expect, it } from "vitest";
import type { CapturedConversation } from "@inbox-handoff/protocol";
import { createDraftStore, DRAFT_TTL_MS } from "../src/drafts.ts";
import { buildTaskCreate, type ReviewForm } from "../src/handoff.ts";
import { routeMessage, type RouterDeps } from "../src/router.ts";
import { classifySender } from "../src/sender.ts";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}/`;

const conversation: CapturedConversation = {
  threadId: "thread-f:1",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:1",
  subject: "Fix login",
  messages: [
    { messageId: "msg-f:1", from: "Ada <ada@example.test>", date: "Oct 1", bodyText: "first", truncated: false },
    { messageId: "msg-f:2", from: "Lin <lin@example.test>", date: "Oct 2", bodyText: "second", truncated: false },
  ],
  collapsedCount: 0,
  capturedAt: "2026-10-24T12:00:00.000Z",
};

const form = (over: Partial<ReviewForm> = {}): ReviewForm => ({
  scope: "message",
  selectedMessageId: "msg-f:2",
  repositoryRef: "",
  title: "",
  instructions: "",
  priority: "normal",
  dueDate: "",
  ...over,
});

function memoryKv() {
  const m = new Map<string, unknown>();
  return {
    get: async (k: string) => (m.has(k) ? { [k]: m.get(k) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([k, v]) => m.set(k, v)),
    remove: async (k: string | string[]) => void [k].flat().forEach((x) => m.delete(x)),
  };
}

function deps() {
  const opened: string[] = [];
  const d: RouterDeps = { drafts: createDraftStore(memoryKv()), openReview: async (id) => void opened.push(id) };
  return { d, opened };
}

describe("classifySender", () => {
  it("recognises the extension's own pages and the top-frame Gmail content script", () => {
    expect(classifySender({ id: ID, url: `${ORIGIN}review.html?draft=x`, tab: {}, frameId: 0 }, ID, ORIGIN)).toBe("extension-page");
    expect(classifySender({ id: ID, url: "https://mail.google.com/mail/u/0/#inbox", tab: {}, frameId: 0 }, ID, ORIGIN)).toBe("gmail-content-script");
  });

  it("rejects other extensions, subframes, lookalike hosts and missing urls", () => {
    expect(classifySender({ id: "other", url: `${ORIGIN}review.html`, tab: {}, frameId: 0 }, ID, ORIGIN)).toBe("untrusted");
    expect(classifySender({ id: ID, url: "https://mail.google.com/x", tab: {}, frameId: 3 }, ID, ORIGIN)).toBe("untrusted");
    expect(classifySender({ id: ID, url: "https://mail.google.com.evil.test/", tab: {}, frameId: 0 }, ID, ORIGIN)).toBe("untrusted");
    expect(classifySender({ id: ID, tab: {}, frameId: 0 }, ID, ORIGIN)).toBe("untrusted");
  });
});

describe("routeMessage", () => {
  it("lets Gmail capture a draft and open the review page", async () => {
    const { d, opened } = deps();
    expect((await routeMessage({ kind: "capture", conversation }, "gmail-content-script", d)).ok).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it("never lets the Gmail page read or discard drafts", async () => {
    const { d } = deps();
    const draftId = await d.drafts.put(conversation);
    for (const msg of [{ kind: "draft.get", draftId }, { kind: "draft.discard", draftId }]) {
      expect(await routeMessage(msg, "gmail-content-script", d)).toEqual({ ok: false, error: "invalid_message" });
    }
    expect(await d.drafts.get(draftId)).not.toBeNull();
  });

  it("ignores untrusted senders entirely", async () => {
    const { d, opened } = deps();
    expect(await routeMessage({ kind: "capture", conversation }, "untrusted", d)).toEqual({ ok: false, error: "sender_not_allowed" });
    expect(opened).toHaveLength(0);
  });

  it("lets extension pages read and discard drafts", async () => {
    const { d } = deps();
    const draftId = await d.drafts.put(conversation);
    expect((await routeMessage({ kind: "draft.get", draftId }, "extension-page", d)).ok).toBe(true);
    await routeMessage({ kind: "draft.discard", draftId }, "extension-page", d);
    expect(await d.drafts.get(draftId)).toBeNull();
  });
});

describe("buildTaskCreate", () => {
  it("defaults the title to the subject and uses only the chosen message", async () => {
    const r = await buildTaskCreate(conversation, form());
    expect(r.ok && r.task.title).toBe("Fix login");
    expect(r.ok && r.task.messages.map((m) => m.messageId)).toEqual(["msg-f:2"]);
  });

  it("includes every captured message for thread scope", async () => {
    const r = await buildTaskCreate(conversation, form({ scope: "thread" }));
    expect(r.ok && r.task.messages).toHaveLength(2);
  });

  it("produces a stable duplicate key that changes with instructions or repository", async () => {
    const key = async (f: ReviewForm) => {
      const r = await buildTaskCreate(conversation, f);
      return r.ok ? r.task.idempotencyKey : null;
    };
    const base = await key(form());
    expect(await key(form())).toBe(base);
    expect(await key(form({ instructions: "also add tests" }))).not.toBe(base);
    expect(await key(form({ repositoryRef: "https://github.com/example/app" }))).not.toBe(base);
  });
});

describe("draft store", () => {
  it("expires drafts after the TTL", async () => {
    let t = 0;
    const store = createDraftStore(memoryKv(), () => t);
    const id = await store.put(conversation);
    t = DRAFT_TTL_MS + 1;
    expect(await store.get(id)).toBeNull();
  });
});
