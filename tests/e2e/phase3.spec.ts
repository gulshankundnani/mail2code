// Phase 3: task list filters and search, context refresh, retention, deletion.
// Synthetic Gmail only; the test browser has no network access.
import type { BrowserContext, Page } from "@playwright/test";
import { createTask, expect, grantClipboard, openReview, test } from "./fixtures.ts";

// Takes a task from Captured to Approved through the task page.
async function approve(context: BrowserContext, task: Page) {
  await task.getByRole("button", { name: "Copy brief" }).click();
  const [claude] = await Promise.all([context.waitForEvent("page"), task.getByRole("button", { name: /^Open / }).click()]);
  await claude.close();
  await task.getByRole("button", { name: "I've sent it to Claude" }).click();
  await task.getByLabel("Plan", { exact: true }).fill("Objective: update the changelog.\nSteps: edit CHANGELOG.md.");
  await task.getByRole("button", { name: "Record plan" }).click();
  await task.getByRole("button", { name: "Approve this plan" }).click();
  await expect(task.locator("#status-label")).toHaveText("Approved by you");
}

test.describe("task list", () => {
  test("search and status filters narrow the list, and survive a reload", async ({ context, openGmail, openPage }) => {
    const gmail = await openGmail("single-message.html");
    await createTask(await openReview(context, gmail), { repository: "https://github.com/example/app" });
    await createTask(await openReview(context, await openGmail("thread.html")));

    const list = await openPage("options.html");
    await expect(list.locator("#count")).toHaveText("Showing 2 of 2 tasks");
    await list.getByLabel("Search").fill("release");
    await expect(list.locator("#tasks li")).toHaveCount(1);
    await expect(list.locator("#tasks li")).toContainText("Release checklist");
    await list.getByLabel("Search").fill("github.com/example");
    await expect(list.locator("#tasks li")).toContainText("Login accepts any password");

    await list.getByLabel("Search").fill("");
    await list.getByLabel("Status").selectOption("needs-you");
    await expect(list.locator("#no-match")).toBeVisible();
    await list.getByLabel("Status").selectOption("active");
    await expect(list.locator("#tasks li")).toHaveCount(2);

    await list.getByLabel("Search").fill("release");
    await list.reload();
    await expect(list.getByLabel("Search")).toHaveValue("release");
    await expect(list.getByLabel("Status")).toHaveValue("active");
    await expect(list.locator("#tasks li")).toHaveCount(1);
    await list.getByRole("button", { name: "Clear" }).click();
    await expect(list.locator("#tasks li")).toHaveCount(2);
  });

  test("the retention setting defaults to 30 days and is remembered", async ({ openPage }) => {
    const list = await openPage("options.html");
    await expect(list.getByLabel("Delete stored email text")).toHaveValue("30");
    await list.getByLabel("Delete stored email text").selectOption("7");
    await expect(list.locator("#status")).toContainText("deleted 7 days after a task closes");
    await list.reload();
    await expect(list.getByLabel("Delete stored email text")).toHaveValue("7");
  });
});

test.describe("context refresh", () => {
  test("adds only new messages to an existing task", async ({ context, openGmail }) => {
    const gmail = await openGmail("thread.html");
    // First capture: just the latest message.
    const task = await createTask(await openReview(context, gmail));
    await expect(task.locator("#sources li")).toHaveCount(1);

    // Second capture: the whole conversation, added to the existing task.
    const review = await openReview(context, gmail);
    await expect(review.locator("#refresh-section")).toBeVisible();
    await review.getByLabel(/Whole conversation/).check();
    // The first capture used only the latest message; the other four are new.
    await expect(review.locator("#refresh-tasks")).toContainText("4 new messages");
    await review.getByRole("button", { name: "Add new messages to this task" }).click();
    await expect(review.getByRole("status")).toContainText("Added 4 new messages to the task.");
    await review.getByRole("link", { name: "Open the task" }).click();
    await expect(review.locator("#sources li")).toHaveCount(5);
    await expect(review.locator("#refresh-info")).toContainText("Last refreshed");
    await expect(review.locator("#history")).toContainText("Context refreshed: 4 new messages added");
  });

  test("new messages after approval block the task; nothing is approved automatically", async ({ context, extensionId, openGmail }) => {
    await grantClipboard(context, extensionId);
    const gmail = await openGmail("thread.html");
    const task = await createTask(await openReview(context, gmail));
    await approve(context, task);

    const review = await openReview(context, gmail);
    await review.getByLabel(/Whole conversation/).check();
    await review.getByRole("button", { name: "Add new messages to this task" }).click();
    await expect(review.getByRole("status")).toContainText("Its approval no longer applies");

    await task.reload();
    await expect(task.locator("#status-label")).toHaveText("Blocked");
    await expect(task.locator("#block-reason")).toContainText("New email messages arrived after approval");
    await expect(task.locator("#context-banner")).toContainText("added after plan version 1 was recorded");
    await expect(task.getByRole("button", { name: "Implementation started" })).toBeDisabled();
    await expect(task.locator("#plan-versions")).toContainText("no longer current");

    await task.getByRole("button", { name: "Copy update with new messages for Claude" }).click();
    const update = await task.evaluate(() => navigator.clipboard.readText());
    expect(update).toContain("# Update for task:");
    expect(update).toContain("Please add a changelog entry before the release.");
    expect(update).not.toContain("the version should be 2.0"); // already in the original brief

    // Back to review: the old plan needs a fresh approval.
    await task.getByRole("button", { name: "Back to review" }).click();
    await expect(task.locator("#status-label")).toHaveText("Plan recorded, awaiting your approval");
  });
});

test.describe("deletion", () => {
  test("stored email text can be deleted on its own, then the whole task", async ({ context, openGmail }) => {
    const task = await createTask(await openReview(context, await openGmail("single-message.html")));
    await expect(task.locator("#retention-info")).toContainText("stored in this browser");
    task.once("dialog", (d) => void d.accept());
    await task.getByRole("button", { name: "Delete stored email text now" }).click();
    await expect(task.locator("#retention-info")).toContainText("Stored email text was deleted");
    await task.getByText("Brief that will be copied").click();
    await expect(task.locator("#brief")).toContainText("(content not retained)");
    await expect(task.locator("#history")).toContainText("Stored email text deleted by you");

    task.once("dialog", (d) => void d.accept());
    await task.getByRole("button", { name: "Delete this task" }).click();
    await task.waitForURL(/options\.html/);
    await expect(task.locator("#empty")).toBeVisible();
  });
});
