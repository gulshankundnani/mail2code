import { defineConfig } from "vitest/config";

// Runs the enforcement spike against the developer's own Claude Code install.
// Consumes model usage. Never runs in the default test suite or CI.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.spike.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
