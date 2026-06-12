import { describe, it, expect } from "vitest";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { jobTenantId } from "@pipeline/lib/job-tenant.js";

describe("jobTenantId", () => {
  it("returns the payload tenantId when present", () => {
    const tenantId = "aaaaaaaa-0000-0000-0000-000000000042";
    expect(jobTenantId({ runId: "r", tenantId })).toBe(tenantId);
  });

  it("falls back to TENANT_ZERO_ID for legacy payloads without tenantId", () => {
    expect(jobTenantId({ runId: "r" })).toBe(TENANT_ZERO_ID);
  });

  it("falls back for non-object, null, empty-string, and non-string tenantId", () => {
    expect(jobTenantId(undefined)).toBe(TENANT_ZERO_ID);
    expect(jobTenantId(null)).toBe(TENANT_ZERO_ID);
    expect(jobTenantId({ tenantId: "" })).toBe(TENANT_ZERO_ID);
    expect(jobTenantId({ tenantId: 7 })).toBe(TENANT_ZERO_ID);
  });
});
