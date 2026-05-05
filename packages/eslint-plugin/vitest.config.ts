import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          globals: false,
          // @typescript-eslint/rule-tester spins up tsserver via projectService;
          // cold-start under turbo parallel load can exceed the 5s default.
          testTimeout: 30000,
        },
      },
    ],
  },
});
