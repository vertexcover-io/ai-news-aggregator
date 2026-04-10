import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/db/index.ts",
    "src/redis.ts",
    "src/types/index.ts",
    "src/constants/index.ts",
    "src/utils/index.ts",
    "src/logger.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
