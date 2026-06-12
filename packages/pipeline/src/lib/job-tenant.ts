import { TENANT_ZERO_ID } from "@newsletter/shared/constants";

/**
 * Derive the owning tenant for a BullMQ job at the worker boundary.
 * Transitional (REQ-061): in-flight legacy jobs carry no tenantId — they
 * belong to tenant 0. Phase 6 threads tenantId into every job payload.
 */
export function jobTenantId(data: unknown): string {
  if (typeof data === "object" && data !== null && "tenantId" in data) {
    const tenantId = (data as { tenantId?: unknown }).tenantId;
    if (typeof tenantId === "string" && tenantId !== "") return tenantId;
  }
  return TENANT_ZERO_ID;
}
