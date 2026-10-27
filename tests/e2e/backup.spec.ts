// Phase 4: export, import, encryption and machine migration in a real browser.
// Synthetic data only; no network.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { createTask, expect, extensionIdOf, launchExtension, openReview, test } from "./fixtures.ts";

async function downloadBackup(page: Page): Promise<{ name: string; text: string }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  return { name: dl.suggestedFilename(), text: readFileSync((await dl.path())!, "utf8") };
}

async function chooseFile(page: Page, name: string, text: string) {
  await page.getByLabel("Backup file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
}

test("plain export has no email text by default; including it requires encryption or an explicit acknowledgement", async ({ context, openGmail, openPage }) => {
  await createTask(await openReview(context, await openGmail("single-message.html")));
  const backup = await openPage("backup.html");
  await expect(backup.locator("#task-total")).toHaveText("1");

  const plain = await downloadBackup(backup);
  expect(plain.name).toMatch(/^mail2code-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(plain.text);
  expect(file).toMatchObject({ format: "mail2code-export", schemaVersion: 2, includesEmailContent: false });
  expect(file.data.tasks[0].title).toBe("Login accepts any password");
  expect(plain.text).not.toContain("accepts any password for the admin user"); // email body

  await backup.getByLabel("Include stored email text").check();
  await expect(backup.locator("#plain-email-warning")).toBeVisible();
  await backup.getByRole("button", { name: "Download backup" }).click();
  await expect(backup.getByRole("status")).toContainText("turn on encryption");
  await backup.getByLabel(/I understand this file will contain email text/).check();
  const withEmail = await downloadBackup(backup);
  expect(withEmail.text).toContain("accepts any password for the admin user");
});

test("migrate to another computer with an encrypted backup", async ({ context, openGmail, openPage, browserChannel, extensionBuild }) => {
  // Computer A: a task, approved and started.
  const task = await createTask(await openReview(context, await openGmail("single-message.html")));
  await task.getByRole("button", { name: "Copy brief" }).click();
  await expect(task.locator("#status-label")).toHaveText("Brief ready");
  const [claude] = await Promise.all([context.waitForEvent("page"), task.getByRole("button", { name: /^Open / }).click()]);
  await claude.close();
  await task.getByRole("button", { name: "I've sent it to Claude" }).click();
  await task.getByLabel("Plan", { exact: true }).fill("Objective: fix login.\nSteps: edit auth.ts.");
  await task.getByRole("button", { name: "Record plan" }).click();
  await task.getByRole("button", { name: "Approve this plan" }).click();
  await task.getByRole("button", { name: "Implementation started" }).click();
  await expect(task.locator("#status-label")).toHaveText(/Implementation started/);

  const backup = await openPage("backup.html");
  await backup.getByLabel("Include stored email text").check();
  await backup.getByLabel("Encrypt with a passphrase").check();
  await backup.getByLabel("Passphrase (at least 12 characters)").fill("correct horse battery");
  await backup.getByLabel("Repeat passphrase").fill("correct horse battery");
  const enc = await downloadBackup(backup);
  expect(enc.name).toMatch(/-encrypted\.json$/);
  expect(enc.text).not.toContain("Login accepts any password");
  expect(enc.text).not.toContain("correct horse battery");

  // Computer B: a separate browser profile.
  const b = await launchExtension(browserChannel, extensionBuild);
  try {
    const id = await extensionIdOf(b.context);
    const page = await b.context.newPage();
    await page.goto(`chrome-extension://${id}/backup.html`);
    await chooseFile(page, enc.name, enc.text);
    await expect(page.locator("#decrypt-fields")).toBeVisible();
    await page.getByLabel(/This backup is encrypted/).fill("wrong passphrase!!");
    await page.getByRole("button", { name: "Decrypt" }).click();
    await expect(page.getByRole("status")).toContainText("Wrong passphrase");
    await page.getByLabel(/This backup is encrypted/).fill("correct horse battery");
    await page.getByRole("button", { name: "Decrypt" }).click();
    await expect(page.locator("#preview-summary")).toContainText("1 task(s)");
    await expect(page.locator("#preview-summary")).toContainText("includes email text");
    await expect(page.getByLabel("Restore into this empty installation")).toBeChecked();
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.locator("#report-list")).toContainText("Imported 1 task(s)");
    await expect(page.locator("#report-list")).toContainText("now blocked for review");

    await page.goto(`chrome-extension://${id}/options.html`);
    await page.locator("#tasks li a").click();
    await expect(page.locator("#status-label")).toHaveText("Blocked");
    await expect(page.locator("#block-reason")).toContainText("Restored from a backup");
    await expect(page.getByRole("button", { name: "Implementation started" })).toBeDisabled();
    await expect(page.locator("#plan-versions")).toContainText("imported, history only");
    await page.getByText("Brief that will be copied").click();
    await expect(page.locator("#brief")).toContainText("accepts any password for the admin user");

    // A fresh approval on computer B is required, and works.
    await page.getByRole("button", { name: "Back to review" }).click();
    await page.getByRole("button", { name: "Approve this plan" }).click();
    await expect(page.locator("#status-label")).toHaveText("Approved by you");
  } finally {
    await b.close();
  }
});

test("damaged and foreign files are rejected without changing anything", async ({ openPage }) => {
  const backup = await openPage("backup.html");
  await chooseFile(backup, "notes.json", "this is not json");
  await expect(backup.getByRole("status")).toContainText("isn't valid JSON");
  await chooseFile(backup, "other.json", JSON.stringify({ hello: "world" }));
  await expect(backup.getByRole("status")).toContainText("isn't a Mail2Code backup");
  await expect(backup.locator("#preview")).toBeHidden();
});

test("replace needs the word REPLACE", async ({ context, openGmail, openPage }) => {
  await createTask(await openReview(context, await openGmail("single-message.html")));
  const backup = await openPage("backup.html");
  const { name, text } = await downloadBackup(backup);
  await createTask(await openReview(context, await openGmail("thread.html")));

  await backup.reload();
  await chooseFile(backup, name, text);
  await expect(backup.getByLabel("Restore into this empty installation")).toBeDisabled();
  await expect(backup.getByLabel("Merge with the tasks already here")).toBeChecked();
  await expect(backup.locator("#preview-tasks")).toContainText("already here (skipped)");
  await backup.getByLabel("Replace all tasks here with the backup").check();
  await expect(backup.locator("#replace-count")).toHaveText("2");
  await expect(backup.getByRole("button", { name: "Import" })).toBeDisabled();
  await backup.getByLabel("Type REPLACE to confirm").fill("REPLACE");
  await backup.getByRole("button", { name: "Import" }).click();
  await expect(backup.locator("#report-list")).toContainText("after deleting the previous tasks");
  await backup.goto(backup.url().replace("backup.html", "options.html"));
  await expect(backup.locator("#tasks li")).toHaveCount(1);
});
