import { test, expect, type Route } from "@playwright/test";

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "aman2005";

async function stubSubscribeOk(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  });
}

test.describe("subscribe flow", () => {
  test("homepage subscribe widget submits and shows success state", async ({ page }) => {
    await page.route("**/api/subscribe", stubSubscribeOk);

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /Get the daily AI digest in your inbox/i }),
    ).toBeVisible();

    const email = `e2e-home-${String(Date.now())}@example.com`;
    await page.getByPlaceholder("Your email").fill(email);
    await page.getByRole("checkbox").check();

    const submit = page.getByRole("button", { name: /^Subscribe$/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(
      page.getByText(/Check your inbox to confirm your subscription/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("submit button is disabled until consent checkbox is checked", async ({ page }) => {
    await page.goto("/");

    const submit = page.getByRole("button", { name: /^Subscribe$/i });
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder("Your email").fill("not-yet-checked@example.com");
    await expect(submit).toBeDisabled();

    await page.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
  });

  test("subscribe widget appears at the bottom of an archive detail page", async ({ page, request }) => {
    await page.route("**/api/subscribe", stubSubscribeOk);

    const archivesRes = await request.get("/api/archives");
    expect(archivesRes.ok()).toBe(true);
    const { archives } = (await archivesRes.json()) as { archives: { runId: string }[] };
    expect(archives.length).toBeGreaterThan(0);
    const [first] = archives;
    const firstRunId = first.runId;

    await page.goto(`/archive/${firstRunId}`);

    const widgetHeading = page.getByRole("heading", {
      name: /Get the daily AI digest in your inbox/i,
    });
    await widgetHeading.scrollIntoViewIfNeeded();
    await expect(widgetHeading).toBeVisible();

    const email = `e2e-archive-${String(Date.now())}@example.com`;
    await page.getByPlaceholder("Your email").fill(email);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Subscribe$/i }).click();

    await expect(
      page.getByText(/Check your inbox to confirm your subscription/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("subscribe nav link", () => {
  test("nav Subscribe link scrolls to widget on /", async ({ page }) => {
    await page.goto("/");

    const widget = page.getByRole("heading", {
      name: /Get the daily AI digest in your inbox/i,
    });
    await expect(widget).toBeVisible();

    const widgetTopBeforeClick = await widget.evaluate(
      (el) => el.getBoundingClientRect().top,
    );
    expect(widgetTopBeforeClick).toBeGreaterThan(400);

    await page.getByRole("link", { name: /^Subscribe$/ }).click();
    await expect(widget).toBeInViewport();
  });

  test("nav Subscribe link from /privacy navigates to /#subscribe and scrolls", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.getByRole("link", { name: /^Subscribe$/ }).click();
    await expect(page).toHaveURL(/\/#subscribe$/);
    await expect(
      page.getByRole("heading", { name: /Get the daily AI digest in your inbox/i }),
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
      page.getByRole("heading", { name: /This link is invalid/i }),
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
      page.getByRole("heading", { name: /^Admin$/i }),
    ).toBeVisible();
  });

  test("renders metric cards and date controls when logged in", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel(/Password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Sign in/i }).click();

    await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 10_000 });

    await page.goto("/admin/analytics");

    await expect(
      page.getByRole("heading", { name: /Deliverability Analytics/i }),
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
