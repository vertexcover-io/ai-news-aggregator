/**
 * P5 e2e: host→tenant resolution through the real stack (REQ-021, EDGE-013).
 *
 * Uses the X-Tenant-Slug dev override (the hermetic stack runs on
 * localhost — no wildcard DNS), which exercises the same resolver wired in
 * the API's index.ts via buildApp's resolveTenant dependency. The hermetic
 * DB is seeded with the AGENTLOOP tenant (slug "agentloop") by
 * migrate:agentloop in run-e2e.mjs.
 */
import { test, expect, type BrowserContext } from "@playwright/test";

async function gotoHomeWithSlug(
  context: BrowserContext,
): Promise<{ status: number; body: unknown }> {
  const page = await context.newPage();
  const responsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/home",
  );
  await page.goto("/");
  const response = await responsePromise;
  const status = response.status();
  const body: unknown = await response.json();
  await page.close();
  return { status, body };
}

test.describe("host→tenant resolution (P5)", () => {
  test("public homepage is served for a known tenant slug (resolver wired via index.ts)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-tenant-slug": "agentloop" },
    });
    const page = await context.newPage();
    const responsePromise = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/home",
    );
    await page.goto("/");
    expect((await responsePromise).status()).toBe(200);
    // The public homepage renders for the resolved tenant.
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText(/daily read/i);
    await context.close();
  });

  test("unknown tenant slug gets a generic not-found, leaking nothing", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-tenant-slug": "no-such-tenant-p5" },
    });
    const { status, body } = await gotoHomeWithSlug(context);
    expect(status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
    await context.close();
  });
});
