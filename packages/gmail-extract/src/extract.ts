import { CapturedConversationSchema, LIMITS, type CapturedConversation, type CapturedMessage } from "@inbox-handoff/protocol";
import { SELECTORS, isHidden, queryAllFirstMatching, queryFirst } from "./selectors.ts";
import { elementToText } from "./text.ts";

export type ExtractError =
  | "no_conversation_open"
  | "ambiguous_conversation"
  | "thread_not_identified"
  | "message_not_identified"
  | "duplicate_message_ids"
  | "no_expanded_messages"
  | "too_many_messages"
  | "not_gmail";

export type ExtractResult = { ok: true; value: CapturedConversation } | { ok: false; error: ExtractError; detail?: string };

const ID_CHARS = /[^A-Za-z0-9:#_-]/g;

export interface ConversationHandle {
  subject: Element;
  root: Element;
}

// Structural check only (is a single conversation open?). Reads no email
// content; safe to call from the DOM observer that keeps the button in place.
export function findConversation(doc: Document): ConversationHandle | "ambiguous" | null {
  const subjects = SELECTORS.subject
    .flatMap((s) => Array.from(doc.querySelectorAll(s)))
    .filter((el, i, all) => all.indexOf(el) === i && !isHidden(el));
  if (subjects.length === 0) return null;
  if (subjects.length > 1) return "ambiguous";
  const subject = subjects[0]!;
  const root = subject.closest("[role='main']") ?? doc.body;
  return { subject, root };
}

function cleanId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const id = raw.replace(/^#/, "").replace(ID_CHARS, "");
  return id.length > 0 && id.length <= 200 ? id : null;
}

function threadIdFrom(subject: Element, href: string): string | null {
  const fromAttr = cleanId(subject.getAttribute("data-thread-perm-id")) ?? cleanId(subject.getAttribute("data-legacy-thread-id"));
  if (fromAttr) return fromAttr;
  // Fallback: the last hash segment of a conversation URL, e.g. #inbox/FMfcgzQ...
  const last = new URL(href).hash.split("/").pop() ?? "";
  return /^[A-Za-z0-9_-]{10,200}$/.test(last) ? last : null;
}

function senderOf(msg: Element): string {
  const el = queryFirst(msg, SELECTORS.sender);
  if (!el) return "";
  const email = el.getAttribute("email") ?? "";
  const name = el.getAttribute("name") ?? (el.textContent ?? "").trim();
  return (email && name && name !== email ? `${name} <${email}>` : email || name).slice(0, 1_000);
}

function dateOf(msg: Element): string {
  const el = queryFirst(msg, SELECTORS.date);
  return (el?.getAttribute("title") ?? el?.textContent ?? "").trim().slice(0, 200);
}

function olderCollapsedCount(root: Element): number {
  const el = queryFirst(root, SELECTORS.olderMessagesCount);
  const n = Number.parseInt((el?.textContent ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function threadUrlFrom(href: string): string | null {
  const u = new URL(href);
  if (u.origin !== "https://mail.google.com") return null;
  return `${u.origin}${u.pathname}${u.hash}`;
}

// Captures every *expanded* message of the open conversation. Called only in
// response to the user's click. Fails rather than guessing when identity is unclear.
export function extractConversation(doc: Document, href: string, now: Date = new Date()): ExtractResult {
  const threadUrl = threadUrlFrom(href);
  if (!threadUrl) return { ok: false, error: "not_gmail" };
  const conv = findConversation(doc);
  if (conv === null) return { ok: false, error: "no_conversation_open" };
  if (conv === "ambiguous") return { ok: false, error: "ambiguous_conversation" };

  const threadId = threadIdFrom(conv.subject, href);
  if (!threadId) return { ok: false, error: "thread_not_identified" };

  const all = queryAllFirstMatching(conv.root, SELECTORS.message).filter((m) => !isHidden(m));
  const messages: CapturedMessage[] = [];
  let collapsed = olderCollapsedCount(conv.root);
  const seen = new Set<string>();
  for (const m of all) {
    const body = queryFirst(m, SELECTORS.body);
    if (!body) {
      collapsed++;
      continue;
    }
    const messageId = cleanId(m.getAttribute("data-message-id")) ?? cleanId(m.getAttribute("data-legacy-message-id"));
    if (!messageId) return { ok: false, error: "message_not_identified" };
    if (seen.has(messageId)) return { ok: false, error: "duplicate_message_ids", detail: messageId };
    seen.add(messageId);
    const text = elementToText(body);
    const truncated = text.length > LIMITS.maxMessageBodyChars;
    messages.push({ messageId, from: senderOf(m), date: dateOf(m), bodyText: truncated ? text.slice(0, LIMITS.maxMessageBodyChars) : text, truncated });
  }
  if (messages.length === 0) return { ok: false, error: "no_expanded_messages" };
  if (messages.length > LIMITS.maxMessagesPerHandoff) return { ok: false, error: "too_many_messages" };

  const parsed = CapturedConversationSchema.safeParse({
    threadId,
    threadUrl,
    subject: (conv.subject.textContent ?? "").trim().slice(0, LIMITS.maxSubjectChars),
    messages,
    collapsedCount: collapsed,
    capturedAt: now.toISOString(),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "message_not_identified", detail: parsed.error.message };
}

export const EXTRACT_ERROR_TEXT: Record<ExtractError, string> = {
  no_conversation_open: "Open an email conversation first.",
  ambiguous_conversation: "More than one conversation is on screen, so the right one can't be identified. Open a single conversation and try again.",
  thread_not_identified: "This conversation couldn't be identified reliably. Reload Gmail and try again.",
  message_not_identified: "A message in this conversation couldn't be identified reliably. Reload Gmail and try again.",
  duplicate_message_ids: "Gmail showed the same message twice. Reload Gmail and try again.",
  no_expanded_messages: "No message is expanded. Click a message to open it, then try again.",
  too_many_messages: "This conversation has too many expanded messages. Collapse some and try again.",
  not_gmail: "This only works on mail.google.com.",
};
