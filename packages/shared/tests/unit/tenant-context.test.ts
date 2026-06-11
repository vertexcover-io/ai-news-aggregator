import { describe, expect, it } from "vitest";
import type { TenantContext, UserRole } from "@shared/types/tenant-context.js";
import { BOOTSTRAP_TENANT_ID } from "@shared/types/tenant-context.js";

describe("TenantContext", () => {
  it("has the correct shape with all required fields", () => {
    const ctx: TenantContext = {
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      role: "tenant_admin",
    };
    expect(ctx.tenantId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(ctx.role).toBe("tenant_admin");
    expect(ctx.userId).toBeUndefined();
    expect(ctx.impersonating).toBeUndefined();
  });

  it("accepts optional userId and impersonating", () => {
    const ctx: TenantContext = {
      tenantId: "550e8400-e29b-41d4-a716-446655440001",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      role: "super_admin",
      impersonating: true,
    };
    expect(ctx.userId).toBe("660e8400-e29b-41d4-a716-446655440000");
    expect(ctx.role).toBe("super_admin");
    expect(ctx.impersonating).toBe(true);
  });

  it("role must be UserRole", () => {
    const role: UserRole = "tenant_admin";
    expect(role).toBe("tenant_admin");
    const role2: UserRole = "super_admin";
    expect(role2).toBe("super_admin");
  });
});

describe("BOOTSTRAP_TENANT_ID", () => {
  it("is the nil UUID string", () => {
    expect(BOOTSTRAP_TENANT_ID).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("is a valid UUID format", () => {
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(UUID_RE.test(BOOTSTRAP_TENANT_ID)).toBe(true);
  });

  it("is exported as a const, not a type", () => {
    // BOOTSTRAP_TENANT_ID should be importable as a value (string constant)
    const val: string = BOOTSTRAP_TENANT_ID;
    expect(val).toBe("00000000-0000-0000-0000-000000000000");
  });
});
