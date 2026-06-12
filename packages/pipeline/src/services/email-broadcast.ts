import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { PipelineSendingDomainsRepo } from "@pipeline/repositories/sending-domains.js";
import type {
  PipelineTenantRecord,
  PipelineTenantsRepo,
} from "@pipeline/repositories/tenants.js";

/** Branding threaded into email templates; undefined ⇒ AGENTLOOP defaults. */
export interface EmailBranding {
  name: string;
  logoUrl?: string;
}

export type BroadcastBlockedReason =
  | "no_sending_domain"
  | "sending_domain_not_verified";

/**
 * REQ-053/EDGE-006: a tenant may only broadcast the digest from its own
 * VERIFIED sending domain. NF3: tenant 0 with no sending_domains row keeps the
 * legacy env FROM_MAIL behavior.
 */
export type BroadcastSender =
  | { kind: "send"; from: string }
  | { kind: "blocked"; reason: BroadcastBlockedReason };

const DEFAULT_FROM_LOCAL_PART = "newsletter";

export async function resolveBroadcastSender(opts: {
  tenantId: string;
  sendingDomainsRepo: PipelineSendingDomainsRepo;
  envFromMail: string;
  /** Local part of the broadcast sender address (default "newsletter"). */
  fromLocalPart?: string;
}): Promise<BroadcastSender> {
  const row = await opts.sendingDomainsRepo.get();
  if (row === null) {
    if (opts.tenantId === TENANT_ZERO_ID) {
      return { kind: "send", from: opts.envFromMail };
    }
    return { kind: "blocked", reason: "no_sending_domain" };
  }
  if (row.status !== "verified") {
    return { kind: "blocked", reason: "sending_domain_not_verified" };
  }
  const localPart = opts.fromLocalPart ?? DEFAULT_FROM_LOCAL_PART;
  return { kind: "send", from: `${localPart}@${row.domain}` };
}

/**
 * Public host for a tenant's archive/unsubscribe links (F14/REQ-034): non-zero
 * tenants live at https://<slug>.<APP_ROOT_DOMAIN> — links built on the
 * platform host would 404 on the tenant's host-scoped public site. Returns
 * null for tenant 0 (or an unknown tenant), meaning "keep the legacy env base
 * URL" (NF3 — tenant 0's custom domain stays env-configured).
 */
export function tenantPublicBaseUrl(opts: {
  tenantId: string;
  tenant: Pick<PipelineTenantRecord, "slug"> | null;
  env: Record<string, string | undefined>;
}): string | null {
  if (opts.tenantId === TENANT_ZERO_ID) return null;
  if (opts.tenant === null) return null;
  const rootDomain = opts.env.APP_ROOT_DOMAIN ?? "lvh.me";
  return `https://${opts.tenant.slug}.${rootDomain}`;
}

/** Tenant 0 keeps the built-in AGENTLOOP template branding (NF3). */
export async function resolveEmailBranding(opts: {
  tenantId: string;
  tenantsRepo: PipelineTenantsRepo;
}): Promise<EmailBranding | undefined> {
  if (opts.tenantId === TENANT_ZERO_ID) return undefined;
  const tenant = await opts.tenantsRepo.findById(opts.tenantId);
  if (tenant === null) return undefined;
  return { name: tenant.name };
}
