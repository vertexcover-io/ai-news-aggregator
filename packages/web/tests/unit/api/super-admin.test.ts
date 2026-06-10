import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listTenants,
  impersonate,
  exitImpersonation,
} from "../../../src/api/super-admin";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("super-admin client", () => {
  it("listTenants unwraps the tenants array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ tenants: [{ id: "t1", slug: "x", name: "X", status: "active" }] }),
        { status: 200 },
      ),
    );
    const out = await listTenants();
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("x");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/super-admin/tenants");
  });

  it("impersonate POSTs the encoded tenantId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, tenantId: "t 1" }), { status: 200 }),
    );
    await impersonate("t 1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/super-admin/impersonate/t%201");
    expect(init.method).toBe("POST");
  });

  it("exitImpersonation POSTs /impersonate/exit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await exitImpersonation();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/super-admin/impersonate/exit");
    expect(init.method).toBe("POST");
  });
});
