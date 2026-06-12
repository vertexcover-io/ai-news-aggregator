/**
 * Phase 7: broadcast sender + branding resolution (REQ-053, EDGE-006, NF3).
 */
import { describe, it, expect } from "vitest";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import {
  resolveBroadcastSender,
  resolveEmailBranding,
  tenantPublicBaseUrl,
} from "@pipeline/services/email-broadcast.js";
import type { PipelineSendingDomainsRepo } from "@pipeline/repositories/sending-domains.js";
import type { PipelineTenantsRepo } from "@pipeline/repositories/tenants.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const ENV_FROM = "newsletter@news.vertexcover.io";

function domainsRepo(
  row: { domain: string; status: "pending" | "verified" | "failed" } | null,
): PipelineSendingDomainsRepo {
  return { get: () => Promise.resolve(row) };
}

function tenantsRepo(
  row: { id: string; name: string; slug?: string } | null,
): PipelineTenantsRepo {
  return {
    findById: () =>
      Promise.resolve(row === null ? null : { slug: "acme", ...row }),
  };
}

describe("resolveBroadcastSender", () => {
  it("verified domain → sends from newsletter@<domain>", async () => {
    const sender = await resolveBroadcastSender({
      tenantId: TENANT_A,
      sendingDomainsRepo: domainsRepo({ domain: "acme.com", status: "verified" }),
      envFromMail: ENV_FROM,
    });
    expect(sender).toEqual({ kind: "send", from: "newsletter@acme.com" });
  });

  it("honors a custom from local part", async () => {
    const sender = await resolveBroadcastSender({
      tenantId: TENANT_A,
      sendingDomainsRepo: domainsRepo({ domain: "acme.com", status: "verified" }),
      envFromMail: ENV_FROM,
      fromLocalPart: "digest",
    });
    expect(sender).toEqual({ kind: "send", from: "digest@acme.com" });
  });

  it("no row, regular tenant → blocked with no_sending_domain (EDGE-006)", async () => {
    const sender = await resolveBroadcastSender({
      tenantId: TENANT_A,
      sendingDomainsRepo: domainsRepo(null),
      envFromMail: ENV_FROM,
    });
    expect(sender).toEqual({ kind: "blocked", reason: "no_sending_domain" });
  });

  it("no row, tenant 0 → env FROM_MAIL fallback (NF3)", async () => {
    const sender = await resolveBroadcastSender({
      tenantId: TENANT_ZERO_ID,
      sendingDomainsRepo: domainsRepo(null),
      envFromMail: ENV_FROM,
    });
    expect(sender).toEqual({ kind: "send", from: ENV_FROM });
  });

  it.each(["pending", "failed"] as const)(
    "%s row → blocked with sending_domain_not_verified (even for tenant 0)",
    async (status) => {
      for (const tenantId of [TENANT_A, TENANT_ZERO_ID]) {
        const sender = await resolveBroadcastSender({
          tenantId,
          sendingDomainsRepo: domainsRepo({ domain: "acme.com", status }),
          envFromMail: ENV_FROM,
        });
        expect(sender).toEqual({
          kind: "blocked",
          reason: "sending_domain_not_verified",
        });
      }
    },
  );
});

describe("resolveEmailBranding", () => {
  it("tenant 0 → undefined (AGENTLOOP template defaults, NF3)", async () => {
    const branding = await resolveEmailBranding({
      tenantId: TENANT_ZERO_ID,
      tenantsRepo: tenantsRepo({ id: TENANT_ZERO_ID, name: "AGENTLOOP" }),
    });
    expect(branding).toBeUndefined();
  });

  it("regular tenant → branding from the tenant name", async () => {
    const branding = await resolveEmailBranding({
      tenantId: TENANT_A,
      tenantsRepo: tenantsRepo({ id: TENANT_A, name: "Acme AI Weekly" }),
    });
    expect(branding).toEqual({ name: "Acme AI Weekly" });
  });

  it("missing tenant row → undefined", async () => {
    const branding = await resolveEmailBranding({
      tenantId: TENANT_A,
      tenantsRepo: tenantsRepo(null),
    });
    expect(branding).toBeUndefined();
  });
});

describe("tenantPublicBaseUrl", () => {
  it("regular tenant → https://<slug>.<APP_ROOT_DOMAIN> (F14)", () => {
    expect(
      tenantPublicBaseUrl({
        tenantId: TENANT_A,
        tenant: { slug: "acme" },
        env: { APP_ROOT_DOMAIN: "ourdomain.com" },
      }),
    ).toBe("https://acme.ourdomain.com");
  });

  it("defaults the root domain to lvh.me (dev parity with the API host resolver)", () => {
    expect(
      tenantPublicBaseUrl({ tenantId: TENANT_A, tenant: { slug: "acme" }, env: {} }),
    ).toBe("https://acme.lvh.me");
  });

  it("tenant 0 → null so the env-configured base URL stays in charge (NF3)", () => {
    expect(
      tenantPublicBaseUrl({
        tenantId: TENANT_ZERO_ID,
        tenant: { slug: "agentloop" },
        env: { APP_ROOT_DOMAIN: "ourdomain.com" },
      }),
    ).toBeNull();
  });

  it("missing tenant row → null (legacy env fallback, never a broken host)", () => {
    expect(
      tenantPublicBaseUrl({
        tenantId: TENANT_A,
        tenant: null,
        env: { APP_ROOT_DOMAIN: "ourdomain.com" },
      }),
    ).toBeNull();
  });
});
