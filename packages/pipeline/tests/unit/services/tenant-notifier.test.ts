import { describe, it, expect, vi } from "vitest";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { NotifierArchiveView, SlackNotifier } from "@newsletter/shared";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import {
  createTenantNotifier,
  type TenantNotifierDeps,
} from "@pipeline/services/tenant-notifier.js";

const TENANT_ID = "aaaaaaaa-0000-4000-8000-000000000042";
const WEBHOOK_BLOB: EncryptedBlob = { ct: "hook-ct", iv: "iv", tag: "tag" };
const DECRYPTED_WEBHOOK = "https://hooks.slack.com/services/T/B/decrypted";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as TenantNotifierDeps["logger"];
}

function makeArchives(view: Partial<NotifierArchiveView> = {}) {
  const markers: Record<string, string> = {};
  const archive: NotifierArchiveView = {
    id: "run-1",
    digestHeadline: "Big AI News",
    rankedItems: [],
    sourceTelemetry: null,
    slackNotifiedAt: null,
    notificationState: markers,
    isDryRun: false,
    ...view,
  };
  return {
    markers,
    findById: vi.fn((id: string) =>
      Promise.resolve(id === archive.id ? { ...archive, notificationState: { ...markers } } : null),
    ),
    markSlackNotified: vi.fn(() => Promise.resolve()),
    markNotification: vi.fn((id: string, key: string, at: Date) => {
      markers[key] = at.toISOString();
      return Promise.resolve();
    }),
  };
}

// No return-type annotation: keeping the inferred vi.fn mock types (instead of
// SlackNotifier's method signatures) lets assertions reference members without
// tripping @typescript-eslint/unbound-method. `satisfies` keeps the shape honest.
function makeSlackChannel() {
  return {
    notifyNewsletterSent: vi.fn(() => Promise.resolve()),
    notifyReviewPending: vi.fn(() => Promise.resolve()),
    notifyReviewWarning: vi.fn(() => Promise.resolve()),
    notifyPublishFailed: vi.fn(() => Promise.resolve()),
    notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
    notifySourceDistribution: vi.fn(() => Promise.resolve()),
    notifyEmailDelivery: vi.fn(() => Promise.resolve()),
    notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
    notifyTwitterPosted: vi.fn(() => Promise.resolve()),
    notifySubscriberConfirmed: vi.fn(() => Promise.resolve()),
    notifySubscriberRemoved: vi.fn(() => Promise.resolve()),
    notifyFeedbackReceived: vi.fn(() => Promise.resolve()),
  } satisfies SlackNotifier;
}

interface HarnessOptions {
  tenantId?: string;
  notificationEmail?: string | null;
  slackWebhookEncrypted?: EncryptedBlob | null;
  settingsRow?: boolean;
  env?: NodeJS.ProcessEnv;
  archiveView?: Partial<NotifierArchiveView>;
  emailClient?: ReturnType<typeof vi.fn>;
  slackClient?: ReturnType<typeof vi.fn>;
  decrypt?: (blob: EncryptedBlob) => string;
}

function makeNotifier(opts: HarnessOptions = {}) {
  const archives = makeArchives(opts.archiveView);
  const slackChannel = makeSlackChannel();
  const createSlackChannel = vi.fn(() => slackChannel);
  const emailClient = opts.emailClient ?? vi.fn(() => Promise.resolve());
  const slackClient = opts.slackClient ?? vi.fn(() => Promise.resolve({ ok: true as const }));
  const settingsRow = opts.settingsRow ?? true;
  const settingsRepo = {
    get: vi.fn(() =>
      Promise.resolve(
        settingsRow
          ? {
              notificationEmail: opts.notificationEmail ?? null,
              slackWebhookEncrypted: opts.slackWebhookEncrypted ?? null,
            }
          : null,
      ),
    ),
  };
  const cipher = {
    decrypt: vi.fn(opts.decrypt ?? (() => DECRYPTED_WEBHOOK)),
  };
  const logger = makeLogger();
  const notifier = createTenantNotifier({
    tenantId: opts.tenantId ?? TENANT_ID,
    settingsRepo,
    cipher,
    archives,
    resolveTopRankedTitle: () => Promise.resolve(null),
    logger,
    emailClient,
    slackClient,
    createSlackChannel,
    env: opts.env ?? {},
    publicArchiveBaseUrl: "https://news.example.com",
  });
  return { notifier, archives, slackChannel, createSlackChannel, emailClient, slackClient, cipher, logger };
}

describe("createTenantNotifier — channel matrix (REQ-090)", () => {
  it("both channels configured: review-ready hits slack (decrypted webhook) and email", async () => {
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: WEBHOOK_BLOB,
    });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.cipher.decrypt).toHaveBeenCalledWith(WEBHOOK_BLOB);
    expect(h.createSlackChannel).toHaveBeenCalledWith(DECRYPTED_WEBHOOK);
    expect(h.slackChannel.notifyReviewPending).toHaveBeenCalledWith({ runId: "run-1" });
    expect(h.emailClient).toHaveBeenCalledTimes(1);
    const [emailArg] = (h.emailClient).mock.calls[0] as [
      { to: string; subject: string; text: string },
    ];
    expect(emailArg.to).toBe("ops@tenant.io");
    expect(emailArg.subject).toContain("Big AI News");
    expect(emailArg.text).toContain("run-1");
    expect(emailArg.text).toContain("https://news.example.com");
  });

  it("email-only: slack channel never built, email sent", async () => {
    const h = makeNotifier({ notificationEmail: "ops@tenant.io" });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.createSlackChannel).not.toHaveBeenCalled();
    expect(h.emailClient).toHaveBeenCalledTimes(1);
  });

  it("slack-only: email never sent, slack delegated", async () => {
    const h = makeNotifier({ slackWebhookEncrypted: WEBHOOK_BLOB });

    await h.notifier.notifyReviewPending({ runId: "run-1" });
    await h.notifier.notifySourceDistribution({ runId: "run-1" });

    expect(h.emailClient).not.toHaveBeenCalled();
    expect(h.slackChannel.notifyReviewPending).toHaveBeenCalledTimes(1);
    expect(h.slackChannel.notifySourceDistribution).toHaveBeenCalledTimes(1);
  });

  it("neither configured: full no-op across the surface", async () => {
    const h = makeNotifier({});

    await h.notifier.notifyReviewPending({ runId: "run-1" });
    await h.notifier.notifyRunCrashed({ runId: "run-1", stage: "ranking", error: "boom" });
    await h.notifier.notifyCollectorFailures({
      failures: [{ collector: "hn", reason: "down" }],
      trigger: "scheduled",
    });

    expect(h.createSlackChannel).not.toHaveBeenCalled();
    expect(h.emailClient).not.toHaveBeenCalled();
    expect(h.slackClient).not.toHaveBeenCalled();
  });

  it("missing settings row behaves as unconfigured (non-zero tenant)", async () => {
    const h = makeNotifier({ settingsRow: false });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.createSlackChannel).not.toHaveBeenCalled();
    expect(h.emailClient).not.toHaveBeenCalled();
  });

  it("decrypt failure disables slack but keeps email working", async () => {
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: WEBHOOK_BLOB,
      decrypt: () => {
        throw new Error("bad blob");
      },
    });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.createSlackChannel).not.toHaveBeenCalled();
    expect(h.emailClient).toHaveBeenCalledTimes(1);
  });
});

describe("createTenantNotifier — tenant 0 env fallback (NF3)", () => {
  it("tenant 0 with no DB webhook falls back to SLACK_WEBHOOK_URL", async () => {
    const h = makeNotifier({
      tenantId: TENANT_ZERO_ID,
      settingsRow: false,
      env: { SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/env/legacy" } as NodeJS.ProcessEnv,
    });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.createSlackChannel).toHaveBeenCalledWith("https://hooks.slack.com/services/env/legacy");
    expect(h.slackChannel.notifyReviewPending).toHaveBeenCalledTimes(1);
  });

  it("tenant 0 with a DB webhook prefers the DB value over env", async () => {
    const h = makeNotifier({
      tenantId: TENANT_ZERO_ID,
      slackWebhookEncrypted: WEBHOOK_BLOB,
      env: { SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/env/legacy" } as NodeJS.ProcessEnv,
    });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.createSlackChannel).toHaveBeenCalledWith(DECRYPTED_WEBHOOK);
  });

  it("non-zero tenant never falls back to the env webhook", async () => {
    const h = makeNotifier({
      tenantId: TENANT_ID,
      settingsRow: false,
      env: { SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/env/legacy" } as NodeJS.ProcessEnv,
    });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.createSlackChannel).not.toHaveBeenCalled();
  });
});

describe("createTenantNotifier — notification_state markers", () => {
  it("review-ready email fires once per run (marker written, second call skipped)", async () => {
    const h = makeNotifier({ notificationEmail: "ops@tenant.io" });

    await h.notifier.notifyReviewPending({ runId: "run-1" });
    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.emailClient).toHaveBeenCalledTimes(1);
    expect(h.archives.markers.reviewPendingEmail).toBeDefined();
  });

  it("email failure does NOT write the marker so a retry can re-alert", async () => {
    const emailClient = vi.fn(() => Promise.reject(new Error("smtp down")));
    const h = makeNotifier({ notificationEmail: "ops@tenant.io", emailClient });

    await expect(h.notifier.notifyReviewPending({ runId: "run-1" })).resolves.toBeUndefined();

    expect(h.archives.markNotification).not.toHaveBeenCalled();
  });

  it("dry-run archive: email skipped, no marker", async () => {
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      archiveView: { isDryRun: true },
    });

    await h.notifier.notifyReviewPending({ runId: "run-1" });

    expect(h.emailClient).not.toHaveBeenCalled();
    expect(h.archives.markNotification).not.toHaveBeenCalled();
  });
});

describe("createTenantNotifier — run crash (REQ-091)", () => {
  it("posts to slack and email with run details, marking both channels", async () => {
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: WEBHOOK_BLOB,
    });

    await h.notifier.notifyRunCrashed({ runId: "run-1", stage: "ranking", error: "LLM exploded" });

    expect(h.slackClient).toHaveBeenCalledTimes(1);
    const [slackArg] = (h.slackClient).mock.calls[0] as [
      { url: string; blocks: unknown[] },
    ];
    expect(slackArg.url).toBe(DECRYPTED_WEBHOOK);
    expect(JSON.stringify(slackArg.blocks)).toContain("run-1");
    expect(JSON.stringify(slackArg.blocks)).toContain("LLM exploded");

    expect(h.emailClient).toHaveBeenCalledTimes(1);
    const [emailArg] = (h.emailClient).mock.calls[0] as [
      { to: string; subject: string; text: string },
    ];
    expect(emailArg.subject).toContain("run-1");
    expect(emailArg.text).toContain("ranking");
    expect(emailArg.text).toContain("LLM exploded");

    expect(h.archives.markers.runCrashed).toBeDefined();
    expect(h.archives.markers.runCrashedEmail).toBeDefined();
  });

  it("second crash notification for the same run is a no-op (markers)", async () => {
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: WEBHOOK_BLOB,
    });

    await h.notifier.notifyRunCrashed({ runId: "run-1", stage: "ranking", error: "boom" });
    await h.notifier.notifyRunCrashed({ runId: "run-1", stage: "ranking", error: "boom" });

    expect(h.slackClient).toHaveBeenCalledTimes(1);
    expect(h.emailClient).toHaveBeenCalledTimes(1);
  });

  it("failed slack post does not write the runCrashed marker", async () => {
    const slackClient = vi.fn(() =>
      Promise.resolve({ ok: false as const, status: 500 as const, error: "oops" }),
    );
    const h = makeNotifier({ slackWebhookEncrypted: WEBHOOK_BLOB, slackClient });

    await h.notifier.notifyRunCrashed({ runId: "run-1", stage: "ranking", error: "boom" });

    expect(h.archives.markers.runCrashed).toBeUndefined();
  });
});

describe("createTenantNotifier — collector failures (REQ-091)", () => {
  it("posts one consolidated slack message and one email, no markers", async () => {
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: WEBHOOK_BLOB,
    });

    await h.notifier.notifyCollectorFailures({
      failures: [
        { collector: "hn", reason: "HN auth failed" },
        { collector: "reddit", reason: "reddit unreachable" },
      ],
      trigger: "scheduled",
    });

    expect(h.slackClient).toHaveBeenCalledTimes(1);
    const [slackArg] = (h.slackClient).mock.calls[0] as [
      { url: string; blocks: unknown[] },
    ];
    expect(JSON.stringify(slackArg.blocks)).toContain("HN auth failed");
    expect(JSON.stringify(slackArg.blocks)).toContain("reddit unreachable");

    expect(h.emailClient).toHaveBeenCalledTimes(1);
    const [emailArg] = (h.emailClient).mock.calls[0] as [
      { to: string; subject: string; text: string },
    ];
    expect(emailArg.subject).toContain("scheduled");
    expect(emailArg.text).toContain("hn: HN auth failed");
    expect(emailArg.text).toContain("reddit: reddit unreachable");

    expect(h.archives.markNotification).not.toHaveBeenCalled();
  });

  it("channel errors are swallowed (email throws, slack non-ok)", async () => {
    const emailClient = vi.fn(() => Promise.reject(new Error("smtp down")));
    const slackClient = vi.fn(() =>
      Promise.resolve({ ok: false as const, status: 500 as const, error: "oops" }),
    );
    const h = makeNotifier({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: WEBHOOK_BLOB,
      emailClient,
      slackClient,
    });

    await expect(
      h.notifier.notifyCollectorFailures({
        failures: [{ collector: "hn", reason: "down" }],
        trigger: "manual",
      }),
    ).resolves.toBeUndefined();
  });

  it("settings repo failure degrades to a no-op instead of throwing", async () => {
    const failing = makeNotifierWithFailingSettings();

    await expect(
      failing.notifier.notifyCollectorFailures({
        failures: [{ collector: "hn", reason: "down" }],
        trigger: "manual",
      }),
    ).resolves.toBeUndefined();
    expect(failing.emailClient).not.toHaveBeenCalled();
    expect(failing.slackClient).not.toHaveBeenCalled();
  });
});

function makeNotifierWithFailingSettings() {
  const emailClient = vi.fn(() => Promise.resolve());
  const slackClient = vi.fn(() => Promise.resolve({ ok: true as const }));
  const notifier = createTenantNotifier({
    tenantId: TENANT_ID,
    settingsRepo: { get: vi.fn(() => Promise.reject(new Error("db down"))) },
    cipher: { decrypt: vi.fn() },
    archives: makeArchives(),
    resolveTopRankedTitle: () => Promise.resolve(null),
    logger: makeLogger(),
    emailClient,
    slackClient,
    createSlackChannel: vi.fn(() => makeSlackChannel()),
    env: {},
  });
  return { notifier, emailClient, slackClient };
}
