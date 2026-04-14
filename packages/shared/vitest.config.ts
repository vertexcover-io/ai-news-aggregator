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
          include: ["tests/unit/**/*.test.ts"],
          globals: false,
        },
      },
    ],
  },
});
