/**
 * VS-3: branded public home + subscribe for a non-zero tenant.
 *
 * Host simulation: the whole browser context sends X-Tenant-Slug (honored by
 * the API when NODE_ENV !== production), standing in for <slug>.lvh.me.
 *
 * Covers REQ-040 (tenant branding, no hardcoded brand, logo fallback),
 * REQ-042 (nav gated by tenant flags), REQ-122-style archive listing for the
 * tenant, and REQ-050/074 (subscriber lands on THAT tenant).
 */
import { test, expect } from "@playwright/test";
import { makeDbClient, seedReviewedArchive, seedTenant } from "./_infra";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG = `quantum-${RUN}`;
const NAME = "Quantum Brief";
const HEADLINE = "Everything superposed, nothing collapsed";
const TOPIC_STRIP = "Qubits · Error correction · Annealing";
const SUBTAGLINE = "Decoherence-free since 2026.";
const ARCHIVE_HEADLINE = `Topological qubits land ${RUN}`;
const SUBSCRIBER_EMAIL = `reader-${RUN}@example.com`;

test.use({ extraHTTPHeaders: { "x-tenant-slug": SLUG } });

let tenantId = "";

test.beforeAll(async () => {
  tenantId = await seedTenant({
    slug: SLUG,
    name: NAME,
    status: "active",
    headline: HEADLINE,
    topicStrip: TOPIC_STRIP,
    subtagline: SUBTAGLINE,
    canonEnabled: false,
  });
  await seedReviewedArchive({ tenantId, digestHeadline: ARCHIVE_HEADLINE });
});

test("VS-3: public home renders the tenant's branding, archive, and gated nav", async ({
  page,
}) => {
  await page.goto("/");

  // Masthead carries the tenant's name; the logo falls back to the default
  // mark (svg) because no logo was uploaded (REQ-040).
  const masthead = page.locator("header");
  await expect(masthead.getByText(NAME)).toBeVisible({ timeout: 15_000 });
  await expect(masthead.locator("svg").first()).toBeVisible();
  await expect(masthead.locator("img")).toHaveCount(0);

  // Hero: headline / topic strip / subtagline come from tenant branding.
  await expect(page.locator("h1")).toHaveText(HEADLINE);
  await expect(page.getByText("Error correction")).toBeVisible();
  await expect(page.getByText(SUBTAGLINE)).toBeVisible();

  // No hardcoded brand anywhere on a non-zero tenant's page (REQ-040).
  await expect(page.getByText(/agentloop/i)).toHaveCount(0);
  await expect(page).toHaveTitle(new RegExp(NAME));

  // Nav gated by flags: canon + built off ⇒ no Must Read / Built; Sources stays.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Sources" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Must Read" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Built" })).toHaveCount(0);

  // The tenant's published archive is listed and opens.
  const archiveLink = page
    .locator('a[href^="/archive/"]')
    .filter({ hasText: ARCHIVE_HEADLINE })
    .first();
  await expect(archiveLink).toBeVisible();
  await archiveLink.click();
  await expect(page).toHaveURL(/\/archive\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 10_000,
  });
});

test("VS-3: subscribing on the tenant's home creates a subscriber for THAT tenant", async ({
  page,
}) => {
  await page.goto("/");

  const card = page.locator('[data-section="inline-subscribe"]');
  await expect(
    card.getByRole("heading", { name: `Read ${NAME} every morning.` }),
  ).toBeVisible({ timeout: 15_000 });
  await card.getByLabel("Email").fill(SUBSCRIBER_EMAIL);
  await card.getByRole("button", { name: /subscribe/i }).click();
  await expect(
    card.getByText("Check your inbox to confirm your subscription."),
  ).toBeVisible({ timeout: 10_000 });

  // REQ-050/074: the subscriber row belongs to the host tenant, not tenant 0.
  const db = makeDbClient();
  await db.connect();
  try {
    const rows = await db.query<{ tenant_id: string; status: string }>(
      "SELECT tenant_id, status FROM subscribers WHERE email = $1",
      [SUBSCRIBER_EMAIL],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].tenant_id).toBe(tenantId);
    expect(rows.rows[0].status).toBe("pending");
  } finally {
    await db.end();
  }
});
