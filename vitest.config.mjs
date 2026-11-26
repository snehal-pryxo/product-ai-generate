import { defineConfig } from "vitest/config";

// Separate from vite.config.js so the React Router plugin isn't loaded for tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    globalSetup: ["tests/support/globalSetup.js"],
    setupFiles: ["tests/support/setupEnv.js"],
    // All test files share one database and the worker claims any queued job,
    // so files run one at a time.
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
