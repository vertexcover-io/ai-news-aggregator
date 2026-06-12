/**
 * Phase 7: sending-domain routes (REQ-084 register + DNS echo, REQ-085 verify
 * + failure reasons, GET current state) with a stub Resend client and an
 * in-memory repo. Also proves auth gating and that no Resend internals
 * (resendDomainId, api key) leak into responses.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createSendingDomainRouter } from "../sending-domains.js";
import { requireUser } from "../../auth/middleware.js";
import { issueSession, COOKIE_NAME } from "../../auth/session.js";
import type {
  SendingDomainRecord,
  SendingDomainsRepo,
  SendingDomainStatusUpdate,
  SendingDomainUpsertInput,
} from "../../repositories/sending-domains.js";
import type {
  ResendDomainsClient,
  ResendDomainState,
} from "../../lib/email/resend-domains.js";
import { ResendDomainsError } from "../../lib/email/resend-domains.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

const DNS_RECORDS = [
  { record: "SPF", name: "send.acme.com", type: "TXT", value: "v=spf1 include:amazonses.com ~all", status: "pending" },
  { record: "DKIM", name: "resend._domainkey.acme.com", type: "TXT", value: "p=MIGfMA0...", status: "pending" },
];

function makeInMemoryRepos(): {
  getRepo: (tenantId: string) => SendingDomainsRepo;
  rows: Map<string, SendingDomainRecord>;
} {
  const rows = new Map<string, SendingDomainRecord>();
  const getRepo = (tenantId: string): SendingDomainsRepo => ({
    get(): Promise<SendingDomainRecord | null> {
      return Promise.resolve(rows.get(tenantId) ?? null);
    },
    upsert(input: SendingDomainUpsertInput): Promise<SendingDomainRecord> {
      const row: SendingDomainRecord = {
        ...input,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(tenantId, row);
      return Promise.resolve(row);
    },
    updateStatus(input: SendingDomainStatusUpdate): Promise<SendingDomainRecord | null> {
      const existing = rows.get(tenantId);
      if (!existing) return Promise.resolve(null);
      const row: SendingDomainRecord = { ...existing, ...input, updatedAt: new Date() };
      rows.set(tenantId, row);
      return Promise.resolve(row);
    },
  });
  return { getRepo, rows };
}

function makeStubClient(
  overrides: Partial<ResendDomainsClient> = {},
): ResendDomainsClient {
  return {
    register: vi.fn((domain: string) =>
      Promise.resolve<ResendDomainState>({
        resendDomainId: `rd-${domain}`,
        status: "pending",
        dnsRecords: DNS_RECORDS,
        failureReason: null,
      }),
    ),
    check: vi.fn(() =>
      Promise.resolve<ResendDomainState>({
        resendDomainId: "rd-acme.com",
        status: "verified",
        dnsRecords: DNS_RECORDS.map((r) => ({ ...r, status: "verified" })),
        failureReason: null,
      }),
    ),
    ...overrides,
  };
}

function buildApp(
  getRepo: (tenantId: string) => SendingDomainsRepo,
  client: ResendDomainsClient | null,
): Hono {
  const app = new Hono();
  app.use("/api/admin/sending-domain", requireUser(SESSION_SECRET));
  app.use("/api/admin/sending-domain/*", requireUser(SESSION_SECRET));
  app.route(
    "/api/admin/sending-domain",
    createSendingDomainRouter({
      getSendingDomainsRepo: getRepo,
      resendDomains: client,
    }),
  );
  return app;
}

function authCookie(tenantId = TENANT_A): string {
  const token = issueSession(
    { uid: "user-1", tid: tenantId, role: "tenant_admin" },
    SESSION_SECRET,
  );
  return `${COOKIE_NAME}=${token}`;
}

function jsonHeaders(tenantId = TENANT_A): Record<string, string> {
  return { "content-type": "application/json", cookie: authCookie(tenantId) };
}

describe("sending-domain routes — auth gating", () => {
  it.each([
    { name: "GET /", path: "/api/admin/sending-domain", method: "GET" },
    { name: "POST /", path: "/api/admin/sending-domain", method: "POST" },
    { name: "POST /verify", path: "/api/admin/sending-domain/verify", method: "POST" },
  ])("$name without cookie → 401", async ({ path, method }) => {
    const { getRepo } = makeInMemoryRepos();
    const app = buildApp(getRepo, makeStubClient());
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/sending-domain (REQ-084)", () => {
  it("registers with Resend, persists, and returns the DNS records", async () => {
    const { getRepo, rows } = makeInMemoryRepos();
    const client = makeStubClient();
    const app = buildApp(getRepo, client);

    const res = await app.request("/api/admin/sending-domain", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "Acme.COM " }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { sendingDomain: { domain: string; status: string; dnsRecords: unknown[] } };
    expect(body.sendingDomain.domain).toBe("acme.com");
    expect(body.sendingDomain.status).toBe("pending");
    expect(body.sendingDomain.dnsRecords).toEqual(DNS_RECORDS);
    expect(client.register).toHaveBeenCalledWith("acme.com");
    expect(rows.get(TENANT_A)?.resendDomainId).toBe("rd-acme.com");
  });

  it("never serializes the resendDomainId", async () => {
    const { getRepo } = makeInMemoryRepos();
    const app = buildApp(getRepo, makeStubClient());

    const res = await app.request("/api/admin/sending-domain", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "acme.com" }),
    });
    const raw = await res.text();
    expect(raw).not.toContain("rd-acme.com");
    expect(raw).not.toContain("resendDomainId");
  });

  it.each(["not a domain", "no-tld", "-leading.com", "", 42])(
    "rejects invalid domain %j with 400",
    async (domain) => {
      const { getRepo } = makeInMemoryRepos();
      const client = makeStubClient();
      const app = buildApp(getRepo, client);
      const res = await app.request("/api/admin/sending-domain", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ domain }),
      });
      expect(res.status).toBe(400);
      expect(client.register).not.toHaveBeenCalled();
    },
  );

  it("returns 503 when no Resend client is configured", async () => {
    const { getRepo } = makeInMemoryRepos();
    const app = buildApp(getRepo, null);
    const res = await app.request("/api/admin/sending-domain", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "acme.com" }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 502 (no persistence) when Resend registration fails", async () => {
    const { getRepo, rows } = makeInMemoryRepos();
    const client = makeStubClient({
      register: vi.fn(() =>
        Promise.reject(new ResendDomainsError("create", "domain quota exceeded")),
      ),
    });
    const app = buildApp(getRepo, client);
    const res = await app.request("/api/admin/sending-domain", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "acme.com" }),
    });
    expect(res.status).toBe(502);
    expect(rows.size).toBe(0);
  });
});

describe("POST /api/admin/sending-domain/verify (REQ-085)", () => {
  async function register(app: Hono): Promise<void> {
    const res = await app.request("/api/admin/sending-domain", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "acme.com" }),
    });
    expect(res.status).toBe(201);
  }

  it("re-checks with Resend and persists a verified status", async () => {
    const { getRepo, rows } = makeInMemoryRepos();
    const client = makeStubClient();
    const app = buildApp(getRepo, client);
    await register(app);

    const res = await app.request("/api/admin/sending-domain/verify", {
      method: "POST",
      headers: jsonHeaders(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sendingDomain: { status: string; lastCheckedAt: string | null } };
    expect(body.sendingDomain.status).toBe("verified");
    expect(body.sendingDomain.lastCheckedAt).not.toBeNull();
    expect(client.check).toHaveBeenCalledWith("rd-acme.com");
    expect(rows.get(TENANT_A)?.status).toBe("verified");
  });

  it("surfaces failure reasons when verification failed", async () => {
    const { getRepo } = makeInMemoryRepos();
    const client = makeStubClient({
      check: vi.fn(() =>
        Promise.resolve<ResendDomainState>({
          resendDomainId: "rd-acme.com",
          status: "failed",
          dnsRecords: DNS_RECORDS.map((r) => ({ ...r, status: "failed" })),
          failureReason: "SPF record (TXT send.acme.com): failed",
        }),
      ),
    });
    const app = buildApp(getRepo, client);
    await register(app);

    const res = await app.request("/api/admin/sending-domain/verify", {
      method: "POST",
      headers: jsonHeaders(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sendingDomain: { status: string; failureReason: string | null } };
    expect(body.sendingDomain.status).toBe("failed");
    expect(body.sendingDomain.failureReason).toContain("SPF record");
  });

  it("404s when the tenant has no registered domain", async () => {
    const { getRepo } = makeInMemoryRepos();
    const app = buildApp(getRepo, makeStubClient());
    const res = await app.request("/api/admin/sending-domain/verify", {
      method: "POST",
      headers: jsonHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("502s when the Resend check itself errors", async () => {
    const { getRepo } = makeInMemoryRepos();
    const client = makeStubClient({
      check: vi.fn(() => Promise.reject(new ResendDomainsError("verify", "boom"))),
    });
    const app = buildApp(getRepo, client);
    await register(app);
    const res = await app.request("/api/admin/sending-domain/verify", {
      method: "POST",
      headers: jsonHeaders(),
    });
    expect(res.status).toBe(502);
  });
});

describe("GET /api/admin/sending-domain", () => {
  it("returns null before registration", async () => {
    const { getRepo } = makeInMemoryRepos();
    const app = buildApp(getRepo, makeStubClient());
    const res = await app.request("/api/admin/sending-domain", {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sendingDomain: null });
  });

  it("is scoped to the session tenant", async () => {
    const { getRepo } = makeInMemoryRepos();
    const app = buildApp(getRepo, makeStubClient());
    await app.request("/api/admin/sending-domain", {
      method: "POST",
      headers: jsonHeaders(TENANT_A),
      body: JSON.stringify({ domain: "acme.com" }),
    });

    const resB = await app.request("/api/admin/sending-domain", {
      headers: { cookie: authCookie(TENANT_B) },
    });
    expect(await resB.json()).toEqual({ sendingDomain: null });

    const resA = await app.request("/api/admin/sending-domain", {
      headers: { cookie: authCookie(TENANT_A) },
    });
    const bodyA = (await resA.json()) as { sendingDomain: { domain: string } | null };
    expect(bodyA.sendingDomain?.domain).toBe("acme.com");
  });
});
