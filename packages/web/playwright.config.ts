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
        // Must match the secret the specs use to forge subscriber tokens;
        // dotenv leaves an already-set env var intact, so this wins over .env.
        SESSION_SECRET: process.env.SESSION_SECRET ?? "",
        // Redirect confirm/unsubscribe/feedback flows at the hermetic web server.
        NEWSLETTER_BASE_URL: webBase,
        // Honor the single X-Forwarded-For hop that adminLogin() randomizes so
        // serial spec runs don't exhaust the per-IP login rate limit. The
        // production default is 0 (header ignored unless behind a proxy).
        TRUST_PROXY_HOPS: "1",
        // Hermetic determinism: force-blank the optional provider keys so the
        // multi-tenant journeys never depend on (or spend) real LLM/search/email
        // quota — generate-prompts and source discovery answer 503, and the
        // subscribe confirmation email fails softly (subscriber persists as
        // pending). The VS-1 journey saves prompts via direct PATCH instead.
        ANTHROPIC_API_KEY: "",
        TAVILY_API_KEY: "",
        RESEND_API_KEY: "",
        // E2E must never send real external messages. Force-blank SLACK_WEBHOOK_URL
        // (hard "" — not a passthrough) so dotenv cannot load a real webhook from
        // .env and the notifier no-ops (createSlackNotifier disables on "").
        // Any new e2e that exercises a Slack-triggering path asserts intent via
        // logs/DB state, never a live send. See packages/web/CLAUDE.md (E2E rules).
        SLACK_WEBHOOK_URL: "",
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
