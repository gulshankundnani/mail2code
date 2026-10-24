import { describe, expect, it } from "vitest";
import type { CapturedConversation } from "@inbox-handoff/protocol";
import { createFakeBridge, createUnavailableBridge } from "../src/bridge.ts";
import { createDraftStore, DRAFT_TTL_MS } from "../src/drafts.ts";
import { buildHandoff, type ReviewForm } from "../src/handoff.ts";
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
  projectId: "proj_e2e",
  title: "",
  instructions: "",
  priority: "normal",
  dueDate: "",
  ...over,
});

function memoryKv() {
  const m = new Map<string, unknown>();
  return {
    m,
    get: async (k: string) => (m.has(k) ? { [k]: m.get(k) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([k, v]) => m.set(k, v)),
    remove: async (k: string | string[]) => void [k].flat().forEach((x) => m.delete(x)),
  };
}

function deps(bridge = createFakeBridge()) {
  const opened: string[] = [];
  const d: RouterDeps = { drafts: createDraftStore(memoryKv()), bridge, openReview: async (id) => void opened.push(id) };
  return { d, opened, bridge };
}

describe("classifySender", () => {
  it("recognises the extension's own pages", () => {
    expect(classifySender({ id: ID, url: `${ORIGIN}review.html?draft=x`, tab: {}, frameId: 0 }, ID, ORIGIN)).toBe("extension-page");
  });

  it("recognises the top-frame Gmail content script", () => {
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
    const r = await routeMessage({ kind: "capture", conversation }, "gmail-content-script", d);
    expect(r.ok).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it("never lets the Gmail page submit a handoff, list projects or read drafts", async () => {
    const { d, bridge } = deps();
    const draftId = await d.drafts.put(conversation);
    const built = await buildHandoff(conversation, form());
    if (!built.ok) throw new Error(built.error);
    for (const msg of [{ kind: "handoff.submit", draftId, handoff: built.handoff }, { kind: "projects.list" }, { kind: "draft.get", draftId }]) {
      expect(await routeMessage(msg, "gmail-content-script", d)).toEqual({ ok: false, error: "invalid_message" });
    }
    expect(bridge.received).toHaveLength(0);
  });

  it("ignores untrusted senders entirely", async () => {
    const { d, opened } = deps();
    expect(await routeMessage({ kind: "capture", conversation }, "untrusted", d)).toEqual({ ok: false, error: "sender_not_allowed" });
    expect(opened).toHaveLength(0);
  });

  it("submits a handoff built from the captured draft and deletes the draft", async () => {
    const { d, bridge } = deps();
    const draftId = await d.drafts.put(conversation);
    const built = await buildHandoff(conversation, form());
    if (!built.ok) throw new Error(built.error);
    expect(await routeMessage({ kind: "handoff.submit", draftId, handoff: built.handoff }, "extension-page", d)).toEqual({
      ok: true,
      value: { taskId: "fake-task-1", created: true },
    });
    expect(bridge.received[0]!.messages.map((m) => m.messageId)).toEqual(["msg-f:2"]);
    expect(await d.drafts.get(draftId)).toBeNull();
  });

  it("rejects a handoff whose content differs from what was captured", async () => {
    const { d, bridge } = deps();
    const draftId = await d.drafts.put(conversation);
    const built = await buildHandoff(conversation, form());
    if (!built.ok) throw new Error(built.error);
    const forged = { ...built.handoff, messages: [{ ...built.handoff.messages[0]!, bodyText: "injected" }] };
    expect(await routeMessage({ kind: "handoff.submit", draftId, handoff: forged }, "extension-page", d)).toEqual({
      ok: false,
      error: "handoff_does_not_match_capture",
    });
    expect(bridge.received).toHaveLength(0);
  });

  it("reports the bridge as unavailable in production builds", async () => {
    const { d } = deps(createUnavailableBridge() as ReturnType<typeof createFakeBridge>);
    expect(await routeMessage({ kind: "projects.list" }, "extension-page", d)).toEqual({ ok: false, error: "bridge_not_connected" });
  });
});

describe("buildHandoff", () => {
  it("defaults the title to the subject and uses only the chosen message", async () => {
    const r = await buildHandoff(conversation, form());
    expect(r.ok && r.handoff.title).toBe("Fix login");
    expect(r.ok && r.handoff.messages).toHaveLength(1);
  });

  it("includes every captured message for thread scope", async () => {
    const r = await buildHandoff(conversation, form({ scope: "thread" }));
    expect(r.ok && r.handoff.messages.map((m) => m.messageId)).toEqual(["msg-f:1", "msg-f:2"]);
  });

  it("produces a stable idempotency key that changes with instructions or project", async () => {
    const key = async (f: ReviewForm) => {
      const r = await buildHandoff(conversation, f);
      return r.ok ? r.handoff.idempotencyKey : null;
    };
    const base = await key(form());
    expect(await key(form())).toBe(base);
    expect(await key(form({ instructions: "also add tests" }))).not.toBe(base);
    expect(await key(form({ projectId: "proj_other" }))).not.toBe(base);
    expect(base).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses to build without a project", async () => {
    expect(await buildHandoff(conversation, form({ projectId: "" }))).toEqual({ ok: false, error: "Choose a project." });
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
