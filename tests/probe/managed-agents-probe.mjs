// Opt-in reachability probe for the possible Managed Agents integration.
// Sends two UNAUTHENTICATED requests (no API key, empty body) to
// api.anthropic.com from a real extension page, to learn whether the API
// accepts browser-extension origins. All other hosts are blocked.
// Run: node tests/probe/managed-agents-probe.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ext = resolve("apps/extension/dist/chrome-mv3");
const profile = mkdtempSync(join(tmpdir(), "ih-probe-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE api.anthropic.com"],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
const page = await ctx.newPage();
const failures = [];
ctx.on("requestfailed", (r) => failures.push({ method: r.method(), url: r.url(), reason: r.failure()?.errorText }));
ctx.on("response", (r) => { if (r.url().includes("api.anthropic.com")) failures.push({ method: r.request().method(), url: r.url(), status: r.status(), allowOrigin: r.headers()["access-control-allow-origin"] ?? null }); });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);

const results = await page.evaluate(async () => {
  const attempt = async (label, headers) => {
    try {
      const r = await fetch("https://api.anthropic.com/v1/agents", { method: "POST", headers, body: "{}" });
      const text = await r.text();
      return { label, outcome: "response readable", status: r.status, body: text.slice(0, 300) };
    } catch (e) {
      return { label, outcome: "blocked before a readable response", error: String(e) };
    }
  };
  const base = { "content-type": "application/json", "anthropic-version": "2023-06-01", "anthropic-beta": "managed-agents-2026-04-01" };
  return [
    await attempt("without direct-browser-access header", base),
    await attempt("with anthropic-dangerous-direct-browser-access: true", { ...base, "anthropic-dangerous-direct-browser-access": "true" }),
  ];
});
console.log(JSON.stringify({ network: failures, origin: new URL(page.url()).protocol, ranAt: new Date().toISOString(), results }, null, 2));
await ctx.close();
rmSync(profile, { recursive: true, force: true });
