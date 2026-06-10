import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Resend } from "resend";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import type { TenantSelect } from "@newsletter/shared/db";
import { createSendingDomainRouter } from "../sending-domain.js";
import type { SendingDomainRouteDeps } from "../sending-domain.js";

const TENANT_ID = "tenant-1";

function setTenantCtxMiddleware() {
  return createMiddleware(async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).set("tenantCtx", { tenantId: TENANT_ID, role: "tenant_admin" });
    await next();
  });
}

function makeTenant(overrides?: Partial<TenantSelect>): TenantSelect {
  return {
    id: TENANT_ID,
    slug: "testco",
    name: "Test Co",
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
    domainId: null,
    domainName: null,
    domainStatus: null,
    domainRecords: null,
    onboardingState: null,
    oldSlug: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockResend(overrides?: { domains?: Partial<Resend["domains"]> }): Resend {
  return {
    domains: {
      create: vi.fn(),
      get: vi.fn(),
      verify: vi.fn(),
      ...overrides?.domains,
    },
  } as unknown as Resend;
}

function makeDefaultTenantsRepo(): TenantsRepo {
  return {
    findById: vi.fn().mockResolvedValue(makeTenant()),
    updateDomain: vi.fn().mockResolvedValue(makeTenant()),
    findBySlug: vi.fn(),
    findByCustomDomain: vi.fn(),
    findByOldSlug: vi.fn(),
    listAll: vi.fn(),
    create: vi.fn(),
  } as unknown as TenantsRepo;
}

type MakeAppDeps = Partial<Pick<SendingDomainRouteDeps, "getTenantsRepo" | "getResendClient">>;

function makeApp(deps: MakeAppDeps = {}): Hono {
  const router = createSendingDomainRouter({
    getTenantsRepo: deps.getTenantsRepo ?? (() => makeDefaultTenantsRepo()),
    getResendClient: deps.getResendClient ?? (() => makeMockResend()),
    getResendFullAccessKey: () => "re_test_key",
    logger: undefined,
  });

  const app = new Hono();
  app.use("*", setTenantCtxMiddleware());
  app.route("/api/settings/domain", router);
  return app;
}

// ── POST /api/settings/domain ────────────────────────────────────────────────

describe("POST /api/settings/domain", () => {
  it("rejects when no domain name is provided", async () => {
    const app = makeApp();
    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("rejects invalid domain name format", async () => {
    const app = makeApp();
    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "not a domain" }),
    });
    expect(res.status).toBe(400);
  });

  it("registers domain with Resend and stores on tenant", async () => {
    const mockRecords = [
      { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.us-east-1.amazonses.com", ttl: "Auto", status: "not_started", priority: 10 },
    ];
    const resend = makeMockResend({
      domains: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: "dom_123",
            name: "news.example.com",
            status: "not_started",
            created_at: "2026-06-10T00:00:00Z",
            region: "us-east-1",
            records: mockRecords,
          },
          error: null,
        }),
      },
    });

    const updateDomain = vi.fn().mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...makeTenant(),
      domainId: data.domainId,
      domainName: data.domainName,
      domainStatus: data.domainStatus,
      domainRecords: data.domainRecords,
    }));

    const app = makeApp({
      getResendClient: () => resend,
      getTenantsRepo: () => ({
        findById: vi.fn().mockResolvedValue(makeTenant()),
        updateDomain,
      } as unknown as TenantsRepo),
    });

    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "news.example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domainId).toBe("dom_123");
    expect(body.status).toBe("pending");
    expect(body.records).toHaveLength(1);
    expect(updateDomain).toHaveBeenCalledWith(TENANT_ID, {
      domainId: "dom_123",
      domainName: "news.example.com",
      domainStatus: "pending",
      domainRecords: expect.arrayContaining([expect.objectContaining({ record: "SPF" })]),
    });
  });

  it("returns error from Resend domain create failure", async () => {
    const resend = makeMockResend({
      domains: {
        create: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Your plan includes 1 domain", statusCode: 403, name: "validation_error" },
        }),
      },
    });

    const app = makeApp({ getResendClient: () => resend });
    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "news.example.com" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("Your plan includes 1 domain");
  });
});

// ── POST /api/settings/domain/verify ─────────────────────────────────────────

describe("POST /api/settings/domain/verify", () => {
  it("rejects when tenant has no domain registered", async () => {
    const tenant = makeTenant({ domainId: null });
    const app = makeApp({
      getTenantsRepo: () => ({
        findById: vi.fn().mockResolvedValue(tenant),
        updateDomain: vi.fn(),
      } as unknown as TenantsRepo),
    });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No domain registered");
  });

  it("returns verified status when Resend confirms", async () => {
    const tenant = makeTenant({ domainId: "dom_123" });
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "dom_123",
            name: "news.example.com",
            status: "verified",
            created_at: "2026-06-10T00:00:00Z",
            region: "us-east-1",
            records: [],
          },
          error: null,
        }),
      },
    });

    const updateDomain = vi.fn().mockResolvedValue({ ...tenant, domainStatus: "verified" });

    const app = makeApp({
      getResendClient: () => resend,
      getTenantsRepo: () => ({
        findById: vi.fn().mockResolvedValue(tenant),
        updateDomain,
      } as unknown as TenantsRepo),
    });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verified");
    expect(updateDomain).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ domainStatus: "verified" }));
  });

  it("returns failed status with reasons", async () => {
    const tenant = makeTenant({ domainId: "dom_456" });
    const failedRecords = [
      { record: "SPF", name: "send", type: "MX", value: "...", ttl: "Auto", status: "failed", priority: 10 },
    ];
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "dom_456",
            name: "news.example.com",
            status: "failed",
            created_at: "2026-06-10T00:00:00Z",
            region: "us-east-1",
            records: failedRecords,
          },
          error: null,
        }),
      },
    });

    const updateDomain = vi.fn().mockResolvedValue({ ...tenant, domainStatus: "failed" });

    const app = makeApp({
      getResendClient: () => resend,
      getTenantsRepo: () => ({
        findById: vi.fn().mockResolvedValue(tenant),
        updateDomain,
      } as unknown as TenantsRepo),
    });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.failureReasons).toBeDefined();
    expect(updateDomain).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ domainStatus: "failed" }));
  });

  it("propagates Resend API errors", async () => {
    const tenant = makeTenant({ domainId: "dom_123" });
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Domain not found", statusCode: 404, name: "not_found" },
        }),
      },
    });

    const app = makeApp({
      getResendClient: () => resend,
      getTenantsRepo: () => ({
        findById: vi.fn().mockResolvedValue(tenant),
        updateDomain: vi.fn(),
      } as unknown as TenantsRepo),
    });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("Domain not found");
  });
});
