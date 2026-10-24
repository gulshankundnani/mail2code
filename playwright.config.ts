import { defineConfig } from "@playwright/test";
import type { ExtensionOptions } from "./tests/e2e/fixtures.ts";

// Extensions need a persistent context, so tests run serially.
export default defineConfig<ExtensionOptions>({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: { browserChannel: "chromium", e2eBuild: "apps/extension/dist/chrome-mv3-e2e", prodBuild: "apps/extension/dist/chrome-mv3" },
    },
    {
      name: "msedge",
      use: { browserChannel: "msedge", e2eBuild: "apps/extension/dist/edge-mv3-e2e", prodBuild: "apps/extension/dist/edge-mv3" },
    },
  ],
});
