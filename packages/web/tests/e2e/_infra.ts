import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Page } from "@playwright/test";

// Single source of truth for e2e wiring. Under the hermetic runner
// (playwright.config.ts) these env vars are set to ephemeral, per-run values;
// the fallbacks only apply when a spec is run against a manually-started stack.
export const E2E_DB_URL: string =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@127.0.0.1:5433/newsletter";

export const API_BASE: string =
  process.env.E2E_API_BASE ?? "http://127.0.0.1:3000";

// Tenant-zero admin used by the specs. The migrations seed the AGENTLOOP
// tenant (TENANT_ZERO_ID); the user row is seeded lazily by ensureE2eUser()
// with a precomputed bcrypt hash so the web package needs no bcrypt dep.
export const TENANT_ZERO_ID = "00000000-0000-0000-0000-000000000000";
export const E2E_USER_EMAIL = "e2e-admin@agentloop.test";
export const E2E_USER_PASSWORD = "vertexcover@123";
const E2E_USER_PASSWORD_HASH =
  "$2b$10$NlVZUuvZnRiTbPDXjQiKaO60ZTQ9UWj34FMCBnzKBKHRIDN4dWwWq";

export function makeDbClient(): Client {
  return new Client({
    connectionString: E2E_DB_URL,
    connectionTimeoutMillis: 5_000,
  });
}

let userSeeded = false;

export async function ensureE2eUser(): Promise<void> {
  if (userSeeded) return;
  const db = makeDbClient();
  await db.connect();
  try {
    // Fresh hermetic DBs have no legacy singleton, so migration 0041's
    // tenant-zero insert no-ops — seed the tenant here before the user.
    await db.query(
      `INSERT INTO tenants (id, slug, name, status, canon_enabled)
       VALUES ($1, 'agentloop', 'AGENTLOOP', 'active', true)
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_ZERO_ID],
    );
    await db.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, 'E2E Admin', $3, 'tenant_admin')
       ON CONFLICT (email) DO NOTHING`,
      [TENANT_ZERO_ID, E2E_USER_EMAIL, E2E_USER_PASSWORD_HASH],
    );
  } finally {
    await db.end();
  }
  userSeeded = true;
}

// Logs the browser context in via the real auth API. Each call sends a unique
// X-Forwarded-For first hop so the suite never trips the per-IP login rate
// limit (20/15min) across specs sharing one hermetic API server.
function randomOctet(): string {
  return String(Math.floor(Math.random() * 255));
}

export async function adminLogin(page: Page): Promise<void> {
  await ensureE2eUser();
  await loginAs(page, E2E_USER_EMAIL);
}

/** Logs the browser context in as any seeded user (password = E2E_USER_PASSWORD). */
export async function loginAs(
  page: Page,
  email: string,
  password: string = E2E_USER_PASSWORD,
): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password },
    headers: {
      "x-forwarded-for": `10.${randomOctet()}.${randomOctet()}.${randomOctet()}`,
    },
  });
  if (!res.ok()) {
    throw new Error(
      `loginAs(${email}) failed: ${String(res.status())} ${await res.text()}`,
    );
  }
}

// ── Multi-tenant seed helpers (Phase 14 journeys) ────────────────────────────

export interface SeedTenantInput {
  slug: string;
  name: string;
  status?: "active" | "pending_setup";
  headline?: string | null;
  topicStrip?: string | null;
  subtagline?: string | null;
  canonEnabled?: boolean;
}

export async function seedTenant(input: SeedTenantInput): Promise<string> {
  const id = randomUUID();
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query(
      `INSERT INTO tenants (id, slug, name, status, headline, topic_strip, subtagline, canon_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.slug,
        input.name,
        input.status ?? "active",
        input.headline ?? null,
        input.topicStrip ?? null,
        input.subtagline ?? null,
        input.canonEnabled ?? false,
      ],
    );
  } finally {
    await db.end();
  }
  return id;
}

/** Seeds a login-able user (password = E2E_USER_PASSWORD). `tenantId: null`
 * with role `super_admin` creates a super admin. */
export async function seedUser(input: {
  email: string;
  tenantId: string | null;
  role: "tenant_admin" | "super_admin";
}): Promise<string> {
  const id = randomUUID();
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, $3, 'E2E Seeded User', $4, $5)`,
      [id, input.tenantId, input.email, E2E_USER_PASSWORD_HASH, input.role],
    );
  } finally {
    await db.end();
  }
  return id;
}

/** Minimal user_settings row — the admin dashboard shows the runs list (not
 * the "Get started" empty state) only once a settings row exists. */
export async function seedTenantSettings(tenantId: string): Promise<void> {
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query(
      `INSERT INTO user_settings
         (tenant_id, top_n, shortlist_size, ranking_prompt, shortlist_prompt,
          pipeline_time, email_time, linkedin_time, twitter_time, schedule_timezone)
       VALUES ($1, 10, 30, 'Seeded ranking prompt.', 'Seeded shortlist prompt.',
               '06:00', '07:30', '08:00', '08:00', 'UTC')
       ON CONFLICT DO NOTHING`,
      [tenantId],
    );
  } finally {
    await db.end();
  }
}

/** Minimal reviewed archive (one ranked story backed by a raw_items row, so
 * public listings render a linked issue) for the tenant's public home and
 * admin runs list. */
export async function seedReviewedArchive(input: {
  tenantId: string;
  digestHeadline: string;
  digestSummary?: string;
  completedAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  const completedAt =
    input.completedAt ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const db = makeDbClient();
  await db.connect();
  try {
    const rawItem = await db.query<{ id: number }>(
      `INSERT INTO raw_items (tenant_id, source_type, external_id, title, url)
       VALUES ($1, 'hn', $2, $3, $4)
       RETURNING id`,
      [
        input.tenantId,
        `e2e-${id}`,
        input.digestHeadline,
        `https://example.com/${id}`,
      ],
    );
    const rankedItems = JSON.stringify([
      {
        rawItemId: rawItem.rows[0].id,
        score: 0.91,
        rationale: "Seeded for e2e.",
        title: input.digestHeadline,
      },
    ]);
    await db.query(
      `INSERT INTO run_archives
         (id, tenant_id, status, ranked_items, top_n, reviewed, completed_at,
          digest_headline, digest_summary)
       VALUES ($1, $2, 'completed', $3::jsonb, 5, true, $4, $5, $6)`,
      [
        id,
        input.tenantId,
        rankedItems,
        completedAt,
        input.digestHeadline,
        input.digestSummary ?? `${input.digestHeadline} — seeded for e2e.`,
      ],
    );
  } finally {
    await db.end();
  }
  return id;
}
