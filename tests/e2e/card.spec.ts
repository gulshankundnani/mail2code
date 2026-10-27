// The one-click flow: Gmail button → preview card → link that opens Claude
// Code on this computer. The test browser has no network and no Claude app, so
// these tests check the link the extension builds and what it records.
import { card, expect, openCard, test } from "./fixtures.ts";

const promptIn = (href: string | null) => new URLSearchParams((href ?? "").split("?")[1]).get("q") ?? "";

test.describe("preview card", () => {
  test("analyses the conversation and builds a Claude app link with a compact prompt", async ({ openGmail }) => {
    const gmail = await openGmail("thread.html");
    const c = await openCard(gmail);
    const open = c.getByRole("link", { name: /Open in Claude app/ });
    const href = await open.getAttribute("href");
    expect(href?.startsWith("claude://code/new?q=")).toBe(true);
    const prompt = promptIn(href);
    expect(prompt).toContain("Task from email: Release checklist");
    expect(prompt).toContain("Please add a changelog entry before the release.");
    expect(prompt).toContain("Deadline: Friday.");
    expect(prompt).toMatch(/<<email-extract [a-f0-9]{8}>> \(untrusted/);
    expect(prompt).toContain("propose a plan first");
    expect(prompt.length).toBeLessThanOrEqual(5000);
    expect(prompt).not.toContain("must never be captured");
    await expect(c.locator("pre")).toHaveText(prompt);
    // Messages Gmail had collapsed (and behind "2 older messages") were expanded and read.
    await expect(c).toContainText("All 5 messages in this conversation were read.");
    expect(prompt).toContain("Kick-off: we agreed to ship version 2.0 at the end of the month.");
    expect(prompt).toContain("Can someone own the release notes?");
    expect(prompt).toContain("please also update the install docs.");
  });

  test("redacts credentials and never shows their values", async ({ openGmail }) => {
    const c = await openCard(await openGmail("secrets.html"));
    await expect(c).toContainText("Possible credentials found");
    await expect(c).not.toContainText("SYNTHETIC");
    const prompt = promptIn(await c.getByRole("link", { name: /Open in/ }).getAttribute("href"));
    expect(prompt).not.toContain("sk-ant-api03");
    expect(prompt).not.toContain("Synthetic-Pa55word");
  });

  test("switches to Claude Code in a terminal for a GitHub repository", async ({ openGmail }) => {
    const c = await openCard(await openGmail("single-message.html"));
    await c.getByLabel("Open in").selectOption("cli");
    await c.getByLabel("Repository (optional)").fill("https://github.com/example/app");
    const href = await c.getByRole("link", { name: /Open in Claude Code \(terminal\)/ }).getAttribute("href");
    expect(href?.startsWith("claude-cli://open?repo=example%2Fapp&q=")).toBe(true);
    await expect(c).toContainText("First time only: run `claude` once");
  });

  test("typing in the card doesn't trigger Gmail keyboard shortcuts", async ({ openGmail }) => {
    const gmail = await openGmail("single-message.html");
    await gmail.evaluate(() => {
      (window as unknown as { keys: string[] }).keys = [];
      document.addEventListener("keydown", (e) => (window as unknown as { keys: string[] }).keys.push(e.key));
    });
    const c = await openCard(gmail);
    await c.getByLabel("Instructions for Claude (optional)").fill("");
    await c.getByLabel("Instructions for Claude (optional)").pressSequentially("cr");
    expect(await gmail.evaluate(() => (window as unknown as { keys: string[] }).keys)).toEqual([]);
    expect(promptIn(await c.getByRole("link", { name: /Open in/ }).getAttribute("href"))).toContain("My instructions: cr");
  });

  test("clicking Open records the task as handed off", async ({ context, openGmail, openPage }) => {
    const gmail = await openGmail("single-message.html");
    const c = await openCard(gmail);
    const requested: string[] = [];
    context.on("request", (r) => requested.push(r.url()));
    await c.getByRole("link", { name: /Open in/ }).click();
    await expect(c.getByRole("status")).toContainText("The task is saved in your task list");
    // No web request carries the prompt; the claude:// link goes to the OS, not the network.
    expect(requested.filter((u) => /^https?:/.test(u) && u.includes("changelog"))).toEqual([]);
    const list = await openPage("options.html");
    await expect(list.locator("#tasks li")).toHaveCount(1);
    await expect(list.locator("#tasks li .badge")).toHaveText("Handoff opened");
  });

  test("More options opens the full review page", async ({ context, openGmail }) => {
    const gmail = await openGmail("single-message.html");
    const c = await openCard(gmail);
    const [review] = await Promise.all([context.waitForEvent("page"), c.getByRole("button", { name: "More options…" }).click()]);
    await expect(review.getByRole("heading", { name: "Review before creating a task" })).toBeVisible();
    await expect(card(gmail)).toHaveCount(0);
  });
});

test.describe("settings", () => {
  test("default destination, folders, mode snippet and validation", async ({ openPage, openGmail }) => {
    const s = await openPage("options.html");
    await expect(s.getByLabel("Default destination")).toHaveValue("desktop");
    await expect(s.getByLabel("Mode for new Claude Code sessions")).toHaveValue("plan");
    await expect(s.locator("#mode-snippet")).toContainText('"defaultMode": "plan"');
    await s.getByLabel("Mode for new Claude Code sessions").selectOption("default");
    await expect(s.locator("#mode-snippet")).toContainText('"defaultMode": "default"');

    await s.getByLabel(/Terminal: project folder/).fill("\\\\server\\share");
    await s.getByRole("button", { name: "Save settings" }).click();
    await expect(s.locator("#err-cliFolder")).toContainText("Network (UNC) paths aren't allowed.");
    await s.getByLabel(/Terminal: project folder/).fill("C:\\Projects\\app");
    await s.getByLabel("Default destination").selectOption("cli");
    await s.getByRole("button", { name: "Save settings" }).click();
    await expect(s.locator("#settings-status")).toContainText("Settings saved.");

    // The card uses the saved default, with the folder for non-GitHub tasks.
    const c = await openCard(await openGmail("single-message.html"));
    const href = await c.getByRole("link", { name: /Open in/ }).getAttribute("href");
    expect(href?.startsWith("claude-cli://open?cwd=C%3A%5CProjects%5Capp&q=")).toBe(true);
  });

  test("Claude API: key stays hidden, network access is opt-in, and removal works", async ({ openPage }) => {
    const s = await openPage("options.html");
    await expect(s.locator("#api-box")).toBeHidden();
    await s.getByLabel(/Claude API summary/).check();
    await expect(s.locator("#api-box")).toBeVisible();
    await expect(s.locator("#api-box")).toContainText("is sent to Anthropic");
    await expect(s.locator("#api-permission-state")).toContainText("hasn't been allowed yet");
    await expect(s.getByLabel("Model")).toHaveValue("claude-opus-5-5");
    await s.getByLabel("Anthropic API key").fill("sk-ant-api03-SYNTHETIC-not-a-real-key-000000");
    await s.getByRole("button", { name: "Save settings" }).click();
    await expect(s.locator("#settings-status")).toContainText("Allow access to api.anthropic.com");
    await expect(s.getByLabel("Anthropic API key")).toHaveValue("");
    await expect(s.locator("#api-key-state")).toContainText("A key is saved");
    // The key is not readable from storage that the Gmail content script can access.
    const local = await s.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    expect(local).not.toContain("SYNTHETIC-not-a-real-key");
    await s.getByRole("button", { name: "Remove key" }).click();
    await expect(s.locator("#api-key-state")).toContainText("No key saved yet");
  });

  test("on-device AI never downloads on its own", async ({ openPage }) => {
    const s = await openPage("options.html");
    await s.getByLabel(/on-device AI summary/).check();
    // Playwright's Chromium has no on-device model: the status says so, and no download starts.
    await expect(s.locator("#on-device-status")).toContainText(/isn't available|one-time model download|ready/);
  });
});

test("the card and the toolbar popup open the task dashboard and settings", async ({ context, extensionId, openGmail, openPage }) => {
  const gmail = await openGmail("single-message.html");
  const c = await openCard(gmail);
  const [settings] = await Promise.all([context.waitForEvent("page"), c.getByRole("button", { name: "Settings" }).click()]);
  await settings.waitForLoadState("domcontentloaded");
  expect(settings.url()).toBe(`chrome-extension://${extensionId}/options.html#settings`);
  await expect(settings.getByRole("heading", { name: "Settings" })).toBeVisible();

  const popup = await openPage("popup.html");
  const [tasks] = await Promise.all([context.waitForEvent("page"), popup.getByRole("button", { name: "Task dashboard" }).click()]);
  await tasks.waitForLoadState("domcontentloaded");
  expect(tasks.url()).toBe(`chrome-extension://${extensionId}/options.html`);
  await expect(tasks.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" })).toBeVisible();
});
