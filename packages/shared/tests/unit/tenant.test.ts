import { describe, expect, it } from "vitest";
import { RESERVED_TENANT_SLUGS, isReservedTenantSlug } from "@shared/constants/tenant.js";
import type { Tenant, User } from "@shared/types/tenant.js";

// EDGE-003 foundation — the reserved-slug blocklist consumed by slug
// validation in P5/P11. Full validation (format + uniqueness) lands later;
// this guards the blocklist contract itself.
describe("constants: reserved tenant slugs (EDGE-003)", () => {
  it.each(["www", "api", "admin", "agentloop"])("blocks reserved slug %s", (slug) => {
    expect(isReservedTenantSlug(slug)).toBe(true);
  });

  it("blocks reserved slugs case-insensitively (slugs are lowercase, defend anyway)", () => {
    expect(isReservedTenantSlug("Admin")).toBe(true);
    expect(isReservedTenantSlug("WWW")).toBe(true);
  });

  it("allows non-reserved slugs", () => {
    expect(isReservedTenantSlug("acme-ai-digest")).toBe(false);
  });

  it("contains only valid lowercase alphanumeric+hyphen entries (REQ-033 format)", () => {
    for (const slug of RESERVED_TENANT_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("types: tenant wire contracts", () => {
  it("Tenant accepts a pending_setup tenant with empty branding", () => {
    const tenant: Tenant = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      slug: "acme",
      name: "Acme AI Digest",
      status: "pending_setup",
      customDomain: null,
      headline: null,
      topicStrip: null,
      subtagline: null,
      logoContentType: null,
      featureCanon: false,
      featureDeliverability: false,
      featureEval: false,
      onboardingState: { currentStep: "branding", completedSteps: ["name", "slug"] },
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    };
    expect(tenant.status).toBe("pending_setup");
  });

  it("User accepts a super_admin with null tenantId", () => {
    const user: User = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      tenantId: null,
      email: "root@example.com",
      name: "Root",
      role: "super_admin",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    };
    expect(user.tenantId).toBeNull();
  });
});
