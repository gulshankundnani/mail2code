// Phase 5: security hardening checks. Synthetic data only; no network.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTask, expect, grantClipboard, openReview, test } from "./fixtures.ts";

test("detected credentials are redacted before saving, by default", async ({ context, extensionId, openGmail }) => {
  await grantClipboard(context, extensionId);
  const review = await openReview(context, await openGmail("secrets.html"));
  await expect(review.locator("#secrets-warning")).toBeVisible();
  await expect(review.locator("#secrets-list")).toContainText("Anthropic API key");
  await expect(review.locator("#secrets-list")).toContainText("password in a URL");
  // The warning names kinds of secret, never the values.
  await expect(review.locator("#secrets-warning")).not.toContainText("SYNTHETIC");
  await expect(review.getByLabel("Replace them with [REDACTED] before saving")).toBeChecked();

  const payload = (await review.locator("#payload").textContent()) ?? "";
  expect(payload).not.toContain("sk-ant-api03");
  expect(payload).not.toContain("Synthetic-Pa55word");
  expect(payload).not.toContain("Synthetic-DbPass");
  expect(payload).toContain("postgres://deploy:[REDACTED]@db.example.test/app");
  expect(payload).toContain("Please fix the failing deploy script.");

  const task = await createTask(review);
  await task.getByRole("button", { name: "Copy brief" }).click();
  const brief = await task.evaluate(() => navigator.clipboard.readText());
  expect(brief).not.toContain("sk-ant-api03");
  expect(brief).toContain("[REDACTED]");
});

test("redaction can be turned off deliberately", async ({ context, openGmail }) => {
  const review = await openReview(context, await openGmail("secrets.html"));
  await review.getByLabel("Replace them with [REDACTED] before saving").uncheck();
  expect(await review.locator("#payload").textContent()).toContain("sk-ant-api03");
});

test("emails without credentials show no warning", async ({ context, openGmail }) => {
  const review = await openReview(context, await openGmail("single-message.html"));
  await expect(review.locator("#secrets-warning")).toBeHidden();
});

test("built manifests stay least-privilege with a strict CSP", async ({ extensionBuild }) => {
  const builds = [extensionBuild, "apps/extension/dist/firefox-mv3"].map((p) => resolve(p)).filter((p) => existsSync(`${p}/manifest.json`));
  expect(builds.length).toBeGreaterThan(0);
  for (const dir of builds) {
    const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
    expect(m.manifest_version, dir).toBe(3);
    expect(m.permissions, dir).toEqual(["storage"]);
    expect(m.host_permissions ?? [], dir).toEqual([]);
    expect(m.optional_permissions ?? [], dir).toEqual([]);
    expect(m.optional_host_permissions ?? [], dir).toEqual(["https://api.anthropic.com/*"]);
    expect(m.web_accessible_resources ?? [], dir).toEqual([]);
    expect(m.externally_connectable, dir).toBeUndefined();
    expect(m.content_scripts.map((c: { matches: string[] }) => c.matches).flat(), dir).toEqual(["https://mail.google.com/*"]);
    const csp: string = m.content_security_policy.extension_pages;
    for (const directive of ["script-src 'self'", "connect-src https://api.anthropic.com", "object-src 'none'", "frame-ancestors 'none'"]) expect(csp, dir).toContain(directive);
    expect(csp, dir).not.toMatch(/unsafe-(eval|inline)/);
    expect((csp.match(/https?:\/\/[^\s;]+/g) ?? []).filter((u) => u !== "https://api.anthropic.com"), dir).toEqual([]);
  }
});

test("extension pages don't load anything from the network", async ({ context, openPage }) => {
  const external: string[] = [];
  context.on("request", (r) => {
    if (/^https?:/.test(r.url())) external.push(r.url());
  });
  for (const page of ["options.html", "backup.html", "task.html?id=none", "review.html"]) {
    const p = await openPage(page);
    await p.waitForLoadState("load");
    await p.close();
  }
  expect(external).toEqual([]);
});
