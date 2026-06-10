export type Role = "super_admin" | "tenant_admin";

export interface TenantContext {
  tenantId: string;
  userId?: string;
  role: Role;
  impersonating?: boolean;
}

export const AGENTLOOP_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export function agentloopContext(): TenantContext {
  return { tenantId: AGENTLOOP_TENANT_ID, role: "tenant_admin" };
}

export function systemContext(tenantId: string): TenantContext {
  return { tenantId, role: "tenant_admin" };
}
