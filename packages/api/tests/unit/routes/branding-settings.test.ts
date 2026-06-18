/**
 * FIX #1: admin branding settings routes — mounted auth-gated at /api/settings:
 *
 *   GET  /api/settings/branding       → onboarding-captured brand fields + logo flag
 *   PUT  /api/settings/branding       → persist name/headline/topicStrip/subtagline
 *   POST /api/settings/branding/logo  → validate + store logo bytes (reuses validateLogo)
 *
 * The branding fields are the ones onboarding wrote to the tenants row; the gap
 * this closes is that Admin Settings could neither view nor edit them.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";
import type {
  BrandingSettingsPatch,
  TenantRow,
} from "@api/repositories/tenants.js";
import {
  createBrandingSettingsRouter,
  type BrandingSettingsRouterDeps,
} from "@api/routes/branding-settings.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";

// A 1×1 transparent PNG — passes validateLogo's magic-byte sniff.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636060606000000005000157a7f9d40000000049454e44ae426082",
  "hex",
);

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
    headline: "The daily read for people building with inference.",
    topicStrip: "Serving · Quantization · Latency",
    subtagline: "Just the runtime.",
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
    customDomainStatus: null,
    customDomainVerifiedAt: null,
    emailMode: "managed",
    smtpConfigEnc: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface FakeRepo {
  findById: ReturnType<typeof vi.fn>;
  updateBranding: ReturnType<typeof vi.fn>;
  updateLogo: ReturnType<typeof vi.fn>;
  state: { row: TenantRow };
}

function makeTenantsRepo(row: TenantRow): FakeRepo {
  const state = { row };
  return {
    state,
    findById: vi.fn((id: string) =>
      Promise.resolve(id === state.row.id ? state.row : null),
    ),
    updateBranding: vi.fn((_id: string, patch: BrandingSettingsPatch) => {
      state.row = { ...state.row, ...patch };
      return Promise.resolve(state.row);
    }),
    updateLogo: vi.fn((_id: string, bytes: Buffer, contentType: string) => {
      state.row = { ...state.row, logoBytes: bytes, logoContentType: contentType };
      return Promise.resolve(state.row);
    }),
  };
}

function buildTestApp(deps: BrandingSettingsRouterDeps): Hono {
  const app = new Hono();
  const gated = new Hono();
  gated.use("*", requireAuth(SESSION_SECRET));
  gated.route("/", createBrandingSettingsRouter(deps));
  app.route("/api/settings", gated);
  return app;
}

function appWithRepo(repo: FakeRepo): Hono {
  return buildTestApp({ getTenantsRepo: () => repo });
}

describe("admin branding settings (FIX #1)", () => {
  it("GET returns the onboarding-captured branding fields + logo flag", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const res = await appWithRepo(repo).request("/api/settings/branding", {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
    const wire = (await res.json()) as Record<string, unknown>;
    expect(wire).toMatchObject({
      name: "The Inference",
      headline: "The daily read for people building with inference.",
      topicStrip: "Serving · Quantization · Latency",
      subtagline: "Just the runtime.",
      hasLogo: false,
      logoUrl: null,
    });
  });

  it("PUT updates the branding fields and round-trips via GET", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);
    const putRes = await app.request("/api/settings/branding", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        name: "Renamed",
        headline: "New headline",
        topicStrip: null,
        subtagline: null,
      }),
    });
    expect(putRes.status).toBe(200);
    expect(repo.state.row.name).toBe("Renamed");
    expect(repo.state.row.topicStrip).toBeNull();

    const getRes = await app.request("/api/settings/branding", {
      headers: { cookie: authCookie() },
    });
    const wire = (await getRes.json()) as { name: string; headline: string | null };
    expect(wire.name).toBe("Renamed");
    expect(wire.headline).toBe("New headline");
  });

  it("PUT rejects an empty newsletter name with 400", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const res = await appWithRepo(repo).request("/api/settings/branding", {
      method: "PUT",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ name: "  ", headline: null, topicStrip: null, subtagline: null }),
    });
    expect(res.status).toBe(400);
    expect(repo.updateBranding).not.toHaveBeenCalled();
  });

  it("POST /branding/logo validates and stores the bytes", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const app = appWithRepo(repo);
    const res = await app.request("/api/settings/branding/logo", {
      method: "POST",
      headers: { cookie: authCookie(), "content-type": "image/png" },
      body: PNG_BYTES,
    });
    expect(res.status).toBe(200);
    expect(repo.updateLogo).toHaveBeenCalled();
    expect(repo.state.row.logoContentType).toBe("image/png");

    // A subsequent GET now advertises the logo + a versioned preview URL.
    const getRes = await app.request("/api/settings/branding", {
      headers: { cookie: authCookie() },
    });
    const wire = (await getRes.json()) as { hasLogo: boolean; logoUrl: string | null };
    expect(wire.hasLogo).toBe(true);
    expect(wire.logoUrl).toContain("/api/settings/branding/logo?v=");
  });

  it("POST /branding/logo rejects an unsupported file with 400 and keeps the prior logo", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const res = await appWithRepo(repo).request("/api/settings/branding/logo", {
      method: "POST",
      headers: { cookie: authCookie(), "content-type": "image/png" },
      body: Buffer.from("not an image"),
    });
    expect(res.status).toBe(400);
    expect(repo.updateLogo).not.toHaveBeenCalled();
  });
});
