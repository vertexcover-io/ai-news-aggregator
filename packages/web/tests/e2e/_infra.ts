import { Client } from "pg";

// Single source of truth for e2e wiring. Under the hermetic runner
// (playwright.config.ts) these env vars are set to ephemeral, per-run values;
// the fallbacks only apply when a spec is run against a manually-started stack.
export const E2E_DB_URL: string =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@127.0.0.1:5433/newsletter";

export const API_BASE: string =
  process.env.E2E_API_BASE ?? "http://127.0.0.1:3000";

export const ADMIN_PASSWORD: string =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "vertexcover@123";

/** Matches the API's bootstrap admin seed (services/admin-seed.ts). */
export const ADMIN_EMAIL: string =
  process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? "admin@agentloop.dev";

export function makeDbClient(): Client {
  return new Client({
    connectionString: E2E_DB_URL,
    connectionTimeoutMillis: 5_000,
  });
}
