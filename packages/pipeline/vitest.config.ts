import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          globals: false,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          testTimeout: 30000,
          globals: false,
          globalSetup: ["tests/e2e/setup/global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
