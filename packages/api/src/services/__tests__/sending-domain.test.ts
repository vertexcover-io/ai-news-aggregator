import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Resend } from "resend";
import { registerDomain, checkDomainStatus } from "../sending-domain.js";

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

// ── registerDomain ──────────────────────────────────────────────────────────

describe("registerDomain", () => {
  it("calls resend.domains.create with the domain name and returns DNS records", async () => {
    const mockRecords = [
      { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.us-east-1.amazonses.com", ttl: "Auto", status: "not_started", priority: 10 },
      { record: "SPF", name: "send", type: "TXT", value: '"v=spf1 include:amazonses.com ~all"', ttl: "Auto", status: "not_started" },
      { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIG...", ttl: "Auto", status: "not_started" },
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
    } as unknown as Resend);

    const result = await registerDomain(resend, "news.example.com");

    expect(resend.domains.create).toHaveBeenCalledWith({ name: "news.example.com" });
    expect(result.domainId).toBe("dom_123");
    expect(result.status).toBe("pending");
    expect(result.records).toHaveLength(3);
    expect(result.records[0].record).toBe("SPF");
    expect(result.records[0].type).toBe("MX");
  });

  it("maps all Resend domain statuses to our internal status", async () => {
    const cases: Array<{ resendStatus: string; expected: string }> = [
      { resendStatus: "not_started", expected: "pending" },
      { resendStatus: "pending", expected: "pending" },
      { resendStatus: "verified", expected: "verified" },
      { resendStatus: "failed", expected: "failed" },
      { resendStatus: "partially_verified", expected: "pending" },
      { resendStatus: "partially_failed", expected: "pending" },
    ];

    for (const c of cases) {
      const resend = makeMockResend({
        domains: {
          create: vi.fn().mockResolvedValue({
            data: {
              id: "dom_1",
              name: "dom.com",
              status: c.resendStatus,
              created_at: "2026-01-01",
              region: "us-east-1",
              records: [],
            },
            error: null,
          }),
        },
      } as unknown as Resend);

      const result = await registerDomain(resend, "dom.com");
      expect(result.status, `Resend status ${c.resendStatus} should map to ${c.expected}`).toBe(c.expected);
    }
  });

  it("throws when Resend returns an error", async () => {
    const resend = makeMockResend({
      domains: {
        create: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Your plan includes 1 domain", statusCode: 403, name: "validation_error" },
        }),
      },
    } as unknown as Resend);

    await expect(registerDomain(resend, "news.example.com")).rejects.toThrow(
      "Your plan includes 1 domain",
    );
  });
});

// ── checkDomainStatus ───────────────────────────────────────────────────────

describe("checkDomainStatus", () => {
  it("calls resend.domains.get with the domainId and returns mapped status", async () => {
    const mockRecords = [
      { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.us-east-1.amazonses.com", ttl: "Auto", status: "verified", priority: 10 },
      { record: "SPF", name: "send", type: "TXT", value: '"v=spf1 include:amazonses.com ~all"', ttl: "Auto", status: "verified" },
      { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIG...", ttl: "Auto", status: "verified" },
    ];
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "dom_123",
            name: "news.example.com",
            status: "verified",
            created_at: "2026-06-10T00:00:00Z",
            region: "us-east-1",
            records: mockRecords,
          },
          error: null,
        }),
      },
    } as unknown as Resend);

    const result = await checkDomainStatus(resend, "dom_123");

    expect(resend.domains.get).toHaveBeenCalledWith("dom_123");
    expect(result.status).toBe("verified");
    expect(result.records).toHaveLength(3);
    expect(result.records[0].status).toBe("verified");
  });

  it("returns failed status with reasons when Resend status is failed", async () => {
    const failedRecords = [
      { record: "SPF", name: "send", type: "MX", value: "...", ttl: "Auto", status: "failed", priority: 10 },
      { record: "SPF", name: "send", type: "TXT", value: "...", ttl: "Auto", status: "verified" },
      { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "...", ttl: "Auto", status: "failed" },
    ];
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "dom_123",
            name: "news.example.com",
            status: "failed",
            created_at: "2026-06-10T00:00:00Z",
            region: "us-east-1",
            records: failedRecords,
          },
          error: null,
        }),
      },
    } as unknown as Resend);

    const result = await checkDomainStatus(resend, "dom_123");

    expect(result.status).toBe("failed");
    expect(result.failureReasons).toBeDefined();
    expect(result.failureReasons!.length).toBe(2); // Two records failed
  });

  it("throws when Resend returns an error", async () => {
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Domain not found", statusCode: 404, name: "not_found" },
        }),
      },
    } as unknown as Resend);

    await expect(checkDomainStatus(resend, "not-a-domain")).rejects.toThrow(
      "Domain not found",
    );
  });

  it("maps partially_verified to pending", async () => {
    const resend = makeMockResend({
      domains: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "dom_1",
            name: "dom.com",
            status: "partially_verified",
            created_at: "2026-01-01",
            region: "us-east-1",
            records: [],
          },
          error: null,
        }),
      },
    } as unknown as Resend);

    const result = await checkDomainStatus(resend, "dom_1");
    expect(result.status).toBe("pending");
  });
});
