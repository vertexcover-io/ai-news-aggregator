import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../dist");

export const API_BASE: string = process.env.E2E_API_BASE ?? "http://127.0.0.1:3000";
export const ADMIN_PASSWORD: string =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "vertexcover@123";
const DB_URL: string =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@127.0.0.1:5432/newsletter";

// Deterministic extension ID derived from the manifest key.
export const EXPECTED_EXTENSION_ID = "alnmmlkpbceggejnpiajajenakencoeb";

export function makeDbClient(): Client {
  return new Client({
    connectionString: DB_URL,
    connectionTimeoutMillis: 5_000,
  });
}

export async function queryRawItems(
  url: string,
): Promise<{ id: string; source_type: string; url: string | null; tenant_id: string | null }[]> {
  const client = makeDbClient();
  await client.connect();
  try {
    const res = await client.query<{
      id: string;
      source_type: string;
      url: string | null;
      tenant_id: string | null;
    }>(
      "SELECT id, source_type, url, tenant_id FROM raw_items WHERE source_type = 'manual' AND url = $1",
      [url],
    );
    return res.rows;
  } finally {
    await client.end();
  }
}

export async function countRawItemsByUrl(url: string): Promise<number> {
  const client = makeDbClient();
  await client.connect();
  try {
    const res = await client.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM raw_items WHERE source_type = 'manual' AND url = $1",
      [url],
    );
    return parseInt(res.rows[0]?.count ?? "0", 10);
  } finally {
    await client.end();
  }
}

/**
 * Create a tenant_admin (+ its tenant) via the public signup API. Idempotent:
 * a 409 (email already in use) is treated as success so re-runs are safe.
 */
export async function signupTenant(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, confirmPassword: password }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`signup failed (${res.status}): ${await res.text()}`);
  }
}

/** The tenant_id of a seeded user, for per-tenant DB assertions. */
export async function getTenantIdForEmail(email: string): Promise<string | null> {
  const client = makeDbClient();
  await client.connect();
  try {
    const res = await client.query<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM users WHERE email = $1",
      [email],
    );
    return res.rows[0]?.tenant_id ?? null;
  } finally {
    await client.end();
  }
}

// Fixture types
interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  apiBase: string;
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        "--headless=new",
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    // Grab the service worker once — MV3 SW sleeps after ~30s, do not re-wait.
    let [sw] = ctx.serviceWorkers();
    if (!sw) {
      sw = await ctx.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    const derivedId = sw.url().split("/")[2];
    // Store for extensionId fixture to read.
    (ctx as BrowserContext & { _derivedExtId?: string })._derivedExtId = derivedId;

    await use(ctx);
    await ctx.close();
  },

  extensionId: async ({ context }, use) => {
    const derivedId = (context as BrowserContext & { _derivedExtId?: string })._derivedExtId;
    if (!derivedId) throw new Error("Extension service worker did not start");
    await use(derivedId);
  },

  // eslint-disable-next-line no-empty-pattern
  apiBase: async ({}, use) => {
    await use(API_BASE);
  },
});

export { expect } from "@playwright/test";
