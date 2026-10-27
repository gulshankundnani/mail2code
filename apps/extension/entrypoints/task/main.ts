import type { TaskStatus } from "@mail2code/protocol";
import { STATUS_LABELS, allowedTargets, type PendingRequest, type PlanRecord, type TrustedApprover } from "@mail2code/task-core";
import { browser } from "wxt/browser";
import { PROGRESS_LABELS, downloadText, readResponse, requestSubject, sealRequest, sealUpdate, updateSubject } from "../../src/approval-blocks.ts";
import type { ApprovalBlock } from "../../src/approval-inbox.ts";
import { buildBrief, buildContextUpdate, handoffDestination } from "../../src/brief.ts";
import type { EventRecord, SnapshotRecord, TaskRecord } from "../../src/db/schema.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { composeOrPaste, gmailAccountOf } from "../../src/gmail-compose.ts";
import type { PageMessage, Reply } from "../../src/messages.ts";
import { $, el, errorText, formatTime, setStatus } from "../../src/ui.ts";

const params = new URLSearchParams(location.search);
const taskId = params.get("id") ?? "";
const inboxId = params.get("inbox") ?? "";
const send = (msg: PageMessage) => browser.runtime.sendMessage(msg) as Promise<Reply>;
const REQUESTER_NAME_KEY = "mail2code.requesterName";
let repo: TaskRepo;
let approvers: TrustedApprover[] = [];
// Status at the previous render: a change offers to tell the approver (D8).
let shownStatus: TaskStatus | null = null;
let task: TaskRecord | null = null;
let latestPlan: PlanRecord | null = null;
let snapshot: SnapshotRecord | null = null;
let brief = "";
// Messages added by a refresh after the brief was handed off.
let newMessageIds: string[] = [];

const BLOCK_REASON_TEXT: Record<string, string> = {
  imported_requires_review: "Restored from a backup: review before continuing.",
  plan_needs_changes: "The plan needs changes.",
  blocked_by_user: "Blocked by you.",
  context_changed: "New email messages arrived after approval: review the plan again.",
};

const DECISION_VERB: Record<string, string> = { approve: "Approved", reject: "Rejected", request_changes: "Changes requested" };

function requestState(r: PendingRequest): string {
  if (r.usedAt) return `answered ${formatTime(r.usedAt)}`;
  if (latestPlan && r.planId !== latestPlan.id) return "out of date (the plan changed)";
  if (r.expiresAt < Date.now()) return "expired";
  return `waiting for a reply until ${formatTime(r.expiresAt)}`;
}

function eventText(e: EventRecord): string {
  const d = e.data;
  switch (e.type) {
    case "task.captured":
      return `Captured ${String(d.messageCount)} message(s) from Gmail`;
    case "task.transition":
      return `${STATUS_LABELS[d.from as TaskStatus] ?? String(d.from)} → ${STATUS_LABELS[d.to as TaskStatus] ?? String(d.to)}${d.decision ? ` (${String(d.decision)}, plan v${String(d.planVersion)})` : ""}`;
    case "plan.recorded":
      return `Plan v${String(d.version)} recorded (fingerprint ${String(d.hash).slice(0, 12)}…)`;
    case "note":
      return `Note: ${String(d.text)}`;
    case "context.refreshed": {
      const n = Array.isArray(d.added) ? d.added.length : 0;
      return n === 0 ? "Context refreshed: no new messages" : `Context refreshed: ${n} new message${n === 1 ? "" : "s"} added`;
    }
    case "context.purged":
      return d.reason === "retention" ? "Stored email text deleted (retention setting)" : "Stored email text deleted by you";
    case "approval.requested":
      return `Approval of plan v${String(d.planVersion)} requested from ${String(d.approver)}`;
    case "approval.signed":
      return `${DECISION_VERB[String(d.decision)] ?? String(d.decision)} by ${String(d.approver)}, plan v${String(d.planVersion)} (signature verified)`;
    case "progress.sent":
      return `Progress update #${String(d.seq)} prepared for ${String(d.approver)} (${PROGRESS_LABELS[d.status as TaskStatus] ?? String(d.status)})`;
    case "approval.requirement":
      return d.approver ? `Only ${String(d.approver)}'s signed approval counts from now on` : "Anyone's approval counts again, including yours";
    default:
      return e.type;
  }
}

const can = (to: TaskStatus, cause: "user_action" | "user_approval" = "user_action") => !!task && allowedTargets(task.status, cause).includes(to);

async function render() {
  task = await repo.getTask(taskId);
  approvers = await repo.listApprovers();
  if (!task) {
    setStatus("This task doesn't exist (it may have been deleted).", "error");
    document.querySelectorAll("section").forEach((s) => (s.hidden = true));
    return;
  }
  const plans = await repo.getPlans(taskId);
  latestPlan = plans.at(-1) ?? null;
  const approvals = await repo.getApprovals(taskId);
  snapshot = await repo.getSnapshot(taskId);
  brief = buildBrief(task, snapshot);
  const dest = handoffDestination(task.repositoryRef);
  const openedAt = task.handoff.openedAt;
  newMessageIds = openedAt === null ? [] : task.sources.filter((s) => (s.addedAt ?? 0) > openedAt).map((s) => s.messageId);

  // Changed-requirements warning: messages arrived after the latest plan.
  const changedAt = task.contextChangedAt ?? null;
  const banner = $("context-banner");
  const afterPlan = changedAt !== null && latestPlan !== null && changedAt > latestPlan.recordedAt;
  banner.hidden = !afterPlan && !(changedAt !== null && newMessageIds.length > 0);
  banner.textContent = afterPlan
    ? `New email messages were added after plan version ${latestPlan!.version} was recorded. Check whether the plan still fits, and record a revised plan if it doesn't.`
    : "New email messages were added after you handed the brief to Claude. Send Claude the update below.";

  document.title = `${task.title} – Mail2Code`;
  $("title").textContent = task.title;
  $("status-label").textContent = STATUS_LABELS[task.status];
  $("status-label").dataset.status = task.status;
  $("block-reason").textContent = task.status === "Blocked" && task.blockReason ? BLOCK_REASON_TEXT[task.blockReason] ?? "" : "";
  $<HTMLAnchorElement>("source-link").href = task.threadUrl;
  $("source-count").textContent = `${task.sources.length} message${task.sources.length === 1 ? "" : "s"} · ${task.sources[0]?.subject ?? ""}`;
  $("repository").textContent = task.repositoryRef || "—";
  $("priority").textContent = task.priority;
  $("due").textContent = task.dueAt ? task.dueAt.slice(0, 10) : "—";
  $("created").textContent = formatTime(task.createdAt);

  // 1. Handoff
  $("brief").textContent = brief;
  $("open-claude").textContent = `Open ${dest.label}`;
  $("destination-hint").textContent = task.handoff.openedAt
    ? `Opened ${dest.label} at ${formatTime(task.handoff.openedAt)}. The extension can't tell whether you sent the brief.`
    : "";
  $<HTMLButtonElement>("copy-brief").disabled = !(task.status === "ReadyForHandoff" || can("ReadyForHandoff"));
  $<HTMLButtonElement>("open-claude").disabled = !(task.status === "ReadyForHandoff" || task.status === "HandoffOpened");
  $<HTMLButtonElement>("mark-submitted").disabled = task.status !== "HandoffOpened";

  // 2. Plan
  $<HTMLButtonElement>("record-plan").disabled = !["Planning", "AwaitingApproval", "Blocked"].includes(task.status);

  // 3. Approval
  $("no-plan").hidden = !!latestPlan;
  $("current-plan").hidden = !latestPlan;
  if (latestPlan) {
    $("plan-meta").textContent = `Plan version ${latestPlan.version} · recorded ${formatTime(latestPlan.recordedAt)} · fingerprint ${latestPlan.hash.slice(0, 16)}…`;
    $("plan-view").textContent = latestPlan.text;
  }
  const awaiting = task.status === "AwaitingApproval" && !!latestPlan;
  const required = task.requiredApprover ? approvers.find((a) => a.fingerprint === task!.requiredApprover) : undefined;
  for (const id of ["approve", "request-changes", "reject"]) $<HTMLButtonElement>(id).disabled = !awaiting;
  if (task.requiredApprover) $<HTMLButtonElement>("approve").disabled = true;
  $("required-hint").hidden = !task.requiredApprover;
  $("required-hint").textContent = `Only ${required?.name ?? "the required approver"}'s signed approval counts for this task. You can still request changes or reject.`;
  const current = approvals.filter((a) => a.decision === "approve" && a.supersededAt === null && a.origin !== "imported" && a.planId === latestPlan?.id).at(-1);
  $("copy-approval").hidden = !current;
  if (task.status === "Approved" && current?.origin === "signed" && current.signedBy) {
    $("status-label").textContent = `Approved by ${current.signedBy.name} (signature verified)`;
  }

  // Approval by another person
  const confirmed = approvers.filter((a) => a.confirmedAt !== null);
  $("no-approvers-hint").hidden = confirmed.length > 0;
  $("ask-form").hidden = confirmed.length === 0;
  const pick = $<HTMLSelectElement>("approver-select");
  const picked = pick.value;
  pick.replaceChildren(...confirmed.map((a) => Object.assign(el("option", `${a.name} <${a.email}>`), { value: a.fingerprint })));
  if (confirmed.some((a) => a.fingerprint === picked)) pick.value = picked;
  else if (required) pick.value = required.fingerprint;
  $<HTMLButtonElement>("ask-approval").disabled = !awaiting || confirmed.length === 0;
  $<HTMLButtonElement>("download-request").disabled = !awaiting || confirmed.length === 0;
  const reqSel = $<HTMLSelectElement>("required-approver");
  reqSel.replaceChildren(
    Object.assign(el("option", "Anyone, including me"), { value: "" }),
    ...confirmed.map((a) => Object.assign(el("option", `Only ${a.name} (signed approval)`), { value: a.fingerprint })),
  );
  reqSel.value = task.requiredApprover ?? "";
  const requests = await repo.getApprovalRequests(taskId);
  const nameOf = (fp: string) => approvers.find((a) => a.fingerprint === fp)?.name ?? "a removed approver";
  $("request-list").replaceChildren(
    ...requests
      .slice()
      .reverse()
      .map((r) => el("li", `Sent to ${nameOf(r.approverFingerprint)} for plan v${r.planVersion} on ${formatTime(r.createdAt)} · ${requestState(r)}`)),
  );
  $<HTMLButtonElement>("import-response").disabled = !$<HTMLTextAreaElement>("response-text").value.trim();

  // Progress updates for the person who approved this task
  const recipient = await repo.progressRecipient(taskId);
  $("update-box").hidden = !recipient;
  if (recipient) {
    const name = recipient.approver.name;
    $("update-title").textContent = `Keep ${name} informed`;
    $("send-update").textContent = `Send progress update to ${name}`;
    if (shownStatus !== null && shownStatus !== task.status) {
      $("update-offer").textContent = `The status is now "${PROGRESS_LABELS[task.status]}". Let ${name} know?`;
      $("update-offer").hidden = false;
    }
  }
  shownStatus = task.status;

  // 4. Progress
  $<HTMLButtonElement>("report-started").disabled = task.status !== "Approved";
  $<HTMLButtonElement>("report-completed").disabled = !can("Completed");
  $<HTMLButtonElement>("report-failed").disabled = !can("Failed");
  $<HTMLButtonElement>("block").disabled = !can("Blocked");
  $<HTMLButtonElement>("unblock").disabled = task.status !== "Blocked";
  $<HTMLButtonElement>("cancel-task").disabled = !can("Cancelled");

  // Context
  $("refresh-info").textContent = task.lastRefreshAt ? `Last refreshed ${formatTime(task.lastRefreshAt)}.` : "Not refreshed since capture.";
  $("sources").replaceChildren(
    ...task.sources.map((s) => {
      const li = el("li", `${s.from || "(unknown sender)"} · ${s.date || "(no date)"}${s.addedAt && s.addedAt > task!.createdAt ? ` · added ${formatTime(s.addedAt)}` : ""}`);
      if (newMessageIds.includes(s.messageId)) li.append(el("span", " (new since handoff)", "warn"));
      return li;
    }),
  );
  const stored = snapshot?.messages.length ?? 0;
  const deadline = await repo.retentionDeadline(taskId);
  $("retention-info").textContent =
    stored === 0
      ? snapshot?.purgedAt
        ? `Stored email text was deleted ${formatTime(snapshot.purgedAt)}. The brief can no longer include it; refresh from Gmail if you need it again.`
        : "No email text is stored for this task."
      : deadline !== null
        ? `Stored email text for ${stored} message${stored === 1 ? "" : "s"} will be deleted around ${formatTime(deadline)}.`
        : `Email text for ${stored} message${stored === 1 ? " is" : "s are"} stored in this browser.`;
  $<HTMLButtonElement>("purge").disabled = stored === 0;
  $<HTMLButtonElement>("add-note").disabled = false;
  $<HTMLButtonElement>("delete-task").disabled = false;
  $("copy-update").hidden = newMessageIds.length === 0;

  // Plan versions and decisions
  $("no-plans").hidden = plans.length > 0;
  $("plan-versions").replaceChildren(
    ...plans
      .slice()
      .reverse()
      .map((p) => {
        const li = el("li");
        if (p.id !== latestPlan?.id) li.className = "superseded";
        const details = el("details");
        details.append(el("summary", `Version ${p.version} · ${formatTime(p.recordedAt)} · fingerprint ${p.hash.slice(0, 16)}…${p.id === latestPlan?.id ? " (current)" : ""}`), el("pre", p.text));
        li.append(details);
        const decisions = approvals.filter((a) => a.planId === p.id);
        if (decisions.length === 0) li.append(el("div", "No decision recorded.", "meta"));
        for (const a of decisions) {
          const verb = a.decision === "approve" ? "Approved" : a.decision === "reject" ? "Rejected" : "Changes requested";
          const notes = [a.origin === "imported" ? "imported, history only" : "", a.supersededAt ? `no longer current since ${formatTime(a.supersededAt)}` : ""].filter(Boolean).join("; ");
          const who = a.signedBy ? ` by ${a.signedBy.name}${a.origin === "signed" ? " (signature verified)" : ""}` : a.origin === "local" ? " by you" : "";
          li.append(el("div", `${verb}${who} ${formatTime(a.decidedAt)}${a.comment ? ` — “${a.comment}”` : ""}${notes ? ` (${notes})` : ""}`, "meta"));
        }
        return li;
      }),
  );

  const history = $("history");
  history.replaceChildren(...(await repo.getEvents(taskId)).reverse().map((e) => el("li", `${formatTime(e.at)} — ${eventText(e)}`)));
}

// Runs a user action, then re-renders. Errors are shown, never swallowed.
function action(id: string, fn: () => Promise<string | void>) {
  $(id).addEventListener("click", async () => {
    const button = $<HTMLButtonElement>(id);
    button.disabled = true;
    try {
      const message = await fn();
      if (message) setStatus(message, "success");
    } catch (err) {
      setStatus(errorText(err), "error");
    }
    await render();
  });
}

function decide(decision: "approve" | "reject" | "request_changes") {
  return async () => {
    if (!task || !latestPlan) return;
    // The page sends the version and fingerprint it is displaying; the store
    // refuses the decision if the plan changed in the meantime.
    await repo.decide({ taskId, planVersion: latestPlan.version, planHash: latestPlan.hash, decision, comment: $<HTMLInputElement>("decision-comment").value.trim() || undefined });
    $<HTMLInputElement>("decision-comment").value = "";
    return decision === "approve"
      ? `Plan version ${latestPlan.version} approved and recorded. Claude hasn't been told yet: copy the approval message and send it yourself.`
      : decision === "reject"
        ? "Plan rejected."
        : "Changes requested. Ask Claude for a revised plan, then record it.";
  };
}

async function init() {
  $<HTMLAnchorElement>("all-tasks").href = browser.runtime.getURL("/options.html");
  if (!taskId) return setStatus("No task selected.", "error");
  repo = await TaskRepo.open();

  action("copy-brief", async () => {
    await navigator.clipboard.writeText(brief);
    await repo.markBriefPrepared(taskId);
    return "Brief copied to your clipboard. Nothing has been sent yet.";
  });
  action("open-claude", async () => {
    if (!task) return;
    const dest = handoffDestination(task.repositoryRef);
    if (task.status === "ReadyForHandoff") await repo.markHandoffOpened(taskId, dest.url);
    await browser.tabs.create({ url: dest.url });
    return `Opened ${dest.label}. Paste the brief there and send it, then come back and click "I've sent it to Claude".`;
  });
  action("mark-submitted", async () => {
    await repo.transition(taskId, "Planning", "user_action");
    return "Recorded that you sent the brief. Paste Claude's plan below when it arrives.";
  });
  action("record-plan", async () => {
    const plan = await repo.recordPlan(taskId, { text: $<HTMLTextAreaElement>("plan-text").value, source: "pasted" });
    $<HTMLTextAreaElement>("plan-text").value = "";
    return `Plan version ${plan.version} recorded. Review it below and approve or reject it.`;
  });
  action("approve", decide("approve"));
  action("request-changes", decide("request_changes"));
  action("reject", decide("reject"));
  action("copy-approval", async () => {
    if (!latestPlan) return;
    await navigator.clipboard.writeText(
      `I approve your plan as recorded (version ${latestPlan.version}, fingerprint ${latestPlan.hash.slice(0, 16)}). Implement exactly that plan. ` +
        "Ask me before doing anything outside it, and get my separate permission before sending email, deploying, publishing or deleting data.",
    );
    return "Approval message copied. Paste it into your Claude conversation.";
  });
  action("report-started", async () => {
    await repo.reportStarted(taskId);
    return "Recorded that implementation started (reported by you).";
  });
  action("report-completed", async () => void (await repo.transition(taskId, "Completed", "user_action")));
  action("report-failed", async () => void (await repo.transition(taskId, "Failed", "user_action")));
  action("block", async () => void (await repo.transition(taskId, "Blocked", "user_action", {}, "blocked_by_user")));
  action("unblock", async () => void (await repo.transition(taskId, latestPlan ? "AwaitingApproval" : "Planning", "user_action")));
  action("cancel-task", async () => {
    if (!confirm("Cancel this task? It stays in your history.")) return;
    await repo.transition(taskId, "Cancelled", "user_action");
    return "Task cancelled.";
  });
  action("add-note", async () => {
    await repo.addNote(taskId, $<HTMLInputElement>("note").value);
    $<HTMLInputElement>("note").value = "";
  });
  action("copy-update", async () => {
    if (!task) return;
    await navigator.clipboard.writeText(buildContextUpdate(task, snapshot, newMessageIds));
    await repo.addNote(taskId, `Copied an update with ${newMessageIds.length} new message(s) for Claude.`);
    return "Update copied. Paste it into your Claude conversation; nothing has been sent yet.";
  });
  action("purge", async () => {
    if (!confirm("Delete the stored email text for this task? The task, its Gmail link and history are kept.")) return;
    await repo.purgeSnapshot(taskId);
    return "Stored email text deleted.";
  });
  $("delete-task").addEventListener("click", async () => {
    if (!confirm("Permanently delete this task and everything recorded about it? This can't be undone.")) return;
    try {
      await repo.deleteTask(taskId);
      location.replace(browser.runtime.getURL("/options.html"));
    } catch (err) {
      setStatus(errorText(err), "error");
    }
  });

  // ---- approval by another person ----
  $<HTMLAnchorElement>("approvers-link").href = browser.runtime.getURL("/options.html#approvers");
  const nameInput = $<HTMLInputElement>("requester-name");
  nameInput.value = localStorage.getItem(REQUESTER_NAME_KEY) ?? (await repo.getIdentity())?.name ?? "";
  nameInput.addEventListener("change", () => localStorage.setItem(REQUESTER_NAME_KEY, nameInput.value.trim()));
  const newRequest = () => repo.createApprovalRequest(taskId, $<HTMLSelectElement>("approver-select").value, nameInput.value);

  action("ask-approval", async () => {
    const request = await newRequest();
    const approver = approvers.find((a) => a.fingerprint === request.approverFingerprint)!;
    const block = await sealRequest(request);
    const intro =
      `Hi ${approver.name},\n\n${request.requesterName || "I"} would like your approval of plan version ${request.plan.version} for "${request.task.title}".\n\n` +
      "Open this email in Gmail and click the Mail2Code icon next to the subject to review and sign your decision. The request expires in 7 days.\n\n" +
      `Plan:\n${request.plan.text}`;
    const draft = composeOrPaste({
      account: gmailAccountOf(task?.threadUrl),
      to: approver.email,
      subject: requestSubject(request),
      intro: intro.length > 4_000 ? `${intro.slice(0, 4_000)}…\n(The full plan is in the request below.)` : intro,
      block,
      pasteHint: "[Paste the Mail2Code approval request here: press Ctrl+V (⌘V on a Mac).]",
    });
    if (draft.paste) await navigator.clipboard.writeText(draft.paste);
    await browser.tabs.create({ url: draft.url });
    return draft.paste
      ? `A Gmail draft to ${approver.name} opened. The request is too long for a link, so it's on your clipboard: paste it into the draft where it says so, then press Send.`
      : `A Gmail draft to ${approver.name} opened in a new tab. Press Send there; nothing has been sent yet.`;
  });
  action("download-request", async () => {
    const request = await newRequest();
    downloadText(`approval-request-${request.requestId.slice(0, 8)}.json`, JSON.stringify(request, null, 2));
    return "Request file downloaded. Send it to the approver; they open it in Mail2Code → Review an approval request.";
  });
  $<HTMLSelectElement>("required-approver").addEventListener("change", async (e) => {
    try {
      await repo.setRequiredApprover(taskId, (e.target as HTMLSelectElement).value || null);
      setStatus((e.target as HTMLSelectElement).value ? "From now on, only that person's signed approval counts for this task." : "Anyone's approval counts again, including yours.", "success");
    } catch (err) {
      setStatus(errorText(err), "error");
    }
    await render();
  });
  const responseText = $<HTMLTextAreaElement>("response-text");
  responseText.addEventListener("input", () => ($<HTMLButtonElement>("import-response").disabled = !responseText.value.trim()));
  $<HTMLInputElement>("response-file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) return setStatus("This file is too large to be an approval response.", "error");
    responseText.value = await f.text();
    $<HTMLButtonElement>("import-response").disabled = false;
  });
  action("import-response", async () => {
    const response = await readResponse(responseText.value);
    if (response.payload.taskId !== taskId) throw new Error("This response is for a different task.");
    const result = await repo.importApprovalResponse(response);
    responseText.value = "";
    $<HTMLInputElement>("response-file").value = "";
    $("inbox-hint").hidden = true;
    if (inboxId) void send({ kind: "approval.discard", itemId: inboxId });
    const verb = result.decision === "approve" ? "approved" : result.decision === "reject" ? "rejected" : "asked for changes to";
    return `Signature verified: ${result.approverName} ${verb} the plan. Recorded.${result.decision === "approve" ? " Claude hasn't been told yet: copy the approval message and send it yourself." : ""}`;
  });
  action("send-update", async () => {
    const { update, approver } = await repo.createProgressUpdate(taskId, $<HTMLInputElement>("update-note").value, nameInput.value);
    const p = update.payload;
    const intro =
      `Hi ${approver.name},\n\nProgress on "${update.taskTitle}" (the plan you approved): ${PROGRESS_LABELS[p.status]}.` +
      `${p.note ? `\nNote: ${p.note}` : ""}\n\n` +
      'Open this email in Gmail and click the Mail2Code icon next to the subject to update your "Approved by me" list.';
    const draft = composeOrPaste({
      account: gmailAccountOf(task?.threadUrl),
      to: approver.email,
      subject: updateSubject(update.taskTitle, p.status),
      intro,
      block: await sealUpdate(update),
      pasteHint: "[Paste the Mail2Code progress update here: press Ctrl+V (⌘V on a Mac).]",
    });
    if (draft.paste) await navigator.clipboard.writeText(draft.paste);
    await browser.tabs.create({ url: draft.url });
    $<HTMLInputElement>("update-note").value = "";
    $("update-offer").hidden = true;
    return `A Gmail draft to ${approver.name} with this update opened in a new tab. Press Send there; nothing has been sent yet.`;
  });

  if (inboxId) {
    const reply = await send({ kind: "approval.get", itemId: inboxId });
    if (reply.ok) {
      responseText.value = (reply.value as ApprovalBlock).block;
      $("inbox-hint").hidden = false;
      $("ask-box").scrollIntoView({ block: "start" });
    } else {
      setStatus("The response from Gmail is no longer available. Click the Mail2Code icon on the email again.", "error");
    }
  }

  await repo.purgeExpired();
  await render();
}

void init().catch((err) => setStatus(errorText(err), "error"));
