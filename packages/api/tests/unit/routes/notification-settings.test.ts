/**
 * P16 (REQ-092/093, EDGE-014): per-tenant notification settings + optional
 * feature flags routes.
 *
 *   GET /api/settings/notifications  → email + webhook-set flag (NEVER raw)
 *   PUT /api/settings/notifications  → persist email + ENCRYPTED webhook
 *   GET /api/settings/features       → 3 flags
 *   PUT /api/settings/features       → independent toggles
 *
 * No real Slack anywhere — the webhook is only stored, never POSTed here.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import type {
  NotificationSettingsPatch,
  TenantFeatureFlagsPatch,
  TenantRow,
} from "@api/repositories/tenants.js";
import { toBrandingWire } from "@api/routes/branding.js";
import {
  createNotificationSettingsRouter,
  type NotificationSettingsRouterDeps,
} from "@api/routes/notification-settings.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";
const RAW_WEBHOOK = "https://hooks.slack.com/services/T0TEST/B0TEST/secret-token";

const cipher = getCredentialCipher({ SESSION_SECRET } as NodeJS.ProcessEnv);

function authCookie(tenantId: string | null = TENANT_ID): string {
  const token = issueToken(
    { userId: "00000000-0000-4000-8000-000000000001", tenantId, role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

function makeTenantRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT_ID,
    slug: "theinference",
    previousSlug: null,
    name: "The Inference",
    status: "active",
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    notifyEmail: null,
    slackWebhook: null,
    notifyReviewReady: true,
    notifyErrors: true,
    onboardingState: null,
    sendingDomainName: null,
    sendingDomainId: null,
    sendingDomainStatus: null,
    sendingDomainRecords: null,
    emailMode: "managed",
    smtpConfigEnc: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface FakeRepo {
  findById: ReturnType<typeof vi.fn>;
  updateNotificationSettings: ReturnType<typeof vi.fn>;
  updateFeatureFlags: ReturnType<typeof vi.fn>;
  state: { row: TenantRow };
}

function makeTenantsRepo(row: TenantRow): FakeRepo {
  const state = { row };
  return {
    state,
    findById: vi.fn((id: string) =>
      Promise.resolve(id === state.row.id ? state.row : null),
    ),
    updateNotificationSettings: vi.fn(
      (_id: string, patch: NotificationSettingsPatch) => {
        const { slackWebhook, ...rest } = patch;
        state.row = {
          ...state.row,
          ...rest,
          ...(slackWebhook !== undefined ? { slackWebhook } : {}),
        };
        return Promise.resolve(state.row);
      },
    ),
    updateFeatureFlags: vi.fn((_id: string, flags: TenantFeatureFlagsPatch) => {
      state.row = { ...state.row, ...flags };
      return Promise.resolve(state.row);
    }),
  };
}

function buildTestApp(deps: NotificationSettingsRouterDeps): Hono {
  const app = new Hono();
  const gate = requireAuth(SESSION_SECRET);
  const gated = new Hono();
  gated.use("*", gate);
  gated.route("/", createNotificationSettingsRouter(deps));
  app.route("/api/settings", gated);
  return app;
}

function appWithRepo(repo: FakeRepo): Hono {
  return buildTestApp({ getTenantsRepo: () => repo, cipher });
}

describe("notification settings (REQ-092)", () => {
  it("test_REQ_092_notification_email_and_slack_persist_encrypted — PUT persists email + ciphertext webhook; raw never echoed", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);

    const putRes = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: "ada@studio.com",
        slackWebhook: RAW_WEBHOOK,
        notifyReviewReady: true,
        notifyErrors: false,
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = JSON.stringify(await putRes.json());
    // REQ-092: the raw webhook secret must never be returned to the client.
    expect(putBody).not.toContain(RAW_WEBHOOK);
    expect(putBody).not.toContain("secret-token");

    // Stored value is ciphertext (not the raw URL), decryptable via D-012.
    const stored = repo.state.row.slackWebhook;
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("hooks.slack.com");
    const blob = JSON.parse(stored as string) as EncryptedBlob;
    expect(cipher.decrypt(blob)).toBe(RAW_WEBHOOK);
    expect(repo.state.row.notifyEmail).toBe("ada@studio.com");
    expect(repo.state.row.notifyErrors).toBe(false);

    // GET reports presence only — never the raw value.
    const getRes = await app.request("/api/settings/notifications", {
      headers: { cookie: authCookie() },
    });
    expect(getRes.status).toBe(200);
    const wire = (await getRes.json()) as {
      notifyEmail: string | null;
      slackWebhookSet: boolean;
      notifyReviewReady: boolean;
      notifyErrors: boolean;
    };
    expect(wire).toEqual({
      notifyEmail: "ada@studio.com",
      slackWebhookSet: true,
      notifyReviewReady: true,
      notifyErrors: false,
    });
    expect(JSON.stringify(wire)).not.toContain(RAW_WEBHOOK);
  });

  it("omitted webhook keeps the stored ciphertext; null clears it", async () => {
    const preEncrypted = JSON.stringify(cipher.encrypt(RAW_WEBHOOK));
    const repo = makeTenantsRepo(makeTenantRow({ slackWebhook: preEncrypted }));
    const app = appWithRepo(repo);

    // Omitting slackWebhook in the body must not wipe the stored secret.
    const keepRes = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: null,
        notifyReviewReady: false,
        notifyErrors: true,
      }),
    });
    expect(keepRes.status).toBe(200);
    expect(repo.state.row.slackWebhook).toBe(preEncrypted);

    // Explicit null clears the channel.
    const clearRes = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: null,
        slackWebhook: null,
        notifyReviewReady: false,
        notifyErrors: true,
      }),
    });
    expect(clearRes.status).toBe(200);
    expect(repo.state.row.slackWebhook).toBeNull();
    const wire = (await clearRes.json()) as { slackWebhookSet: boolean };
    expect(wire.slackWebhookSet).toBe(false);
  });

  it("rejects an invalid notification email", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);
    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        notifyEmail: "not-an-email",
        notifyReviewReady: true,
        notifyErrors: true,
      }),
    });
    expect(res.status).toBe(400);
    expect(repo.updateNotificationSettings).not.toHaveBeenCalled();
  });
});

describe("feature flags (REQ-093, EDGE-014)", () => {
  it("test_REQ_093_feature_flags_default_off_independent — defaults off; each flag toggles without touching the others", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);

    // Defaults: a fresh tenant has all three off (DB column default false).
    const initial = await app.request("/api/settings/features", {
      headers: { cookie: authCookie() },
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      featureCanon: false,
      featureDeliverability: false,
      featureEval: false,
    });

    // Toggle ONE flag on — the others stay off.
    const putEval = await app.request("/api/settings/features", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        featureCanon: false,
        featureDeliverability: false,
        featureEval: true,
      }),
    });
    expect(putEval.status).toBe(200);
    expect(await putEval.json()).toEqual({
      featureCanon: false,
      featureDeliverability: false,
      featureEval: true,
    });

    // Toggle another independently — the first keeps its value.
    const putCanon = await app.request("/api/settings/features", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        featureCanon: true,
        featureDeliverability: false,
        featureEval: true,
      }),
    });
    expect(putCanon.status).toBe(200);
    expect(repo.state.row.featureCanon).toBe(true);
    expect(repo.state.row.featureDeliverability).toBe(false);
    expect(repo.state.row.featureEval).toBe(true);
  });

  it("test_EDGE_014_disable_canon_hides_keeps_data — canon off hides Must Read (branding flag) while entries survive", async () => {
    const repo = makeTenantsRepo(makeTenantRow({ featureCanon: true }));
    const app = appWithRepo(repo);
    // Stand-in for the tenant's must_read rows: the features route must never
    // touch them (deletion isn't even a dependency of the router).
    const mustReadRows = [{ id: 1, title: "Attention Is All You Need" }];

    const res = await app.request("/api/settings/features", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        featureCanon: false,
        featureDeliverability: false,
        featureEval: false,
      }),
    });
    expect(res.status).toBe(200);

    // The public nav/page gate reads flags.canon from the branding wire.
    expect(toBrandingWire(repo.state.row).flags.canon).toBe(false);
    // Data retained — nothing deleted the entries (REQ-042/EDGE-014).
    expect(mustReadRows).toHaveLength(1);
    expect(repo.updateFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it("requires a tenant session (no tenant → 400)", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);
    const res = await app.request("/api/settings/notifications", {
      headers: { cookie: authCookie(null) },
    });
    expect(res.status).toBe(400);
  });
});

describe("slack webhook URL validation (SSRF guard)", () => {
  it.each([
    ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data"],
    ["internal service", "https://internal.example.com/hook"],
    ["non-URL garbage", "not-a-url"],
    ["slack-lookalike http", "http://hooks.slack.com/services/T0/B0/x"],
  ])(
    "rejects a webhook that is not a Slack incoming-webhook URL (%s) and stores nothing",
    async (_label, webhook) => {
      const repo = makeTenantsRepo(makeTenantRow());
      const app = appWithRepo(repo);

      const res = await app.request("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: authCookie() },
        body: JSON.stringify({
          notifyEmail: null,
          slackWebhook: webhook,
          notifyReviewReady: true,
          notifyErrors: true,
        }),
      });

      expect(res.status).toBe(400);
      expect(repo.updateNotificationSettings).not.toHaveBeenCalled();
    },
  );

  it("still accepts a real Slack incoming-webhook URL", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);

    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({
        notifyEmail: null,
        slackWebhook: RAW_WEBHOOK,
        notifyReviewReady: true,
        notifyErrors: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(repo.updateNotificationSettings).toHaveBeenCalledOnce();
  });
});
