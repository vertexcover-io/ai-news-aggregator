import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const alias = {
  "@shared": resolve(__dirname, "src"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
          globals: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          testTimeout: 60000,
          hookTimeout: 60000,
          globals: false,
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
