// Settings → Approvers: this browser's own approver identity, and the people
// whose signed approvals it accepts.
import { APPROVER_CARD_FORMAT, ApprovalFileError, ApproverCardSchema, parseApprovalFile, type ApproverCard } from "@mail2code/protocol";
import { fingerprintOf, formatFingerprint, type TrustedApprover } from "@mail2code/task-core";
import { browser } from "wxt/browser";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { gmailComposeUrl } from "../../src/gmail-compose.ts";
import { $, el, errorText, formatTime, setStatus } from "../../src/ui.ts";

const say = (text: string, tone: "info" | "error" | "success" = "info") => setStatus(text, tone, "approvers-status");

let pendingCard: ApproverCard | null = null;

// A card may be pasted on its own or together with the email it came in.
function cardFromText(text: string): ApproverCard {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new ApprovalFileError("not_json", "Paste the whole approver card, from { to }.");
  return parseApprovalFile(text.slice(start, end + 1), ApproverCardSchema, APPROVER_CARD_FORMAT);
}

function cardText(card: ApproverCard): string {
  return JSON.stringify(card);
}

async function renderIdentity(repo: TaskRepo) {
  const id = await repo.getIdentity();
  $("identity-none").hidden = !!id;
  $("identity-some").hidden = !id;
  if (id) {
    $("identity-label").textContent = `${id.name} <${id.email}> · created ${formatTime(id.createdAt)}`;
    $("identity-fingerprint").textContent = formatFingerprint(id.fingerprint);
  }
}

function approverItem(repo: TaskRepo, a: TrustedApprover): HTMLLIElement {
  const li = el("li");
  li.dataset.fingerprint = a.fingerprint;
  li.append(el("strong", a.name), el("span", ` <${a.email}>`), el("div", formatFingerprint(a.fingerprint), "fingerprint"));
  const state = a.confirmedAt
    ? el("div", `Confirmed ${formatTime(a.confirmedAt)}`, "hint")
    : el("div", "Restored from a backup: not trusted until you check the fingerprint with this person again.", "warn");
  li.append(state);
  const actions = el("div", undefined, "actions");
  if (!a.confirmedAt) {
    const confirmBtn = el("button", "Confirm fingerprint", "secondary");
    confirmBtn.type = "button";
    confirmBtn.addEventListener("click", async () => {
      if (!confirm(`Have you checked this fingerprint with ${a.name} directly?\n\n${formatFingerprint(a.fingerprint)}`)) return;
      await repo.confirmApprover(a.fingerprint);
      say(`${a.name} is now a trusted approver.`, "success");
      await renderApprovers(repo);
    });
    actions.append(confirmBtn);
  }
  const remove = el("button", "Remove", "secondary danger");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm(`Remove ${a.name}? Their future responses won't be accepted. Approvals already recorded stay in your history.`)) return;
    try {
      await repo.removeApprover(a.fingerprint);
      say(`${a.name} was removed.`, "success");
    } catch (err) {
      say(errorText(err), "error");
    }
    await renderApprovers(repo);
  });
  actions.append(remove);
  li.append(actions);
  return li;
}

async function renderApprovers(repo: TaskRepo) {
  const list = await repo.listApprovers();
  $("no-approvers").hidden = list.length > 0;
  $("approver-list").replaceChildren(...list.map((a) => approverItem(repo, a)));
}

async function previewCard(text: string) {
  pendingCard = null;
  $("card-preview").hidden = true;
  $<HTMLInputElement>("card-confirm").checked = false;
  $<HTMLButtonElement>("add-approver").disabled = true;
  if (!text.trim()) return say("");
  try {
    const card = cardFromText(text);
    if ((await fingerprintOf(card.publicKey)) !== card.fingerprint) throw new Error("This approver card is damaged: its fingerprint doesn't match its key.");
    pendingCard = card;
    $("card-who").textContent = `${card.name} <${card.email}>`;
    $("card-fingerprint").textContent = formatFingerprint(card.fingerprint);
    $("card-confirm-label").textContent = `I checked this fingerprint with ${card.name} directly (in person or by phone).`;
    $("card-preview").hidden = false;
    say("Check the fingerprint with this person before adding them.");
  } catch (err) {
    say(errorText(err), "error");
  }
}

export async function initApprovers() {
  const repo = await TaskRepo.open();
  $<HTMLAnchorElement>("approve-link").href = browser.runtime.getURL("/approve.html");

  $("create-identity").addEventListener("click", async () => {
    try {
      await repo.createIdentity($<HTMLInputElement>("identity-name").value, $<HTMLInputElement>("identity-email").value);
      say("Your approver identity was created. Send your card to the people who will ask you for approvals.", "success");
    } catch (err) {
      say(errorText(err), "error");
    }
    await renderIdentity(repo);
  });
  $("email-card").addEventListener("click", async () => {
    const card = await repo.approverCard();
    const body =
      `Please add me as a trusted approver in Mail2Code: Settings → Approvers → paste the card below.\n` +
      `Before adding it, check this fingerprint with me directly:\n${formatFingerprint(card.fingerprint)}\n\n${cardText(card)}\n`;
    await browser.tabs.create({ url: gmailComposeUrl({ subject: `[Mail2Code] My approver card (${card.name})`, body }) });
    say("A Gmail draft with your card opened in a new tab. Add the recipient and press Send.", "success");
  });
  $("copy-card").addEventListener("click", async () => {
    await navigator.clipboard.writeText(cardText(await repo.approverCard()));
    say("Your approver card was copied.", "success");
  });
  $("delete-identity").addEventListener("click", async () => {
    if (!confirm("Delete your approver identity? Your signing key is destroyed for good. Approvals you already sent stay valid, but you'll need a new identity (and to re-share your card) to approve again.")) return;
    await repo.deleteIdentity();
    say("Your approver identity was deleted.", "success");
    await renderIdentity(repo);
  });

  const text = $<HTMLTextAreaElement>("approver-card-text");
  text.addEventListener("input", () => void previewCard(text.value));
  $<HTMLInputElement>("approver-card-file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 64 * 1024) return say("This file is too large to be an approver card.", "error");
    text.value = await f.text();
    await previewCard(text.value);
  });
  $<HTMLInputElement>("card-confirm").addEventListener("change", (e) => {
    $<HTMLButtonElement>("add-approver").disabled = !(e.target as HTMLInputElement).checked || !pendingCard;
  });
  $("add-approver").addEventListener("click", async () => {
    if (!pendingCard) return;
    try {
      const a = await repo.addApprover(pendingCard, $<HTMLInputElement>("card-confirm").checked);
      say(`${a.name} is now a trusted approver.`, "success");
      text.value = "";
      $<HTMLInputElement>("approver-card-file").value = "";
      await previewCard("");
    } catch (err) {
      say(errorText(err), "error");
    }
    await renderApprovers(repo);
  });

  await renderIdentity(repo);
  await renderApprovers(repo);
  $<HTMLButtonElement>("create-identity").disabled = false;
  // A card pasted while the page was still loading is picked up now.
  if (text.value.trim()) await previewCard(text.value);
}
