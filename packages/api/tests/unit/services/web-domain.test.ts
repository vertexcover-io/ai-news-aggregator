/**
 * Web-domain service (Fix #3, Phase C): register → DNS record by type →
 * verify against our ingress. DNS is faked — no real lookups.
 */
import { describe, expect, it, vi } from "vitest";
import type { TenantRow } from "@newsletter/shared/db";
import {
  dnsRecordFor,
  isApex,
  registerWebDomain,
  verifyWebDomain,
  WebDomainError,
  type DnsLookupResult,
  type WebDomainServiceDeps,
} from "../../../src/services/web-domain";

function tenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: "t1",
    slug: "inference",
    status: "active",
    customDomain: null,
    customDomainStatus: null,
    customDomainVerifiedAt: null,
    ...overrides,
  } as unknown as TenantRow;
}

function makeDeps(
  initial: TenantRow,
  dns: DnsLookupResult,
): { deps: WebDomainServiceDeps; update: ReturnType<typeof vi.fn> } {
  let row = initial;
  const update = vi.fn((_id: string, patch: Record<string, unknown>) => {
    row = { ...row, ...patch } as TenantRow;
    return Promise.resolve(row);
  });
  return {
    deps: {
      tenantsRepo: {
        findById: vi.fn(() => Promise.resolve(row)),
        updateCustomDomain: update as never,
      },
      resolveDns: vi.fn(() => Promise.resolve(dns)),
      ingressHost: "ingress.vertexcover.io",
      ingressIp: "203.0.113.10",
      reservedSuffixes: ["vertexcover.io", "app.vertexcover.io"],
    },
    update,
  };
}

describe("web-domain helpers", () => {
  it("classifies apex vs subdomain", () => {
    expect(isApex("acme.com")).toBe(true);
    expect(isApex("news.acme.com")).toBe(false);
  });
  it("gives an A record for apex, CNAME for subdomain", () => {
    expect(dnsRecordFor("acme.com", "ingress.x.io", "1.2.3.4")).toEqual({
      type: "A",
      name: "acme.com",
      value: "1.2.3.4",
    });
    expect(dnsRecordFor("news.acme.com", "ingress.x.io", "1.2.3.4")).toEqual({
      type: "CNAME",
      name: "news.acme.com",
      value: "ingress.x.io",
    });
  });
});

describe("registerWebDomain", () => {
  it("stores the domain pending and returns the DNS record", async () => {
    const { deps, update } = makeDeps(tenant(), { cnames: [], addresses: [] });
    const wire = await registerWebDomain(deps, "t1", "News.Acme.com");
    expect(update).toHaveBeenCalledWith("t1", {
      customDomain: "news.acme.com",
      customDomainStatus: "pending",
      customDomainVerifiedAt: null,
    });
    expect(wire.status).toBe("pending");
    expect(wire.record).toEqual({
      type: "CNAME",
      name: "news.acme.com",
      value: "ingress.vertexcover.io",
    });
  });

  it("rejects our own infrastructure hosts", async () => {
    const { deps } = makeDeps(tenant(), { cnames: [], addresses: [] });
    await expect(registerWebDomain(deps, "t1", "evil.vertexcover.io")).rejects.toBeInstanceOf(
      WebDomainError,
    );
    await expect(registerWebDomain(deps, "t1", "vertexcover.io")).rejects.toBeInstanceOf(
      WebDomainError,
    );
  });

  it("rejects a malformed domain", async () => {
    const { deps } = makeDeps(tenant(), { cnames: [], addresses: [] });
    await expect(registerWebDomain(deps, "t1", "not a domain")).rejects.toBeInstanceOf(
      WebDomainError,
    );
  });
});

describe("verifyWebDomain", () => {
  it("marks verified when a subdomain CNAMEs our ingress", async () => {
    const { deps, update } = makeDeps(
      tenant({ customDomain: "news.acme.com", customDomainStatus: "pending" }),
      { cnames: ["ingress.vertexcover.io."], addresses: [] },
    );
    const wire = await verifyWebDomain(deps, "t1");
    expect(wire.status).toBe("verified");
    expect(update.mock.calls[0]?.[1]).toMatchObject({ customDomainStatus: "verified" });
    expect(wire.verifiedAt).not.toBeNull();
  });

  it("marks verified when an apex A-records our ingress IP", async () => {
    const { deps } = makeDeps(
      tenant({ customDomain: "acme.com", customDomainStatus: "pending" }),
      { cnames: [], addresses: ["203.0.113.10"] },
    );
    const wire = await verifyWebDomain(deps, "t1");
    expect(wire.status).toBe("verified");
  });

  it("marks failed when DNS does not point at us", async () => {
    const { deps } = makeDeps(
      tenant({ customDomain: "news.acme.com", customDomainStatus: "pending" }),
      { cnames: ["somewhere-else.example."], addresses: [] },
    );
    const wire = await verifyWebDomain(deps, "t1");
    expect(wire.status).toBe("failed");
    expect(wire.verifiedAt).toBeNull();
  });

  it("errors when no domain is registered", async () => {
    const { deps } = makeDeps(tenant(), { cnames: [], addresses: [] });
    await expect(verifyWebDomain(deps, "t1")).rejects.toBeInstanceOf(WebDomainError);
  });
});
