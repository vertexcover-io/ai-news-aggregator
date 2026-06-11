/**
 * Pipeline-side tenant reads (P14, REQ-053): the email-send worker consults
 * the JOB tenant's sending-domain status to gate the subscriber broadcast.
 */
import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { isTenantContext, type TenantScope } from "@newsletter/shared/types/tenant-context";
import type { SendingDomainStatus } from "@newsletter/shared/types/tenant";

export interface PipelineTenantsRepo {
  /**
   * Sending-domain status of the scoped tenant; `null` when the tenant never
   * registered a domain (the broadcast gate treats that as not verified,
   * EDGE-006) or when the scope carries no concrete tenant.
   */
  getSendingDomainStatus(): Promise<SendingDomainStatus | null>;
  /**
   * Verified sending-domain NAME of the scoped tenant (REQ-084 follow-
   * through): the broadcast FROM address becomes `newsletter@<name>`. `null`
   * when the tenant never registered a domain — notably the grandfathered
   * tenant 0, whose status is `verified` with no name, so its broadcasts
   * keep the shared platform sender exactly as before multi-tenancy.
   */
  getSendingDomainName(): Promise<string | null>;
  /**
   * Notification config of the scoped tenant (P16, REQ-090–092).
   * `slackWebhook` is the D-012 CIPHERTEXT — decryption happens in
   * services/tenant-notify.ts, never here. `null` when the scope carries no
   * concrete tenant (legacy jobs → global SLACK_WEBHOOK_URL fallback).
   */
  getNotificationSettings(): Promise<TenantNotificationSettingsRow | null>;
}

export interface TenantNotificationSettingsRow {
  notifyEmail: string | null;
  /** JSON-serialized EncryptedBlob ciphertext, or null when unset. */
  slackWebhook: string | null;
  notifyReviewReady: boolean;
  notifyErrors: boolean;
}

export function createPipelineTenantsRepo(
  db: Pick<AppDb, "select">,
  ctx?: TenantScope,
): PipelineTenantsRepo {
  return {
    async getSendingDomainStatus(): Promise<SendingDomainStatus | null> {
      if (!isTenantContext(ctx)) return null;
      const rows = await db
        .select({ status: tenants.sendingDomainStatus })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      return rows[0]?.status ?? null;
    },

    async getSendingDomainName(): Promise<string | null> {
      if (!isTenantContext(ctx)) return null;
      const rows = await db
        .select({ name: tenants.sendingDomainName })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      return rows[0]?.name ?? null;
    },

    async getNotificationSettings(): Promise<TenantNotificationSettingsRow | null> {
      if (!isTenantContext(ctx)) return null;
      const rows = await db
        .select({
          notifyEmail: tenants.notifyEmail,
          slackWebhook: tenants.slackWebhook,
          notifyReviewReady: tenants.notifyReviewReady,
          notifyErrors: tenants.notifyErrors,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
