/**
 * P11 — resumable onboarding wizard journeys (UI level).
 *
 *   1. Signup lands in the wizard; required steps fill with a LIVE slug
 *      check (REQ-033: reserved / taken / available); the preview reflects
 *      typed branding (REQ-034); a mid-wizard reload resumes the saved step
 *      and values (REQ-030); visiting Schedule early shows Activate
 *      disabled with the missing steps listed (REQ-038); prompts generate
 *      into editable textareas (REQ-036, STUBBED Anthropic) and discovery
 *      renders click-to-add pills that add nothing until clicked
 *      (REQ-037/051, STUBBED Tavily); the pending tenant's public host
 *      serves nothing (REQ-031).
 *   2. A fresh login resumes the same wizard (cross-session resume,
 *      REQ-030) and activation flips the tenant live: dashboard reachable,
 *      public branding served for the chosen slug, status active in the DB
 *      (REQ-035).
 *
 * No real external calls (S-web-04): ANTHROPIC_API_KEY / TAVILY_API_KEY are
 * force-blanked in playwright.config.ts and the two AI endpoints are
 * fulfilled via page.route here — the API server is otherwise real.
 */
import { test, expect, type Page } from "@playwright/test";
import { API_BASE, makeDbClient } from "./_infra";

const UNIQUE = `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1000))}`;
const EMAIL = `e2e-onboard-${UNIQUE}@example.com`;
const PASSWORD = "e2e-onboarding-pass-123";
const SLUG = `wiz${UNIQUE}`;
const RIVAL_SLUG = `wizrival${UNIQUE}`;

const STUB_PROMPTS = {
  rankingPrompt: "STUB: rank by hands-on usefulness to inference engineers.",
  shortlistPrompt: "STUB: keep deployment items, drop funding news.",
};

const STUB_CANDIDATES = {
  candidates: [
    {
      type: "reddit",
      value: "LocalLLaMA",
      label: "r/LocalLLaMA",
      group: "Reddit",
    },
    {
      type: "rss",
      value: "https://blog.vllm.ai",
      label: "vLLM blog",
      group: "RSS / Blogs",
    },
  ],
};

/** Browser-layer stubs for the AI endpoints — never a real LLM/search call. */
async function stubAiEndpoints(page: Page): Promise<void> {
  await page.route("**/api/onboarding/generate-prompts", (route) =>
    route.fulfill({ json: STUB_PROMPTS }),
  );
  await page.route("**/api/onboarding/discover-sources", (route) =>
    route.fulfill({ json: STUB_CANDIDATES }),
  );
}

async function cleanupRows(): Promise<void> {
  const db = makeDbClient();
  await db.connect();
  try {
    const res = await db.query<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM users WHERE email = $1",
      [EMAIL],
    );
    await db.query("DELETE FROM users WHERE email = $1", [EMAIL]);
    const tenantIds = res.rows
      .map((r) => r.tenant_id)
      .filter((t): t is string => t !== null);
    for (const id of tenantIds) {
      await db.query("DELETE FROM sources WHERE tenant_id = $1", [id]);
      await db.query("DELETE FROM user_settings WHERE tenant_id = $1", [id]);
      await db.query("DELETE FROM tenants WHERE id = $1", [id]);
    }
    await db.query("DELETE FROM tenants WHERE slug = $1", [RIVAL_SLUG]);
  } finally {
    await db.end();
  }
}

test.describe.serial("onboarding wizard", () => {
  // Warm up the Vite dev server's module graph: the first visit to a page
  // with newly-optimized deps can trigger a full reload that wipes typed
  // form state mid-test (same pattern as auth.spec.ts).
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/signup");
    await page
      .getByRole("heading", { name: /Start your newsletter/i })
      .waitFor();
    await page.goto("/admin/login");
    await page.getByRole("heading", { name: /^Sign in$/i }).waitFor();
    await page.waitForTimeout(1000);
    await page.close();
  });

  test.beforeAll(async () => {
    // Rival tenant that already holds a slug (REQ-033 "taken" state).
    const db = makeDbClient();
    await db.connect();
    try {
      await db.query(
        "INSERT INTO tenants (slug, name, status) VALUES ($1, 'Wizard Rival', 'active') ON CONFLICT DO NOTHING",
        [RIVAL_SLUG],
      );
    } finally {
      await db.end();
    }
  });

  test.afterAll(cleanupRows);

  test("signup → wizard: slug states, live preview, reload-resume, blocked activate, stubbed prompts + discovery", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await context.clearCookies();
    await stubAiEndpoints(page);

    // ── Signup lands in the wizard ───────────────────────────────────────
    // Retried as a block: a Vite dependency re-optimization can full-reload
    // the page mid-fill and wipe form state (see auth.spec.ts).
    await page.goto("/signup");
    await expect(async () => {
      if (!page.url().includes("/admin/onboarding")) {
        await page.getByLabel(/Your name/i).fill("E2E Onboard");
        await page.getByLabel(/^Email$/i).fill(EMAIL);
        await page.getByLabel(/^Password$/i).fill(PASSWORD);
        await page.getByLabel(/Confirm password/i).fill(PASSWORD);
        await page.getByRole("button", { name: /Create account/i }).click();
      }
      await expect(page).toHaveURL(/\/admin\/onboarding/, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    await expect(
      page.getByRole("heading", { name: /Name your newsletter/i, level: 2 }),
    ).toBeVisible();

    // ── REQ-031: while pending, the tenant's public host serves nothing ──
    const db = makeDbClient();
    await db.connect();
    let placeholderSlug: string;
    try {
      const row = await db.query<{ slug: string }>(
        "SELECT t.slug FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.email = $1",
        [EMAIL],
      );
      placeholderSlug = row.rows[0]?.slug ?? "";
    } finally {
      await db.end();
    }
    expect(placeholderSlug).toMatch(/^pending-/);
    const pendingPublic = await page.request.get(`${API_BASE}/api/branding`, {
      headers: { "X-Tenant-Slug": placeholderSlug },
    });
    expect(pendingPublic.status()).toBe(404);

    // ── Name step + live preview (REQ-034) ───────────────────────────────
    const preview = page.getByRole("complementary", {
      name: /live preview/i,
    });
    await expect(preview.getByText("Your newsletter")).toBeVisible(); // placeholder
    await page.getByLabel(/Newsletter name/i).fill("The Inference");
    await expect(preview.getByText("The Inference")).toBeVisible(); // live slot
    await page.getByRole("button", { name: /Continue/i }).click();

    // ── Slug step: reserved → taken → available (REQ-033) ────────────────
    await expect(
      page.getByRole("heading", { name: /Pick your address/i, level: 2 }),
    ).toBeVisible();
    const slugInput = page.getByLabel(/Subdomain/i);
    await slugInput.fill("admin");
    await expect(page.getByRole("status")).toContainText(/reserved/i);
    await slugInput.fill(RIVAL_SLUG);
    await expect(page.getByRole("status")).toContainText(/is taken/i, {
      timeout: 10_000,
    });
    await slugInput.fill(SLUG);
    await expect(page.getByRole("status")).toContainText(/is available/i, {
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Continue/i }).click();

    // ── Jump ahead to Schedule: activation must be BLOCKED (REQ-038) ─────
    await page
      .getByRole("navigation", { name: /setup steps/i })
      .getByRole("button", { name: /Schedule/i })
      .click();
    await expect(
      page.getByRole("heading", { name: /Set your schedule/i, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Activate newsletter/i }),
    ).toBeDisabled();
    const missingList = page.getByRole("list", { name: /remaining steps/i });
    await expect(missingList.getByText(/Homepage text/i)).toBeVisible();
    await expect(missingList.getByText(/Prompts/i)).toBeVisible();
    await expect(missingList.getByText(/Sources/i)).toBeVisible();

    // ── Homepage text + preview reflects headline (REQ-034) ──────────────
    await page
      .getByRole("navigation", { name: /setup steps/i })
      .getByRole("button", { name: /Homepage text/i })
      .click();
    await page
      .getByLabel(/^Headline$/i)
      .fill("The daily read for people building with inference.");
    await page.getByLabel(/Topic strip/i).fill("Serving · Quantization · Cost");
    await page.getByLabel(/Subtagline/i).fill("Just the runtime.");
    await expect(
      preview.getByRole("heading", { level: 1 }),
    ).toContainText(/building with/i);
    await expect(preview.getByText(/QUANTIZATION|Quantization/)).toBeVisible();
    await page.getByRole("button", { name: /Continue/i }).click();

    // ── Prompts: STUBBED generator fills two editable textareas (REQ-036) ─
    await expect(
      page.getByRole("heading", { name: /Tune what gets picked/i, level: 2 }),
    ).toBeVisible();
    await page
      .getByLabel(/What.s your newsletter about/i)
      .fill("Practical LLM inference for engineers shipping to prod.");
    await page.getByRole("button", { name: /Generate prompts/i }).click();
    const rankingBox = page.getByLabel(/Ranking prompt/i);
    await expect(rankingBox).toHaveValue(STUB_PROMPTS.rankingPrompt);
    await expect(page.getByLabel(/Shortlist prompt/i)).toHaveValue(
      STUB_PROMPTS.shortlistPrompt,
    );
    // Editable: append a custom line and keep it.
    await rankingBox.fill(`${STUB_PROMPTS.rankingPrompt} EDITED.`);
    await expect(rankingBox).toHaveValue(/EDITED\.$/);

    // ── Mid-wizard reload resumes step + values (REQ-030) ────────────────
    // Wait for the persistence PATCH so the reload can't race it.
    const patchDone = page.waitForResponse(
      (r) =>
        r.url().includes("/api/onboarding") &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: /Continue/i }).click(); // → social
    await patchDone;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Connect channels/i, level: 2 }),
    ).toBeVisible({ timeout: 15_000 });
    // Saved fields survive: check the headline via the live preview slot.
    await expect(
      page
        .getByRole("complementary", { name: /live preview/i })
        .getByRole("heading", { level: 1 }),
    ).toContainText(/building with/i);
    await stubAiEndpoints(page); // re-arm stubs after reload (new routes set)
    await page.getByRole("button", { name: /Skip/i }).click();

    // ── Sources: STUBBED discovery; nothing added until clicked (REQ-037) ─
    await expect(
      page.getByRole("heading", { name: /Choose your sources/i, level: 2 }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Discover sources/i }).click();
    await expect(
      page.getByRole("button", { name: /r\/LocalLLaMA/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /vLLM blog/i }),
    ).toBeVisible();
    // NONE added yet (REQ-037/051).
    await expect(page.getByText(/Selected · 0 sources/i)).toBeVisible();
    await page.getByRole("button", { name: /r\/LocalLLaMA/i }).click();
    await expect(page.getByText(/Selected · 1 source\b/i)).toBeVisible({
      timeout: 10_000,
    });
    // Manual add works alongside discovery.
    await page
      .getByLabel(/Add manually/i)
      .fill("https://blog.example-inference.dev/feed");
    await page.getByRole("button", { name: /^Add$/i }).click();
    await expect(page.getByText(/Selected · 2 sources/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("fresh login resumes the wizard; activate → dashboard + public site live (REQ-030/035)", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await context.clearCookies();
    await stubAiEndpoints(page);

    // Cross-session resume (REQ-030): a brand-new session lands back in the
    // wizard (pending_setup gate) with all saved progress intact.
    await page.goto("/admin/login");
    await expect(async () => {
      if (!page.url().includes("/admin/onboarding")) {
        await page.getByLabel(/Email/i).fill(EMAIL);
        await page.getByLabel(/Password/i).fill(PASSWORD);
        await page.getByRole("button", { name: /Sign in/i }).click();
      }
      await expect(page).toHaveURL(/\/admin\/onboarding/, { timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    await expect(
      page
        .getByRole("complementary", { name: /live preview/i })
        .getByRole("heading", { level: 1 }),
    ).toContainText(/building with/i);

    // Go to Schedule — everything required is now complete.
    await page
      .getByRole("navigation", { name: /setup steps/i })
      .getByRole("button", { name: /Schedule/i })
      .click();
    const activate = page.getByRole("button", {
      name: /Activate newsletter/i,
    });
    await expect(activate).toBeEnabled({ timeout: 10_000 });
    await activate.click();

    // Wizard exits to the dashboard (tenant is active now).
    await expect(page).toHaveURL(/\/admin(?!\/onboarding)/, {
      timeout: 20_000,
    });

    // Public site live for the chosen slug (REQ-035).
    const live = await page.request.get(`${API_BASE}/api/branding`, {
      headers: { "X-Tenant-Slug": SLUG },
    });
    expect(live.status()).toBe(200);
    const branding = (await live.json()) as { name: string };
    expect(branding.name).toBe("The Inference");

    // DB truth: status active, slug applied, settings row with the prompts.
    const db = makeDbClient();
    await db.connect();
    try {
      const tenant = await db.query<{
        status: string;
        slug: string;
        headline: string;
      }>(
        "SELECT t.status, t.slug, t.headline FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.email = $1",
        [EMAIL],
      );
      expect(tenant.rows[0]?.status).toBe("active");
      expect(tenant.rows[0]?.slug).toBe(SLUG);
      expect(tenant.rows[0]?.headline).toMatch(/building with inference/);
      const settings = await db.query<{ ranking_prompt: string }>(
        "SELECT s.ranking_prompt FROM user_settings s JOIN tenants t ON s.tenant_id = t.id WHERE t.slug = $1",
        [SLUG],
      );
      expect(settings.rows[0]?.ranking_prompt).toMatch(/EDITED\.$/);
    } finally {
      await db.end();
    }
  });
});
