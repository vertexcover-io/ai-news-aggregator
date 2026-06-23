/**
 * P14 (REQ-084/085): per-tenant Resend sending-domain registration +
 * verification routes. Resend is ALWAYS faked here (no live calls).
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";
import type { SendingDomainPatch, TenantRow } from "@api/repositories/tenants.js";
import {
  createSendingDomainRouter,
  type SendingDomainRouterDeps,
} from "@api/routes/sending-domain.js";
import type {
  ResendDomainsClient,
  ResendDomainShape,
} from "@api/services/sending-domain.js";
import type { SendingDomainWire } from "@newsletter/shared/types/tenant";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";

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
    customDomainStatus: null,
    customDomainVerifiedAt: null,
    emailMode: "managed",
    smtpConfigEnc: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

const dkimRecord = {
  record: "DKIM",
  type: "TXT",
  name: "resend._domainkey",
  value: "p=MIGfMA0GCSq",
  ttl: "Auto",
  status: "not_started",
};
const spfRecord = {
  record: "SPF",
  type: "MX",
  name: "send",
  value: "feedback-smtp.resend.com",
  ttl: "Auto",
  priority: 10,
  status: "not_started",
};

function makeDomain(overrides: Partial<ResendDomainShape> = {}): ResendDomainShape {
  return {
    id: "rsd-domain-1",
    name: "theinference.com",
    status: "pending",
    records: [dkimRecord, spfRecord],
    ...overrides,
  };
}

function makeFakeResend(domain: ResendDomainShape = makeDomain()): {
  client: ResendDomainsClient;
  createCalls: { name: string }[];
  verifyCalls: string[];
  getCalls: string[];
} {
  const createCalls: { name: string }[] = [];
  const verifyCalls: string[] = [];
  const getCalls: string[] = [];
  return {
    createCalls,
    verifyCalls,
    getCalls,
    client: {
      create(payload) {
        createCalls.push(payload);
        return Promise.resolve({ data: domain, error: null });
      },
      get(id) {
        getCalls.push(id);
        return Promise.resolve({ data: domain, error: null });
      },
      verify(id) {
        verifyCalls.push(id);
        return Promise.resolve({ error: null });
      },
    },
  };
}

function makeTenantsRepo(row: TenantRow): ReturnType<SendingDomainRouterDeps["getTenantsRepo"]> & {
  findById: ReturnType<typeof vi.fn>;
  updateSendingDomain: ReturnType<typeof vi.fn>;
} {
  const state = { row };
  return {
    findById: vi.fn((id: string) => Promise.resolve(id === state.row.id ? state.row : null)),
    updateSendingDomain: vi.fn((_id: string, patch: SendingDomainPatch) => {
      state.row = { ...state.row, ...patch };
      return Promise.resolve(state.row);
    }),
  };
}

function buildTestApp(deps: SendingDomainRouterDeps): Hono {
  const app = new Hono();
  const gate = requireAuth(SESSION_SECRET);
  const gated = new Hono();
  gated.use("*", gate);
  gated.route("/", createSendingDomainRouter(deps));
  app.route("/api/settings/domain", gated);
  return app;
}

describe("POST /api/settings/domain (REQ-084)", () => {
  it("test_REQ_084_add_domain_registers_returns_dns — registers with Resend, persists on the tenant, returns DNS records", async () => {
    const fake = makeFakeResend();
    const repo = makeTenantsRepo(makeTenantRow());
    const app = buildTestApp({
      getTenantsRepo: () => repo,
      domainsClient: fake.client,
    });

    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ domain: "theinference.com" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain: SendingDomainWire };
    expect(body.domain.domain).toBe("theinference.com");
    expect(body.domain.status).toBe("pending");
    expect(body.domain.records).toHaveLength(2);
    expect(body.domain.records[0]).toMatchObject({
      record: "DKIM",
      type: "TXT",
      name: "resend._domainkey",
      value: "p=MIGfMA0GCSq",
    });

    // Registered against Resend with the requested name…
    expect(fake.createCalls).toEqual([{ name: "theinference.com" }]);
    // …and {domainId,status,records} persisted on the tenant row.
    expect(repo.updateSendingDomain).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        sendingDomainName: "theinference.com",
        sendingDomainId: "rsd-domain-1",
        sendingDomainStatus: "pending",
        sendingDomainRecords: expect.arrayContaining([
          expect.objectContaining({ record: "DKIM" }),
        ]),
      }),
    );
  });

  it("rejects an invalid domain name without calling Resend", async () => {
    const fake = makeFakeResend();
    const repo = makeTenantsRepo(makeTenantRow());
    const app = buildTestApp({
      getTenantsRepo: () => repo,
      domainsClient: fake.client,
    });

    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ domain: "not a domain" }),
    });

    expect(res.status).toBe(400);
    expect(fake.createCalls).toHaveLength(0);
  });

  it("surfaces a Resend rejection (e.g. plan domain quota) as 502 with the message", async () => {
    const repo = makeTenantsRepo(makeTenantRow());
    const client: ResendDomainsClient = {
      create: () =>
        Promise.resolve({
          data: null,
          error: {
            name: "validation_error",
            message: "Your plan includes 1 domain. Upgrade to add more.",
          },
        }),
      get: vi.fn(),
      verify: vi.fn(),
    };
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: client });

    const res = await app.request("/api/settings/domain", {
      method: "POST",
      headers: { cookie: authCookie(), "content-type": "application/json" },
      body: JSON.stringify({ domain: "theinference.com" }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("plan includes 1 domain");
    expect(repo.updateSendingDomain).not.toHaveBeenCalled();
  });
});

describe("POST /api/settings/domain/verify (REQ-085)", () => {
  const registeredRow = makeTenantRow({
    sendingDomainName: "theinference.com",
    sendingDomainId: "rsd-domain-1",
    sendingDomainStatus: "pending",
    sendingDomainRecords: [
      { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSq", status: "not_started" },
    ],
  });

  it("test_REQ_085_verify_updates_domain_status — pending → verified is persisted and returned", async () => {
    const fake = makeFakeResend(makeDomain({
      status: "verified",
      records: [{ ...dkimRecord, status: "verified" }, { ...spfRecord, status: "verified" }],
    }));
    const repo = makeTenantsRepo(registeredRow);
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { cookie: authCookie() },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain: SendingDomainWire };
    expect(body.domain.status).toBe("verified");
    expect(body.domain.reasons).toBeUndefined();
    // Triggered verification then queried current state, both on the stored id.
    expect(fake.verifyCalls).toEqual(["rsd-domain-1"]);
    expect(fake.getCalls).toEqual(["rsd-domain-1"]);
    expect(repo.updateSendingDomain).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ sendingDomainStatus: "verified" }),
    );
  });

  it("test_REQ_085_verify_failed_surfaces_reasons — failed records map to human-readable reasons", async () => {
    const fake = makeFakeResend(makeDomain({
      status: "failed",
      records: [
        { ...dkimRecord, status: "failed" },
        { ...spfRecord, status: "verified" },
      ],
    }));
    const repo = makeTenantsRepo(registeredRow);
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { cookie: authCookie() },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain: SendingDomainWire };
    expect(body.domain.status).toBe("failed");
    expect(body.domain.reasons).toEqual([
      expect.stringContaining("resend._domainkey"),
    ]);
  });

  it("maps Resend partially_verified to pending (not yet broadcastable)", async () => {
    const fake = makeFakeResend(makeDomain({ status: "partially_verified" }));
    const repo = makeTenantsRepo(registeredRow);
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { cookie: authCookie() },
    });

    const body = (await res.json()) as { domain: SendingDomainWire };
    expect(body.domain.status).toBe("pending");
  });

  it("404s when the tenant has no registered domain", async () => {
    const fake = makeFakeResend();
    const repo = makeTenantsRepo(makeTenantRow());
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain/verify", {
      method: "POST",
      headers: { cookie: authCookie() },
    });

    expect(res.status).toBe(404);
    expect(fake.getCalls).toHaveLength(0);
  });
});

describe("GET /api/settings/domain", () => {
  it("returns the stored domain state without calling Resend", async () => {
    const fake = makeFakeResend();
    const repo = makeTenantsRepo(
      makeTenantRow({
        sendingDomainName: "theinference.com",
        sendingDomainId: "rsd-domain-1",
        sendingDomainStatus: "pending",
        sendingDomainRecords: [
          { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=x", status: "pending" },
        ],
      }),
    );
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain", {
      headers: { cookie: authCookie() },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain: SendingDomainWire | null };
    expect(body.domain?.domain).toBe("theinference.com");
    expect(body.domain?.records).toHaveLength(1);
    expect(fake.getCalls).toHaveLength(0);
  });

  it("returns { domain: null } when nothing is registered", async () => {
    const fake = makeFakeResend();
    const repo = makeTenantsRepo(makeTenantRow());
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain", {
      headers: { cookie: authCookie() },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ domain: null });
  });

  it("rejects without a session cookie", async () => {
    const fake = makeFakeResend();
    const repo = makeTenantsRepo(makeTenantRow());
    const app = buildTestApp({ getTenantsRepo: () => repo, domainsClient: fake.client });

    const res = await app.request("/api/settings/domain");
    expect(res.status).toBe(401);
  });
});
