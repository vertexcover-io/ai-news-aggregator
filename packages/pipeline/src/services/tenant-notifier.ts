import {
  createSlackNotifier,
  postToWebhook,
  buildCollectorHealthMessage,
} from "@newsletter/shared";
import type { createLogger } from "@newsletter/shared/logger";
import type {
  SlackNotifier,
  NotifierArchiveAccess,
  NotifierArchiveView,
  NotifierTopRankedTitle,
} from "@newsletter/shared";
import type { NotificationKey } from "@newsletter/shared/types";
import type { CollectorHealthTrigger, HealthCheckCollector } from "@newsletter/shared/types";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { NotificationSettingsRepo } from "@pipeline/repositories/user-settings.js";
import { createEmailProvider } from "@pipeline/lib/email-provider.js";

export interface RunCrashedInput {
  runId: string;
  stage: string;
  error: string;
}

export interface CollectorFailuresInput {
  failures: { collector: HealthCheckCollector; reason: string }[];
  trigger: CollectorHealthTrigger;
}

export interface TenantNotifier extends SlackNotifier {
  notifyRunCrashed(input: RunCrashedInput): Promise<void>;
  notifyCollectorFailures(input: CollectorFailuresInput): Promise<void>;
}

export type NotificationEmailClient = (input: {
  to: string;
  subject: string;
  text: string;
}) => Promise<void>;

export type SlackPostFn = typeof postToWebhook;

type Logger = ReturnType<typeof createLogger>;

export interface TenantNotifierDeps {
  tenantId: string;
  settingsRepo: NotificationSettingsRepo;
  cipher: Pick<CredentialCipher, "decrypt">;
  archives: NotifierArchiveAccess;
  resolveTopRankedTitle: NotifierTopRankedTitle;
  logger: Logger;
  emailClient: NotificationEmailClient;
  /** Slack webhook poster for the notifier's own messages (run-crash, collector failures). */
  slackClient?: SlackPostFn;
  /** Slack channel factory for the standard notify* surface; defaults to createSlackNotifier. */
  createSlackChannel?: (webhookUrl: string) => SlackNotifier;
  env?: NodeJS.ProcessEnv;
  publicArchiveBaseUrl?: string;
  now?: () => Date;
}

interface ResolvedChannels {
  email: string | null;
  webhookUrl: string | null;
  slack: SlackNotifier | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createTenantNotifier(deps: TenantNotifierDeps): TenantNotifier {
  const log = deps.logger;
  const env = deps.env ?? process.env;
  const slackPost = deps.slackClient ?? postToWebhook;
  const nowFn = deps.now ?? ((): Date => new Date());

  const buildSlackChannel =
    deps.createSlackChannel ??
    ((webhookUrl: string): SlackNotifier =>
      createSlackNotifier({
        webhookUrl,
        archives: deps.archives,
        resolveTopRankedTitle: deps.resolveTopRankedTitle,
        logger: log,
        publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
        now: deps.now,
      }));

  let resolved: Promise<ResolvedChannels> | null = null;

  const doResolve = async (): Promise<ResolvedChannels> => {
    let email: string | null = null;
    let webhookUrl: string | null = null;
    try {
      const settings = await deps.settingsRepo.get();
      email = settings?.notificationEmail ?? null;
      if (settings?.slackWebhookEncrypted) {
        try {
          webhookUrl = deps.cipher.decrypt(settings.slackWebhookEncrypted);
        } catch (err) {
          log.warn(
            { event: "notify.webhook_decrypt_failed", tenantId: deps.tenantId, error: errorMessage(err) },
            "failed to decrypt slack webhook — slack channel disabled",
          );
        }
      }
    } catch (err) {
      log.warn(
        { event: "notify.settings_resolve_failed", tenantId: deps.tenantId, error: errorMessage(err) },
        "failed to resolve notification settings — notifications disabled for this job",
      );
    }
    // NF3 transitional fallback: tenant 0 without a configured webhook keeps
    // the legacy env-driven Slack behavior.
    if (webhookUrl === null && deps.tenantId === TENANT_ZERO_ID) {
      const envUrl = env.SLACK_WEBHOOK_URL;
      if (envUrl !== undefined && envUrl !== "") webhookUrl = envUrl;
    }
    return {
      email,
      webhookUrl,
      slack: webhookUrl !== null ? buildSlackChannel(webhookUrl) : null,
    };
  };

  const resolve = (): Promise<ResolvedChannels> => (resolved ??= doResolve());

  const viaSlack = async (fn: (slack: SlackNotifier) => Promise<void>): Promise<void> => {
    const { slack } = await resolve();
    if (slack === null) return;
    await fn(slack);
  };

  // Run-scoped email with the notification_state marker pattern: skip missing
  // archives, dry runs, and already-notified keys; never mark on failure.
  const emailWithMarker = async (input: {
    runId: string;
    key: NotificationKey;
    event: string;
    compose: (archive: NotifierArchiveView) => { subject: string; text: string };
  }): Promise<void> => {
    const { email } = await resolve();
    if (email === null) return;
    try {
      const archive = await deps.archives.findById(input.runId);
      if (archive === null) {
        log.warn(
          { event: `${input.event}.archive_missing`, runId: input.runId },
          "archive not found for email notification",
        );
        return;
      }
      if (archive.isDryRun) {
        log.info(
          { event: "publish.skipped_dry_run", runId: input.runId, channel: "notification-email" },
          "email notification skipped (dry-run archive)",
        );
        return;
      }
      if (archive.notificationState?.[input.key] !== undefined) {
        log.info(
          { event: `${input.event}.skipped`, reason: "already_notified", runId: input.runId },
          "email notification skipped (already notified)",
        );
        return;
      }
      const { subject, text } = input.compose(archive);
      await deps.emailClient({ to: email, subject, text });
      await deps.archives.markNotification(input.runId, input.key, nowFn());
      log.info({ event: `${input.event}.sent`, runId: input.runId }, "email notification sent");
    } catch (err) {
      log.warn(
        { event: `${input.event}.failed`, runId: input.runId, error: errorMessage(err) },
        "email notification failed",
      );
    }
  };

  // Run-scoped slack post (for events the shared SlackNotifier has no method
  // for) with the same marker pattern.
  const slackWithMarker = async (input: {
    runId: string;
    key: NotificationKey;
    event: string;
    blocks: unknown[];
  }): Promise<void> => {
    const { webhookUrl } = await resolve();
    if (webhookUrl === null) return;
    try {
      const archive = await deps.archives.findById(input.runId);
      if (archive === null) {
        log.warn(
          { event: `${input.event}.archive_missing`, runId: input.runId },
          "archive not found for slack notification",
        );
        return;
      }
      if (archive.isDryRun) {
        log.info(
          { event: "publish.skipped_dry_run", runId: input.runId, channel: "slack" },
          "slack notification skipped (dry-run archive)",
        );
        return;
      }
      if (archive.notificationState?.[input.key] !== undefined) {
        log.info(
          { event: `${input.event}.skipped`, reason: "already_notified", runId: input.runId },
          "slack notification skipped (already notified)",
        );
        return;
      }
      const result = await slackPost({ url: webhookUrl, blocks: input.blocks });
      if (!result.ok) {
        log.warn(
          { event: `${input.event}.failed`, runId: input.runId, status: result.status, responseBody: result.error },
          "slack notification failed",
        );
        return;
      }
      await deps.archives.markNotification(input.runId, input.key, nowFn());
      log.info({ event: `${input.event}.sent`, runId: input.runId }, "slack notification sent");
    } catch (err) {
      log.warn(
        { event: `${input.event}.failed`, runId: input.runId, error: errorMessage(err) },
        "slack notification threw unexpectedly",
      );
    }
  };

  const reviewLink = (runId: string): string | null =>
    deps.publicArchiveBaseUrl !== undefined && deps.publicArchiveBaseUrl !== ""
      ? `${deps.publicArchiveBaseUrl.replace(/\/$/, "")}/admin/review/${runId}`
      : null;

  return {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- pass-through for the deprecated legacy method, required by the SlackNotifier interface
    notifyNewsletterSent: (i) => viaSlack((s) => s.notifyNewsletterSent(i)),
    notifyReviewWarning: (i) => viaSlack((s) => s.notifyReviewWarning(i)),
    notifyPublishFailed: (i) => viaSlack((s) => s.notifyPublishFailed(i)),
    notifyPublishUnavailable: (i) =>
      viaSlack((s) => s.notifyPublishUnavailable?.(i) ?? Promise.resolve()),
    notifySourceDistribution: (i) => viaSlack((s) => s.notifySourceDistribution(i)),
    notifyEmailDelivery: (i) => viaSlack((s) => s.notifyEmailDelivery(i)),
    notifyLinkedinPosted: (i) => viaSlack((s) => s.notifyLinkedinPosted(i)),
    notifyTwitterPosted: (i) => viaSlack((s) => s.notifyTwitterPosted(i)),
    notifySubscriberConfirmed: (i) => viaSlack((s) => s.notifySubscriberConfirmed(i)),
    notifySubscriberRemoved: (i) => viaSlack((s) => s.notifySubscriberRemoved(i)),
    notifyFeedbackReceived: (i) => viaSlack((s) => s.notifyFeedbackReceived(i)),

    async notifyReviewPending(input: { runId: string }): Promise<void> {
      await viaSlack((s) => s.notifyReviewPending(input));
      await emailWithMarker({
        runId: input.runId,
        key: "reviewPendingEmail",
        event: "email.review_pending",
        compose: (archive) => {
          const link = reviewLink(input.runId);
          return {
            subject: `Review ready: ${archive.digestHeadline ?? input.runId}`,
            text: [
              `A new digest is ready for review.`,
              `Run: ${input.runId}`,
              ...(archive.digestHeadline !== null ? [`Headline: ${archive.digestHeadline}`] : []),
              ...(link !== null ? [`Review it at: ${link}`] : []),
            ].join("\n"),
          };
        },
      });
    },

    async notifyRunCrashed(input: RunCrashedInput): Promise<void> {
      const text = `:rotating_light: *Run crashed* — \`${input.runId}\`\nStage: ${input.stage}\nError: ${input.error}`;
      await slackWithMarker({
        runId: input.runId,
        key: "runCrashed",
        event: "slack.run_crashed",
        blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      });
      await emailWithMarker({
        runId: input.runId,
        key: "runCrashedEmail",
        event: "email.run_crashed",
        compose: () => ({
          subject: `Run crashed: ${input.runId}`,
          text: [
            `A pipeline run crashed.`,
            `Run: ${input.runId}`,
            `Stage: ${input.stage}`,
            `Error: ${input.error}`,
          ].join("\n"),
        }),
      });
    },

    async notifyCollectorFailures(input: CollectorFailuresInput): Promise<void> {
      if (input.failures.length === 0) return;
      const { email, webhookUrl } = await resolve();
      if (webhookUrl !== null) {
        try {
          const { blocks } = buildCollectorHealthMessage(input);
          const result = await slackPost({ url: webhookUrl, blocks });
          if (!result.ok) {
            log.warn(
              { event: "slack.collector_health.failed", status: result.status, responseBody: result.error },
              "collector health slack alert failed",
            );
          }
        } catch (err) {
          log.warn(
            { event: "slack.collector_health.failed", error: errorMessage(err) },
            "collector health slack alert failed",
          );
        }
      }
      if (email !== null) {
        try {
          await deps.emailClient({
            to: email,
            subject: `Collector health check failed (${input.trigger})`,
            text: input.failures.map((f) => `${f.collector}: ${f.reason}`).join("\n"),
          });
        } catch (err) {
          log.warn(
            { event: "email.collector_health.failed", error: errorMessage(err) },
            "collector health email alert failed",
          );
        }
      }
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Default email channel: sends plain-text alerts via the configured email provider. */
export function createDefaultNotificationEmailClient(
  env: NodeJS.ProcessEnv = process.env,
): NotificationEmailClient {
  const provider = createEmailProvider();
  const from = env.FROM_MAIL ?? "newsletter@news.vertexcover.io";
  return async ({ to, subject, text }): Promise<void> => {
    await provider.send({
      to: [to],
      from,
      subject,
      text,
      html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(text)}</pre>`,
    });
  };
}
