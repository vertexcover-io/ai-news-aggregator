/**
 * P14 — Sending-domain panel e2e (REQ-084/085 UI + REQ-053 gate state).
 *
 * Full stack with a MOCKED Resend (S-web-04): the API's Resend SDK is pointed
 * at an in-spec fake HTTP server via RESEND_BASE_URL + a fake key (see
 * playwright.config.ts), so no request can reach the real Resend API.
 *
 * Journey:
 *   1. /admin/settings → Sending domain panel → add domain
 *      → DNS records from Resend's create response render, badge = Pending.
 *   2. DB: tenants.sending_domain_status = 'pending' — the exact predicate
 *      the pipeline email-send broadcast gate reads (REQ-053/EDGE-006: a
 *      broadcast for this tenant is blocked in this state; the gate behavior
 *      itself is integration-tested in @newsletter/pipeline). Paused-broadcast
 *      copy is visible.
 *   3. Verify while DNS "not yet propagated" (fake still pending) → stays
 *      Pending. Flip the fake to verified → Verify → badge = Verified,
 *      DB status = 'verified' (broadcast unblocked).
 */
import { createServer, type Server } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";

const FAKE_RESEND_PORT = Number(process.env.E2E_FAKE_RESEND_PORT ?? "0");

const DOMAIN_ID = "e2e-resend-domain-1";
const DOMAIN_NAME = "theinference-e2e.com";

interface FakeRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  status: string;
}

function makeRecords(status: string): FakeRecord[] {
  return [
    { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSqE2E", ttl: "Auto", status },
    { record: "SPF", type: "MX", name: "send", value: "feedback-smtp.resend.com", ttl: "Auto", status },
  ];
}

// Mutable fake-Resend state, flipped by the test between verify attempts.
const fake = { status: "not_started", recordStatus: "not_started" };

function startFakeResend(): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    const respond = (code: number, body: unknown): void => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "POST" && url === "/domains") {
      respond(201, {
        id: DOMAIN_ID,
        name: DOMAIN_NAME,
        status: fake.status,
        created_at: new Date().toISOString(),
        region: "us-east-1",
        records: makeRecords(fake.recordStatus),
      });
      return;
    }
    if (req.method === "POST" && url === `/domains/${DOMAIN_ID}/verify`) {
      respond(200, { object: "domain", id: DOMAIN_ID });
      return;
    }
    if (req.method === "GET" && url === `/domains/${DOMAIN_ID}`) {
      respond(200, {
        object: "domain",
        id: DOMAIN_ID,
        name: DOMAIN_NAME,
        status: fake.status,
        created_at: new Date().toISOString(),
        region: "us-east-1",
        records: makeRecords(fake.recordStatus),
      });
      return;
    }
    respond(404, { name: "not_found", message: `fake resend: no route ${req.method ?? ""} ${url}` });
  });
  server.listen(FAKE_RESEND_PORT, "127.0.0.1");
  return server;
}

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function getTenantDomainRow(): Promise<{
  sending_domain_name: string | null;
  sending_domain_status: string | null;
} | null> {
  const client = makeDbClient();
  await client.connect();
  try {
    const r = await client.query<{
      sending_domain_name: string | null;
      sending_domain_status: string | null;
    }>(
      `SELECT t.sending_domain_name, t.sending_domain_status
         FROM tenants t JOIN users u ON u.tenant_id = t.id
        WHERE u.email = $1 LIMIT 1`,
      [ADMIN_EMAIL],
    );
    return r.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function resetTenantDomain(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(
      `UPDATE tenants SET sending_domain_name = NULL, sending_domain_id = NULL,
              sending_domain_status = NULL, sending_domain_records = NULL`,
    );
  } finally {
    await client.end();
  }
}

test.describe("sending-domain panel (P14, REQ-084/085 + REQ-053 gate state)", () => {
  let server: Server;

  test.beforeAll(() => {
    fake.status = "not_started";
    fake.recordStatus = "not_started";
    server = startFakeResend();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    await resetTenantDomain();
  });

  test.beforeEach(async () => {
    await resetTenantDomain();
  });

  test("add domain → DNS records + Pending; broadcast stays gated (DB) until verify flips it to Verified", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");

    const panel = page.getByTestId("sending-domain-panel");
    await panel.waitFor({ state: "visible" });

    // ── 1. Register the domain (REQ-084) ─────────────────────────────────
    await panel.getByLabel("Sending domain").fill(DOMAIN_NAME);
    await panel.getByRole("button", { name: /add domain/i }).click();

    // DNS records returned by (fake) Resend render in the table.
    const records = panel.getByTestId("sending-domain-records");
    await expect(records).toBeVisible();
    await expect(records).toContainText("resend._domainkey");
    await expect(records).toContainText("feedback-smtp.resend.com");
    await expect(panel.getByTestId("sending-domain-status")).toHaveText(/pending/i);

    // Paused-broadcast explainer (REQ-053 surfaced in the UI).
    await expect(panel).toContainText(/broadcast is paused/i);

    // DB: the broadcast-gate predicate is NOT 'verified' → broadcast blocked
    // (EDGE-006). No real email path is touched (S-web-04).
    const pendingRow = await getTenantDomainRow();
    expect(pendingRow?.sending_domain_name).toBe(DOMAIN_NAME);
    expect(pendingRow?.sending_domain_status).toBe("pending");

    // ── 2. Verify while DNS hasn't propagated → still Pending (REQ-085) ──
    // Await the verify API response before mutating the fake's state: the
    // badge already reads "Pending", so a text assertion alone would race
    // the in-flight request (it could observe the flipped fake → Verified →
    // permanently disabled button).
    const verifyButton = panel.getByRole("button", { name: /verify domain/i });
    const [stillPending] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/settings/domain/verify")),
      verifyButton.click(),
    ]);
    expect(stillPending.status()).toBe(200);
    await expect(panel.getByTestId("sending-domain-status")).toHaveText(/pending/i);

    // ── 3. DNS "propagates" (fake flips) → Verify → Verified ─────────────
    fake.status = "verified";
    fake.recordStatus = "verified";
    const [verified] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/settings/domain/verify")),
      verifyButton.click(),
    ]);
    expect(verified.status()).toBe(200);
    await expect(panel.getByTestId("sending-domain-status")).toHaveText(/verified/i);

    // DB now satisfies the broadcast gate (REQ-053: broadcasts unblocked).
    await expect
      .poll(async () => (await getTenantDomainRow())?.sending_domain_status)
      .toBe("verified");
  });
});
