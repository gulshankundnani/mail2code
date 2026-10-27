// The card shown instead of "Send to Claude" when the email the user clicked
// on contains a Mail2Code approval request, approval response or progress update.
//
// Security notes:
// - The card never reviews, signs or records anything. On a real click it
//   hands the sealed block to the background, which opens an extension page;
//   the decision happens there, out of reach of the Gmail page.
// - Email-derived text (the sender) is inserted with textContent only.
// - Synthetic clicks from page scripts are ignored.
import { findSealedBlocks, type SealedKind } from "@mail2code/protocol/approval-seal";
import type { CapturedConversation } from "@mail2code/protocol";
import { icon } from "../icons.ts";
import type { Reply } from "../messages.ts";
import { applyStyles } from "../shadow-style.ts";
import { CARD_ATTR, CARD_CSS } from "./card.ts";

export interface FoundApproval {
  kind: SealedKind;
  block: string;
  from: string;
}

// The approval block the newest message carries. In a reply, the sender's own
// block comes before the quoted request, so the first block of the newest
// message that has any is the one meant for the reader.
export function findApproval(conversation: CapturedConversation): FoundApproval | null {
  for (const m of [...conversation.messages].reverse()) {
    const [first] = findSealedBlocks(m.bodyText);
    if (first) return { kind: first.kind, block: first.text, from: m.from };
  }
  return null;
}

export interface ApprovalCardDeps {
  sendMessage(msg: unknown): Promise<Reply | undefined>;
  // Shows the normal Send to Claude card for the same email instead.
  sendToClaude(): void;
  account: number;
  requireTrustedEvents?: boolean;
}

const TEXT = {
  request: {
    title: "Approval request",
    sub: "This email asks you to approve a plan in Mail2Code.",
    body: "Review the plan on a Mail2Code page and sign your decision there. Nothing is sent until you press Send on the reply draft.",
    action: "Review request",
  },
  response: {
    title: "Approval response",
    sub: "This email answers one of your approval requests.",
    body: "Mail2Code checks the signature against your trusted approvers and shows you the task before anything is recorded. The wording of the email doesn't count.",
    action: "Check and record",
  },
  update: {
    title: "Progress update",
    sub: "News about a task you approved.",
    body: "Mail2Code checks that it was signed by the person who asked you to approve, then updates your \"Approved by me\" list.",
    action: "Update my list",
  },
} as const;

export function openApprovalCard(doc: Document, found: FoundApproval, deps: ApprovalCardDeps): { close(): void; root: ShadowRoot } {
  doc.querySelectorAll(`[${CARD_ATTR}]`).forEach((n) => n.remove());
  const host = doc.createElement("div");
  host.setAttribute(CARD_ATTR, "approval");
  const root = host.attachShadow({ mode: "open" });
  applyStyles(doc, root, CARD_CSS);
  const trusted = (e: Event) => deps.requireTrustedEvents === false || e.isTrusted;
  const t = TEXT[found.kind];

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
    const e = doc.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };

  const card = el("div", undefined, "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "ap-title");
  const head = el("header", undefined, "head");
  const mark = el("span", undefined, "mark");
  mark.append(icon(doc, "mail2code", 20));
  const titles = el("div", undefined, "titles");
  const title = el("h2", t.title);
  title.id = "ap-title";
  titles.append(title, el("p", t.sub, "sub"));
  const closeBtn = el("button", undefined, "close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.append(icon(doc, "close", 18));
  head.append(mark, titles, closeBtn);

  const body = el("div", undefined, "body");
  body.append(el("p", `From: ${found.from || "(unknown sender)"}`, "meta"), el("p", t.body));

  const primary = el("button", undefined, "primary-btn");
  primary.type = "button";
  primary.id = "ap-open";
  primary.append(icon(doc, "open"), el("span", t.action));
  const other = el("button", undefined, "link");
  other.type = "button";
  other.append(el("span", "Send to Claude instead"));
  const status = el("p", "", "err");
  status.setAttribute("role", "status");
  const actions = el("div", undefined, "actions");
  actions.append(primary);
  const nav = el("nav", undefined, "nav");
  nav.setAttribute("aria-label", "Mail2Code");
  nav.append(other);
  const foot = el("footer", undefined, "foot");
  foot.append(actions, status, nav);
  card.append(head, body, foot);
  root.append(card);
  doc.body.append(host);

  const close = () => host.remove();
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    card.addEventListener(type, (e) => {
      if (type === "keydown" && (e as KeyboardEvent).key === "Escape") close();
      e.stopPropagation();
    });
  }
  closeBtn.addEventListener("click", close);
  other.addEventListener("click", (e) => {
    if (!trusted(e)) return;
    close();
    deps.sendToClaude();
  });
  primary.addEventListener("click", async (e) => {
    if (!trusted(e)) return;
    primary.disabled = true;
    const reply = await deps.sendMessage({ kind: "approval.block", item: { kind: found.kind, block: found.block, from: found.from, account: deps.account } });
    if (reply?.ok) close();
    else {
      status.textContent = reply && !reply.ok ? reply.error : "Mail2Code didn't respond. Reload Gmail and try again.";
      primary.disabled = false;
    }
  });
  primary.focus();
  return { close, root };
}
