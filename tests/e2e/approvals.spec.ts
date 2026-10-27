// Approval by another person, through Gmail, in two separate browser profiles:
// Ada (the requester, the default test profile) and Priya (the approver).
// Gmail is synthetic: the draft links the extension opens are captured, and the
// emails they would produce are served back as synthetic Gmail pages. Nothing
// is sent anywhere; the test browsers have no network.
import type { BrowserContext, Page } from "@playwright/test";
import { DYNAMIC_GMAIL, card, createTask, expect, extensionIdOf, grantClipboard, launchExtension, openReview, sendButton, syntheticEmail, test } from "./fixtures.ts";

// Clicks something that opens a Gmail draft; returns the draft's fields.
async function draftFrom(context: BrowserContext, click: () => Promise<unknown>): Promise<{ to: string; subject: string; body: string; url: string }> {
  const [tab] = await Promise.all([context.waitForEvent("page"), click()]);
  await tab.waitForURL(/^https:\/\/mail\.google\.com\//);
  const url = new URL(tab.url());
  await tab.close();
  expect(url.origin).toBe("https://mail.google.com");
  expect(url.searchParams.get("view")).toBe("cm");
  return { to: url.searchParams.get("to") ?? "", subject: url.searchParams.get("su") ?? "", body: url.searchParams.get("body") ?? "", url: url.href };
}

// Walks a captured task in Ada's browser to "Plan recorded, awaiting approval".
async function taskAwaitingApproval(context: BrowserContext, gmail: Page): Promise<Page> {
  const task = await createTask(await openReview(context, gmail));
  await task.getByRole("button", { name: "Copy brief" }).click();
  const [claude] = await Promise.all([context.waitForEvent("page"), task.getByRole("button", { name: /^Open / }).click()]);
  await claude.close();
  await task.getByRole("button", { name: "I've sent it to Claude" }).click();
  await task.getByLabel("Plan", { exact: true }).fill("Objective: reject empty passwords.\nSteps: edit src/auth.ts; add a test.");
  await task.getByRole("button", { name: "Record plan" }).click();
  await expect(task.locator("#status-label")).toHaveText("Plan recorded, awaiting your approval");
  return task;
}

test("another person approves a plan through Gmail, with a verified signature", async ({ context, extensionId, openGmail, openPage, browserChannel, extensionBuild }) => {
  await grantClipboard(context, extensionId);
  const priya = await launchExtension(browserChannel, extensionBuild);
  try {
    const priyaId = await extensionIdOf(priya.context);

    // 1. Priya creates her approver identity and emails her card.
    const pSettings = await priya.context.newPage();
    await pSettings.goto(`chrome-extension://${priyaId}/options.html#approvers`);
    await pSettings.getByLabel("Your name").fill("Priya Example");
    await pSettings.getByLabel("Your email address").fill("priya@example.test");
    await pSettings.getByRole("button", { name: "Create my approver identity" }).click();
    await expect(pSettings.locator("#identity-fingerprint")).toHaveText(/^([a-f0-9]{4} ){15}[a-f0-9]{4}$/);
    const fingerprint = await pSettings.locator("#identity-fingerprint").textContent();
    const cardDraft = await draftFrom(priya.context, () => pSettings.getByRole("button", { name: "Email my approver card" }).click());
    expect(cardDraft.body).toContain(fingerprint!);

    // 2. Ada adds Priya after checking the fingerprint.
    const aSettings = await openPage("options.html#approvers");
    await aSettings.getByLabel(/paste their approver card/).fill(cardDraft.body);
    await expect(aSettings.locator("#card-fingerprint")).toHaveText(fingerprint!);
    await expect(aSettings.getByRole("button", { name: "Add as trusted approver" })).toBeDisabled();
    await aSettings.getByLabel(/I checked this fingerprint with Priya Example/).check();
    await aSettings.getByRole("button", { name: "Add as trusted approver" }).click();
    await expect(aSettings.locator("#approver-list li")).toContainText("Priya Example");

    // 3. Ada requires Priya's approval and asks by email.
    const task = await taskAwaitingApproval(context, await openGmail("single-message.html"));
    await task.getByLabel("Whose approval counts for this task").selectOption({ label: "Only Priya Example (signed approval)" });
    await expect(task.getByRole("button", { name: "Approve this plan" })).toBeDisabled();
    await task.getByLabel("Your name (shown to them)").fill("Ada Example");
    const request = await draftFrom(context, () => task.getByRole("button", { name: "Ask by email" }).click());
    expect(request.to).toBe("priya@example.test");
    expect(request.subject).toBe("[Mail2Code] Approval request: Login accepts any password (plan v1)");
    expect(request.body).toContain("-----BEGIN MAIL2CODE APPROVAL REQUEST-----");
    expect(request.body).not.toContain("accepts any password for the admin user"); // no email text
    await expect(task.locator("#request-list li")).toContainText("Sent to Priya Example for plan v1");

    // 4. Priya opens the email, reviews and signs.
    DYNAMIC_GMAIL.set("request", syntheticEmail({ threadId: "thread-f:1790000000000000101", subject: request.subject, fromName: "Ada Example", fromEmail: "ada@example.test", body: request.body }));
    const pGmail = await priya.context.newPage();
    await pGmail.goto("https://mail.google.com/mail/u/0/?fixture=dynamic:request#inbox/FMfcgzSyntheticThread0101");
    await sendButton(pGmail).click();
    await expect(card(pGmail).getByRole("heading", { name: "Approval request" })).toBeVisible();
    const [review] = await Promise.all([priya.context.waitForEvent("page"), card(pGmail).getByRole("button", { name: "Review request" }).click()]);
    await review.waitForLoadState("domcontentloaded");
    await expect(review.locator("#req-task")).toHaveText("Login accepts any password");
    await expect(review.locator("#req-plan-text")).toContainText("reject empty passwords");
    await expect(review.locator("#req-from")).toHaveText("Ada Example <ada@example.test>");
    await review.getByLabel("Approve this plan").check();
    await review.getByLabel("Comment (optional)").fill("Go ahead.");
    const reply = await draftFrom(priya.context, () => review.getByRole("button", { name: "Sign and reply by email" }).click());
    expect(reply.to).toBe("ada@example.test");
    expect(reply.subject).toContain("Approved");
    expect(reply.body).toContain("-----BEGIN MAIL2CODE APPROVAL RESPONSE-----");

    // 5. Ada opens the reply; the signature is verified and the approval recorded.
    DYNAMIC_GMAIL.set("reply", syntheticEmail({ threadId: "thread-f:1790000000000000102", subject: reply.subject, fromName: "Priya Example", fromEmail: "priya@example.test", body: reply.body }));
    const aGmail = await openGmail("dynamic:reply", "#inbox/FMfcgzSyntheticThread0102");
    await sendButton(aGmail).click();
    await expect(card(aGmail).getByRole("heading", { name: "Approval response" })).toBeVisible();
    const [taskTab] = await Promise.all([context.waitForEvent("page"), card(aGmail).getByRole("button", { name: "Check and record" }).click()]);
    await taskTab.waitForLoadState("domcontentloaded");
    await expect(taskTab.locator("#inbox-hint")).toBeVisible();
    await taskTab.getByRole("button", { name: "Check and record" }).click();
    await expect(taskTab.getByRole("status").first()).toContainText("Signature verified: Priya Example approved the plan");
    await expect(taskTab.locator("#status-label")).toHaveText("Approved by Priya Example (signature verified)");
    await expect(taskTab.locator("#plan-versions")).toContainText("Approved by Priya Example (signature verified)");
    await expect(taskTab.locator("#history")).toContainText("Approved by Priya Example, plan v1 (signature verified)");
    // Priya's dashboard already lists the plan she signed.
    const pDash = await priya.context.newPage();
    await pDash.goto(`chrome-extension://${priyaId}/options.html#approved`);
    await expect(pDash.locator("#approved-list li").first()).toContainText("Login accepts any password");
    await expect(pDash.locator("#approved-list li").first()).toContainText("No updates yet");

    // 6. Ada starts work; Mail2Code offers to tell Priya, and Ada sends a signed update.
    await taskTab.getByRole("button", { name: "Implementation started" }).click();
    await expect(taskTab.locator("#status-label")).toHaveText(/Implementation started/);
    await expect(taskTab.locator("#update-offer")).toContainText('The status is now "Implementation started". Let Priya Example know?');
    await taskTab.getByLabel("Note for them (optional)").fill("Branch fix/login opened");
    const update = await draftFrom(context, () => taskTab.getByRole("button", { name: "Send progress update to Priya Example" }).click());
    expect(update.to).toBe("priya@example.test");
    expect(update.subject).toBe("[Mail2Code] Progress update: Login accepts any password — Implementation started");
    expect(update.body).toContain("-----BEGIN MAIL2CODE PROGRESS UPDATE-----");
    await expect(taskTab.locator("#update-offer")).toBeHidden();

    // 7. Priya opens the update email; her list shows the verified update.
    DYNAMIC_GMAIL.set("update", syntheticEmail({ threadId: "thread-f:1790000000000000103", subject: update.subject, fromName: "Ada Example", fromEmail: "ada@example.test", body: update.body }));
    const pGmail2 = await priya.context.newPage();
    await pGmail2.goto("https://mail.google.com/mail/u/0/?fixture=dynamic:update#inbox/FMfcgzSyntheticThread0103");
    await sendButton(pGmail2).click();
    await expect(card(pGmail2).getByRole("heading", { name: "Progress update" })).toBeVisible();
    const [approvedTab] = await Promise.all([priya.context.waitForEvent("page"), card(pGmail2).getByRole("button", { name: "Update my list" }).click()]);
    await approvedTab.waitForLoadState("domcontentloaded");
    await expect(approvedTab.locator("#approved-status")).toContainText('Signature verified. "Login accepts any password": Implementation started — “Branch fix/login opened”');
    await expect(approvedTab.locator("#approved-list li").first()).toContainText("Implementation started");
    await expect(approvedTab.locator("#approved-list .timeline")).toContainText("Branch fix/login opened");

    // The same update opened again changes nothing.
    await pGmail2.reload();
    await sendButton(pGmail2).click();
    const [again] = await Promise.all([priya.context.waitForEvent("page"), card(pGmail2).getByRole("button", { name: "Update my list" }).click()]);
    await expect(again.locator("#approved-status")).toContainText("already have this update");

    // The same reply can't be recorded twice.
    await taskTab.getByLabel("Approval response").fill(reply.body);
    await taskTab.getByRole("button", { name: "Check and record" }).click();
    await expect(taskTab.getByRole("status").first()).toContainText("already answered");
  } finally {
    await priya.close();
  }
});

test("a reply for an older plan version is refused", async ({ context, extensionId, openGmail, openPage, browserChannel, extensionBuild }) => {
  await grantClipboard(context, extensionId);
  const priya = await launchExtension(browserChannel, extensionBuild);
  try {
    const priyaId = await extensionIdOf(priya.context);
    const pSettings = await priya.context.newPage();
    await pSettings.goto(`chrome-extension://${priyaId}/options.html#approvers`);
    await pSettings.getByLabel("Your name").fill("Priya Example");
    await pSettings.getByLabel("Your email address").fill("priya@example.test");
    await pSettings.getByRole("button", { name: "Create my approver identity" }).click();
    const cardDraft = await draftFrom(priya.context, () => pSettings.getByRole("button", { name: "Email my approver card" }).click());
    const aSettings = await openPage("options.html#approvers");
    await aSettings.getByLabel(/paste their approver card/).fill(cardDraft.body);
    await aSettings.getByLabel(/I checked this fingerprint/).check();
    await aSettings.getByRole("button", { name: "Add as trusted approver" }).click();

    const task = await taskAwaitingApproval(context, await openGmail("single-message.html"));
    const request = await draftFrom(context, () => task.getByRole("button", { name: "Ask by email" }).click());
    // Priya answers from a pasted request (no Gmail needed on her side).
    const review = await priya.context.newPage();
    await review.goto(`chrome-extension://${priyaId}/approve.html`);
    await review.getByLabel("Paste the request").fill(request.body);
    await review.getByLabel("Approve this plan").check();
    const reply = await draftFrom(priya.context, () => review.getByRole("button", { name: "Sign and reply by email" }).click());

    // Meanwhile Ada records a revised plan.
    await task.getByLabel("Plan", { exact: true }).fill("Objective: reject empty passwords.\nSteps: edit src/auth.ts; deploy to production.");
    await task.getByRole("button", { name: "Record plan" }).click();
    await expect(task.locator("#plan-meta")).toContainText("Plan version 2");
    await task.getByLabel("Approval response").fill(reply.body);
    await task.getByRole("button", { name: "Check and record" }).click();
    await expect(task.getByRole("status").first()).toContainText("The plan changed after this request was sent");
    await expect(task.locator("#status-label")).toHaveText("Plan recorded, awaiting your approval");
  } finally {
    await priya.close();
  }
});
