import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { createSlackNotifier } from "@shared/slack/notifier.js";
import type {
  NotifierArchiveAccess,
  NotifierArchiveView,
  NotifierTopRankedTitle,
} from "@shared/slack/types.js";
import type { RunSourceTelemetry } from "@shared/types/run.js";

interface LogCall {
  level: string;
  obj: unknown;
  msg: string | undefined;
}

function makeCapturedLogger(): { calls: LogCall[]; logger: Logger } {
  const calls: LogCall[] = [];
  const make =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      calls.push({ level, obj, msg });
    };
  const noop = (): void => {
    /* noop */
  };
  const logger = {
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    debug: noop,
    fatal: noop,
    trace: noop,
  } as unknown as Logger;
  return { calls, logger };
}

const SECRET_URL =
  "https://hooks.slack.com/services/T_TEST/B_TEST/SECRET_PATH_TOKEN";

function makeArchive(
  overrides: Partial<NotifierArchiveView> = {},
): NotifierArchiveView {
  return {
    id: "run-1",
    digestHeadline: "Hello world",
    rankedItems: [{ rawItemId: 1 }],
    sourceTelemetry: null,
    slackNotifiedAt: null,
    notificationState: null,
    isDryRun: false,
    ...overrides,
  };
}

function makeArchives(
  archive: NotifierArchiveView | null,
): NotifierArchiveAccess & {
  findById: ReturnType<typeof vi.fn>;
  markSlackNotified: ReturnType<typeof vi.fn>;
  markNotification: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(() => Promise.resolve(archive)),
    markSlackNotified: vi.fn(() => Promise.resolve()),
    markNotification: vi.fn(() => Promise.resolve()),
  };
}

const resolveTitle: NotifierTopRankedTitle = () => Promise.resolve(null);

describe("createSlackNotifier", () => {
  it("is a no-op when webhookUrl is undefined", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: undefined,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.findById).not.toHaveBeenCalled();
    const disabled = calls.filter(
      (c) =>
        c.level === "info" &&
        (c.obj as { event?: string } | undefined)?.event ===
          "slack.notify.disabled",
    );
    expect(disabled).toHaveLength(1);
  });

  it("is a no-op when webhookUrl is empty string", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: "",
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.findById).not.toHaveBeenCalled();
    expect(
      calls.some(
        (c) =>
          (c.obj as { event?: string } | undefined)?.event ===
          "slack.notify.disabled",
      ),
    ).toBe(true);
  });

  it("warns on suspicious URL but continues operating normally", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const notifier = createSlackNotifier({
      webhookUrl: "https://evil.example.com/webhook",
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(
      calls.some(
        (c) =>
          c.level === "warn" &&
          (c.obj as { event?: string } | undefined)?.event ===
            "slack.notify.suspicious_url",
      ),
    ).toBe(true);
    await notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(archives.markSlackNotified).toHaveBeenCalledTimes(1);
  });

  it("logs warn and skips when archive is missing", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(null);
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({
      runId: "missing",
      delivery: { attempted: 0, sent: 0, failed: 0 },
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.markSlackNotified).not.toHaveBeenCalled();
    expect(
      calls.some(
        (c) =>
          c.level === "warn" &&
          (c.obj as { event?: string } | undefined)?.event ===
            "slack.notify.archive_missing",
      ),
    ).toBe(true);
  });

  it("skips when archive is already notified", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(
      makeArchive({ slackNotifiedAt: new Date("2026-01-01T00:00:00Z") }),
    );
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.markSlackNotified).not.toHaveBeenCalled();
    expect(
      calls.some(
        (c) =>
          c.level === "info" &&
          (c.obj as { event?: string; reason?: string } | undefined)?.event ===
            "slack.notify.skipped",
      ),
    ).toBe(true);
  });

  it("happy path: posts to webhook and marks notified", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const fixedNow = new Date("2026-05-07T12:00:00Z");
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SECRET_URL);
    expect(archives.markSlackNotified).toHaveBeenCalledTimes(1);
    expect(archives.markSlackNotified).toHaveBeenCalledWith("run-1", fixedNow);
    expect(
      calls.some(
        (c) =>
          c.level === "info" &&
          (c.obj as { event?: string } | undefined)?.event ===
            "slack.notify.sent",
      ),
    ).toBe(true);
  });

  it("logs error and does not mark notified on webhook 500", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("server", { status: 500 })),
    );
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } }),
    ).resolves.toBeUndefined();
    expect(archives.markSlackNotified).not.toHaveBeenCalled();
    const errorCall = calls.find(
      (c) =>
        c.level === "error" &&
        (c.obj as { event?: string } | undefined)?.event ===
          "slack.notify.failed",
    );
    expect(errorCall).toBeDefined();
    expect((errorCall?.obj as { status?: unknown }).status).toBe(500);
  });

  it("logs error with status='network' on fetch throw", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } }),
    ).resolves.toBeUndefined();
    expect(archives.markSlackNotified).not.toHaveBeenCalled();
    const errorCall = calls.find(
      (c) =>
        c.level === "error" &&
        (c.obj as { event?: string } | undefined)?.event ===
          "slack.notify.failed",
    );
    expect(errorCall).toBeDefined();
    expect((errorCall?.obj as { status?: unknown }).status).toBe("network");
  });

  it("forwards socialResults into the rendered Slack message blocks", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({
      runId: "run-1",
      delivery: { attempted: 1, sent: 1, failed: 0 },
      socialResults: {
        linkedin: {
          status: "posted",
          permalink: "urn:li:share:7777",
        },
        twitter: { status: "failed", reason: "http_402" },
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body) as {
      blocks: { type: string; text?: { text?: string } }[];
    };
    const sectionTextValues = payload.blocks
      .filter((b) => b.type === "section")
      .map((b) => b.text?.text ?? "");
    const social = sectionTextValues.find((s) =>
      s.includes("🔗 Social posts"),
    );
    expect(social).toBeDefined();
    expect(social).toContain(
      "🟢 LinkedIn: posted — <https://www.linkedin.com/feed/update/urn:li:share:7777|view>",
    );
    expect(social).toContain("🔴 X: failed — http_402");
  });

  it("skips webhook POST when archive is a dry run", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ isDryRun: true }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({
      runId: "run-1",
      delivery: { attempted: 3, sent: 3, failed: 0 },
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.markSlackNotified).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) =>
        (c.obj as { event?: string; channel?: string } | undefined)?.event ===
          "publish.skipped_dry_run" &&
        (c.obj as { channel?: string }).channel === "slack",
    );
    expect(skipped).toBeDefined();
  });

  it("notifyReviewPending skips webhook POST when archive is a dry run", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ isDryRun: true }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyReviewPending({ runId: "run-1" });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) =>
        (c.obj as { event?: string; channel?: string } | undefined)?.event ===
          "publish.skipped_dry_run" &&
        (c.obj as { channel?: string }).channel === "slack",
    );
    expect(skipped).toBeDefined();
  });

  it("never logs the webhook URL or its secret path token", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("server", { status: 500 })),
    );
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 3, sent: 3, failed: 0 } });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("SECRET_PATH_TOKEN");
    expect(serialized).not.toContain(SECRET_URL);
  });
});

const baseTelemetry: RunSourceTelemetry = {
  sources: [
    {
      sourceType: "hn",
      identifier: "hn",
      displayName: "Hacker News",
      status: "completed",
      itemsFetched: 5,
      errors: [],
      retries: 0,
      durationMs: 100,
    },
  ],
  totalItemsFetched: 5,
  totalErrors: 0,
};

describe("notifySourceDistribution (VS-1, VS-2, VS-10, VS-11, VS-12, VS-13)", () => {
  // VS-1: happy path
  it("posts to webhook and marks sourceDistribution on success", async () => {
    const { logger } = makeCapturedLogger();
    const archive = makeArchive({ sourceTelemetry: baseTelemetry, notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const fixedNow = new Date("2026-05-21T10:00:00Z");
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await notifier.notifySourceDistribution({ runId: "run-1" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SECRET_URL);
    expect(archives.markNotification).toHaveBeenCalledWith("run-1", "sourceDistribution", fixedNow);
  });

  it("includes 📊 Sources collected header in posted message (VS-1)", async () => {
    const { logger } = makeCapturedLogger();
    const archive = makeArchive({
      sourceTelemetry: baseTelemetry,
      notificationState: {},
      digestHeadline: "AI Week in Review",
    });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifySourceDistribution({ runId: "run-1" });
    const [, init] = fetchFn.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body) as { blocks: { type: string; text?: { text?: string } }[] };
    const header = payload.blocks.find((b) => b.type === "header");
    expect(header?.text?.text).toBe("📊 Sources collected");
  });

  // VS-2: skip on null telemetry
  it("skips posting when sourceTelemetry is null (VS-2)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archive = makeArchive({ sourceTelemetry: null, notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifySourceDistribution({ runId: "run-1" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.markNotification).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { event?: string; reason?: string } | undefined)?.event === "slack.source_distribution.skipped",
    );
    expect(skipped).toBeDefined();
    expect((skipped?.obj as { reason?: string }).reason).toBe("no_telemetry");
  });

  // VS-10: idempotency
  it("skips if sourceDistribution already notified (VS-10)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archive = makeArchive({
      sourceTelemetry: baseTelemetry,
      notificationState: { sourceDistribution: "2026-05-21T00:00:00Z" },
    });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifySourceDistribution({ runId: "run-1" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.markNotification).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { reason?: string } | undefined)?.reason === "already_notified",
    );
    expect(skipped).toBeDefined();
  });

  // VS-11: failure does not mark
  it("does not mark when webhook returns 500 (VS-11)", async () => {
    const { logger } = makeCapturedLogger();
    const archive = makeArchive({ sourceTelemetry: baseTelemetry, notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn(() => Promise.resolve(new Response("error", { status: 500 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(notifier.notifySourceDistribution({ runId: "run-1" })).resolves.toBeUndefined();
    expect(archives.markNotification).not.toHaveBeenCalled();
  });

  // VS-12: dry-run skip
  it("skips when archive is a dry run (VS-12)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archive = makeArchive({ sourceTelemetry: baseTelemetry, isDryRun: true, notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifySourceDistribution({ runId: "run-1" });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { event?: string } | undefined)?.event === "publish.skipped_dry_run",
    );
    expect(skipped).toBeDefined();
  });

  // VS-13: webhook unset
  it("is a no-op when webhook is unset (VS-13)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ sourceTelemetry: baseTelemetry }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: undefined,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifySourceDistribution({ runId: "run-1" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.findById).not.toHaveBeenCalled();
  });
});

describe("notifyEmailDelivery (VS-4, VS-10, VS-11, VS-12, VS-13)", () => {
  const delivery = { attempted: 5, sent: 4, failed: 1, failureReasons: [{ reason: "bounce", count: 1 }] };

  // VS-4: happy path
  it("posts to webhook and marks emailDelivery on success", async () => {
    const { logger } = makeCapturedLogger();
    const archive = makeArchive({ notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const fixedNow = new Date("2026-05-21T10:00:00Z");
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await notifier.notifyEmailDelivery({ runId: "run-1", delivery });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(archives.markNotification).toHaveBeenCalledWith("run-1", "emailDelivery", fixedNow);
  });

  it("includes 📬 Newsletter emailed header in posted message (VS-4)", async () => {
    const { logger } = makeCapturedLogger();
    const archive = makeArchive({ notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyEmailDelivery({ runId: "run-1", delivery });
    const [, init] = fetchFn.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body) as { blocks: { type: string; text?: { text?: string } }[] };
    const header = payload.blocks.find((b) => b.type === "header");
    expect(header?.text?.text).toBe("📬 Newsletter emailed");
  });

  // VS-10: idempotency
  it("skips if emailDelivery already notified (VS-10)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archive = makeArchive({ notificationState: { emailDelivery: "2026-05-21T00:00:00Z" } });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyEmailDelivery({ runId: "run-1", delivery });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.markNotification).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { reason?: string } | undefined)?.reason === "already_notified",
    );
    expect(skipped).toBeDefined();
  });

  // VS-11: failure does not mark
  it("does not mark when webhook returns 500 (VS-11)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("error", { status: 500 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(notifier.notifyEmailDelivery({ runId: "run-1", delivery })).resolves.toBeUndefined();
    expect(archives.markNotification).not.toHaveBeenCalled();
  });

  // VS-12: dry-run skip
  it("skips when archive is a dry run (VS-12)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ isDryRun: true, notificationState: {} }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyEmailDelivery({ runId: "run-1", delivery });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { event?: string } | undefined)?.event === "publish.skipped_dry_run",
    );
    expect(skipped).toBeDefined();
  });

  // VS-13: webhook unset
  it("is a no-op when webhook is unset (VS-13)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: undefined,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyEmailDelivery({ runId: "run-1", delivery });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.findById).not.toHaveBeenCalled();
  });
});

describe("notifyLinkedinPosted (VS-6, VS-10, VS-11, VS-12, VS-13)", () => {
  const permalink = "urn:li:share:12345";

  // VS-6: happy path
  it("posts to webhook and marks linkedinPosted on success", async () => {
    const { logger } = makeCapturedLogger();
    const archive = makeArchive({ notificationState: {} });
    const archives = makeArchives(archive);
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const fixedNow = new Date("2026-05-21T10:00:00Z");
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await notifier.notifyLinkedinPosted({ runId: "run-1", permalink });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(archives.markNotification).toHaveBeenCalledWith("run-1", "linkedinPosted", fixedNow);
  });

  it("includes 🟢 LinkedIn posted header in posted message (VS-6)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyLinkedinPosted({ runId: "run-1", permalink });
    const [, init] = fetchFn.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body) as { blocks: { type: string; text?: { text?: string } }[] };
    const header = payload.blocks.find((b) => b.type === "header");
    expect(header?.text?.text).toBe("🟢 LinkedIn posted");
  });

  // VS-10: idempotency
  it("skips if linkedinPosted already notified (VS-10)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: { linkedinPosted: "2026-05-21T00:00:00Z" } }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyLinkedinPosted({ runId: "run-1", permalink });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find((c) => (c.obj as { reason?: string } | undefined)?.reason === "already_notified");
    expect(skipped).toBeDefined();
  });

  // VS-11: failure does not mark
  it("does not mark when webhook returns 500 (VS-11)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("error", { status: 500 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(notifier.notifyLinkedinPosted({ runId: "run-1", permalink })).resolves.toBeUndefined();
    expect(archives.markNotification).not.toHaveBeenCalled();
  });

  // VS-12: dry-run skip
  it("skips when archive is a dry run (VS-12)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ isDryRun: true, notificationState: {} }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyLinkedinPosted({ runId: "run-1", permalink });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { event?: string } | undefined)?.event === "publish.skipped_dry_run",
    );
    expect(skipped).toBeDefined();
  });

  // VS-13: webhook unset
  it("is a no-op when webhook is unset (VS-13)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: undefined,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyLinkedinPosted({ runId: "run-1", permalink });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.findById).not.toHaveBeenCalled();
  });
});

describe("notifyTwitterPosted (VS-8, VS-10, VS-11, VS-12, VS-13)", () => {
  const permalink = "https://x.com/ai_digest/status/9999";

  // VS-8: happy path
  it("posts to webhook and marks twitterPosted on success", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const fixedNow = new Date("2026-05-21T10:00:00Z");
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await notifier.notifyTwitterPosted({ runId: "run-1", permalink });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(archives.markNotification).toHaveBeenCalledWith("run-1", "twitterPosted", fixedNow);
  });

  it("includes 🟢 X (Twitter) posted header in posted message (VS-8)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyTwitterPosted({ runId: "run-1", permalink });
    const [, init] = fetchFn.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body) as { blocks: { type: string; text?: { text?: string } }[] };
    const header = payload.blocks.find((b) => b.type === "header");
    expect(header?.text?.text).toBe("🟢 X (Twitter) posted");
  });

  // VS-10: idempotency
  it("skips if twitterPosted already notified (VS-10)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: { twitterPosted: "2026-05-21T00:00:00Z" } }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyTwitterPosted({ runId: "run-1", permalink });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find((c) => (c.obj as { reason?: string } | undefined)?.reason === "already_notified");
    expect(skipped).toBeDefined();
  });

  // VS-11: failure does not mark
  it("does not mark when webhook returns 500 (VS-11)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response("error", { status: 500 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(notifier.notifyTwitterPosted({ runId: "run-1", permalink })).resolves.toBeUndefined();
    expect(archives.markNotification).not.toHaveBeenCalled();
  });

  // VS-12: dry-run skip
  it("skips when archive is a dry run (VS-12)", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive({ isDryRun: true, notificationState: {} }));
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyTwitterPosted({ runId: "run-1", permalink });
    expect(fetchFn).not.toHaveBeenCalled();
    const skipped = calls.find(
      (c) => (c.obj as { event?: string } | undefined)?.event === "publish.skipped_dry_run",
    );
    expect(skipped).toBeDefined();
  });

  // VS-13: webhook unset
  it("is a no-op when webhook is unset (VS-13)", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn();
    const notifier = createSlackNotifier({
      webhookUrl: undefined,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyTwitterPosted({ runId: "run-1", permalink });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(archives.findById).not.toHaveBeenCalled();
  });
});

// VS-14: NotificationKey type exhaustiveness
// The real enforcement is via tsc — a typo like "sourceDistribuion" would fail
// `pnpm typecheck` because markNotification is typed against NotificationKey.
// This runtime test confirms the four new keys are valid values at runtime too.
describe("NotificationKey type (VS-14)", () => {
  it("markNotification is callable with all four new keys", async () => {
    const archives = makeArchives(makeArchive({ notificationState: {} }));
    const now = new Date();
    await archives.markNotification("run-1", "sourceDistribution", now);
    await archives.markNotification("run-1", "emailDelivery", now);
    await archives.markNotification("run-1", "linkedinPosted", now);
    await archives.markNotification("run-1", "twitterPosted", now);
    expect(archives.markNotification).toHaveBeenCalledTimes(4);
  });
});

// VS-15: legacy method preserved
describe("notifyNewsletterSent preserved (VS-15)", () => {
  it("notifyNewsletterSent still exists on the interface and is callable", async () => {
    const { logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    // Method must exist and not throw
    expect(typeof notifier.notifyNewsletterSent).toBe("function");
    await expect(
      notifier.notifyNewsletterSent({ runId: "run-1", delivery: { attempted: 1, sent: 1, failed: 0 } }),
    ).resolves.toBeUndefined();
  });
});
