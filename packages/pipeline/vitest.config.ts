import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const alias = {
  "@pipeline": resolve(__dirname, "src"),
  "@pipeline-tests": resolve(__dirname, "tests"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/unit/setup.ts"],
          globals: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "seam",
          include: ["tests/e2e/seam/**/*.e2e.test.ts"],
          testTimeout: 30000,
          globals: false,
          globalSetup: ["tests/e2e/setup/global-setup.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "network",
          include: ["tests/e2e/network/**/*.e2e.test.ts"],
          testTimeout: 60000,
          globals: false,
          globalSetup: ["tests/e2e/setup/global-setup.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          enabled: process.env.RUN_NETWORK_TESTS === "1",
        },
      },
    ],
  },
});
