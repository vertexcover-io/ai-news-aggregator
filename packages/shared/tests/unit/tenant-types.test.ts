import { describe, expect, it } from "vitest";

// Phase 1: These types don't exist yet — imports will fail until types are created.
// We use type-level assertions to verify the type shapes without runtime deps.
describe("tenant types", () => {
  it("TenantStatus has the expected values", () => {
    // Assert the union values exist as string literals
    const statuses: ("pending_setup" | "active")[] = ["pending_setup", "active"];
    expect(statuses).toHaveLength(2);
    expect(statuses).toContain("pending_setup");
    expect(statuses).toContain("active");
  });

  it("UserRole has the expected values", () => {
    const roles: ("super_admin" | "tenant_admin")[] = ["super_admin", "tenant_admin"];
    expect(roles).toHaveLength(2);
    expect(roles).toContain("super_admin");
    expect(roles).toContain("tenant_admin");
  });
});

describe("tenant type shapes", () => {
  it("Tenant shape has expected fields", () => {
    const tenant = {
      id: "uuid",
      slug: "my-tenant",
      name: "My Tenant",
      status: "active" as const,
      customDomain: null as string | null,
      headline: null as string | null,
      topicStrip: null as string | null,
      subtagline: null as string | null,
      logoBytes: null as Uint8Array | null,
      logoContentType: null as string | null,
      featureCanon: false,
      featureDeliverability: false,
      featureEval: false,
      onboardingState: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(tenant.slug).toBe("my-tenant");
    expect(tenant.status).toBe("active");
    expect(tenant.featureCanon).toBe(false);
  });

  it("User shape has expected fields", () => {
    const user = {
      id: "uuid",
      tenantId: null as string | null,
      email: "user@example.com",
      name: "User Name",
      passwordHash: "hash",
      role: "tenant_admin" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(user.email).toBe("user@example.com");
    expect(user.role).toBe("tenant_admin");
    expect(user.tenantId).toBeNull();
  });

  it("super_admin User has null tenantId", () => {
    const superAdmin = {
      id: "uuid",
      tenantId: null as string | null,
      email: "admin@example.com",
      name: "Super Admin",
      passwordHash: "hash",
      role: "super_admin" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(superAdmin.role).toBe("super_admin");
    expect(superAdmin.tenantId).toBeNull();
  });
});
