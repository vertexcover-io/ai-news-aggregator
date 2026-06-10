import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createSendingDomainsRouter,
  type ResendDomainsClient,
} from "../sending-domains.js";
import type { TenantVariables } from "../../middleware/types.js";
import type { TenantContext } from "@newsletter/shared";
import type {
  SendingDomainsRepo,
  SendingDomainUpsertInput,
} from "../../repositories/sending-domains.js";
import type {
  SendingDomainRow,
  SendingDomainStatus,
} from "@newsletter/shared";

const TENANT_A: TenantContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  userId: "user-a",
  role: "tenant_admin",
};

function makeRepo(initial?: SendingDomainRow | null): {
  repo: SendingDomainsRepo;
  current: () => SendingDomainRow | null;
} {
  let row: SendingDomainRow | null = initial ?? null;
  const repo: SendingDomainsRepo = {
    get: () => Promise.resolve(row),
    upsert: (input: SendingDomainUpsertInput) => {
      row = {
        id: "domain-1",
        tenantId: TENANT_A.tenantId,
        domain: input.domain,
        providerDomainId: input.providerDomainId ?? null,
        status: input.status ?? "pending",
        dnsRecords: input.dnsRecords ?? null,
        failureReasons: input.failureReasons ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return Promise.resolve(row);
    },
    updateStatus: (
      status: SendingDomainStatus,
      extra?: {
        providerDomainId?: string | null;
        dnsRecords?: unknown[] | null;
        failureReasons?: string[] | null;
      },
    ) => {
      if (!row) throw new Error("no row to update");
      row = {
        ...row,
        status,
        ...(extra ?? {}),
        updatedAt: new Date(),
      };
      return Promise.resolve(row);
    },
  };
  return { repo, current: () => row };
}

function buildApp(
  repo: SendingDomainsRepo,
  resend: ResendDomainsClient | null,
): Hono<{ Variables: TenantVariables }> {
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    c.set("tenantCtx", TENANT_A);
    await next();
  });
  app.route(
    "/",
    createSendingDomainsRouter({
      getRepo: () => repo,
      getResend: () => resend,
    }),
  );
  return app;
}

const RECORDS = [
  {
    record: "DKIM",
    name: "resend._domainkey",
    type: "TXT",
    status: "not_started",
    value: "p=abc",
  },
];

describe("sending-domains router — GET", () => {
  it("returns none status when no domain registered", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, null);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      domain: null,
      status: "none",
      verified: false,
    });
  });

  it("returns current domain + verified flag", async () => {
    const { repo } = makeRepo({
      id: "d1",
      tenantId: TENANT_A.tenantId,
      domain: "mail.example.com",
      providerDomainId: "rd_1",
      status: "verified",
      dnsRecords: RECORDS,
      failureReasons: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = buildApp(repo, null);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified: boolean; status: string };
    expect(body.verified).toBe(true);
    expect(body.status).toBe("verified");
  });
});

describe("sending-domains router — POST /", () => {
  it("registers a domain with Resend and stores providerDomainId + dnsRecords (pending)", async () => {
    const { repo, current } = makeRepo(null);
    const resend: ResendDomainsClient = {
      create: () =>
        Promise.resolve({
          data: { id: "rd_99", status: "not_started", records: RECORDS },
          error: null,
        }),
      get: () => Promise.reject(new Error("unused")),
    };
    const app = buildApp(repo, resend);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "mail.example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      verified: boolean;
      dnsRecords: unknown[];
    };
    expect(body.status).toBe("pending");
    expect(body.verified).toBe(false);
    expect(body.dnsRecords).toEqual(RECORDS);
    expect(current()?.providerDomainId).toBe("rd_99");
  });

  it("rejects an invalid domain with 400", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, {
      create: () => Promise.reject(new Error("unused")),
      get: () => Promise.reject(new Error("unused")),
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "not a domain" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 501 when Resend is unavailable", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, null);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "mail.example.com" }),
    });
    expect(res.status).toBe(501);
  });

  it("returns 502 when Resend create errors", async () => {
    const { repo } = makeRepo(null);
    const resend: ResendDomainsClient = {
      create: () =>
        Promise.resolve({
          data: null,
          error: { message: "quota exceeded", name: "rate_limit" },
        }),
      get: () => Promise.reject(new Error("unused")),
    };
    const app = buildApp(repo, resend);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "mail.example.com" }),
    });
    expect(res.status).toBe(502);
  });
});

describe("sending-domains router — POST /verify", () => {
  it("marks domain verified when Resend reports verified", async () => {
    const { repo, current } = makeRepo({
      id: "d1",
      tenantId: TENANT_A.tenantId,
      domain: "mail.example.com",
      providerDomainId: "rd_99",
      status: "pending",
      dnsRecords: RECORDS,
      failureReasons: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const resend: ResendDomainsClient = {
      create: () => Promise.reject(new Error("unused")),
      get: () =>
        Promise.resolve({
          data: { id: "rd_99", status: "verified", records: RECORDS },
          error: null,
        }),
    };
    const app = buildApp(repo, resend);
    const res = await app.request("/verify", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; verified: boolean };
    expect(body.status).toBe("verified");
    expect(body.verified).toBe(true);
    expect(current()?.status).toBe("verified");
  });

  it("marks domain failed with reasons when Resend reports failure", async () => {
    const { repo } = makeRepo({
      id: "d1",
      tenantId: TENANT_A.tenantId,
      domain: "mail.example.com",
      providerDomainId: "rd_99",
      status: "pending",
      dnsRecords: RECORDS,
      failureReasons: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const resend: ResendDomainsClient = {
      create: () => Promise.reject(new Error("unused")),
      get: () =>
        Promise.resolve({
          data: {
            id: "rd_99",
            status: "failed",
            records: [{ ...RECORDS[0], status: "failed" }],
          },
          error: null,
        }),
    };
    const app = buildApp(repo, resend);
    const res = await app.request("/verify", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      failureReasons: string[] | null;
    };
    expect(body.status).toBe("failed");
    expect(body.failureReasons).not.toBeNull();
    expect(body.failureReasons?.length).toBeGreaterThan(0);
  });

  it("returns 404 when no domain registered", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, {
      create: () => Promise.reject(new Error("unused")),
      get: () => Promise.reject(new Error("unused")),
    });
    const res = await app.request("/verify", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("sending-domains router — auth", () => {
  it("returns 401 when tenant ctx is absent", async () => {
    const { repo } = makeRepo(null);
    const app = new Hono<{ Variables: TenantVariables }>();
    app.route(
      "/",
      createSendingDomainsRouter({
        getRepo: () => repo,
        getResend: () => null,
      }),
    );
    const res = await app.request("/");
    expect(res.status).toBe(401);
  });
});
