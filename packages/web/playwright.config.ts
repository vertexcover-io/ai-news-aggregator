import { defineConfig, devices } from "@playwright/test";

// Ports + URLs are provisioned by tests/e2e/run-e2e.mjs (the `test:e2e`
// entrypoint), which brings up Postgres/Redis and exports these before
// invoking Playwright. Running `playwright test` directly is unsupported.
const apiBase = process.env.E2E_API_BASE;
const webBase = process.env.PLAYWRIGHT_BASE_URL;
const apiPort = process.env.API_PORT;
const webPort = process.env.WEB_PORT;

if (!apiBase || !webBase || !apiPort || !webPort) {
  throw new Error("e2e env not provisioned — run `pnpm --filter @newsletter/web test:e2e` (not `playwright test` directly)");
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalTimeout: 600_000,
  retries: 0,
  // All specs share ONE hermetic Postgres/Redis, and several seed/truncate
  // global tables (run_archives, user_settings) in their hooks. Running spec
  // files concurrently lets one spec's teardown clobber another's seeded data,
  // so execute serially — these specs were written for a single shared stack.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: webBase,
    headless: true,
  },
  webServer: [
    {
      command: "pnpm --filter @newsletter/api dev",
      url: `${apiBase}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        API_PORT: apiPort,
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        REDIS_URL: process.env.REDIS_URL ?? "",
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "",
        // Email for the bootstrap-seeded admin user (P3 per-user auth) — must
        // match what the specs use to log in (tests/e2e/_infra.ts).
        ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "admin@agentloop.dev",
        // The whole serial suite logs in dozens of times from one IP; the
        // production token-bucket (10 burst / 0.5 tok/s) would 429 mid-suite.
        // The 429 path itself is covered by API integration tests.
        AUTH_RATE_LIMIT_CAPACITY: "100000",
        AUTH_RATE_LIMIT_REFILL_PER_SEC: "1000",
        // Must match the secret the specs use to forge subscriber tokens;
        // dotenv leaves an already-set env var intact, so this wins over .env.
        SESSION_SECRET: process.env.SESSION_SECRET ?? "",
        // Redirect confirm/unsubscribe/feedback flows at the hermetic web server.
        NEWSLETTER_BASE_URL: webBase,
        // E2E must never send real external messages. Force-blank SLACK_WEBHOOK_URL
        // (hard "" — not a passthrough) so dotenv cannot load a real webhook from
        // .env and the notifier no-ops (createSlackNotifier disables on "").
        // Any new e2e that exercises a Slack-triggering path asserts intent via
        // logs/DB state, never a live send. See packages/web/CLAUDE.md (E2E rules).
        SLACK_WEBHOOK_URL: "",
        // Same rule for the onboarding wizard's AI endpoints (P11): force-blank
        // the keys so a stray request can never reach Anthropic/Tavily — the
        // wizard spec stubs /api/onboarding/{generate-prompts,discover-sources}
        // at the browser network layer (page.route) instead.
        ANTHROPIC_API_KEY: "",
        TAVILY_API_KEY: "",
      },
    },
    {
      command: `pnpm --filter @newsletter/web exec vite --port ${webPort} --strictPort`,
      url: webBase,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        VITE_API_TARGET: apiBase,
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
