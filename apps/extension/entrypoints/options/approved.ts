// Dashboard → "Approved by me": plans this browser signed for other people,
// kept current by the requesters' signed progress updates. An update handed
// over from Gmail (?inbox=…) is checked and applied when the page opens.
import type { GivenApproval } from "@mail2code/task-core";
import { browser } from "wxt/browser";
import { PROGRESS_LABELS, readUpdate } from "../../src/approval-blocks.ts";
import type { ApprovalBlock } from "../../src/approval-inbox.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import type { PageMessage, Reply } from "../../src/messages.ts";
import { $, el, errorText, formatTime, setStatus } from "../../src/ui.ts";

const say = (text: string, tone: "info" | "error" | "success" = "info") => setStatus(text, tone, "approved-status");
const send = (msg: PageMessage) => browser.runtime.sendMessage(msg) as Promise<Reply>;
const DECISION = { approve: "You approved", request_changes: "You requested changes", reject: "You rejected" } as const;

function item(repo: TaskRepo, g: GivenApproval): HTMLLIElement {
  const li = el("li");
  li.dataset.requestId = g.requestId;
  const head = el("div", undefined, "row-head");
  head.append(
    el("strong", g.taskTitle),
    el("span", `from ${g.requesterName || "(no name)"}${g.requesterEmail ? ` <${g.requesterEmail}>` : ""}`, "hint"),
    el("span", g.status ? PROGRESS_LABELS[g.status] : "No updates yet", "progress"),
  );
  const last = g.updates.at(-1);
  li.append(
    head,
    el("div", `${DECISION[g.decision]} plan v${g.planVersion} on ${formatTime(g.signedAt)}${last ? ` · last update ${formatTime(last.receivedAt)}` : ""}`, "hint"),
  );
  if (g.updates.length) {
    const timeline = el("ol", undefined, "timeline");
    timeline.reversed = true;
    for (const u of [...g.updates].reverse()) {
      timeline.append(el("li", `${PROGRESS_LABELS[u.status]}${u.planVersion !== g.planVersion ? ` (plan v${u.planVersion})` : ""}${u.note ? ` — “${u.note}”` : ""} · ${formatTime(Date.parse(u.sentAt))}`));
    }
    li.append(timeline);
  }
  const details = el("details");
  details.append(el("summary", "Plan you signed"), el("pre", g.planText));
  if (g.comment) details.append(el("p", `Your comment: “${g.comment}”`, "hint"));
  li.append(details);
  const remove = el("button", "Remove from this list", "secondary");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm(`Remove "${g.taskTitle}" from this list? Later updates for it will be ignored.`)) return;
    await repo.removeGivenApproval(g.requestId);
    await render(repo);
  });
  const actions = el("div", undefined, "actions");
  actions.append(remove);
  li.append(actions);
  return li;
}

async function render(repo: TaskRepo) {
  const list = await repo.listGivenApprovals();
  $("approved-empty").hidden = list.length > 0;
  $("approved-list").replaceChildren(...list.map((g) => item(repo, g)));
}

export async function initApproved() {
  const repo = await TaskRepo.open();
  await render(repo);
  const inboxId = new URLSearchParams(location.search).get("inbox");
  if (!inboxId) return;
  $("approved").scrollIntoView({ block: "start" });
  const reply = await send({ kind: "approval.get", itemId: inboxId });
  if (!reply.ok) return say("This update is no longer available. Click the Mail2Code icon on the email again.", "error");
  try {
    const update = await readUpdate((reply.value as ApprovalBlock).block);
    const g = await repo.applyProgressUpdate(update);
    say(`Signature verified. "${g.taskTitle}": ${PROGRESS_LABELS[g.status!]}${update.payload.note ? ` — “${update.payload.note}”` : ""}.`, "success");
  } catch (err) {
    say(errorText(err), "error");
  }
  void send({ kind: "approval.discard", itemId: inboxId });
  await render(repo);
}
