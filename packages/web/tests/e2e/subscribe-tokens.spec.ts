/**
 * Token round-trip e2e — REQ-005, REQ-007, REQ-008, REQ-015, EDGE-003,
 * EDGE-004, EDGE-011.
 *
 * Real DB, real API, real browser navigation. Requires `pnpm dev` running
 * (api on :3000, web on :5173).
 */
import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { createHmac, randomUUID } from "node:crypto";

const API_BASE = "http://localhost:3000";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@localhost:5433/newsletter";
const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  "test-session-secret-32-bytes-minimum-abcdef1234567890";

function issueSubscriberToken(
  subscriberId: string,
  type: "confirm" | "unsub",
  secret: string,
  expiresAt: Date,
): string {
  const expires = String(expiresAt.getTime());
  const payload = `${subscriberId}:${type}:${expires}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + mac;
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface SubscriberRow {
  id: string;
  status: string;
  confirm_token: string | null;
  subscribed_at: Date | null;
  unsubscribed_at: Date | null;
}

async function findSubscriberByEmail(email: string): Promise<SubscriberRow | null> {
  return withClient(async (c) => {
    const r = await c.query<SubscriberRow>(
      "SELECT id, status, confirm_token, subscribed_at, unsubscribed_at FROM subscribers WHERE email = $1 LIMIT 1",
      [email],
    );
    return r.rows[0] ?? null;
  });
}

async function insertConfirmedSubscriber(email: string): Promise<string> {
  return withClient(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO subscribers (id, email, status, subscribed_at)
       VALUES ($1, $2, 'confirmed', NOW())
       ON CONFLICT (email) DO UPDATE SET status = 'confirmed', subscribed_at = NOW()
       RETURNING id`,
      [randomUUID(), email],
    );
    return r.rows[0].id;
  });
}

test.describe("subscribe tokens — round trip", () => {
  test("confirm token success path: pending -> confirmed", async ({ page, request }) => {
    const email = `delivered+e2e-confirm-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@resend.dev`;
    const res = await request.post(`${API_BASE}/api/subscribe`, {
      data: { email },
    });
    expect(res.ok()).toBe(true);

    const before = await findSubscriberByEmail(email);
    expect(before).not.toBeNull();
    expect(before?.status).toBe("pending");
    expect(before?.confirm_token).toBeTruthy();

    if (!before?.confirm_token) throw new Error("missing confirm_token");
    const token = before.confirm_token;
    await page.goto(`${API_BASE}/api/confirm?token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/confirm\?status=success/);
    await expect(page.getByText(/You're subscribed/i)).toBeVisible();

    const after = await findSubscriberByEmail(email);
    expect(after?.status).toBe("confirmed");
    expect(after?.subscribed_at).not.toBeNull();
  });

  test("confirm token invalid -> /confirm?status=invalid", async ({ page }) => {
    await page.goto(`${API_BASE}/api/confirm?token=garbage.invalid`);
    await expect(page).toHaveURL(/\/confirm\?status=invalid/);
    await expect(page.getByText(/Invalid|invalid/i).first()).toBeVisible();
  });

  test("confirm token expired -> /confirm?status=expired (REQ-007 / EDGE-003)", async ({ page }) => {
    const email = `e2e-expired-${String(Date.now())}@example.com`;
    // Insert a pending subscriber directly so we can issue a token with the
    // matching subscriber id and a past expiry.
    const subId = await withClient(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO subscribers (id, email, status) VALUES ($1, $2, 'pending')
         ON CONFLICT (email) DO UPDATE SET status='pending' RETURNING id`,
        [randomUUID(), email],
      );
      return r.rows[0].id;
    });

    const expiredToken = issueSubscriberToken(
      subId,
      "confirm",
      SESSION_SECRET,
      new Date(Date.now() - 60_000),
    );

    await page.goto(`${API_BASE}/api/confirm?token=${encodeURIComponent(expiredToken)}`);
    await expect(page).toHaveURL(/\/confirm\?status=expired/);
    await expect(page.getByText(/expired/i).first()).toBeVisible();

    const after = await findSubscriberByEmail(email);
    expect(after?.status).toBe("pending");
  });

  test("unsubscribe token success: confirmed -> unsubscribed (REQ-015)", async ({ page }) => {
    const email = `e2e-unsub-${String(Date.now())}@example.com`;
    const subId = await insertConfirmedSubscriber(email);
    const token = issueSubscriberToken(
      subId,
      "unsub",
      SESSION_SECRET,
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );

    await page.goto(`${API_BASE}/api/unsubscribe?token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/unsubscribe\?status=success/);

    const after = await findSubscriberByEmail(email);
    expect(after?.status).toBe("unsubscribed");
    expect(after?.unsubscribed_at).not.toBeNull();
  });

  test("already-confirmed re-confirm is idempotent success (EDGE-004)", async ({ page }) => {
    const email = `e2e-already-${String(Date.now())}@example.com`;
    const subId = await insertConfirmedSubscriber(email);
    const token = issueSubscriberToken(
      subId,
      "confirm",
      SESSION_SECRET,
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );

    await page.goto(`${API_BASE}/api/confirm?token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/confirm\?status=success/);

    const after = await findSubscriberByEmail(email);
    expect(after?.status).toBe("confirmed");
  });

  test("unsubscribe token wrong-type / tampered HMAC redirects to success but does NOT change status (REQ-017 / EDGE-012)", async ({ page }) => {
    const email = `e2e-tampered-${String(Date.now())}@example.com`;
    const subId = await insertConfirmedSubscriber(email);
    // Issue a confirm-typed token, then submit it as unsub — verifier should
    // reject as wrong-type and leave status unchanged.
    const wrongTypeToken = issueSubscriberToken(
      subId,
      "confirm",
      SESSION_SECRET,
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    await page.goto(`${API_BASE}/api/unsubscribe?token=${encodeURIComponent(wrongTypeToken)}`);
    await expect(page).toHaveURL(/\/unsubscribe\?status=success/);

    const after = await findSubscriberByEmail(email);
    expect(after?.status).toBe("confirmed");
  });
});
