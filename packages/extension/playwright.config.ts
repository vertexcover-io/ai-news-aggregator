import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ports are provisioned by tests/e2e/run-e2e.mjs (the `test:e2e` entrypoint).
// Running `playwright test` directly is unsupported.
const apiBase = process.env.E2E_API_BASE;
const apiPort = process.env.API_PORT;

if (!apiBase || !apiPort) {
  throw new Error(
    "e2e env not provisioned — run `pnpm --filter @newsletter/extension test:e2e` (not `playwright test` directly)",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalTimeout: 300_000,
  retries: 0,
  // Persistent context (browser with extension) must not be shared across parallel workers.
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(
          __dirname,
          "../../.harness/runtime/chrome-extension-url-collector/phase-4-playwright.json",
        ),
      },
    ],
  ],
  webServer: {
    command: "pnpm --filter @newsletter/api dev",
    url: `${apiBase}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      API_PORT: apiPort,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      REDIS_URL: process.env.REDIS_URL ?? "",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "",
      // No real external sends.
      SLACK_WEBHOOK_URL: "",
    },
  },
  projects: [
    {
      name: "chromium-extension",
      use: {
        // launchPersistentContext is done manually in fixtures.ts
      },
    },
  ],
});
