/**
 * VS-1: signup → onboarding wizard → activate (hermetic, real API + DB).
 *
 * Covers REQ-030/032/033 (resumable steps, debounced slug check states),
 * REQ-034 (live preview reflects typed branding), REQ-036 (generate-prompts
 * degrades to 503 without ANTHROPIC_API_KEY — prompts saved via direct PATCH),
 * REQ-037 (source add/remove incl. manual), REQ-035/038 (activation gate:
 * 422 missing-list with clickable items, then successful activation), and
 * REQ-094 (no shortlist-size control in the tenant settings UI).
 */
import { test, expect, type Page } from "@playwright/test";
import { API_BASE, makeDbClient, seedTenant } from "./_infra";

// xl viewport so the LivePreview rail (hidden below 1280px) renders.
test.use({ viewport: { width: 1440, height: 900 } });

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EMAIL = `vs1-${RUN}@example.com`;
const NAME = "The Inference Daily";
const SLUG = `inference-${RUN}`;
const TAKEN_SLUG = `taken-${RUN}`;
const HEADLINE = "The daily read for people shipping inference";
const TOPIC_STRIP = "Serving · Quantization · Latency";
const SUBTAGLINE = "No funding rounds. Just the runtime.";
const RANKING_PROMPT = `E2E ranking prompt ${RUN}: prefer practical inference stories.`;
const SHORTLIST_PROMPT = `E2E shortlist prompt ${RUN}: drop press releases.`;

async function clickWizardNav(page: Page, title: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Setup steps" })
    .getByRole("button", { name: title })
    .click();
}

test("VS-1: signup, complete the wizard, hit the activation gate, activate", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await seedTenant({ slug: TAKEN_SLUG, name: "Slug Squatter", status: "active" });

  // ── Signup → lands in the wizard with a pending_setup tenant ──────────────
  await page.goto("/signup");
  await page.locator("#name").fill("Vee Sone");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill("vs1-password-123");
  await page.locator("#confirmPassword").fill("vs1-password-123");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });

  // ── Step 1: name ───────────────────────────────────────────────────────────
  await expect(
    page.getByRole("heading", { name: "Name your newsletter" }),
  ).toBeVisible();
  await page.locator("#name").fill(NAME);
  await page.getByRole("button", { name: /continue/i }).click();

  // ── Step 2: slug — debounced availability states (REQ-033) ────────────────
  await expect(
    page.getByRole("heading", { name: "Pick your address" }),
  ).toBeVisible();
  const slugStatus = page.getByTestId("slug-status");
  const continueBtn = page.getByRole("button", { name: /continue/i });

  await page.locator("#slug").fill("admin");
  await expect(slugStatus).toHaveAttribute("data-status", "reserved");
  await expect(slugStatus).toContainText(/reserved/i);
  await expect(continueBtn).toBeDisabled();

  await page.locator("#slug").fill(TAKEN_SLUG);
  // Debounce (300ms) + probe in flight ⇒ transient "checking" state first.
  await expect(slugStatus).toHaveAttribute("data-status", "checking");
  await expect(slugStatus).toHaveAttribute("data-status", "taken");
  await expect(slugStatus).toContainText(`${TAKEN_SLUG}.ourdomain.com is already taken`);
  await expect(continueBtn).toBeDisabled();

  await page.locator("#slug").fill(SLUG);
  await expect(slugStatus).toHaveAttribute("data-status", "available");
  await expect(slugStatus).toContainText(`${SLUG}.ourdomain.com is available`);
  await continueBtn.click();

  // ── Step 3: logo — optional, skip ──────────────────────────────────────────
  await expect(page.getByRole("heading", { name: "Add your logo" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  // ── Step 4: homepage text + live preview (REQ-034) ─────────────────────────
  await expect(
    page.getByRole("heading", { name: "Your homepage text" }),
  ).toBeVisible();
  await page.locator("#headline").fill(HEADLINE);
  await page.locator("#topicStrip").fill(TOPIC_STRIP);
  await page.locator("#subtagline").fill(SUBTAGLINE);

  const preview = page.getByTestId("preview-canvas");
  await expect(preview.locator("h1").first()).toHaveText(HEADLINE);
  await expect(preview.getByText(NAME).first()).toBeVisible();
  await expect(preview.getByText("Quantization")).toBeVisible();
  await expect(preview.getByText(SUBTAGLINE)).toBeVisible();
  await expect(page.getByTestId("preview-url")).toContainText(
    `${SLUG}.ourdomain.com`,
  );
  // Live: editing the headline updates the preview before any save.
  await page.locator("#headline").fill(`${HEADLINE} tonight`);
  await expect(preview.locator("h1").first()).toHaveText(
    `${HEADLINE} tonight`,
  );
  await page.locator("#headline").fill(HEADLINE);
  await page.getByRole("button", { name: /continue/i }).click();

  // ── Step 5: prompts — LLM unavailable (503), save via direct PATCH ─────────
  await expect(
    page.getByRole("heading", { name: "Tune what gets picked" }),
  ).toBeVisible();
  await page
    .locator("#description")
    .fill("Practical LLM inference for engineers shipping to prod.");
  await page.getByRole("button", { name: /generate prompts/i }).click();
  await expect(
    page.getByText(/prompt generation is unavailable right now/i),
  ).toBeVisible({ timeout: 10_000 });

  const patchRes = await page.request.patch(
    `${API_BASE}/api/admin/onboarding/state`,
    {
      data: {
        step: "prompts",
        data: {
          rankingPrompt: RANKING_PROMPT,
          shortlistPrompt: SHORTLIST_PROMPT,
          description: "Practical LLM inference for engineers shipping to prod.",
        },
      },
    },
  );
  expect(patchRes.ok()).toBe(true);

  // Leave-and-return (REQ-030/032): reload resumes past prompts; navigating
  // back shows the persisted prompts in the editable fields.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connect channels" }),
  ).toBeVisible({ timeout: 15_000 });
  await clickWizardNav(page, "Prompts");
  await expect(page.locator("#rankingPrompt")).toHaveValue(RANKING_PROMPT);
  await expect(page.locator("#shortlistPrompt")).toHaveValue(SHORTLIST_PROMPT);

  // ── Step 6: channels — optional, skip ──────────────────────────────────────
  await clickWizardNav(page, "Social & email");
  await expect(
    page.getByRole("heading", { name: "Connect channels" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your sources" }),
  ).toBeVisible();

  // ── Activation gate first (REQ-038): no sources yet ⇒ 422 missing list ─────
  await clickWizardNav(page, "Schedule");
  await expect(
    page.getByRole("heading", { name: "Set your schedule" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /activate newsletter/i }).click();
  const missingBox = page.getByTestId("activate-missing");
  await expect(missingBox).toBeVisible({ timeout: 10_000 });
  await expect(missingBox).toContainText("Finish these required steps first");
  // Missing items are clickable and jump to the offending step.
  await missingBox.getByRole("button", { name: /sources/i }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your sources" }),
  ).toBeVisible();

  // ── Step 7: sources — quick-add + manual add/remove (REQ-037) ──────────────
  await page.getByRole("button", { name: /\+ Hacker News/ }).click();
  await expect(page.getByText("Selected · 1 source", { exact: true })).toBeVisible();
  await page.locator("#manual-source").fill("r/LocalLLaMA");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Selected · 2 sources", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove r/LocalLLaMA" }).click();
  await expect(page.getByText("Selected · 1 source", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /continue/i }).click();

  // ── Step 8: schedule → activate (REQ-035) ──────────────────────────────────
  await expect(
    page.getByRole("heading", { name: "Set your schedule" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /activate newsletter/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

  // Session tenant flipped to active.
  const meRes = await page.request.get(`${API_BASE}/api/auth/me`);
  expect(meRes.ok()).toBe(true);
  const me = (await meRes.json()) as { tenant: { status: string; slug: string } };
  expect(me.tenant.status).toBe("active");
  expect(me.tenant.slug).toBe(SLUG);

  // DB agrees and the slug landed on this tenant.
  const db = makeDbClient();
  await db.connect();
  try {
    const row = await db.query<{ status: string }>(
      "SELECT status FROM tenants WHERE slug = $1",
      [SLUG],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].status).toBe("active");
  } finally {
    await db.end();
  }

  // ── REQ-094: no shortlist-size control anywhere in tenant settings ─────────
  await page.goto("/admin/settings");
  await expect(page.getByText("Shortlist prompt").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/shortlist size/i)).toHaveCount(0);
});
