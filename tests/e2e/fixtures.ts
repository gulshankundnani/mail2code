import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";

export interface ExtensionOptions {
  browserChannel: string;
  extensionBuild: string;
}

const FIXTURES = resolve("fixtures/synthetic-gmail");
export const CLAUDE_STUB = "<!doctype html><title>Claude (stub)</title><h1>claude.ai stub for tests</h1>";

// Gmail pages built by a test at run time (fixture=dynamic:<name>), for emails
// whose content another browser profile produced (approval requests/replies).
export const DYNAMIC_GMAIL = new Map<string, string>();

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// One synthetic Gmail conversation with a single plain-text message.
export function syntheticEmail(d: { threadId: string; subject: string; fromName: string; fromEmail: string; body: string }): string {
  const lines = d.body
    .split("\n")
    .map((l) => (l ? `<div>${escapeHtml(l)}</div>` : "<div><br></div>"))
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(d.subject)} - Synthetic Mail</title></head><body>
<div role="main">
  <h2 class="hP" data-thread-perm-id="${d.threadId}">${escapeHtml(d.subject)}</h2>
  <div class="adn ads" data-message-id="#msg-${d.threadId.replace("thread-", "")}1">
    <span class="gD" email="${d.fromEmail}" name="${escapeHtml(d.fromName)}">${escapeHtml(d.fromName)}</span>
    <span class="g3" title="Oct 26, 2026, 10:00 AM">10:00 AM</span>
    <div class="ii gt"><div class="a3s aiL">${lines}</div></div>
  </div>
</div></body></html>`;
}

// Launches a browser with the extension in a fresh profile. Each call is a
// separate "computer" with its own IndexedDB.
export async function launchExtension(browserChannel: string, extensionBuild: string): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const ext = resolve(extensionBuild);
  const profile = mkdtempSync(join(tmpdir(), "m2c-e2e-profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: browserChannel,
    headless: true,
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      // Network kill switch: no hostname resolves, so nothing can reach the
      // internet. Needed because tabs opened by the extension itself
      // (tabs.create) bypass context.route below.
      "--host-resolver-rules=MAP * ~NOTFOUND",
    ],
  });
  // Synthetic Gmail and a claude.ai stub for pages Playwright can intercept;
  // every other request is aborted.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://mail.google.com") {
      const name = url.searchParams.get("fixture") ?? "single-message.html";
      const body = name.startsWith("dynamic:") ? (DYNAMIC_GMAIL.get(name.slice(8)) ?? "<!doctype html><title>missing</title>") : readFileSync(join(FIXTURES, name), "utf8");
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
    } else if (url.origin === "https://claude.ai") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: CLAUDE_STUB });
    } else if (url.protocol === "http:" || url.protocol === "https:") {
      await route.abort();
    } else {
      await route.fallback();
    }
  });
  return {
    context,
    close: async () => {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

export async function extensionIdOf(context: BrowserContext): Promise<string> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  return new URL(sw.url()).host;
}

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  gmail: Page;
  // Serves a fixture as https://mail.google.com/... in the Gmail tab.
  openGmail: (fixture: string, hash?: string) => Promise<Page>;
  // Opens an extension page in a new tab.
  openPage: (path: string) => Promise<Page>;
}

export const test = base.extend<Fixtures & ExtensionOptions>({
  browserChannel: ["chromium", { option: true }],
  extensionBuild: ["", { option: true }],

  context: async ({ browserChannel, extensionBuild }, use) => {
    const { context, close } = await launchExtension(browserChannel, extensionBuild);
    await use(context);
    await close();
  },

  extensionId: async ({ context }, use) => {
    await use(await extensionIdOf(context));
  },

  gmail: async ({ context }, use) => {
    await use(await context.newPage());
  },

  openGmail: async ({ gmail, extensionId }, use) => {
    void extensionId; // ensure the extension is loaded first
    await use(async (fixture, hash = "#inbox/FMfcgzSyntheticThread0001") => {
      await gmail.goto(`https://mail.google.com/mail/u/0/?fixture=${fixture}${hash}`);
      return gmail;
    });
  },

  openPage: async ({ context, extensionId }, use) => {
    await use(async (path) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      return page;
    });
  },
});

export const expect = test.expect;

export function sendButton(page: Page) {
  return page.locator("[data-mail2code]").getByRole("button", { name: /Send this email to Claude/ });
}

// The preview card that opens in Gmail after clicking the button.
export function card(page: Page) {
  return page.locator("[data-mail2code-card]");
}

// Clicks the Gmail button and waits for the preview card.
export async function openCard(page: Page) {
  await sendButton(page).click();
  await expect(card(page).getByRole("dialog")).toBeVisible();
  return card(page);
}

// Clicks the Gmail button, then "More options…" on the card, and returns the
// full review tab it opens.
export async function openReview(context: BrowserContext, page: Page): Promise<Page> {
  await openCard(page);
  const [review] = await Promise.all([context.waitForEvent("page"), card(page).getByRole("button", { name: "More options…" }).click()]);
  await review.waitForLoadState("domcontentloaded");
  return review;
}

// From a review page: create the task and follow the link to it.
export async function createTask(review: Page, opts: { repository?: string; instructions?: string } = {}): Promise<Page> {
  if (opts.repository) await review.getByLabel("Repository URL or project name (optional)").fill(opts.repository);
  if (opts.instructions) await review.getByLabel("Instructions for Claude (optional)").fill(opts.instructions);
  await review.getByRole("button", { name: "Create task" }).click();
  await expect(review.getByRole("status")).toContainText(/Task created|already exists/);
  await review.getByRole("link", { name: "Open the task" }).click();
  await review.waitForURL(/task\.html\?id=/);
  return review;
}

// Chromium refuses per-origin grants for chrome-extension:// ("opaque origin"),
// so grant for the whole test profile. Test-only; the extension itself
// requests no clipboard permission.
export async function grantClipboard(context: BrowserContext, extensionId: string) {
  void extensionId;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}
