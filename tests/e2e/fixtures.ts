import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";

export interface ExtensionOptions {
  browserChannel: string;
  e2eBuild: string;
  prodBuild: string;
}

const FIXTURES = resolve("fixtures/synthetic-gmail");

interface Fixtures {
  build: "e2e" | "prod";
  context: BrowserContext;
  extensionId: string;
  gmail: Page;
  // Serves a fixture as https://mail.google.com/... and waits for the content script's button.
  openGmail: (fixture: string, hash?: string) => Promise<Page>;
}

export const test = base.extend<Fixtures & ExtensionOptions>({
  browserChannel: ["chromium", { option: true }],
  e2eBuild: ["", { option: true }],
  prodBuild: ["", { option: true }],
  build: ["e2e", { option: true }],

  context: async ({ browserChannel, e2eBuild, prodBuild, build }, use) => {
    const ext = resolve(build === "e2e" ? e2eBuild : prodBuild);
    const profile = mkdtempSync(join(tmpdir(), "ih-e2e-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: browserChannel,
      headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    // Synthetic Gmail only; every other request is blocked so no real site is contacted.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "https://mail.google.com") {
        const name = url.searchParams.get("fixture") ?? "single-message.html";
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(join(FIXTURES, name), "utf8") });
      } else if (url.protocol === "http:" || url.protocol === "https:") {
        await route.abort();
      } else {
        await route.fallback();
      }
    });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
    await use(new URL(sw.url()).host);
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
});

export const expect = test.expect;

export function sendButton(page: Page) {
  return page.locator("[data-inbox-handoff]").getByRole("button", { name: /Send this email to Claude/ });
}

// Clicks the Gmail button and returns the review tab it opens.
export async function openReview(context: BrowserContext, page: Page): Promise<Page> {
  const [review] = await Promise.all([context.waitForEvent("page"), sendButton(page).click()]);
  await review.waitForLoadState("domcontentloaded");
  return review;
}
