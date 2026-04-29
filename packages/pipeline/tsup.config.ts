import { defineConfig } from "tsup";
import { resolve } from "node:path";

export default defineConfig({
  entry: ["src/index.ts", "src/add-post-entry.ts"],
  format: ["esm"],
  dts: { entry: { "add-post-entry": "src/add-post-entry.ts" } },
  clean: true,
  sourcemap: true,
  external: [
    "playwright",
    "crawlee",
    "@mozilla/readability",
    "jsdom",
    "turndown",
    "turndown-plugin-gfm",
  ],
  esbuildOptions(options) {
    options.alias = {
      "@pipeline": resolve(__dirname, "src"),
    };
  },
});
