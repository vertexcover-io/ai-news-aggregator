import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDomain,
  registerDomain,
  verifyDomain,
} from "../../../src/api/sending-domains";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sending-domains client", () => {
  it("getDomain returns the none-state payload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ domain: null, status: "none", verified: false }),
        { status: 200 },
      ),
    );
    const out = await getDomain();
    expect(out.status).toBe("none");
    expect(out.verified).toBe(false);
  });

  it("registerDomain POSTs the domain name", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ domain: "mail.x.co", status: "pending", verified: false }),
        { status: 200 },
      ),
    );
    await registerDomain("mail.x.co");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sending-domains");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ domain: "mail.x.co" });
  });

  it("verifyDomain POSTs /verify", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ domain: "mail.x.co", status: "verified", verified: true }),
        { status: 200 },
      ),
    );
    const out = await verifyDomain();
    expect(out.verified).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sending-domains/verify");
    expect(init.method).toBe("POST");
  });

  it("surfaces the message field on error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "resend_unavailable", message: "RESEND_API_KEY not configured" }),
        { status: 501 },
      ),
    );
    await expect(registerDomain("x.co")).rejects.toThrow("RESEND_API_KEY not configured");
  });
});
