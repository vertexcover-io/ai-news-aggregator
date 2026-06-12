/**
 * Phase 7: Resend domains client mapping (REQ-084/085). No live Resend calls —
 * the structural ResendDomainsApi is faked and the normalization to
 * {resendDomainId, status, dnsRecords, failureReason} is asserted directly.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createResendDomainsClient,
  mapDomainStatus,
  ResendDomainsError,
  toDomainState,
  type ResendDomainsApi,
} from "@api/lib/email/resend-domains.js";

const RAW_RECORDS = [
  { record: "SPF", name: "send.acme.com", type: "TXT", value: "v=spf1 ...", status: "pending", ttl: "Auto" },
  { record: "DKIM", name: "resend._domainkey.acme.com", type: "TXT", value: "p=MIGf...", status: "pending", ttl: "Auto" },
];

function makeApi(overrides: Partial<ResendDomainsApi> = {}): ResendDomainsApi {
  return {
    create: vi.fn(() =>
      Promise.resolve({
        data: { id: "rd-1", status: "not_started", records: RAW_RECORDS },
        error: null,
      }),
    ),
    get: vi.fn(() =>
      Promise.resolve({
        data: { id: "rd-1", status: "verified", records: RAW_RECORDS.map((r) => ({ ...r, status: "verified" })) },
        error: null,
      }),
    ),
    verify: vi.fn(() => Promise.resolve({ data: { id: "rd-1" }, error: null })),
    ...overrides,
  };
}

describe("mapDomainStatus", () => {
  it.each([
    ["verified", "verified"],
    ["failed", "failed"],
    ["partially_failed", "failed"],
    ["pending", "pending"],
    ["not_started", "pending"],
    ["partially_verified", "pending"],
  ])("maps Resend %s → %s", (resendStatus, expected) => {
    expect(mapDomainStatus(resendStatus)).toBe(expected);
  });
});

describe("toDomainState", () => {
  it("normalizes records and strips Resend-only fields", () => {
    const state = toDomainState({ id: "rd-1", status: "pending", records: RAW_RECORDS });
    expect(state).toEqual({
      resendDomainId: "rd-1",
      status: "pending",
      dnsRecords: [
        { record: "SPF", name: "send.acme.com", type: "TXT", value: "v=spf1 ...", status: "pending" },
        { record: "DKIM", name: "resend._domainkey.acme.com", type: "TXT", value: "p=MIGf...", status: "pending" },
      ],
      failureReason: null,
    });
  });

  it("derives a failure reason from failing records when the domain failed", () => {
    const state = toDomainState({
      id: "rd-1",
      status: "failed",
      records: [
        { ...RAW_RECORDS[0], status: "failed" },
        { ...RAW_RECORDS[1], status: "verified" },
      ],
    });
    expect(state.status).toBe("failed");
    expect(state.failureReason).toBe("SPF record (TXT send.acme.com): failed");
  });

  it("falls back to a generic reason when no record reports a failure", () => {
    const state = toDomainState({ id: "rd-1", status: "failed", records: [] });
    expect(state.failureReason).toBe("Domain verification failed");
  });

  it("keeps failureReason null when not failed even if a record is pending", () => {
    const state = toDomainState({ id: "rd-1", status: "pending", records: RAW_RECORDS });
    expect(state.failureReason).toBeNull();
  });
});

describe("createResendDomainsClient", () => {
  it("register() creates the domain and returns its DNS state", async () => {
    const api = makeApi();
    const client = createResendDomainsClient(api);
    const state = await client.register("acme.com");
    expect(api.create).toHaveBeenCalledWith({ name: "acme.com" });
    expect(state.resendDomainId).toBe("rd-1");
    expect(state.status).toBe("pending");
    expect(state.dnsRecords).toHaveLength(2);
  });

  it("check() triggers verify then reads the refreshed domain", async () => {
    const api = makeApi();
    const client = createResendDomainsClient(api);
    const state = await client.check("rd-1");
    expect(api.verify).toHaveBeenCalledWith("rd-1");
    expect(api.get).toHaveBeenCalledWith("rd-1");
    expect(state.status).toBe("verified");
  });

  it("throws ResendDomainsError on an error response", async () => {
    const api = makeApi({
      create: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: "quota exceeded" } }),
      ),
    });
    const client = createResendDomainsClient(api);
    await expect(client.register("acme.com")).rejects.toThrow(ResendDomainsError);
    await expect(client.register("acme.com")).rejects.toThrow(/quota exceeded/);
  });
});
