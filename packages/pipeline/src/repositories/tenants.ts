/**
 * Pipeline-side tenant reads (P14, REQ-053): the email-send worker consults
 * the JOB tenant's sending-domain status to gate the subscriber broadcast.
 */
import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { isTenantContext, type TenantScope } from "@newsletter/shared/types/tenant-context";
import { getCredentialCipher } from "@newsletter/shared/services";
import type {
  SendingDomainStatus,
  TenantEmailSettings,
} from "@newsletter/shared/types/tenant";

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
   * Slug of the scoped tenant (Fix #3): the managed-default broadcast sender
   * is `<slug>@<MANAGED_EMAIL_DOMAIN>` on our shared, pre-verified Resend
   * domain — so a tenant with no own verified sending domain still sends
   * (zero-config). `null` when the scope carries no concrete tenant.
   */
  getSlug(): Promise<string | null>;
  /**
   * Resolved email config for the broadcast send path (Fix #3, Phase B):
   * mode + DECRYPTED SMTP (smtp mode only) + sending-domain state + slug, so
   * the worker can pick the provider and FROM address per mode. `null` when
   * the scope carries no concrete tenant.
   */
  getEmailSettings(): Promise<TenantEmailSettings | null>;
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

    async getSlug(): Promise<string | null> {
      if (!isTenantContext(ctx)) return null;
      const rows = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      return rows[0]?.slug ?? null;
    },

    async getEmailSettings(): Promise<TenantEmailSettings | null> {
      if (!isTenantContext(ctx)) return null;
      const rows = await db
        .select({
          mode: tenants.emailMode,
          smtpConfigEnc: tenants.smtpConfigEnc,
          sendingDomainName: tenants.sendingDomainName,
          sendingDomainStatus: tenants.sendingDomainStatus,
          slug: tenants.slug,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      // `for...of` (not `rows[0]` + guard): with noUncheckedIndexedAccess off
      // an index guard reads as "always truthy" to the linter; iterating is the
      // lint-clean way to handle the 0-or-1-row case.
      for (const row of rows) {
        let smtp: TenantEmailSettings["smtp"] = null;
        if (row.mode === "smtp" && row.smtpConfigEnc !== null) {
          const cipher = getCredentialCipher();
          const enc = row.smtpConfigEnc;
          smtp = {
            host: enc.host,
            port: enc.port,
            secure: enc.secure,
            fromAddress: enc.fromAddress,
            fromName: enc.fromName,
            username: cipher.decrypt(enc.username),
            password: cipher.decrypt(enc.password),
          };
        }
        return {
          mode: row.mode,
          smtp,
          sendingDomainName: row.sendingDomainName,
          sendingDomainStatus: row.sendingDomainStatus,
          slug: row.slug,
        };
      }
      return null;
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
