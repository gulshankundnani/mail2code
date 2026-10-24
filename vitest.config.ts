import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // Real Claude Code runs live in *.spike.ts and only run via `npm run spike:real`.
    // Browser end-to-end tests live in tests/e2e and run via `npm run test:e2e`.
    exclude: ["**/node_modules/**", "**/*.spike.ts", "tests/e2e/**"],
  },
});
