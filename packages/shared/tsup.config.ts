import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: [
    "src/index.ts",
    "src/db/index.ts",
    "src/redis.ts",
    "src/types/index.ts",
    "src/types/settings.ts",
    "src/run-start.ts",
    "src/send-newsletter.ts",
    "src/constants/index.ts",
    "src/utils/index.ts",
    "src/logger.ts",
    "src/slack/index.ts",
    "src/social/test-post-result.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: !options.watch,
  sourcemap: true,
}));
