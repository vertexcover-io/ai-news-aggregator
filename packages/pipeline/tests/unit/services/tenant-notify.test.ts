/**
 * P16 (REQ-090/092): per-tenant notification channel resolution + the
 * review-ready notification fan-out.
 *
 * NO real Slack anywhere — the Slack channel is a captured fetchFn (fake
 * channel) and idempotency is asserted via the notification_state markers
 * (D-107). The webhook ciphertext is decrypted with the real D-012 cipher.
 */
import { describe, it, expect, vi } from "vitest";
import { createSlackNotifier } from "@newsletter/shared";
import type { NotificationKey, NotificationState } from "@newsletter/shared/types";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import {
  resolveTenantNotificationChannels,
  type TenantNotificationChannels,
} from "@pipeline/services/tenant-notify.js";
import { notifyReviewReady } from "@pipeline/services/review-ready-notify.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";

const SESSION_SECRET = "test-session-secret-32-bytes-minimum-abcdef1234567890";
const cipher = getCredentialCipher({ SESSION_SECRET } as NodeJS.ProcessEnv);

const TENANT_WEBHOOK = "https://hooks.slack.com/services/T0TENANT/B0TENANT/tenant-secret";
const GLOBAL_WEBHOOK = "https://hooks.slack.com/services/T0GLOBAL/B0GLOBAL/global-secret";
const RUN_ID = "00000000-0000-4000-8000-00000000c0de";

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  // pino Logger structural stand-in for createSlackNotifier
  debug: vi.fn(),
} as never;

function makeArchiveRow(over: Partial<PipelineRunArchiveRow> = {}): PipelineRunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [],
    topN: 5,
    reviewed: false,
    completedAt: new Date("2026-06-11T07:00:00Z"),
    digestHeadline: "Headline",
    digestSummary: null,
    hook: null,
    twitterSummary: null,
    linkedinPostBody: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    isDryRun: false,
    ...over,
  };
}

interface FakeArchives {
  findById: (id: string) => Promise<PipelineRunArchiveRow | null>;
  markNotification: (runId: string, key: NotificationKey, at: Date) => Promise<void>;
  state: { markers: NotificationState };
}

function makeArchives(row: PipelineRunArchiveRow): FakeArchives {
  const state: { markers: NotificationState } = { markers: {} };
  return {
    state,
    findById: (id) =>
      Promise.resolve(
        id === row.id ? { ...row, notificationState: { ...state.markers } } : null,
      ),
    markNotification: (_runId, key, at) => {
      state.markers[key] = at.toISOString();
      return Promise.resolve();
    },
  };
}

function makeRepo(row: {
  notifyEmail: string | null;
  slackWebhook: string | null;
  notifyReviewReady: boolean;
  notifyErrors: boolean;
} | null): { getNotificationSettings: () => Promise<typeof row> } {
  return { getNotificationSettings: () => Promise.resolve(row) };
}

describe("resolveTenantNotificationChannels (REQ-092 read side)", () => {
  it("decrypts the tenant webhook ciphertext via the D-012 cipher", async () => {
    const channels = await resolveTenantNotificationChannels({
      tenantsRepo: makeRepo({
        notifyEmail: "ada@studio.com",
        slackWebhook: JSON.stringify(cipher.encrypt(TENANT_WEBHOOK)),
        notifyReviewReady: true,
        notifyErrors: false,
      }),
      cipher,
      env: { SLACK_WEBHOOK_URL: GLOBAL_WEBHOOK } as NodeJS.ProcessEnv,
      logger: silentLogger,
    });
    expect(channels).toEqual({
      slackWebhookUrl: TENANT_WEBHOOK,
      notifyEmail: "ada@studio.com",
      notifyReviewReady: true,
      notifyErrors: false,
    });
  });

  it("falls back to the global SLACK_WEBHOOK_URL when the tenant has no webhook (and when no tenant resolves)", async () => {
    const noWebhook = await resolveTenantNotificationChannels({
      tenantsRepo: makeRepo({
        notifyEmail: null,
        slackWebhook: null,
        notifyReviewReady: true,
        notifyErrors: true,
      }),
      cipher,
      env: { SLACK_WEBHOOK_URL: GLOBAL_WEBHOOK } as NodeJS.ProcessEnv,
      logger: silentLogger,
    });
    expect(noWebhook.slackWebhookUrl).toBe(GLOBAL_WEBHOOK);
    expect(noWebhook.notifyEmail).toBeUndefined();

    const noTenant = await resolveTenantNotificationChannels({
      tenantsRepo: makeRepo(null),
      cipher,
      env: { SLACK_WEBHOOK_URL: GLOBAL_WEBHOOK } as NodeJS.ProcessEnv,
      logger: silentLogger,
    });
    expect(noTenant).toEqual({
      slackWebhookUrl: GLOBAL_WEBHOOK,
      notifyEmail: undefined,
      notifyReviewReady: true,
      notifyErrors: true,
    });
  });

  it("disables the Slack channel (no global fallback) on corrupt ciphertext", async () => {
    const channels = await resolveTenantNotificationChannels({
      tenantsRepo: makeRepo({
        notifyEmail: null,
        slackWebhook: "{not-a-valid-blob",
        notifyReviewReady: true,
        notifyErrors: true,
      }),
      cipher,
      env: { SLACK_WEBHOOK_URL: GLOBAL_WEBHOOK } as NodeJS.ProcessEnv,
      logger: silentLogger,
    });
    expect(channels.slackWebhookUrl).toBeUndefined();
  });
});

describe("notifyReviewReady (REQ-090)", () => {
  function makeHarness(channels: TenantNotificationChannels): {
    slackPosts: { url: string }[];
    emails: { to: string; subject: string }[];
    archives: FakeArchives;
    run: () => Promise<void>;
  } {
    const slackPosts: { url: string }[] = [];
    const emails: { to: string; subject: string }[] = [];
    const archives = makeArchives(makeArchiveRow());
    const fetchFn: typeof fetch = ((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      slackPosts.push({ url });
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;
    const slackNotifier = createSlackNotifier({
      webhookUrl: channels.slackWebhookUrl,
      archives,
      resolveTopRankedTitle: () => Promise.resolve(null),
      logger: silentLogger,
      fetchFn,
    });
    const emailSender = {
      send: (input: { to: string; subject: string; text: string }) => {
        emails.push({ to: input.to, subject: input.subject });
        return Promise.resolve();
      },
    };
    return {
      slackPosts,
      emails,
      archives,
      run: () =>
        notifyReviewReady({
          runId: RUN_ID,
          channels,
          slackNotifier,
          emailSender,
          archives,
          logger: silentLogger,
        }),
    };
  }

  it("test_REQ_090_review_ready_notifies_channels — posts to the tenant webhook AND emails the tenant address, stamping D-107 markers; repeat call is idempotent", async () => {
    const h = makeHarness({
      slackWebhookUrl: TENANT_WEBHOOK,
      notifyEmail: "ada@studio.com",
      notifyReviewReady: true,
      notifyErrors: true,
    });

    await h.run();

    // Fake Slack channel received the post, addressed to the TENANT webhook.
    expect(h.slackPosts).toEqual([{ url: TENANT_WEBHOOK }]);
    // Email channel received the review-ready notification.
    expect(h.emails).toEqual([
      { to: "ada@studio.com", subject: expect.stringContaining("ready") },
    ]);
    // D-107: both idempotency markers live in notification_state.
    expect(h.archives.state.markers.reviewPending).toBeDefined();
    expect(h.archives.state.markers.reviewPendingEmail).toBeDefined();

    // Second call: markers short-circuit BOTH channels.
    await h.run();
    expect(h.slackPosts).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
  });

  it("review-ready toggle off suppresses both channels", async () => {
    const h = makeHarness({
      slackWebhookUrl: TENANT_WEBHOOK,
      notifyEmail: "ada@studio.com",
      notifyReviewReady: false,
      notifyErrors: true,
    });
    await h.run();
    expect(h.slackPosts).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
    expect(h.archives.state.markers).toEqual({});
  });

  it("email send failure leaves no marker so a retry can re-send (D-107)", async () => {
    const h = makeHarness({
      slackWebhookUrl: undefined,
      notifyEmail: "ada@studio.com",
      notifyReviewReady: true,
      notifyErrors: true,
    });
    const failingSender = {
      send: () => Promise.reject(new Error("smtp down")),
    };
    await notifyReviewReady({
      runId: RUN_ID,
      channels: {
        slackWebhookUrl: undefined,
        notifyEmail: "ada@studio.com",
        notifyReviewReady: true,
        notifyErrors: true,
      },
      slackNotifier: undefined,
      emailSender: failingSender,
      archives: h.archives,
      logger: silentLogger,
    });
    expect(h.archives.state.markers.reviewPendingEmail).toBeUndefined();
  });
});
