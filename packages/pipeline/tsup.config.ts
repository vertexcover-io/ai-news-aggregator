import { defineConfig } from "tsup";
import { resolve } from "node:path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = {
      "@pipeline": resolve(__dirname, "src"),
    };
  },
});
