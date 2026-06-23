/**
 * Full subscribe-to-confirm UI flow — REQ-003 + REQ-005.
 *
 * Does NOT mock /api/subscribe — exercises the real API end-to-end:
 *   1. Browser fills the SubscribeWidget on `/`.
 *   2. POST /api/subscribe persists a pending subscriber + sends confirmation.
 *   3. Test reads the confirm_token from Postgres and navigates to the
 *      confirm URL.
 *   4. Asserts subscriber.status='confirmed' afterwards.
 *
 * Recipient uses the Resend `delivered+<unique>@resend.dev` aliasing pattern
 * so the real Resend send (`SES_FROM_EMAIL=onboarding@resend.dev`,
 * `EMAIL_PROVIDER=resend`) succeeds without a verified domain.
 */
import { test, expect } from "@playwright/test";
import { API_BASE, makeDbClient } from "./_infra";


interface SubscriberRow {
  id: string;
  status: string;
  confirm_token: string | null;
  subscribed_at: Date | null;
}

async function findSubscriberByEmail(email: string): Promise<SubscriberRow | null> {
  const c = makeDbClient();
  await c.connect();
  try {
    const r = await c.query<SubscriberRow>(
      "SELECT id, status, confirm_token, subscribed_at FROM subscribers WHERE email = $1 LIMIT 1",
      [email],
    );
    return r.rows[0] ?? null;
  } finally {
    await c.end();
  }
}

test.describe("subscribe full flow — UI -> API -> token -> confirm (REQ-003 + REQ-005)", () => {
  test("submits via the homepage widget, persists pending row, confirms via token", async ({ page }) => {
    const unique = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `delivered+e2e-flow-${unique}@resend.dev`;

    await page.goto("/");
    const card = page.locator('[data-section="inline-subscribe"]');
    await expect(
      card.getByRole("heading", { name: /Subscribe to AgentLoop's daily digest/i }),
    ).toBeVisible();

    await card.getByPlaceholder("you@company.com").fill(email);
    const submit = card.getByRole("button", { name: /Subscribe/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(
      page.getByText(/Check your inbox to confirm your subscription/i),
    ).toBeVisible({ timeout: 30_000 });

    const pendingRow = await findSubscriberByEmail(email);
    expect(pendingRow).not.toBeNull();
    expect(pendingRow?.status).toBe("pending");
    expect(pendingRow?.confirm_token).toBeTruthy();

    if (!pendingRow?.confirm_token) throw new Error("missing confirm_token");
    const token = pendingRow.confirm_token;
    await page.goto(`${API_BASE}/api/confirm?token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/confirm\?status=success/);
    await expect(page.getByText(/You're subscribed/i)).toBeVisible();

    const confirmedRow = await findSubscriberByEmail(email);
    expect(confirmedRow?.status).toBe("confirmed");
    expect(confirmedRow?.subscribed_at).not.toBeNull();
  });
});
