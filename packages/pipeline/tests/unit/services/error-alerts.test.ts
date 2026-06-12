/**
 * P16 (REQ-091): error alerts to the tenant's configured channels on a run
 * crash. Markerless by design (D-111 counterpart) — a crash has no archive
 * flow to carry a notification_state marker. Fake channels only (S-web-04 /
 * project rule: NO real Slack in tests).
 */
import { describe, it, expect, vi } from "vitest";
import type { WebhookPostResult } from "@newsletter/shared";
import { createErrorAlerter } from "@pipeline/services/error-alerts.js";

const TENANT_WEBHOOK = "https://hooks.slack.com/services/T0TENANT/B0TENANT/tenant-secret";
const RUN_ID = "00000000-0000-4000-8000-00000000dead";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeHarness(overrides: {
  slackWebhookUrl?: string;
  notifyEmail?: string;
  notifyErrors: boolean;
}): {
  posts: { url: string; blocks: unknown[] }[];
  emails: { to: string; subject: string; text: string }[];
  alerter: ReturnType<typeof createErrorAlerter>;
} {
  const posts: { url: string; blocks: unknown[] }[] = [];
  const emails: { to: string; subject: string; text: string }[] = [];
  const alerter = createErrorAlerter({
    channels: {
      slackWebhookUrl: overrides.slackWebhookUrl,
      notifyEmail: overrides.notifyEmail,
      notifyReviewReady: true,
      notifyErrors: overrides.notifyErrors,
    },
    postToWebhookFn: (input: { url: string; blocks: unknown[] }): Promise<WebhookPostResult> => {
      posts.push({ url: input.url, blocks: input.blocks });
      return Promise.resolve({ ok: true });
    },
    emailSender: {
      send: (input) => {
        emails.push(input);
        return Promise.resolve();
      },
    },
    logger: silentLogger,
  });
  return { posts, emails, alerter };
}

describe("createErrorAlerter (REQ-091)", () => {
  it("test_REQ_091_error_alert_to_channels — run crash posts to the tenant webhook AND emails the tenant address", async () => {
    const h = makeHarness({
      slackWebhookUrl: TENANT_WEBHOOK,
      notifyEmail: "ada@studio.com",
      notifyErrors: true,
    });

    await h.alerter.runCrashed({ runId: RUN_ID, error: "rank stage exploded", stage: "ranking" });

    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].url).toBe(TENANT_WEBHOOK);
    expect(JSON.stringify(h.posts[0].blocks)).toContain("Run failed");
    expect(JSON.stringify(h.posts[0].blocks)).toContain("rank stage exploded");

    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("ada@studio.com");
    expect(h.emails[0].text).toContain(RUN_ID);
    expect(h.emails[0].text).toContain("rank stage exploded");
  });

  it("notifyErrors toggle off suppresses both channels", async () => {
    const h = makeHarness({
      slackWebhookUrl: TENANT_WEBHOOK,
      notifyEmail: "ada@studio.com",
      notifyErrors: false,
    });
    await h.alerter.runCrashed({ runId: RUN_ID, error: "boom" });
    expect(h.posts).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  it("never throws — channel failures are logged, not propagated", async () => {
    const alerter = createErrorAlerter({
      channels: {
        slackWebhookUrl: TENANT_WEBHOOK,
        notifyEmail: "ada@studio.com",
        notifyReviewReady: true,
        notifyErrors: true,
      },
      postToWebhookFn: () => Promise.reject(new Error("network down")),
      emailSender: { send: () => Promise.reject(new Error("smtp down")) },
      logger: silentLogger,
    });
    await expect(
      alerter.runCrashed({ runId: RUN_ID, error: "boom" }),
    ).resolves.toBeUndefined();
    expect(silentLogger.warn).toHaveBeenCalled();
  });
});
