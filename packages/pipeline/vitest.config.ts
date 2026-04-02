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
          globals: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          testTimeout: 30000,
          globals: false,
          globalSetup: ["tests/e2e/setup/global-setup.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
