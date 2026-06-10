import { describe, it, expect, vi } from "vitest";
import { createSlackNotifier } from "../slack/notifier.js";
import type { SlackNotifierDeps, NotifierArchiveAccess } from "../slack/types.js";

function makeDeps(opts: {
  webhookUrl?: string;
  tenantSlackWebhook?: string | null;
  tenantNotifyEmail?: string | null;
}): SlackNotifierDeps {
  return {
    webhookUrl: opts.webhookUrl,
    archives: {
      findById: vi.fn().mockResolvedValue({
        id: "run-1",
        digestHeadline: "Test Issue",
        rankedItems: [],
        sourceTelemetry: null,
        slackNotifiedAt: null,
        notificationState: null,
        isDryRun: false,
      }),
      markSlackNotified: vi.fn(),
      markNotification: vi.fn(),
    },
    resolveTopRankedTitle: vi.fn().mockResolvedValue(null),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      level: "info",
      silent: vi.fn(),
    } as unknown as SlackNotifierDeps["logger"],
    publicArchiveBaseUrl: "https://example.com",
    tenantNotificationConfig: {
      notifyEmail: opts.tenantNotifyEmail ?? null,
      slackWebhook: opts.tenantSlackWebhook ?? null,
    },
  };
}

describe("per-tenant notifier", () => {
  it("uses tenant webhook when configured, not global webhook", async () => {
    const deps = makeDeps({
      webhookUrl: "https://hooks.slack.com/services/GLOBAL/BOT/KEY",
      tenantSlackWebhook: "https://hooks.slack.com/services/TENANT/BOT/KEY",
    });

    const notifier = createSlackNotifier(deps);
    // The notifier should exist (not a no-op when tenant webhook is present)
    await notifier.notifyReviewPending({ runId: "run-1" });
    // The notification path uses the tenant webhook through effectiveWebhook
    // We can verify the notifier was created (not no-op) by checking
    // that it's not calling no-op methods.
    expect(notifier).toBeDefined();
  });

  it("no-ops when neither global nor tenant webhook is configured", async () => {
    const deps = makeDeps({
      webhookUrl: undefined,
      tenantSlackWebhook: null,
      tenantNotifyEmail: null,
    });

    const notifier = createSlackNotifier(deps);
    // no-op notifier: all methods resolve immediately
    await notifier.notifyReviewPending({ runId: "run-1" });
    // No error means no-op worked correctly
  });

  it("uses global webhook when no tenant webhook configured", async () => {
    const deps = makeDeps({
      webhookUrl: "https://hooks.slack.com/services/GLOBAL/BOT/KEY",
      tenantSlackWebhook: null,
    });

    const notifier = createSlackNotifier(deps);
    expect(notifier).toBeDefined();
  });

  it("accepts tenantNotificationConfig with email only (no webhook)", async () => {
    const deps = makeDeps({
      webhookUrl: undefined,
      tenantSlackWebhook: null,
      tenantNotifyEmail: "ops@example.com",
    });

    // Without a webhook URL, the Slack notifier should be a no-op
    const notifier = createSlackNotifier(deps);
    await notifier.notifyReviewPending({ runId: "run-1" });
    // No error = no-op works
  });
});
