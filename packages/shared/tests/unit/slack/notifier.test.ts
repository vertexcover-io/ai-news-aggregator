import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { createSlackNotifier } from "@shared/slack/notifier.js";
import type {
  NotifierArchiveAccess,
  NotifierArchiveView,
  NotifierSubscriberCount,
  NotifierTopRankedTitle,
} from "@shared/slack/types.js";

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
    ...overrides,
  };
}

function makeArchives(
  archive: NotifierArchiveView | null,
): NotifierArchiveAccess & {
  findById: ReturnType<typeof vi.fn>;
  markSlackNotified: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(() => Promise.resolve(archive)),
    markSlackNotified: vi.fn(() => Promise.resolve()),
  };
}

function makeSubscribers(count = 3): NotifierSubscriberCount {
  return { countConfirmed: vi.fn(() => Promise.resolve(count)) };
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
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" });
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
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" });
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
      subscribers: makeSubscribers(),
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
    await notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" });
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
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyReviewedArchive({
      runId: "missing",
      trigger: "manual",
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
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" });
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
      subscribers: makeSubscribers(7),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => fixedNow,
    });
    await notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" });
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
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" }),
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
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(
      notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" }),
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

  it("never logs the webhook URL or its secret path token", async () => {
    const { calls, logger } = makeCapturedLogger();
    const archives = makeArchives(makeArchive());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response("server", { status: 500 })),
    );
    const notifier = createSlackNotifier({
      webhookUrl: SECRET_URL,
      archives,
      subscribers: makeSubscribers(),
      resolveTopRankedTitle: resolveTitle,
      logger,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await notifier.notifyReviewedArchive({ runId: "run-1", trigger: "manual" });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("SECRET_PATH_TOKEN");
    expect(serialized).not.toContain(SECRET_URL);
  });
});
