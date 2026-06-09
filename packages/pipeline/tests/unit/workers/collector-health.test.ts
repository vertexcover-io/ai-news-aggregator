import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist module mocks so they run before imports
const mockWorkerConstructor = vi.hoisted(() => vi.fn());
const mockCreateRedisConnection = vi.hoisted(() => vi.fn(() => ({ fake: "redis" })));
const mockCreateLogger = vi.hoisted(() =>
  vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  })),
);

vi.mock("bullmq", () => ({
  Worker: mockWorkerConstructor.mockImplementation((name, handler, opts) => ({
    name,
    handler,
    options: opts,
    close: vi.fn(),
    on: vi.fn(),
  })),
  Queue: vi.fn().mockImplementation((name, opts) => ({
    name,
    options: opts,
    add: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: mockCreateRedisConnection,
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: mockCreateLogger,
}));

vi.mock("@newsletter/shared", async () => {
  const actual = await vi.importActual("@newsletter/shared");
  return {
    ...(actual as Record<string, unknown>),
    getDb: vi.fn(() => ({ fake: "db" })),
    createSlackNotifier: vi.fn(() => ({ notifyReviewPending: vi.fn() })),
  };
});

vi.mock("@newsletter/shared/services/credential-cipher", () => ({
  getCredentialCipher: vi.fn(() => ({ encrypt: vi.fn(), decrypt: vi.fn() })),
}));

vi.mock("@pipeline/repositories/social-credentials.js", () => ({
  createSocialCredentialsRepo: vi.fn(() => ({
    getLinkedIn: vi.fn().mockResolvedValue(null),
    getTwitter: vi.fn().mockResolvedValue(null),
    getTwitterCollector: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@pipeline/repositories/user-settings.js", () => ({
  createUserSettingsRepo: vi.fn(() => ({ get: vi.fn().mockResolvedValue(null) })),
}));

vi.mock("@pipeline/services/credential-resolver.js", () => ({
  resolveLinkedInCredentials: vi.fn().mockResolvedValue(null),
  resolveTwitterOAuth1Credentials: vi.fn().mockResolvedValue(null),
  resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
}));

vi.mock("@pipeline/workers/run-process.js", () => ({
  handleRunProcessJob: vi.fn(),
}));

vi.mock("@pipeline/workers/daily-run.js", () => ({
  handleDailyRunJob: vi.fn(),
}));

vi.mock("@pipeline/workers/email-send.js", () => ({
  handleEmailSendJob: vi.fn(),
}));

vi.mock("@pipeline/workers/linkedin-post.js", () => ({
  handleLinkedInPostJob: vi.fn(),
}));

vi.mock("@pipeline/workers/twitter-post.js", () => ({
  handleTwitterPostJob: vi.fn(),
}));

vi.mock("@pipeline/workers/social-health.js", () => ({
  handleSocialHealthJob: vi.fn(),
}));

vi.mock("@pipeline/social/linkedin/notifier.js", () => ({
  createLinkedInNotifier: vi.fn(() => ({ notifyArchiveReady: vi.fn() })),
}));

vi.mock("@pipeline/social/twitter/notifier.js", () => ({
  createTwitterNotifier: vi.fn(() => ({ notifyArchiveReady: vi.fn() })),
}));

vi.mock("@pipeline/social/linkedin/api-client.js", () => ({
  createLinkedInApiClient: vi.fn(() => ({ fake: "linkedin-client" })),
}));

vi.mock("@pipeline/social/twitter/api-client.js", () => ({
  createTwitterApiClient: vi.fn(() => ({ fake: "twitter-client" })),
}));

vi.mock("@pipeline/repositories/social-tokens.js", () => ({
  createSocialTokensRepo: vi.fn(() => ({ fake: "social-tokens" })),
}));

vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({ findByIds: vi.fn() })),
}));

vi.mock("@pipeline/repositories/run-archives.js", () => ({
  createRunArchivesRepo: vi.fn(() => ({ fake: "run-archives" })),
}));

vi.mock("@pipeline/repositories/candidates.js", () => ({
  createCandidatesRepo: vi.fn(() => ({ fake: "candidates" })),
}));

vi.mock("@pipeline/repositories/run-logs.js", () => ({
  createRunLogRepo: vi.fn(() => ({ append: vi.fn() })),
}));

vi.mock("@pipeline/repositories/subscribers.js", () => ({
  createPipelineSubscribersRepo: vi.fn(() => ({ fake: "subscribers" })),
}));

vi.mock("@pipeline/repositories/email-sends.js", () => ({
  createPipelineEmailSendsRepo: vi.fn(() => ({ fake: "email-sends" })),
}));

vi.mock("@pipeline/services/cancel-subscriber.js", () => ({
  createCancelSubscriber: vi.fn(() => ({ subscribe: vi.fn() })),
}));

vi.mock("@pipeline/services/run-state.js", () => ({
  createRunStateService: vi.fn(() => ({ setStage: vi.fn() })),
}));

vi.mock("@pipeline/services/candidate-loader.js", () => ({
  loadCandidatesSince: vi.fn(),
}));

vi.mock("@pipeline/collectors/hn.js", () => ({ collectHn: vi.fn() }));
vi.mock("@pipeline/collectors/reddit.js", () => ({ collectReddit: vi.fn() }));
vi.mock("@pipeline/collectors/web.js", () => ({ collectWeb: vi.fn() }));
vi.mock("@pipeline/collectors/twitter/index.js", () => ({ collectTwitter: vi.fn() }));
vi.mock("@pipeline/collectors/web-search/index.js", () => ({ collectWebSearch: vi.fn() }));
vi.mock("@pipeline/collectors/web-search/providers/index.js", () => ({
  createWebSearchProvider: vi.fn(() => ({ search: vi.fn() })),
}));
vi.mock("@pipeline/collectors/twitter/clients/rettiwt.js", () => ({
  createRettiwtClient: vi.fn(() => ({ list: { tweets: vi.fn() }, user: { timeline: vi.fn() } })),
}));
vi.mock("@pipeline/collectors/twitter/clients/rettiwt-auth.js", () => ({
  refreshRettiwtCsrfToken: vi.fn(),
}));
vi.mock("@pipeline/processors/rank.js", () => ({ rankCandidates: vi.fn() }));
vi.mock("@pipeline/processors/shortlist.js", () => ({ shortlistCandidates: vi.fn() }));
vi.mock("@pipeline/lib/email-render.js", () => ({ renderNewsletter: vi.fn() }));
vi.mock("@pipeline/lib/email-provider.js", () => ({ createEmailProvider: vi.fn(() => ({})) }));
vi.mock("@pipeline/services/web-crawler.js", () => ({ runWebCrawl: vi.fn() }));
vi.mock("@pipeline/lib/posthog.js", () => ({ capturePipelineEvent: vi.fn() }));
vi.mock("rettiwt-api", () => ({ Rettiwt: vi.fn() }));

import {
  handleCollectorHealthJob,
  createCollectorHealthWorker,
} from "@pipeline/workers/collector-health.js";
import type { CollectorHealthJobDeps } from "@pipeline/workers/collector-health.js";
import type { CollectorHealthStore } from "@newsletter/shared/services";
import type { CollectorHealthResult, HealthCheckCollector } from "@newsletter/shared/types";
import type { CheckableCollector, CollectorHealthOutcome, HealthCheckDeps } from "@pipeline/services/collector-health/index.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import type { UserSettings } from "@newsletter/shared";
import { COLLECTOR_HEALTH_QUEUE_NAME } from "@newsletter/shared/constants";

// ─── Fakes ────────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeStore(overrides: Partial<CollectorHealthStore> = {}): CollectorHealthStore {
  return {
    set: vi.fn().mockResolvedValue(undefined),
    setRunning: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue({ collectors: [] }),
    ...overrides,
  };
}

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "settings-1",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: { keywords: ["AI"], pointsThreshold: 50, sinceDays: 1 },
    redditEnabled: true,
    redditConfig: { subreddits: ["MachineLearning"], sort: "hot", limit: 25, sinceDays: 1 },
    webEnabled: true,
    webConfig: { sources: [{ name: "Test", listingUrl: "https://example.com/blog" }], maxItems: 10 },
    twitterEnabled: true,
    twitterConfig: { listIds: ["12345"], users: [], maxTweetsPerSource: 20, sinceHours: 24 },
    webSearchEnabled: true,
    webSearchConfig: { provider: "tavily", queries: [{ query: "AI news", sinceDays: 1, maxItems: 5 }] },
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "06:00",
    pipelineTime: "06:00",
    emailTime: "07:00",
    linkedinTime: "08:00",
    twitterTime: "08:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: "rank these",
    shortlistPrompt: "shortlist these",
    shortlistSize: 20,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeUserSettingsRepo(settings: UserSettings | null = makeSettings()): UserSettingsRepo {
  return {
    get: vi.fn().mockResolvedValue(settings),
  };
}

function makeHealthOutcome(status: "healthy" | "failed" = "healthy"): CollectorHealthOutcome {
  return {
    status,
    durationMs: 100,
    reason: status === "failed" ? "test failure" : null,
    detail: status === "healthy" ? "ok" : null,
  };
}

function makeRunCollectorHealthCheck(
  outcomes: Partial<Record<CheckableCollector, CollectorHealthOutcome | Error>> = {},
) {
  return vi.fn().mockImplementation(
    (collector: CheckableCollector): Promise<CollectorHealthOutcome> => {
      const outcome = outcomes[collector];
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome ?? makeHealthOutcome("healthy"));
    },
  );
}

function makeFakeHealthCheckDeps(): HealthCheckDeps {
  return {
    credentialResolver: {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: undefined,
    },
    logger: makeLogger(),
  };
}

function makeDeps(overrides: Partial<CollectorHealthJobDeps> = {}): CollectorHealthJobDeps {
  return {
    userSettingsRepo: makeUserSettingsRepo(),
    store: makeStore(),
    runCollectorHealthCheck: makeRunCollectorHealthCheck(),
    buildHealthCheckDeps: vi.fn().mockResolvedValue(makeFakeHealthCheckDeps()),
    slackWebhookUrl: undefined,
    postToWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    capturePipelineEvent: vi.fn(),
    logger: makeLogger(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleCollectorHealthJob", () => {
  it("manual: explicit collectors both reach terminal — running NOT re-written for manual (REQ-003, REQ-013)", async () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-1",
      data: { collectors: ["hn", "reddit"], trigger: "manual" },
    });

    // setRunning must NOT be called for manual — API already set it
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(store.setRunning)).not.toHaveBeenCalled();

    // Both collectors must be persisted via store.set
    const setCalls = (store.set as ReturnType<typeof vi.fn>).mock.calls as [CollectorHealthResult][];
    const persistedCollectors = setCalls.map((c) => c[0].collector);
    expect(persistedCollectors).toContain("hn");
    expect(persistedCollectors).toContain("reddit");

    // Both should be terminal (healthy or failed)
    for (const call of setCalls) {
      expect(["healthy", "failed"]).toContain(call[0].status);
    }
  });

  it("scheduled: no explicit collectors → all enabled targeted with trigger:scheduled + setRunning called (REQ-013)", async () => {
    const store = makeStore();
    const runCheck = makeRunCollectorHealthCheck();
    const deps = makeDeps({ store, runCollectorHealthCheck: runCheck });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-2",
      data: { trigger: "scheduled" },
    });

    // setRunning must be called for each enabled collector before the check
    const setRunningCalls = (store.setRunning as ReturnType<typeof vi.fn>).mock.calls as [HealthCheckCollector, "scheduled" | "manual", Date][];
    const runningCollectors = setRunningCalls.map((c) => c[0]);

    // With all enabled, should include hn, reddit, twitter, blog, web_search
    expect(runningCollectors).toContain("hn");
    expect(runningCollectors).toContain("reddit");
    expect(runningCollectors).toContain("twitter");
    expect(runningCollectors).toContain("blog");
    expect(runningCollectors).toContain("web_search");

    // trigger must be "scheduled"
    for (const call of setRunningCalls) {
      expect(call[1]).toBe("scheduled");
    }

    // All should also reach terminal
    const setCalls = (store.set as ReturnType<typeof vi.fn>).mock.calls as [CollectorHealthResult][];
    expect(setCalls.length).toBe(5); // 5 enabled collectors
  });

  it("one strategy throws → other collectors still persisted terminal (REQ-010)", async () => {
    const store = makeStore();
    const runCheck = makeRunCollectorHealthCheck({
      reddit: new Error("reddit exploded"),
    });
    const deps = makeDeps({ store, runCollectorHealthCheck: runCheck });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-3",
      data: { collectors: ["hn", "reddit"], trigger: "manual" },
    });

    // Both collectors should still get store.set called
    const setCalls = (store.set as ReturnType<typeof vi.fn>).mock.calls as [CollectorHealthResult][];
    const persistedCollectors = setCalls.map((c) => c[0].collector);
    expect(persistedCollectors).toContain("hn");
    expect(persistedCollectors).toContain("reddit");

    // The thrown one must result in a "failed" status
    const redditResult = setCalls.find((c) => c[0].collector === "reddit");
    expect(redditResult?.[0]?.status).toBe("failed");

    // The healthy one must be "healthy"
    const hnResult = setCalls.find((c) => c[0].collector === "hn");
    expect(hnResult?.[0]?.status).toBe("healthy");
  });

  it("≥1 failure + webhook set → exactly one postToWebhook call with consolidated message (REQ-014)", async () => {
    const postToWebhook = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const runCheck = makeRunCollectorHealthCheck({
      hn: makeHealthOutcome("failed"),
      reddit: makeHealthOutcome("failed"),
    });
    const deps = makeDeps({
      runCollectorHealthCheck: runCheck,
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
      postToWebhook,
    });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-4",
      data: { collectors: ["hn", "reddit"], trigger: "manual" },
    });

    // Exactly one postToWebhook call
    expect(postToWebhook).toHaveBeenCalledOnce();

    // Payload must contain both failures
    const callArgs = postToWebhook.mock.calls[0] as [{ url: string; blocks: unknown[] }];
    expect(callArgs[0].url).toBe("https://hooks.slack.com/services/T/B/C");
    expect(callArgs[0].blocks).toBeDefined();
  });

  it("all collectors healthy + webhook set → no postToWebhook (REQ-014)", async () => {
    const postToWebhook = vi.fn();
    const deps = makeDeps({
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
      postToWebhook,
    });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-5",
      data: { collectors: ["hn"], trigger: "manual" },
    });

    expect(postToWebhook).not.toHaveBeenCalled();
  });

  it("webhook unset → no postToWebhook, job ok (REQ-015)", async () => {
    const postToWebhook = vi.fn();
    const runCheck = makeRunCollectorHealthCheck({ hn: makeHealthOutcome("failed") });
    const deps = makeDeps({
      runCollectorHealthCheck: runCheck,
      slackWebhookUrl: undefined,
      postToWebhook,
    });

    await expect(
      handleCollectorHealthJob(deps, {
        name: "collector-health",
        id: "job-6",
        data: { collectors: ["hn"], trigger: "manual" },
      }),
    ).resolves.toBeUndefined();

    expect(postToWebhook).not.toHaveBeenCalled();
  });

  it("webhook non-2xx → warn log, job ok, does not throw (REQ-016)", async () => {
    const logger = makeLogger();
    const postToWebhook = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const runCheck = makeRunCollectorHealthCheck({ hn: makeHealthOutcome("failed") });
    const deps = makeDeps({
      runCollectorHealthCheck: runCheck,
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
      postToWebhook,
      logger,
    });

    await expect(
      handleCollectorHealthJob(deps, {
        name: "collector-health",
        id: "job-7",
        data: { collectors: ["hn"], trigger: "manual" },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "slack.collector_health.failed" }),
      expect.any(String),
    );
  });

  it("webhook throws → warn log, job ok, does not throw (REQ-016)", async () => {
    const logger = makeLogger();
    const postToWebhook = vi.fn().mockRejectedValue(new Error("network error"));
    const runCheck = makeRunCollectorHealthCheck({ hn: makeHealthOutcome("failed") });
    const deps = makeDeps({
      runCollectorHealthCheck: runCheck,
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
      postToWebhook,
      logger,
    });

    await expect(
      handleCollectorHealthJob(deps, {
        name: "collector-health",
        id: "job-8",
        data: { collectors: ["hn"], trigger: "manual" },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "slack.collector_health.failed" }),
      expect.any(String),
    );
  });

  it("empty targets (all disabled) → logs and returns without calling store or runCheck (EDGE-001)", async () => {
    const store = makeStore();
    const runCheck = makeRunCollectorHealthCheck();
    const noEnabledSettings = makeSettings({
      hnEnabled: false,
      redditEnabled: false,
      webEnabled: false,
      twitterEnabled: false,
      webSearchEnabled: false,
    });
    const deps = makeDeps({
      store,
      runCollectorHealthCheck: runCheck,
      userSettingsRepo: makeUserSettingsRepo(noEnabledSettings),
    });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-9",
      data: { trigger: "scheduled" },
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(store.set)).not.toHaveBeenCalled();
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("last-writer-wins: two sequential calls for same collector overwrite (EDGE-008)", async () => {
    const setResults: CollectorHealthResult[] = [];
    const store = makeStore({
      set: vi.fn().mockImplementation((r: CollectorHealthResult) => {
        setResults.push(r);
        return Promise.resolve();
      }),
    });

    const deps1 = makeDeps({ store });
    const deps2 = makeDeps({
      store,
      runCollectorHealthCheck: makeRunCollectorHealthCheck({ hn: makeHealthOutcome("failed") }),
    });

    await handleCollectorHealthJob(deps1, {
      name: "collector-health",
      id: "job-10a",
      data: { collectors: ["hn"], trigger: "manual" },
    });

    await handleCollectorHealthJob(deps2, {
      name: "collector-health",
      id: "job-10b",
      data: { collectors: ["hn"], trigger: "manual" },
    });

    // Two writes total for "hn"
    const hnWrites = setResults.filter((r) => r.collector === "hn");
    expect(hnWrites.length).toBe(2);
    // Second write is "failed"
    expect(hnWrites[1].status).toBe("failed");
  });

  it("store.set result shape includes required fields", async () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "job-11",
      data: { collectors: ["hn"], trigger: "manual" },
    });

    const setCalls = (store.set as ReturnType<typeof vi.fn>).mock.calls as [CollectorHealthResult][];
    expect(setCalls.length).toBe(1);
    const result = setCalls[0][0];
    expect(result.collector).toBe("hn");
    expect(result.trigger).toBe("manual");
    expect(result.checkedAt).toBeDefined();
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("buildHealthCheckDeps throws after scheduled setRunning → collectors written as failed, job rethrows (stuck-running guard)", async () => {
    // RED: If buildHealthCheckDeps throws after setRunning for a scheduled job,
    // the collectors must be written as "failed" (not left stuck in "running").
    const store = makeStore();
    const depsErr = makeDeps({
      store,
      buildHealthCheckDeps: vi.fn().mockRejectedValue(new Error("credential DB failure")),
    });

    await expect(
      handleCollectorHealthJob(depsErr, {
        name: "collector-health",
        id: "job-stuck",
        data: { collectors: ["hn", "reddit"], trigger: "scheduled" },
      }),
    ).rejects.toThrow("credential DB failure");

    // setRunning was called for scheduled trigger
    const setRunningCalls = (store.setRunning as ReturnType<typeof vi.fn>).mock.calls as [HealthCheckCollector, string, Date][];
    expect(setRunningCalls.map((c) => c[0])).toContain("hn");
    expect(setRunningCalls.map((c) => c[0])).toContain("reddit");

    // store.set must have been called with "failed" for each targeted collector
    const setCalls = (store.set as ReturnType<typeof vi.fn>).mock.calls as [CollectorHealthResult][];
    const persistedCollectors = setCalls.map((c) => c[0].collector);
    expect(persistedCollectors).toContain("hn");
    expect(persistedCollectors).toContain("reddit");
    for (const call of setCalls) {
      expect(call[0].status).toBe("failed");
    }
  });

  it("userSettingsRepo.get throws for manual trigger → targets written as failed, job rethrows (stuck-running guard)", async () => {
    // RED: For manual trigger with explicit collectors, if settings.get throws
    // AFTER the API wrote "running", the job must still write "failed" before rethrowing.
    const store = makeStore();
    const depsErr = makeDeps({
      store,
      userSettingsRepo: { get: vi.fn().mockRejectedValue(new Error("DB unavailable")) },
    });

    await expect(
      handleCollectorHealthJob(depsErr, {
        name: "collector-health",
        id: "job-stuck-manual",
        data: { collectors: ["hn"], trigger: "manual" },
      }),
    ).rejects.toThrow("DB unavailable");

    // store.set must have been called with "failed" for "hn"
    const setCalls = (store.set as ReturnType<typeof vi.fn>).mock.calls as [CollectorHealthResult][];
    expect(setCalls.some((c) => c[0].collector === "hn" && c[0].status === "failed")).toBe(true);
  });
});

// ─── PostHog collector_preflight_failed emit ─────────────────────────────────

describe("handleCollectorHealthJob — PostHog emit (collector_preflight_failed)", () => {
  type CaptureCall = [string, Record<string, unknown>];

  it("F1/F2/F3: one collector_preflight_failed event per failed collector with collector/reason/trigger/durationMs/severity", async () => {
    const capturePipelineEvent = vi.fn();
    const runCheck = makeRunCollectorHealthCheck({
      hn: { status: "failed", durationMs: 120, reason: "HN auth failed", detail: null },
      reddit: { status: "failed", durationMs: 80, reason: "reddit unreachable", detail: null },
    });
    const deps = makeDeps({ runCollectorHealthCheck: runCheck, capturePipelineEvent });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "emit-1",
      data: { collectors: ["hn", "reddit"], trigger: "scheduled" },
    });

    const calls = capturePipelineEvent.mock.calls as CaptureCall[];
    const preflight = calls.filter((c) => c[0] === "collector_preflight_failed");
    expect(preflight).toHaveLength(2);
    for (const [, props] of preflight) {
      expect(props.trigger).toBe("scheduled");
      expect(props.severity).toBe("error");
      expect(typeof props.collector).toBe("string");
      expect(typeof props.reason).toBe("string");
    }
    const byCollector = Object.fromEntries(preflight.map(([, p]) => [p.collector, p]));
    expect(byCollector.hn).toMatchObject({ reason: "HN auth failed", durationMs: 120 });
    expect(byCollector.reddit).toMatchObject({ reason: "reddit unreachable", durationMs: 80 });
  });

  it("NF2: all collectors healthy → no collector_preflight_failed emit", async () => {
    const capturePipelineEvent = vi.fn();
    const deps = makeDeps({ capturePipelineEvent });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "emit-2",
      data: { collectors: ["hn"], trigger: "manual" },
    });

    const calls = capturePipelineEvent.mock.calls as CaptureCall[];
    expect(calls.filter((c) => c[0] === "collector_preflight_failed")).toHaveLength(0);
  });

  it("F1: emits only for the failed collectors in a mixed result", async () => {
    const capturePipelineEvent = vi.fn();
    const runCheck = makeRunCollectorHealthCheck({
      hn: makeHealthOutcome("healthy"),
      reddit: { status: "failed", durationMs: 50, reason: "reddit down", detail: null },
    });
    const deps = makeDeps({ runCollectorHealthCheck: runCheck, capturePipelineEvent });

    await handleCollectorHealthJob(deps, {
      name: "collector-health",
      id: "emit-3",
      data: { collectors: ["hn", "reddit"], trigger: "manual" },
    });

    const preflight = (capturePipelineEvent.mock.calls as CaptureCall[]).filter(
      (c) => c[0] === "collector_preflight_failed",
    );
    expect(preflight).toHaveLength(1);
    expect(preflight[0][1]).toMatchObject({ collector: "reddit", trigger: "manual" });
  });

  it("E2: deps-build failure path emits collector_preflight_failed for each forced-failed target before rethrow", async () => {
    const capturePipelineEvent = vi.fn();
    const deps = makeDeps({
      capturePipelineEvent,
      buildHealthCheckDeps: vi.fn().mockRejectedValue(new Error("credential DB failure")),
    });

    await expect(
      handleCollectorHealthJob(deps, {
        name: "collector-health",
        id: "emit-4",
        data: { collectors: ["hn", "reddit"], trigger: "scheduled" },
      }),
    ).rejects.toThrow("credential DB failure");

    const preflight = (capturePipelineEvent.mock.calls as CaptureCall[]).filter(
      (c) => c[0] === "collector_preflight_failed",
    );
    expect(preflight.map(([, p]) => p.collector).sort()).toEqual(["hn", "reddit"]);
    for (const [, props] of preflight) {
      expect(props.reason).toBe("credential DB failure");
      expect(props.severity).toBe("error");
    }
  });

  it("E2: settings-load failure path (manual) emits collector_preflight_failed for explicit targets before rethrow", async () => {
    const capturePipelineEvent = vi.fn();
    const deps = makeDeps({
      capturePipelineEvent,
      userSettingsRepo: { get: vi.fn().mockRejectedValue(new Error("DB unavailable")) },
    });

    await expect(
      handleCollectorHealthJob(deps, {
        name: "collector-health",
        id: "emit-5",
        data: { collectors: ["hn"], trigger: "manual" },
      }),
    ).rejects.toThrow("DB unavailable");

    const preflight = (capturePipelineEvent.mock.calls as CaptureCall[]).filter(
      (c) => c[0] === "collector_preflight_failed",
    );
    expect(preflight).toHaveLength(1);
    expect(preflight[0][1]).toMatchObject({ collector: "hn", reason: "DB unavailable" });
  });
});

// ─── createCollectorHealthWorker ─────────────────────────────────────────────

describe("createCollectorHealthWorker", () => {
  beforeEach(() => {
    mockWorkerConstructor.mockClear();
    mockCreateRedisConnection.mockClear();
  });

  it("creates a Worker with COLLECTOR_HEALTH_QUEUE_NAME", () => {
    createCollectorHealthWorker({ deps: makeDeps() });

    expect(mockWorkerConstructor).toHaveBeenCalledOnce();
    const [queueName] = mockWorkerConstructor.mock.calls[0] as [string, unknown, unknown];
    expect(queueName).toBe(COLLECTOR_HEALTH_QUEUE_NAME);
  });

  it("does NOT set concurrency: 1 on the Worker options (REQ-009, queue-concurrency-vs-in-process-pacer)", () => {
    createCollectorHealthWorker({ deps: makeDeps() });

    const [, , opts] = mockWorkerConstructor.mock.calls[0] as [string, unknown, { concurrency?: number }];
    expect(opts?.concurrency).not.toBe(1);
  });

  it("uses provided connection or creates its own", () => {
    const fakeConnection = { fake: "provided-redis" };
    createCollectorHealthWorker({
      connection: fakeConnection as never,
      deps: makeDeps(),
    });

    const [, , opts] = mockWorkerConstructor.mock.calls[0] as [string, unknown, { connection: unknown }];
    expect(opts.connection).toBe(fakeConnection);
    expect(mockCreateRedisConnection).not.toHaveBeenCalled();
  });

  it("creates a new Redis connection when none provided", () => {
    createCollectorHealthWorker({ deps: makeDeps() });

    expect(mockCreateRedisConnection).toHaveBeenCalledOnce();
  });
});

// ─── Guard: createProcessingWorker must NOT use concurrency:1 (REQ-009) ─────

describe("createProcessingWorker concurrency guard (REQ-009)", () => {
  beforeEach(() => {
    mockWorkerConstructor.mockClear();
  });

  it("processing worker is NOT constructed with concurrency: 1", async () => {
    const { createProcessingWorker } = await import("@pipeline/workers/processing.js");
    createProcessingWorker();

    const allCalls = mockWorkerConstructor.mock.calls as [string, unknown, { concurrency?: number }][];
    const processingCall = allCalls.find(([name]) => name === "processing");
    expect(processingCall).toBeDefined();
    expect(processingCall?.[2]?.concurrency).not.toBe(1);
  });
});
