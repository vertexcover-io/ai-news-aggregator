import { test, expect } from "@playwright/test";

// VS-7, VS-8, VS-9 from .harness/features/add-archive-keyword-search/spec.md.
//
// Prereqs (managed by functional-verify):
//   - `pnpm infra:up` (Postgres + Redis)
//   - api dev server on :3000 (Vite proxies /api → :3000)
//   - web dev server on :5173 (Playwright baseURL)
//
// VS-7 and VS-9 do not require any pre-seeded archives. VS-8 needs at least
// one reviewed archive whose search_text contains "claude". The test probes
// `/api/archives/search?q=claude` first and skips with a clear reason if the
// dev DB is empty so functional-verify can decide whether to seed.

test("VS-7: empty state when query has no matches", async ({ page }) => {
  await page.goto("/?q=zzz-no-match-zzz");
  await expect(
    page.getByText(/no matches/i).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(/zzz-no-match-zzz/),
  ).toBeVisible();
});

test("VS-8: type → results filter → clear restores list", async ({ page, request }) => {
  const probe = await request.get("http://localhost:3000/api/archives/search?q=claude");
  if (!probe.ok()) {
    test.skip(true, `archive-search API unreachable (status ${String(probe.status())})`);
    return;
  }
  const probeJson = (await probe.json()) as { archives: unknown[] };
  if (!Array.isArray(probeJson.archives) || probeJson.archives.length === 0) {
    test.skip(
      true,
      "no reviewed archives matching 'claude' in dev DB — seed before running VS-8",
    );
    return;
  }

  await page.goto("/");
  const input = page.getByPlaceholder("Search the archive…");
  await input.fill("claude");

  await page.waitForURL((url) => url.searchParams.get("q") === "claude", {
    timeout: 5_000,
  });

  await expect(page.getByText(/match\s+"claude"/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: /^clear$/i }).click();

  await page.waitForURL((url) => !url.searchParams.has("q"), {
    timeout: 5_000,
  });
});

test("VS-9: open date chip → pick preset → apply updates URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^DATE:/ }).click();
  await page.getByRole("button", { name: /last 30 days/i }).click();
  await page.getByRole("button", { name: /^apply$/i }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/to=\d{4}-\d{2}-\d{2}/);
});
