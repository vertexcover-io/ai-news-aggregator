/**
 * P16 e2e — per-tenant notifications + optional feature flags
 * (REQ-092/093/094, EDGE-014).
 *
 * Journey (tenant-0 admin on the hermetic stack):
 *   1. REQ-094: the Settings page renders WITHOUT a shortlist-size control
 *      (internal default applies; the prompt sections still render).
 *   2. REQ-092: set a notification email + Slack webhook → saved. DB stores
 *      the webhook as D-012 CIPHERTEXT (a JSON {ct,iv,tag} blob, no
 *      "hooks.slack.com" substring); the GET payload only ever reports
 *      `slackWebhookSet` — the raw URL never comes back.
 *   3. REQ-093 + EDGE-014: Deliverability/Eval default OFF; toggling Eval
 *      flips only Eval (independence). Toggling Canon OFF hides the public
 *      Must Read nav while the seeded must_read row SURVIVES in the DB;
 *      Canon back ON re-shows the nav.
 *
 * NO real Slack (S-web-04): SLACK_WEBHOOK_URL is force-blanked in
 * playwright.config.ts and the webhook saved here is a fake URL that is only
 * ever STORED (encrypted) — nothing in this flow posts to it.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";

const NOTIFY_EMAIL = "alerts-p16@example.com";
const FAKE_WEBHOOK = "https://hooks.slack.com/services/T0E2E16/B0E2E16/p16-fake-secret";
const MUST_READ_URL = "https://example.com/p16-canon-survives";
const FRESH_TENANT_SLUG = "p16-fresh-defaults";

let initialFlags = {
  feature_canon: true,
  feature_deliverability: true,
  feature_eval: true,
};

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

interface TenantNotifyRow {
  id: string;
  feature_canon: boolean;
  feature_deliverability: boolean;
  feature_eval: boolean;
  notify_email: string | null;
  slack_webhook: string | null;
  notify_review_ready: boolean;
  notify_errors: boolean;
}

async function getTenantRow(): Promise<TenantNotifyRow> {
  const db = makeDbClient();
  await db.connect();
  try {
    const r = await db.query<TenantNotifyRow>(
      `SELECT id, feature_canon, feature_deliverability, feature_eval,
              notify_email, slack_webhook, notify_review_ready, notify_errors
         FROM tenants WHERE slug = 'agentloop'`,
    );
    expect(r.rows).toHaveLength(1);
    return r.rows[0];
  } finally {
    await db.end();
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    const tenant = await db.query<{
      id: string;
      feature_canon: boolean;
      feature_deliverability: boolean;
      feature_eval: boolean;
    }>(
      `SELECT id, feature_canon, feature_deliverability, feature_eval
         FROM tenants WHERE slug = 'agentloop'`,
    );
    expect(tenant.rows).toHaveLength(1);
    const { id: _id, ...flags } = tenant.rows[0];
    initialFlags = flags;
    // A canon entry that must SURVIVE the Canon toggle (EDGE-014).
    await db.query(
      `INSERT INTO must_read_entries (url, title, annotation, tenant_id)
       VALUES ($1, 'Attention Is All You Need', 'P16 e2e seed', $2)
       ON CONFLICT (url) DO NOTHING`,
      [MUST_READ_URL, tenant.rows[0].id],
    );
    // Fresh tenant for the REQ-093 default-off assertion — created with no
    // explicit flags so the DB column defaults apply.
    await db.query(
      `INSERT INTO tenants (slug, name, status) VALUES ($1, 'P16 Fresh', 'active')
       ON CONFLICT (slug) DO NOTHING`,
      [FRESH_TENANT_SLUG],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  // Restore pristine tenant-0 state for the rest of the serial suite
  // (tenant-branding.spec asserts the grandfathered Canon nav).
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query(
      `UPDATE tenants
          SET feature_canon = $1, feature_deliverability = $2,
              feature_eval = $3, notify_email = NULL, slack_webhook = NULL,
              notify_review_ready = true, notify_errors = true
        WHERE slug = 'agentloop'`,
      [
        initialFlags.feature_canon,
        initialFlags.feature_deliverability,
        initialFlags.feature_eval,
      ],
    );
    await db.query(`DELETE FROM must_read_entries WHERE url = $1`, [MUST_READ_URL]);
    await db.query(`DELETE FROM tenants WHERE slug = $1`, [FRESH_TENANT_SLUG]);
  } finally {
    await db.end();
  }
});

async function openSettings(page: Page): Promise<void> {
  await adminLogin(page);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test("test_REQ_094_shortlist_size_hidden_in_dashboard — no shortlist-size control on the tenant settings page", async ({
  page,
}) => {
  await openSettings(page);

  // The prompt sections render (page fully loaded)…
  await expect(page.getByText("Shortlist prompt").first()).toBeVisible();
  // …but the size control is gone — by label, by id, and by any stray copy.
  await expect(page.getByLabel(/shortlist size/i)).toHaveCount(0);
  await expect(page.locator("#shortlistSize")).toHaveCount(0);
  await expect(page.getByText(/^Shortlist size$/)).toHaveCount(0);
});

test("test_REQ_092_ui_notification_email_and_webhook_persist_encrypted — saved via the panel; ciphertext at rest; raw never echoed", async ({
  page,
}) => {
  await openSettings(page);

  const panel = page.getByTestId("notifications-panel");
  await expect(panel.getByText("Notifications", { exact: true })).toBeVisible();

  await panel.getByLabel("Notification email").fill(NOTIFY_EMAIL);
  await panel.getByLabel("Slack incoming webhook").fill(FAKE_WEBHOOK);
  // Flip Error alerts off so a non-default toggle round-trips too.
  await panel.getByRole("switch", { name: "Error alerts" }).click();
  await panel.getByRole("button", { name: "Save notifications" }).click();
  await expect(page.getByText("Notification settings saved")).toBeVisible();

  // DB: email plaintext, webhook CIPHERTEXT (JSON EncryptedBlob — REQ-092).
  const row = await getTenantRow();
  expect(row.notify_email).toBe(NOTIFY_EMAIL);
  expect(row.notify_review_ready).toBe(true);
  expect(row.notify_errors).toBe(false);
  expect(row.slack_webhook).not.toBeNull();
  expect(row.slack_webhook).not.toContain("hooks.slack.com");
  expect(row.slack_webhook).not.toContain("p16-fake-secret");
  const blob = JSON.parse(row.slack_webhook ?? "") as Record<string, string>;
  expect(Object.keys(blob).sort()).toEqual(["ct", "iv", "tag"]);

  // API read-back: presence flag only — the raw webhook never crosses back.
  const res = await page.request.get(`${API_BASE}/api/settings/notifications`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.slackWebhookSet).toBe(true);
  expect(body.notifyEmail).toBe(NOTIFY_EMAIL);
  expect(JSON.stringify(body)).not.toContain("p16-fake-secret");
  expect(JSON.stringify(body)).not.toContain("hooks.slack.com");

  // Reload: the webhook input is a write-only secret — empty, with a
  // "configured" placeholder.
  await page.reload();
  const webhookInput = page.getByLabel("Slack incoming webhook");
  await expect(webhookInput).toHaveValue("");
  await expect(webhookInput).toHaveAttribute("placeholder", /configured/);
});

test("test_REQ_093_EDGE_014_feature_flags — defaults off for a NEW tenant, independent toggles; Canon off hides Must Read but keeps the rows", async ({
  page,
}) => {
  // REQ-093 default-off: a freshly created tenant (DB column defaults) has
  // all three flags OFF. Tenant 0 itself is grandfathered all-on by the
  // AGENTLOOP migration (F93), so the defaults are proven on the fresh row.
  {
    const db = makeDbClient();
    await db.connect();
    try {
      const fresh = await db.query<{
        feature_canon: boolean;
        feature_deliverability: boolean;
        feature_eval: boolean;
      }>(
        `SELECT feature_canon, feature_deliverability, feature_eval
           FROM tenants WHERE slug = $1`,
        [FRESH_TENANT_SLUG],
      );
      expect(fresh.rows).toHaveLength(1);
      expect(fresh.rows[0]).toEqual({
        feature_canon: false,
        feature_deliverability: false,
        feature_eval: false,
      });
    } finally {
      await db.end();
    }
  }

  await openSettings(page);
  const features = page.getByTestId("features-panel");
  const evalToggle = features.getByRole("switch", { name: "Eval" });

  // Wait for the flags query to hydrate the switches (tenant 0: all on).
  await expect(evalToggle).toBeEnabled();
  await expect(evalToggle).toHaveAttribute("data-state", "checked");

  // Independence: flipping Eval OFF changes ONLY Eval.
  await evalToggle.click();
  await expect(page.getByText("Features updated").first()).toBeVisible();
  await expect(evalToggle).toHaveAttribute("data-state", "unchecked");
  let row = await getTenantRow();
  expect(row.feature_eval).toBe(false);
  expect(row.feature_deliverability).toBe(true);
  expect(row.feature_canon).toBe(true);

  // With Canon ON, the public nav shows Must Read.
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Must Read" })).toBeVisible();

  // EDGE-014: turn Canon OFF → nav entry disappears, data survives.
  await page.goto("/admin/settings");
  const canon = features.getByRole("switch", { name: /Canon/ });
  await expect(canon).toBeEnabled();
  await expect(canon).toHaveAttribute("data-state", "checked");
  await canon.click();
  await expect(canon).toHaveAttribute("data-state", "unchecked");
  await expect(page.getByText("Features updated").first()).toBeVisible();
  row = await getTenantRow();
  expect(row.feature_canon).toBe(false);
  expect(row.feature_eval).toBe(false); // still independent

  await page.goto("/");
  await expect(nav.getByRole("link", { name: "Sources" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Must Read" })).toHaveCount(0);

  // The canon entries are RETAINED, not deleted (EDGE-014).
  const db = makeDbClient();
  await db.connect();
  try {
    const entries = await db.query(
      `SELECT 1 FROM must_read_entries WHERE url = $1`,
      [MUST_READ_URL],
    );
    expect(entries.rows).toHaveLength(1);
  } finally {
    await db.end();
  }

  // Canon back ON → Must Read returns (flag-driven, nothing was lost).
  await page.goto("/admin/settings");
  await expect(canon).toBeEnabled();
  await canon.click();
  await expect(canon).toHaveAttribute("data-state", "checked");
  await expect(page.getByText("Features updated").first()).toBeVisible();
  await page.goto("/");
  await expect(nav.getByRole("link", { name: "Must Read" })).toBeVisible();

  // Restore Eval for the rest of the suite (afterAll double-guards).
  await page.goto("/admin/settings");
  await expect(evalToggle).toBeEnabled();
  await expect(evalToggle).toHaveAttribute("data-state", "unchecked");
  await evalToggle.click();
  await expect(evalToggle).toHaveAttribute("data-state", "checked");
  await expect(page.getByText("Features updated").first()).toBeVisible();
});
