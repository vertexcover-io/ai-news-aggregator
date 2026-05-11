import { test, expect } from "@playwright/test";

// REQ-053 — Social posting test button end-to-end via mocked API.
//
// We don't seed `social_tokens` directly (would require a DB connection from
// Playwright); instead we mock both the `social-status` and the test-post
// endpoints at the network layer. This still exercises the real React UI
// rendering, click handler, and polling loop.

test("REQ-053: clicking 'Send test post' for LinkedIn surfaces a posted result within 5s", async ({
  page,
}) => {
  await page.route("**/api/admin/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(null),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/settings/social-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        linkedin: { configured: true },
        twitter: { configured: false },
      }),
    });
  });
  await page.route("**/api/settings/test-social-post", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ requestId: "req-e2e" }),
    });
  });

  let pollCount = 0;
  await page.route("**/api/settings/test-social-post/req-e2e", async (route) => {
    pollCount += 1;
    if (pollCount >= 2) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "posted",
          permalink: "urn:li:share:test",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending" }),
    });
  });

  // Try to skip auth gate: hit the page directly. If the admin login redirect
  // intercepts, skip — this e2e is best-effort against a live web server.
  const response = await page.goto("/admin/settings", {
    waitUntil: "domcontentloaded",
  });
  if (!response || response.status() >= 400) {
    test.skip(true, "web server not reachable");
    return;
  }
  if (page.url().includes("/admin/login")) {
    test.skip(true, "admin auth gate not bypassable in this environment");
    return;
  }

  await expect(page.getByText("Social posting")).toBeVisible({
    timeout: 10_000,
  });
  const linkedinRow = page.getByTestId("social-row-linkedin");
  await expect(linkedinRow.getByText("Connected")).toBeVisible();

  await linkedinRow.getByRole("button", { name: /send test post/i }).click();

  const result = page.getByTestId("social-result-linkedin");
  await expect(result).toContainText(/Posted/i, { timeout: 5_000 });
  await expect(result.getByRole("link")).toHaveAttribute(
    "href",
    "https://www.linkedin.com/feed/update/urn:li:share:test",
  );
});
