/**
 * P7 e2e: per-tenant branding on the public homepage (REQ-040/041/042/043).
 *
 * Distinct from tenant-host.spec.ts (which proves the Host→tenant RESOLVER
 * semantics: known slug 200 / unknown slug 404). This spec proves what the
 * resolved tenant actually RENDERS: the AGENTLOOP homepage is visually
 * unchanged (same sections, same slots — REQ-041), a second seeded tenant
 * gets the same layout with its own name/headline/strip and a logo, with no
 * "AGENTLOOP" string anywhere (REQ-040), nav derived from flags/tenant-0
 * (REQ-042), and the logo endpoint serves cache-friendly image bytes
 * (REQ-043).
 *
 * Tenancy targeted via the X-Tenant-Slug dev override (hermetic stack runs
 * on localhost — no wildcard DNS), as in tenant-host.spec.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { makeDbClient } from "./_infra";

const SLUG = "inference";
const NAME = "The Inference";
const HEADLINE = "The daily read for people building with inference.";
const TOPIC_STRIP = "SERVING · QUANTIZATION · LATENCY · COST";
const SUBTAGLINE = "No funding rounds. No leaderboards. No discourse. Just the runtime.";

// Minimal valid 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let agentloopArchiveId = "";

test.beforeAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    // Second tenant with full branding + logo, Canon off (REQ-040/042/043).
    await db.query(
      `INSERT INTO tenants
         (slug, name, status, headline, topic_strip, subtagline,
          logo_bytes, logo_content_type, feature_canon)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, 'image/png', false)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, status = EXCLUDED.status,
         headline = EXCLUDED.headline, topic_strip = EXCLUDED.topic_strip,
         subtagline = EXCLUDED.subtagline, logo_bytes = EXCLUDED.logo_bytes,
         logo_content_type = EXCLUDED.logo_content_type,
         feature_canon = EXCLUDED.feature_canon`,
      [SLUG, NAME, HEADLINE, TOPIC_STRIP, SUBTAGLINE, PNG_BYTES],
    );

    // One reviewed archive for AGENTLOOP so its homepage shows today's issue.
    const tenantRow = await db.query(
      `SELECT id FROM tenants WHERE slug = 'agentloop'`,
    );
    const agentloopId = (tenantRow.rows as { id: string }[])[0]?.id;
    expect(agentloopId).toBeTruthy();
    agentloopArchiveId = randomUUID();
    await db.query(
      `INSERT INTO run_archives
         (id, tenant_id, status, ranked_items, top_n, reviewed,
          started_at, completed_at, source_types,
          digest_headline, digest_summary)
       VALUES ($1, $2, 'completed', '[]'::jsonb, 0, true,
               now() - interval '1 minute', now(), '["hn"]'::jsonb,
               'P7 branding e2e headline', 'P7 branding e2e summary')`,
      [agentloopArchiveId, agentloopId],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    if (agentloopArchiveId) {
      await db.query(`DELETE FROM run_archives WHERE id = $1`, [agentloopArchiveId]);
    }
    await db.query(`DELETE FROM tenants WHERE slug = $1`, [SLUG]);
  } finally {
    await db.end();
  }
});

async function openHome(page: Page): Promise<void> {
  const brandingLoaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/branding" && r.status() === 200,
  );
  const homeLoaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/home" && r.status() === 200,
  );
  await page.goto("/");
  await brandingLoaded;
  await homeLoaded;
}

/** innerText reflects CSS `text-transform: uppercase` — normalize both sides. */
async function bodyTextUpper(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).toUpperCase();
}

function sectionOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator("[data-section]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
}

test.describe("per-tenant branding (P7)", () => {
  test("test_REQ_041 AGENTLOOP homepage keeps the existing layout and brand slots", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-tenant-slug": "agentloop" },
    });
    const page = await context.newPage();
    await openHome(page);

    // Hero slots (now branding-driven) render the exact legacy copy.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "The daily read for people who ship with agents.",
    );
    // The seeded reviewed archive renders as today's issue.
    await expect(page.locator('[data-section="todays-issue"]')).toBeVisible();
    const body = await bodyTextUpper(page);
    expect(body).toMatch(/AGENTIC\s+CODING/);
    expect(body).toContain(
      "NO MODEL RELEASES. NO BENCHMARKS. NO DISCOURSE. JUST THE CRAFT.",
    );
    expect(body).toContain("READ AGENTLOOP EVERY MORNING.");
    expect(body).toContain("P7 BRANDING E2E HEADLINE");

    // Masthead wordmark + full tenant-0 nav.
    await expect(
      page.getByRole("link", { name: /AGENTLOOP — home/i }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Must Read" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sources" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "How it's built" })).toBeVisible();

    // Section order unchanged (REQ-041). Other serial specs may leave extra
    // reviewed archives / canon entries behind, so assert the rendered
    // sections are a subsequence of the canonical order rather than an exact
    // list — the required sections must be present and correctly ordered.
    const canonicalOrder = [
      "todays-issue",
      "from-the-canon",
      "inline-subscribe",
      "recent-issues",
      "elsewhere",
    ];
    const sections = await sectionOrder(page);
    expect(sections).toEqual(
      canonicalOrder.filter((s) => sections.includes(s)),
    );
    for (const required of ["todays-issue", "inline-subscribe", "elsewhere"]) {
      expect(sections).toContain(required);
    }

    // Footer colophon + Built column are tenant-0 surfaces.
    expect(body).toContain("AGENTLOOP IS BUILT BY AGENTS");
    await expect(
      page.locator('[data-section="elsewhere"] [data-column="built"]'),
    ).toBeVisible();
    await context.close();
  });

  test("test_REQ_040 second tenant: same layout, own branding, no AGENTLOOP string; nav per flags (REQ-042)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-tenant-slug": SLUG },
    });
    const page = await context.newPage();
    await openHome(page);

    // Branding slots.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
    const body = await bodyTextUpper(page);
    expect(body).toMatch(/SERVING/);
    expect(body).toMatch(/QUANTIZATION/);
    expect(body).toContain(SUBTAGLINE.toUpperCase());
    expect(body).toContain(`Read ${NAME} every morning.`.toUpperCase());

    // REQ-040: no hardcoded brand anywhere in the rendered page.
    expect(body).not.toContain("AGENTLOOP");
    expect(body).not.toContain("VERTEXCOVER");

    // REQ-042: Sources always; Must Read (canon off) and Built (non-zero) hidden.
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Sources" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Must Read" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "How it's built" })).toHaveCount(0);
    await expect(
      page.locator('[data-section="elsewhere"] [data-column="sources"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-section="elsewhere"] [data-column="must-read"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-section="elsewhere"] [data-column="built"]'),
    ).toHaveCount(0);

    // Same layout skeleton: hero → inline subscribe → elsewhere (no archives seeded).
    expect(await sectionOrder(page)).toEqual(["inline-subscribe", "elsewhere"]);

    // Tenant logo replaces the BrandMark in the masthead.
    const logo = page
      .getByRole("link", { name: `${NAME} — home` })
      .locator('img[src^="/api/branding/logo"]');
    await expect(logo).toBeVisible();

    // AGENTLOOP's archive ids do not resolve on this tenant's host (REQ-044).
    const crossHost = await page.request.get(`/api/archives/${agentloopArchiveId}`);
    expect(crossHost.status()).toBe(404);
    await context.close();
  });

  test("test_REQ_043 logo endpoint serves image bytes with content-type, cache-control and etag", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-tenant-slug": SLUG },
    });
    const res = await context.request.get("/api/branding/logo");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    const etag = res.headers().etag;
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    expect(Buffer.from(await res.body()).equals(PNG_BYTES)).toBe(true);

    const revalidated = await context.request.get("/api/branding/logo", {
      headers: { "if-none-match": etag },
    });
    expect(revalidated.status()).toBe(304);
    await context.close();
  });
});
