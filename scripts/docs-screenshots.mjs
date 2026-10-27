// Captures the screenshots used in docs/user-guide.md (docs/images/*.png).
// Uses a neutral, synthetic mail page that has the same structure the
// extension looks for, two separate browser profiles (requester and
// approver), synthetic data only, and no network.
//
// Usage: npm run -w @mail2code/extension build, then
//        node scripts/docs-screenshots.mjs
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const EXT = resolve("apps/extension/dist/chrome-mv3");
const OUT = resolve("docs/images");
mkdirSync(OUT, { recursive: true });

const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// A plain mail client look. Not Gmail's design; only its element structure.
function mailPage({ threadId, subject, messages }) {
  const msgs = messages
    .map(
      (m, i) => `
    <div class="adn ads msg" data-message-id="#msg-${threadId.replace("thread-", "")}${i + 1}">
      <div class="who"><span class="avatar">${esc(m.name[0])}</span>
        <span class="gD" email="${m.email}" name="${esc(m.name)}">${esc(m.name)}</span>
        <span class="addr">&lt;${m.email}&gt;</span>
        <span class="g3" title="${m.date}">${m.date}</span></div>
      <div class="ii gt"><div class="a3s aiL">${m.body
        .split("\n")
        .map((l) => (l ? `<div>${esc(l)}</div>` : "<div><br></div>"))
        .join("")}</div></div>
    </div>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(subject)} - Mail</title><style>
  body { margin: 0; font: 14px/1.5 Arial, Helvetica, sans-serif; color: #202124; background: #f6f8fc; }
  .top { height: 56px; display: flex; align-items: center; padding: 0 20px; font-size: 20px; color: #444; }
  .wrap { display: flex; }
  .side { width: 200px; padding: 8px 12px; color: #444; }
  .side div { padding: 6px 12px; border-radius: 16px; } .side .on { background: #d3e3fd; font-weight: bold; }
  [role=main] { flex: 1; background: #fff; border-radius: 16px; margin: 0 16px 16px 0; padding: 12px 24px 24px; min-height: 640px; }
  .bar { display: flex; gap: 18px; color: #555; font-size: 13px; padding: 6px 0 14px; border-bottom: 1px solid #eee; }
  .subj { display: flex; align-items: center; margin: 18px 0 8px; }
  h2.hP { font: 22px Arial, sans-serif; margin: 0; }
  .chip { font-size: 12px; background: #e8eaed; border-radius: 4px; padding: 1px 6px; }
  .msg { border-bottom: 1px solid #eee; padding: 14px 0; }
  .who { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: #c8d7f5; display: grid; place-items: center; font-weight: bold; }
  .gD { font-weight: bold; } .addr, .g3 { color: #666; font-size: 12px; } .g3 { margin-left: auto; }
  .a3s { padding-left: 40px; }
  </style></head><body>
  <div class="top">Mail (synthetic example)</div>
  <div class="wrap"><div class="side"><div class="on">Inbox</div><div>Starred</div><div>Sent</div><div>Drafts</div></div>
  <div role="main">
    <div class="bar" gh="mtb"><span>Archive</span><span>Report spam</span><span>Delete</span><span>Mark as unread</span><span>Add to tasks</span></div>
    <div class="subj"><h2 class="hP" data-thread-perm-id="${threadId}">${esc(subject)}</h2><span class="chip">Inbox ×</span></div>
    ${msgs}
  </div></div></body></html>`;
}

const PAGES = new Map();
PAGES.set(
  "thread",
  mailPage({
    threadId: "thread-f:1790000000000000501",
    subject: "Login accepts any password",
    messages: [
      { name: "Ada Example", email: "ada@example.test", date: "Oct 26, 10:02", body: "Hi team,\n\nThe login form accepts any password for the admin user.\nSteps: open the login page, type admin and any password.\n\nCan someone fix this before Friday's release?\n\nThanks,\nAda" },
      { name: "Lin Example", email: "lin@example.test", date: "Oct 26, 11:15", body: "Confirmed on staging. We agreed the fix should reject empty passwords and add a regression test.\nWho can own it?" },
    ],
  }),
);

async function launch(name) {
  const profile = mkdtempSync(join(tmpdir(), `m2c-docs-${name}-`));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 820 },
    colorScheme: "light",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://mail.google.com") {
      const page = PAGES.get(url.searchParams.get("doc") ?? "thread") ?? PAGES.get("thread");
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page });
    } else if (url.protocol.startsWith("http")) await route.abort();
    else await route.fallback();
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(sw.url()).host;
  const open = async (path) => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${id}/${path}`);
    return p;
  };
  return { context, id, open, close: async () => (await context.close(), rmSync(profile, { recursive: true, force: true })) };
}

const shot = async (target, file, opts = {}) => {
  await target.screenshot({ path: join(OUT, file), animations: "disabled", ...opts });
  console.log("✓", file);
};

// Opens a mail page; returns it.
async function mail(ctx, doc, hash = "#inbox/FMfcgzDocsThread0001") {
  const p = await ctx.context.newPage();
  await p.goto(`https://mail.google.com/mail/u/0/?doc=${doc}${hash}`);
  await p.locator("[data-mail2code]").getByRole("button").waitFor();
  return p;
}

// Clicks something that opens a mail draft; returns its fields.
async function draft(ctx, click) {
  const [tab] = await Promise.all([ctx.context.waitForEvent("page"), click()]);
  await tab.waitForURL(/^https:\/\/mail\.google\.com\//);
  const u = new URL(tab.url());
  await tab.close();
  return { to: u.searchParams.get("to") ?? "", subject: u.searchParams.get("su") ?? "", body: u.searchParams.get("body") ?? "" };
}

const ada = await launch("ada");
const priya = await launch("priya");
try {
  // 1. The button next to the subject.
  const inbox = await mail(ada, "thread");
  await shot(inbox, "01-gmail-button.png", { clip: { x: 0, y: 40, width: 1280, height: 200 } });

  // 2. The preview card.
  await inbox.locator("[data-mail2code]").getByRole("button").click();
  const card = inbox.locator("[data-mail2code-card]").getByRole("dialog");
  await card.waitFor();
  await inbox.waitForTimeout(400);
  await shot(inbox, "02-send-to-claude-card.png");

  // 3. The toolbar popup.
  const popup = await ada.open("popup.html");
  await popup.setViewportSize({ width: 300, height: 290 });
  await shot(popup, "03-toolbar-popup.png");

  // 4. Settings.
  const settings = await ada.open("options.html#settings");
  await settings.locator("#settings-form:not([inert])").waitFor();
  await shot(settings.locator("#settings"), "04-settings.png");

  // 5. A task: card → More options… → review → create, then walk to "plan recorded".
  const [review] = await Promise.all([ada.context.waitForEvent("page"), inbox.locator("[data-mail2code-card]").getByRole("button", { name: "More options…" }).click()]);
  await review.waitForLoadState("domcontentloaded");
  await review.getByLabel("Repository URL or project name (optional)").fill("https://github.com/example/app");
  await review.getByRole("button", { name: "Create task" }).click();
  await review.getByRole("link", { name: "Open the task" }).click();
  await review.waitForURL(/task\.html\?id=/);
  const task = review;
  await task.getByRole("button", { name: "Copy brief" }).click();
  const [claude] = await Promise.all([ada.context.waitForEvent("page"), task.getByRole("button", { name: /^Open / }).click()]);
  await claude.close();
  await task.getByRole("button", { name: "I've sent it to Claude" }).click();
  await task.getByLabel("Plan", { exact: true }).fill(
    "Objective: reject empty and wrong passwords for the admin user.\nSteps:\n1. Fix the password check in src/auth.ts.\n2. Add a regression test in test/auth.test.ts.\n3. Run npm test.\nRisks: none outside the login flow.",
  );
  await task.getByRole("button", { name: "Record plan" }).click();
  await task.locator("#status-label").filter({ hasText: "awaiting" }).waitFor();
  await shot(task, "05-task-page.png", { fullPage: false });
  await shot(task.locator("#step-approve"), "06-approve-plan.png");

  // 6. Task dashboard.
  const dash = await ada.open("options.html");
  await dash.locator("#tasks li").first().waitFor();
  await dash.setViewportSize({ width: 1100, height: 620 });
  await shot(dash, "07-task-dashboard.png");

  // 7. Approval by another person: Priya creates an identity and sends her card.
  const pSettings = await priya.open("options.html#approvers");
  await pSettings.getByLabel("Your name").fill("Priya Example");
  await pSettings.getByLabel("Your email address").fill("priya@example.test");
  await pSettings.getByRole("button", { name: "Create my approver identity" }).click();
  await pSettings.locator("#identity-fingerprint").filter({ hasText: /[a-f0-9]{4}/ }).waitFor();
  await shot(pSettings.locator("#approvers"), "08-approver-identity.png");
  const cardDraft = await draft(priya, () => pSettings.getByRole("button", { name: "Email my approver card" }).click());

  const aSettings = await ada.open("options.html#approvers");
  await aSettings.getByLabel(/paste their approver card/).fill(cardDraft.body);
  await aSettings.getByLabel(/I checked this fingerprint/).check();
  await shot(aSettings.locator("#approvers"), "09-add-approver.png");
  await aSettings.getByRole("button", { name: "Add as trusted approver" }).click();
  await aSettings.locator("#approver-list li").waitFor();

  // Ada asks Priya by email.
  await task.reload();
  await task.getByLabel("Your name (shown to them)").fill("Ada Example");
  await shot(task.locator("#ask-box"), "10-ask-someone.png");
  const request = await draft(ada, () => task.getByRole("button", { name: "Ask by email" }).click());

  // Priya opens the request email and reviews it.
  PAGES.set("request", mailPage({ threadId: "thread-f:1790000000000000502", subject: request.subject, messages: [{ name: "Ada Example", email: "ada@example.test", date: "Oct 26, 14:30", body: request.body }] }));
  const pMail = await mail(priya, "request", "#inbox/FMfcgzDocsThread0002");
  await pMail.locator("[data-mail2code]").getByRole("button").click();
  await pMail.locator("[data-mail2code-card]").getByRole("dialog").waitFor();
  await pMail.waitForTimeout(400);
  await shot(pMail, "11-approval-request-card.png");
  const [approve] = await Promise.all([priya.context.waitForEvent("page"), pMail.locator("[data-mail2code-card]").getByRole("button", { name: "Review request" }).click()]);
  await approve.waitForLoadState("domcontentloaded");
  await approve.locator("#review-box:not([hidden])").waitFor();
  await approve.getByLabel("Approve this plan").check();
  await approve.getByLabel("Comment (optional)").fill("Looks good. Please keep the change small.");
  await shot(approve, "12-review-and-sign.png", { fullPage: true });
  const reply = await draft(priya, () => approve.getByRole("button", { name: "Sign and reply by email" }).click());

  // Ada records the signed reply.
  PAGES.set("reply", mailPage({ threadId: "thread-f:1790000000000000503", subject: reply.subject, messages: [{ name: "Priya Example", email: "priya@example.test", date: "Oct 26, 15:05", body: reply.body }] }));
  const aMail = await mail(ada, "reply", "#inbox/FMfcgzDocsThread0003");
  await aMail.locator("[data-mail2code]").getByRole("button").click();
  const [recorded] = await Promise.all([ada.context.waitForEvent("page"), aMail.locator("[data-mail2code-card]").getByRole("button", { name: "Check and record" }).click()]);
  await recorded.waitForLoadState("domcontentloaded");
  await recorded.getByRole("button", { name: "Check and record" }).click();
  await recorded.locator("#status-label").filter({ hasText: "signature verified" }).waitFor();
  await recorded.evaluate(() => window.scrollTo(0, 0));
  await shot(recorded, "13-approved-signed.png");

  // Ada starts work and sends Priya a progress update.
  await recorded.getByRole("button", { name: "Implementation started" }).click();
  await recorded.locator("#update-offer:not([hidden])").waitFor();
  await recorded.getByLabel("Note for them (optional)").fill("Branch fix/login opened");
  await shot(recorded.locator("#step-progress"), "15-send-progress-update.png");
  const update = await draft(ada, () => recorded.getByRole("button", { name: /Send progress update to/ }).click());
  PAGES.set("update", mailPage({ threadId: "thread-f:1790000000000000504", subject: update.subject, messages: [{ name: "Ada Example", email: "ada@example.test", date: "Oct 26, 16:40", body: update.body }] }));
  const pMail2 = await mail(priya, "update", "#inbox/FMfcgzDocsThread0004");
  await pMail2.locator("[data-mail2code]").getByRole("button").click();
  const [approvedTab] = await Promise.all([priya.context.waitForEvent("page"), pMail2.locator("[data-mail2code-card]").getByRole("button", { name: "Update my list" }).click()]);
  await approvedTab.waitForLoadState("domcontentloaded");
  await approvedTab.locator("#approved-status").filter({ hasText: "Signature verified" }).waitFor();
  await shot(approvedTab.locator("#approved"), "16-approved-by-me.png");

  // 8. Backups.
  const backup = await ada.open("backup.html");
  await backup.setViewportSize({ width: 1100, height: 760 });
  await shot(backup, "14-backup.png");
} finally {
  await ada.close();
  await priya.close();
}
console.log(`Screenshots written to ${OUT}`);
