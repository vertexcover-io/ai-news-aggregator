import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impersonateTenant, listTenants, exitImpersonation } from "../../../src/api/super";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tenantResponse = {
  id: "t-1",
  slug: "agentloop",
  name: "AGENTLOOP",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("listTenants", () => {
  it("fetches /api/super/tenants and returns tenant array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([tenantResponse]), { status: 200 }),
    );
    const out = await listTenants();
    expect(out).toEqual([tenantResponse]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("/api/super/tenants");
    expect(init?.credentials).toBe("include");
  });

  it("throws with error message on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    await expect(listTenants()).rejects.toThrow("unauthorized");
  });
});

describe("impersonateTenant", () => {
  it("POSTs to /api/super/impersonate/:tenantId and returns result", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, tenantId: "t-1", tenantName: "AGENTLOOP" }), { status: 200 }),
    );
    const out = await impersonateTenant("t-1");
    expect(out).toEqual({ ok: true, tenantId: "t-1", tenantName: "AGENTLOOP" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("/api/super/impersonate/t-1");
    expect(init?.method).toBe("POST");
  });

  it("throws on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Tenant not found" }), { status: 404 }),
    );
    await expect(impersonateTenant("bad-id")).rejects.toThrow("Tenant not found");
  });
});

describe("exitImpersonation", () => {
  it("POSTs to /api/super/impersonate/exit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const out = await exitImpersonation();
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("/api/super/impersonate/exit");
    expect(init?.method).toBe("POST");
  });
});
