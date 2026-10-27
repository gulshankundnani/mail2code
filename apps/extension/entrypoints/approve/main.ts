// The approver's side: review one approval request and sign a decision.
// The request may come from Gmail (handed over after the user clicked
// "Review request" on the card), be pasted, or be opened as a file. Signing
// happens here, in the extension, never in the Gmail page.
import type { ApprovalDecision, ApprovalRequest, ApprovalResponse } from "@mail2code/protocol";
import { requestPlanMatches } from "@mail2code/task-core";
import { browser } from "wxt/browser";
import { downloadText, readRequest, responseSubject, sealResponse } from "../../src/approval-blocks.ts";
import { addressOf, type ApprovalBlock } from "../../src/approval-inbox.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { gmailComposeUrl } from "../../src/gmail-compose.ts";
import type { PageMessage, Reply } from "../../src/messages.ts";
import { $, errorText, formatTime, setStatus } from "../../src/ui.ts";

const send = (msg: PageMessage) => browser.runtime.sendMessage(msg) as Promise<Reply>;
const inboxId = new URLSearchParams(location.search).get("inbox") ?? "";

let repo: TaskRepo;
let request: ApprovalRequest | null = null;
let replyTo = "";
let account = 0;
let signed: { response: ApprovalResponse; block: string; draftUrl: string } | null = null;

function decision(): ApprovalDecision | null {
  return (document.querySelector<HTMLInputElement>("input[name=decision]:checked")?.value as ApprovalDecision | undefined) ?? null;
}

async function load(text: string) {
  request = null;
  $("review-box").hidden = true;
  if (!text.trim()) return setStatus("");
  try {
    const r = await readRequest(text);
    const me = await repo.getIdentity();
    if (!me) return setStatus("You don't have an approver identity in this browser yet. Create one in Settings → Approvers first.", "error");
    if (r.approverFingerprint !== me.fingerprint) return setStatus("This request is addressed to a different approver, not to your approver identity.", "error");
    if (!(await requestPlanMatches(r))) return setStatus("The plan in this request doesn't match its fingerprint. It was changed after it was sent; ask for a new request.", "error");
    const expired = Date.parse(r.expiresAt) < Date.now();
    request = r;
    $("req-from").textContent = [r.requesterName || "(no name given)", replyTo ? `<${replyTo}>` : ""].filter(Boolean).join(" ");
    $("req-task").textContent = r.task.title;
    $("req-plan").textContent = `Version ${r.plan.version} · fingerprint ${r.plan.hash.slice(0, 16)}…`;
    $("req-expires").textContent = `${formatTime(Date.parse(r.expiresAt))}${expired ? " (expired)" : ""}`;
    $("req-plan-text").textContent = r.plan.text;
    $("review-box").hidden = false;
    $("load-box").hidden = !!inboxId;
    updateSign();
    setStatus(expired ? "This request has expired. Ask the requester to send a new one." : "Read the plan, then choose your decision.", expired ? "error" : "info");
  } catch (err) {
    setStatus(errorText(err), "error");
  }
}

function updateSign() {
  const expired = request ? Date.parse(request.expiresAt) < Date.now() : true;
  $<HTMLButtonElement>("sign").disabled = !request || !decision() || expired || !!signed;
}

async function sign() {
  const d = decision();
  if (!request || !d) return;
  const comment = $<HTMLTextAreaElement>("comment").value.trim();
  const response = await repo.signDecision({
    requestId: request.requestId,
    taskId: request.task.id,
    planVersion: request.plan.version,
    planHash: request.plan.hash,
    decision: d,
    comment: comment || null,
  });
  // Remember what was signed, so progress updates from the requester can be shown.
  await repo.recordGivenApproval(request, response, replyTo);
  const block = await sealResponse(response);
  const verb = d === "approve" ? "I approve" : d === "reject" ? "I reject" : "I'm requesting changes to";
  const intro =
    `${verb} plan version ${request.plan.version} of "${request.task.title}".${comment ? `\n\nComment: ${comment}` : ""}\n\n` +
    "Open this email in Gmail and click the Mail2Code icon next to the subject to record the decision. Mail2Code checks the signed data below; the wording of this email doesn't count.";
  const draftUrl = gmailComposeUrl({ account, to: replyTo || undefined, subject: responseSubject(request, d), body: `${intro}\n\n${block}\n` });
  signed = { response, block, draftUrl };
  await browser.tabs.create({ url: draftUrl });
  if (inboxId) void send({ kind: "approval.discard", itemId: inboxId });
  $("done-text").textContent = replyTo
    ? `A reply draft to ${replyTo} opened in Gmail. Press Send there. Nothing has been sent yet. The task now appears under "Approved by me" in your Task dashboard.`
    : "A reply draft opened in Gmail. Add the requester's address and press Send. Nothing has been sent yet. The task now appears under \"Approved by me\" in your Task dashboard.";
  $("done-box").hidden = false;
  updateSign();
  setStatus("Decision signed.", "success");
}

async function init() {
  $<HTMLAnchorElement>("all-tasks").href = browser.runtime.getURL("/options.html");
  repo = await TaskRepo.open();
  document.querySelectorAll("input[name=decision]").forEach((r) => r.addEventListener("change", updateSign));
  $("sign").addEventListener("click", () => void sign().catch((err) => setStatus(errorText(err), "error")));
  $("reopen-draft").addEventListener("click", () => signed && void browser.tabs.create({ url: signed.draftUrl }));
  $("copy-response").addEventListener("click", async () => {
    if (!signed) return;
    await navigator.clipboard.writeText(signed.block);
    setStatus("Response copied. Paste it into an email to the requester.", "success");
  });
  $("download-response").addEventListener("click", () => {
    if (signed) downloadText(`approval-response-${signed.response.payload.requestId.slice(0, 8)}.json`, JSON.stringify(signed.response, null, 2));
  });
  const text = $<HTMLTextAreaElement>("request-text");
  text.addEventListener("input", () => void load(text.value));
  $<HTMLInputElement>("request-file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) return setStatus("This file is too large to be an approval request.", "error");
    text.value = await f.text();
    await load(text.value);
  });

  if (inboxId) {
    const reply = await send({ kind: "approval.get", itemId: inboxId });
    if (!reply.ok) return setStatus("This request is no longer available. Go back to the email and click the Mail2Code icon again.", "error");
    const item = reply.value as ApprovalBlock;
    replyTo = addressOf(item.from);
    account = item.account;
    await load(item.block);
  }
}

void init().catch((err) => setStatus(errorText(err), "error"));
