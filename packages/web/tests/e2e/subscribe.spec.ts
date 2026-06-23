import { test, expect, type Route } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./_infra";


async function stubSubscribeOk(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  });
}

// The archive-detail subscribe widget (SubscribeInline `interlude` variant)
// only renders when the issue has >= 4 stories, so mock a 4-story archive
// rather than depending on whatever the shared DB happens to hold.
function mockArchiveWithStories(runId: string): unknown {
  const rankedItems = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    rawItemId: i + 1,
    title: `Story ${String(i + 1)}`,
    url: `https://example.com/story-${String(i + 1)}`,
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 10, commentCount: 2 },
    score: 0.9 - i * 0.1,
    rationale: `Rationale for story ${String(i + 1)}.`,
    content: null,
    imageUrl: null,
    recap: null,
    enrichedSource: null,
  }));
  return {
    id: runId,
    status: "completed",
    stage: "completed",
    topN: 4,
    startedAt: "2026-05-08T10:00:00Z",
    updatedAt: "2026-05-08T10:30:00Z",
    completedAt: "2026-05-08T10:30:00Z",
    issueDate: "2026-05-08",
    digestHeadline: "Test issue",
    digestSummary: "A seeded issue for the subscribe-widget e2e.",
    sources: { hn: { status: "completed", itemsFetched: 4, errors: [] } },
    rankedItems,
    warnings: [],
    error: null,
  };
}

test.describe("subscribe flow", () => {
  test("homepage subscribe widget submits and shows success state", async ({ page }) => {
    await page.route("**/api/subscribe", stubSubscribeOk);

    await page.goto("/");

    const card = page.locator('[data-section="inline-subscribe"]');
    await expect(
      card.getByRole("heading", { name: /Get AgentLoop's daily digest/i }),
    ).toBeVisible();

    const email = `e2e-home-${String(Date.now())}@example.com`;
    await card.getByPlaceholder("you@company.com").fill(email);

    const submit = card.getByRole("button", { name: /Subscribe/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(
      card.getByText(/Check your inbox to confirm your subscription/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("homepage submit button is disabled until an email is entered", async ({ page }) => {
    await page.goto("/");

    const card = page.locator('[data-section="inline-subscribe"]');
    const submit = card.getByRole("button", { name: /Subscribe/i });
    await expect(submit).toBeDisabled();

    await card.getByPlaceholder("you@company.com").fill("typed@example.com");
    await expect(submit).toBeEnabled();
  });

  test("subscribe widget appears within an archive detail page", async ({ page }) => {
    await page.route("**/api/subscribe", stubSubscribeOk);
    const runId = "e2e-subscribe-archive";
    await page.route(`**/api/archives/${runId}`, async (route: Route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(mockArchiveWithStories(runId)),
      });
    });

    await page.goto(`/archive/${runId}`);

    const widgetHeading = page.getByRole("heading", {
      name: /Get the daily AI digest in your inbox/i,
    });
    await widgetHeading.scrollIntoViewIfNeeded();
    await expect(widgetHeading).toBeVisible();

    const email = `e2e-archive-${String(Date.now())}@example.com`;
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Subscribe$/i }).click();

    await expect(
      page.getByText(/Check your inbox to confirm your subscription/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("subscribe nav link", () => {
  test("nav Subscribe link scrolls to the homepage widget", async ({ page }) => {
    await page.goto("/");

    const widget = page.getByRole("heading", {
      name: /Subscribe to AgentLoop's daily digest/i,
    });
    await expect(widget).toBeVisible();

    await page.getByRole("link", { name: /Subscribe/ }).click();
    await expect(page).toHaveURL(/#subscribe$/);
    await expect(widget).toBeInViewport();
  });

  test("deep-linking to /#subscribe scrolls the homepage widget into view", async ({
    page,
  }) => {
    await page.goto("/#subscribe");
    await expect(
      page.getByRole("heading", { name: /Get AgentLoop's daily digest/i }),
    ).toBeInViewport({ timeout: 10000 });
  });
});

test.describe("legal pages", () => {
  test("privacy page renders policy heading and key sections", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: /Privacy Policy/i, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /What data we collect/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /How to unsubscribe/i }),
    ).toBeVisible();
  });

  test("terms page renders terms heading and key sections", async ({ page }) => {
    await page.goto("/terms");
    await expect(
      page.getByRole("heading", { name: /Terms of Service/i, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Subscription terms/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /No warranties/i }),
    ).toBeVisible();
  });
});

test.describe("confirm page status states", () => {
  test("success status shows confirmed message", async ({ page }) => {
    await page.goto("/confirm?status=success");
    await expect(
      page.getByRole("heading", { name: /You're subscribed/i }),
    ).toBeVisible();
  });

  test("expired status shows expired message", async ({ page }) => {
    await page.goto("/confirm?status=expired");
    await expect(
      page.getByRole("heading", { name: /This confirmation link has expired/i }),
    ).toBeVisible();
  });

  test("invalid status shows invalid message", async ({ page }) => {
    await page.goto("/confirm?status=invalid");
    await expect(
      page.getByRole("heading", { name: /This link doesn't/i }),
    ).toBeVisible();
  });
});

test.describe("unsubscribe page", () => {
  test("success status shows unsubscribed confirmation", async ({ page }) => {
    await page.goto("/unsubscribe?status=success");
    await expect(
      page.getByRole("heading", { name: /You've been unsubscribed/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/You won't receive any more newsletters/i),
    ).toBeVisible();
  });
});

test.describe("admin analytics page", () => {
  test("redirects to login when unauthenticated", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/admin/analytics");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(
      page.getByRole("heading", { name: /^Sign in$/i }),
    ).toBeVisible();
  });

  test("renders metric cards and date controls when logged in", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel(/Email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Sign in/i }).click();

    await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 10_000 });

    await page.goto("/admin/analytics");

    await expect(
      page.getByRole("heading", { name: /^Analytics$/i }),
    ).toBeVisible();

    await expect(page.getByLabel(/^From$/i)).toBeVisible();
    await expect(page.getByLabel(/^To$/i)).toBeVisible();
    await expect(page.getByRole("combobox")).toBeVisible();

    await expect(page.getByText(/Subscriptions/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Unsubscriptions/i)).toBeVisible();
    await expect(page.getByText(/Emails Sent/i)).toBeVisible();
    await expect(page.getByText(/Bounces/i)).toBeVisible();
    await expect(page.getByText(/Spam Complaints/i)).toBeVisible();
  });
});
