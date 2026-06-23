/**
 * Per-tenant notification channel resolution (P16, REQ-090–092).
 *
 * Replaces the single global SLACK_WEBHOOK_URL for review-ready and error
 * alerts: the JOB tenant's stored config wins; a tenant without a stored
 * webhook (and legacy jobs with no tenant scope) falls back to the global
 * env webhook so the single-tenant AGENTLOOP deployment keeps behaving
 * exactly as before this phase.
 *
 * The stored webhook is the D-012 ciphertext — it is decrypted here, per
 * job, at send time; plaintext never persists anywhere. Corrupt ciphertext
 * disables the Slack channel for that tenant (NO global fallback — a broken
 * tenant secret must not leak that tenant's alerts to the platform Slack).
 */
import type {
  CredentialCipher,
  EncryptedBlob,
} from "@newsletter/shared/services/credential-cipher";
import type { TenantNotificationSettingsRow } from "@pipeline/repositories/tenants.js";

export interface TenantNotificationChannels {
  /** Webhook to post to; undefined = Slack channel off. */
  slackWebhookUrl: string | undefined;
  /** Address for email notifications; undefined = email channel off. */
  notifyEmail: string | undefined;
  /** Review-ready alert toggle (REQ-090). */
  notifyReviewReady: boolean;
  /** Collector-failure / run-crash alert toggle (REQ-091). */
  notifyErrors: boolean;
}

export interface ResolveChannelsDeps {
  tenantsRepo: {
    getNotificationSettings(): Promise<TenantNotificationSettingsRow | null>;
  };
  cipher: CredentialCipher;
  env?: NodeJS.ProcessEnv;
  logger?: { warn(fields: Record<string, unknown>, msg: string): void };
}

export async function resolveTenantNotificationChannels(
  deps: ResolveChannelsDeps,
): Promise<TenantNotificationChannels> {
  const env = deps.env ?? process.env;
  const globalWebhook =
    env.SLACK_WEBHOOK_URL === "" ? undefined : env.SLACK_WEBHOOK_URL;

  const row = await deps.tenantsRepo.getNotificationSettings();
  if (row === null) {
    return {
      slackWebhookUrl: globalWebhook,
      notifyEmail: undefined,
      notifyReviewReady: true,
      notifyErrors: true,
    };
  }

  let slackWebhookUrl: string | undefined;
  if (row.slackWebhook === null) {
    slackWebhookUrl = globalWebhook;
  } else {
    try {
      slackWebhookUrl = deps.cipher.decrypt(
        JSON.parse(row.slackWebhook) as EncryptedBlob,
      );
    } catch (err) {
      deps.logger?.warn(
        {
          event: "tenant_notify.webhook_decrypt_failed",
          error: err instanceof Error ? err.message : String(err),
        },
        "tenant slack webhook ciphertext is unreadable — slack channel disabled for this job",
      );
      slackWebhookUrl = undefined;
    }
  }

  return {
    slackWebhookUrl,
    notifyEmail: row.notifyEmail ?? undefined,
    notifyReviewReady: row.notifyReviewReady,
    notifyErrors: row.notifyErrors,
  };
}
