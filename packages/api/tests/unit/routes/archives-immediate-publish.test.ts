/**
 * Integration tests for the immediate-publish block wired into
 * PATCH /api/admin/archives/:runId (Phase 2).
 *
 * Traces: REQ-001, REQ-002, REQ-003, REQ-008, REQ-009, REQ-010, REQ-011
 *         EDGE-003, EDGE-004, EDGE-006, EDGE-007, EDGE-008
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import type { Queue } from "bullmq";
import { createAdminArchivesRouter } from "@api/routes/archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchiveRow, RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** The run completed well in the past so channels can be past-due. */
const PAST_COMPLETED_AT = new Date("2026-01-15T06:00:00Z");

/**
 * Settings where all three channels are enabled and their publish times are
 * well before the current test "now". pipelineTime="06:00", channel times all
 * earlier in the day in UTC — so completedAt 06:00 UTC with those times gives
 * past-due channels when now is after those times.
 *
 * We use a fixed timezone (UTC) and channel times of "07:00", "08:00", "09:00"
 * with pipelineTime "06:00". After completedAt (06:00), window=next-occurrence
 * of those times. Our test "now" is midnight the NEXT day (>all windows).
 */
function makeSettings(overrides: Partial<{
  scheduleEnabled: boolean;
  emailEnabled: boolean;
  linkedinEnabled: boolean;
  twitterPostEnabled: boolean;
  emailTime: string;
  linkedinTime: string;
  twitterTime: string;
  pipelineTime: string;
  scheduleTimezone: string;
}> = {}): UserSettings {
  return {
    id: "settings-singleton",
    topN: 10,
    halfLifeHours: 24,
    hnEnabled: true,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: overrides.pipelineTime ?? "06:00",
    pipelineTime: overrides.pipelineTime ?? "06:00",
    emailTime: overrides.emailTime ?? "07:00",
    linkedinTime: overrides.linkedinTime ?? "08:00",
    twitterTime: overrides.twitterTime ?? "09:00",
    scheduleTimezone: overrides.scheduleTimezone ?? "UTC",
    scheduleEnabled: overrides.scheduleEnabled ?? true,
    emailEnabled: overrides.emailEnabled ?? true,
    linkedinEnabled: overrides.linkedinEnabled ?? true,
    twitterPostEnabled: overrides.twitterPostEnabled ?? true,
    autoReview: false,
    rankingPrompt: "rank these",
    shortlistPrompt: "shortlist these",
    shortlistSize: 20,
    updatedAt: new Date().toISOString(),
  };
}

function makeArchiveRow(
  overrides: Partial<RunArchiveRow> = {},
): RunArchiveRow {
  return {
    id: "run-uuid-1",
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "" }],
    topN: 1,
    reviewed: true,
    completedAt: PAST_COMPLETED_AT,
    publishedAt: null,
    createdAt: PAST_COMPLETED_AT,
    startedAt: null,
    sourceTypes: ["hn"],
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    isDryRun: false,
    costBreakdown: null,
    runFunnel: null,
    ...overrides,
  };
}

function makeRawRepo(): RawItemsRepo {
  return {
    findByIds: vi.fn((ids: number[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          sourceType: "hn" as const,
          title: `t${String(id)}`,
          url: `https://example.com/${String(id)}`,
          author: null,
          publishedAt: null,
          engagement: { points: 0, commentCount: 0 },
          content: null,
          imageUrl: null,
          metadata: { comments: [] },
        })),
      ),
    ),
  };
}

function makeArchiveRepo(
  row: RunArchiveRow | null,
  updatedRow?: RunArchiveRow,
): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve([])),
    searchReviewed: vi.fn(() => Promise.resolve({ archives: [], total: 0 })),
    findMostRecentReviewed: vi.fn(() => Promise.resolve(null)),
    findLatestReviewedSince: vi.fn(() => Promise.resolve(null)),
    updateRankedItems: vi.fn(() =>
      Promise.resolve(updatedRow ?? (row as RunArchiveRow)),
    ),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
    markSlackNotified: vi.fn(() => Promise.resolve()),
    markEmailSent: vi.fn(() => Promise.resolve()),
    markNotification: vi.fn(() => Promise.resolve()),
    markLinkedInPosted: vi.fn(() => Promise.resolve()),
    markTwitterPosted: vi.fn(() => Promise.resolve()),
    recordSocialFailure: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve({ deleted: true, removedEmailSends: 0 })),
    getReviewedDigestCountsByDerivedSource: vi.fn(() => Promise.resolve(new Map())),
    getRecentSourceTelemetry: vi.fn(() => Promise.resolve(new Map())),
    getSourceFailuresInRange: vi.fn(() => Promise.resolve([])),
    countCompletedRunsInRange: vi.fn(() => Promise.resolve(0)),
  };
}

function makeSettingsRepo(
  settings: UserSettings | null,
): Pick<UserSettingsRepo, "get"> {
  return {
    get: vi.fn(() => Promise.resolve(settings)),
  };
}

function makeQueue(): { queue: Pick<Queue, "add">; addSpy: ReturnType<typeof vi.fn> } {
  const addSpy = vi.fn(() => Promise.resolve({ id: "job-1" }));
  return { queue: { add: addSpy }, addSpy };
}

interface BuildAppOpts {
  archiveRow: RunArchiveRow | null;
  updatedRow?: RunArchiveRow;
  settings?: UserSettings | null;
  processingQueue?: Pick<Queue, "add">;
  logger?: Parameters<typeof createAdminArchivesRouter>[0]["logger"];
}

function buildApp(opts: BuildAppOpts): {
  app: Hono;
  addSpy: ReturnType<typeof vi.fn> | undefined;
} {
  const archiveRepo = makeArchiveRepo(opts.archiveRow, opts.updatedRow);
  const rawRepo = makeRawRepo();
  let addSpy: ReturnType<typeof vi.fn> | undefined;

  const deps: Parameters<typeof createAdminArchivesRouter>[0] = {
    getArchiveRepo: () => archiveRepo,
    getRawItemsRepo: () => rawRepo,
    logger: opts.logger,
  };

  if (opts.processingQueue !== undefined) {
    deps.processingQueue = opts.processingQueue;
    // Extract the spy from the queue if it's our spy-wrapped one
    addSpy = opts.processingQueue.add as ReturnType<typeof vi.fn>;
  }

  if (opts.settings !== undefined) {
    const settingsValue = opts.settings;
    deps.getSettingsRepo = () => makeSettingsRepo(settingsValue);
  }

  const app = new Hono();
  app.route("/api/admin/archives", createAdminArchivesRouter(deps));
  return { app, addSpy };
}

/**
 * "now" is midnight the next day after PAST_COMPLETED_AT.
 * All channel times (07:00, 08:00, 09:00) on 2026-01-15 UTC are in the past.
 */
const NOW_PAST_DUE = new Date("2026-01-16T00:00:00Z");

const PATCH_BODY = JSON.stringify({
  rankedItems: [{ id: 1, sourceType: "hn" }],
});

const PATCH_HEADERS = { "Content-Type": "application/json" };

// ── tests ─────────────────────────────────────────────────────────────────────
// ── tests ─────────────────────────────────────────────────────────────────────
//
// The channel-selection matrix (which past-due/enabled channels get enqueued) is
// driven by the pure shared helper `selectImmediatePublishChannels`, unit-tested
// directly in @newsletter/shared. The wired PATCH path + real-DB behavior is
// covered by archives.e2e.test.ts (VS-1/VS-2). Here we keep a parameterized
// integration table for the route wiring plus the discrete dependency-guard and
// observability (log) cases.

interface EnqueueCase {
  readonly name: string;
  /** Wall-clock "now" the handler observes. */
  readonly now: Date;
  /** Settings overrides for the singleton row. */
  readonly settings?: Parameters<typeof makeSettings>[0];
  /** Sent-timestamp overrides on the post-PATCH (updated) archive row. */
  readonly updatedRow?: Partial<RunArchiveRow>;
  /** Channels expected to be enqueued (exact set). */
  readonly expected: readonly ("email-send" | "linkedin-post" | "twitter-post")[];
}

const ALL_CHANNELS = ["email-send", "linkedin-post", "twitter-post"] as const;

function jobIdFor(channel: (typeof ALL_CHANNELS)[number]): string {
  return `${channel}-run-uuid-1`;
}

describe("PATCH /api/admin/archives/:runId — immediate publish block", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: EnqueueCase[] = [
    {
      name: "REQ-002/EDGE-008: all channels enabled + past-due → all three enqueued",
      now: NOW_PAST_DUE,
      expected: ALL_CHANNELS,
    },
    {
      name: "REQ-003/EDGE-007: email past-due, linkedin+twitter future → only email-send",
      // 07:30 UTC: email (07:00) past-due; linkedin (08:00) + twitter (09:00) future.
      now: new Date("2026-01-15T07:30:00Z"),
      settings: { emailTime: "07:00", linkedinTime: "08:00", twitterTime: "09:00" },
      expected: ["email-send"],
    },
    {
      name: "REQ-008: emailSentAt set → email-send skipped, others enqueued",
      now: NOW_PAST_DUE,
      updatedRow: { emailSentAt: new Date("2026-01-15T07:05:00Z") },
      expected: ["linkedin-post", "twitter-post"],
    },
    {
      name: "REQ-008: linkedinPostedAt set → linkedin-post skipped, others enqueued",
      now: NOW_PAST_DUE,
      updatedRow: { linkedinPostedAt: new Date("2026-01-15T08:05:00Z") },
      expected: ["email-send", "twitter-post"],
    },
    {
      name: "REQ-008: twitterPostedAt set → twitter-post skipped, others enqueued",
      now: NOW_PAST_DUE,
      updatedRow: { twitterPostedAt: new Date("2026-01-15T09:05:00Z") },
      expected: ["email-send", "linkedin-post"],
    },
    {
      name: "REQ-004: twitterPostEnabled=false → twitter-post not enqueued",
      now: NOW_PAST_DUE,
      settings: { twitterPostEnabled: false },
      expected: ["email-send", "linkedin-post"],
    },
    {
      name: "REQ-004: scheduleEnabled=false → no channels enqueued",
      now: NOW_PAST_DUE,
      settings: { scheduleEnabled: false },
      expected: [],
    },
    {
      name: "EDGE-002: emailSentAt null + linkedinPostedAt set → email + twitter only",
      now: NOW_PAST_DUE,
      updatedRow: {
        emailSentAt: null,
        linkedinPostedAt: new Date("2026-01-15T08:05:00Z"),
        twitterPostedAt: null,
      },
      expected: ["email-send", "twitter-post"],
    },
    {
      name: "EDGE-001/REQ-011: all three already sent → enqueues nothing",
      now: NOW_PAST_DUE,
      updatedRow: {
        emailSentAt: new Date("2026-01-15T07:05:00Z"),
        linkedinPostedAt: new Date("2026-01-15T08:05:00Z"),
        twitterPostedAt: new Date("2026-01-15T09:05:00Z"),
      },
      expected: [],
    },
  ];

  it.each(cases)("$name", async ({ now, settings, updatedRow, expected }) => {
    vi.setSystemTime(now);

    const { queue, addSpy } = makeQueue();
    const { app } = buildApp({
      archiveRow: makeArchiveRow({ reviewed: false }),
      updatedRow: makeArchiveRow({ reviewed: true, ...updatedRow }),
      settings: makeSettings(settings),
      processingQueue: queue,
    });

    const res = await app.request("/api/admin/archives/run-uuid-1", {
      method: "PATCH",
      headers: PATCH_HEADERS,
      body: PATCH_BODY,
    });

    expect(res.status).toBe(200);
    expect(addSpy).toHaveBeenCalledTimes(expected.length);
    for (const channel of expected) {
      expect(addSpy).toHaveBeenCalledWith(
        channel,
        { runId: "run-uuid-1" },
        { jobId: jobIdFor(channel), delay: 0 },
      );
    }
    for (const channel of ALL_CHANNELS) {
      if (!expected.includes(channel)) {
        expect(addSpy).not.toHaveBeenCalledWith(
          channel,
          expect.anything(),
          expect.anything(),
        );
      }
    }
  });

  describe("dependency guards: PATCH still returns 200 with no enqueue", () => {
    it("REQ-010: no processingQueue dep → 200 + updated archive, no enqueue", async () => {
      vi.setSystemTime(NOW_PAST_DUE);
      const { app } = buildApp({
        archiveRow: makeArchiveRow({ reviewed: false }),
        updatedRow: makeArchiveRow({ reviewed: true }),
        settings: makeSettings(),
        // processingQueue intentionally omitted
      });

      const res = await app.request("/api/admin/archives/run-uuid-1", {
        method: "PATCH",
        headers: PATCH_HEADERS,
        body: PATCH_BODY,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { reviewed: boolean };
      expect(body.reviewed).toBe(true);
    });

    it("getSettingsRepo undefined → 200, no enqueue", async () => {
      vi.setSystemTime(NOW_PAST_DUE);
      const { queue, addSpy } = makeQueue();
      const archiveRepo = makeArchiveRepo(
        makeArchiveRow({ reviewed: false }),
        makeArchiveRow({ reviewed: true }),
      );
      const app = new Hono();
      app.route(
        "/api/admin/archives",
        createAdminArchivesRouter({
          getArchiveRepo: () => archiveRepo,
          getRawItemsRepo: () => makeRawRepo(),
          processingQueue: queue,
          // getSettingsRepo intentionally omitted
        }),
      );

      const res = await app.request("/api/admin/archives/run-uuid-1", {
        method: "PATCH",
        headers: PATCH_HEADERS,
        body: PATCH_BODY,
      });

      expect(res.status).toBe(200);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it("settings is null → 200, no enqueue", async () => {
      vi.setSystemTime(NOW_PAST_DUE);
      const { queue, addSpy } = makeQueue();
      const { app } = buildApp({
        archiveRow: makeArchiveRow({ reviewed: false }),
        updatedRow: makeArchiveRow({ reviewed: true }),
        settings: null,
        processingQueue: queue,
      });

      const res = await app.request("/api/admin/archives/run-uuid-1", {
        method: "PATCH",
        headers: PATCH_HEADERS,
        body: PATCH_BODY,
      });

      expect(res.status).toBe(200);
      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  it("EDGE-003: autoReview=true in settings does NOT suppress the immediate block", async () => {
    vi.setSystemTime(NOW_PAST_DUE);
    const { queue, addSpy } = makeQueue();
    const settingsWithAutoReview = makeSettings({ scheduleEnabled: true });
    settingsWithAutoReview.autoReview = true;

    const archiveRepo = makeArchiveRepo(
      makeArchiveRow({ reviewed: false }),
      makeArchiveRow({ reviewed: true }),
    );
    const app = new Hono();
    app.route(
      "/api/admin/archives",
      createAdminArchivesRouter({
        getArchiveRepo: () => archiveRepo,
        getRawItemsRepo: () => makeRawRepo(),
        processingQueue: queue,
        getSettingsRepo: () => makeSettingsRepo(settingsWithAutoReview),
      }),
    );

    const res = await app.request("/api/admin/archives/run-uuid-1", {
      method: "PATCH",
      headers: PATCH_HEADERS,
      body: PATCH_BODY,
    });

    expect(res.status).toBe(200);
    expect(addSpy).toHaveBeenCalledTimes(3);
  });

  it("REQ-009: emits archive.immediate_publish_enqueued log after past-due enqueue", async () => {
    vi.setSystemTime(NOW_PAST_DUE);

    const infoSpy = vi.fn();
    const logger = {
      info: infoSpy,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Parameters<typeof createAdminArchivesRouter>[0]["logger"];

    const { queue } = makeQueue();
    const { app } = buildApp({
      archiveRow: makeArchiveRow({ reviewed: false }),
      updatedRow: makeArchiveRow({ reviewed: true }),
      settings: makeSettings(),
      processingQueue: queue,
      logger,
    });

    await app.request("/api/admin/archives/run-uuid-1", {
      method: "PATCH",
      headers: PATCH_HEADERS,
      body: PATCH_BODY,
    });

    const publishLog = infoSpy.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event ===
          "archive.immediate_publish_enqueued",
    );
    expect(publishLog).toBeDefined();
    const logContext = publishLog?.[0] as Record<string, unknown> | undefined;
    expect(logContext?.runId).toBe("run-uuid-1");
    expect(logContext?.enqueued).toEqual(
      expect.arrayContaining(["email-send", "linkedin-post", "twitter-post"]),
    );
  });

  it("REQ-008: re-PATCH already-reviewed archive → 200 + persisted (updateRankedItems called once)", async () => {
    vi.setSystemTime(NOW_PAST_DUE);
    const updatedRow = makeArchiveRow({
      reviewed: true,
      rankedItems: [
        { rawItemId: 1, score: 0.9, rationale: "" },
        { rawItemId: 2, score: 0.8, rationale: "" },
      ],
    });
    const archiveRepo = makeArchiveRepo(makeArchiveRow({ reviewed: true }), updatedRow);
    const app = new Hono();
    app.route(
      "/api/admin/archives",
      createAdminArchivesRouter({
        getArchiveRepo: () => archiveRepo,
        getRawItemsRepo: () => makeRawRepo(),
      }),
    );

    const res = await app.request("/api/admin/archives/run-uuid-1", {
      method: "PATCH",
      headers: PATCH_HEADERS,
      body: JSON.stringify({
        rankedItems: [
          { id: 1, sourceType: "hn" },
          { id: 2, sourceType: "hn" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(archiveRepo.updateRankedItems).toHaveBeenCalledOnce();
    const body = (await res.json()) as { reviewed: boolean };
    expect(body.reviewed).toBe(true);
  });
});
