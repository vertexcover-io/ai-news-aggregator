import type {
  EnrichmentTelemetry,
  RunCostBreakdown,
  RunLogEntry,
  RunObservability,
} from "@newsletter/shared/types";

export const enrichmentFixture: EnrichmentTelemetry = {
  attempted: 486,
  ok: 351,
  failed: 28,
  skipped: 107,
  cacheHits: 61,
  avgFetchMs: 612,
  skippedReasons: { "same-platform": 22, "non-html-media": 15, "no-url": 9 },
};

export const costFixture: RunCostBreakdown = {
  schemaVersion: 1,
  totalCostUsd: 0.0214,
  stages: {
    shortlist: {
      calls: 1,
      costUsd: 0.0061,
      costStatus: "ok",
      byModel: [
        {
          modelId: "claude-haiku-4-5",
          calls: 1,
          costUsd: 0.0061,
          inputTokens: 90000,
          outputTokens: 2000,
          cachedInputTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          reasoningTokens: 0,
        },
      ],
    },
    rank: {
      calls: 1,
      costUsd: 0.0153,
      costStatus: "ok",
      byModel: [
        {
          modelId: "claude-haiku-4-5",
          calls: 1,
          costUsd: 0.0153,
          inputTokens: 92000,
          outputTokens: 2100,
          cachedInputTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          reasoningTokens: 0,
        },
      ],
    },
  },
  unknownModels: [],
  generatedAt: "2026-05-25T09:03:20Z",
};

export function makeLog(overrides: Partial<RunLogEntry>): RunLogEntry {
  return {
    id: 1,
    runId: "run-1",
    ts: "2026-05-25T09:02:14Z",
    level: "info",
    stage: "collecting",
    source: null,
    event: "run.started",
    message: "Run started",
    context: null,
    ...overrides,
  };
}

export const fullFixture: RunObservability = {
  run: {
    runId: "0c8f1a92-d41b",
    status: "running",
    stage: "ranking",
    startedAt: "2026-05-25T09:02:14Z",
    completedAt: null,
    isDryRun: false,
    reviewed: false,
  },
  funnel: { collected: 1284, deduped: 542, shortlisted: 60, ranked: null },
  sources: [
    {
      sourceType: "hacker_news",
      identifier: "news.ycombinator.com",
      displayName: "news.ycombinator.com",
      itemsFetched: 412,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 6800,
    },
    {
      sourceType: "twitter",
      identifier: "@karpathy",
      displayName: "@karpathy · @swyx · +18",
      itemsFetched: 0,
      status: "failed",
      errors: ["auth failed — cookies expired. Rotate at /admin/settings."],
      retries: 2,
      durationMs: 3100,
    },
    {
      sourceType: "web_search",
      identifier: "tavily",
      displayName: "tavily · “ai agents 2026”",
      itemsFetched: 183,
      status: "running",
      errors: [],
      retries: 0,
      durationMs: null,
    },
  ],
  enrichment: enrichmentFixture,
  stages: [
    {
      stage: "collecting",
      startedAt: "2026-05-25T09:02:14Z",
      endedAt: "2026-05-25T09:02:52Z",
      durationMs: 38200,
    },
    {
      stage: "ranking",
      startedAt: "2026-05-25T09:03:14Z",
      endedAt: null,
      durationMs: null,
    },
    {
      stage: "finalize",
      startedAt: null,
      endedAt: null,
      durationMs: null,
    },
  ],
  cost: costFixture,
  logs: [
    makeLog({ id: 1, event: "run.started", message: "Run started · topN=12" }),
    makeLog({
      id: 2,
      level: "info",
      event: "source.completed",
      message: "hn — 412 items",
    }),
    makeLog({
      id: 3,
      level: "error",
      stage: "collecting",
      source: "twitter",
      event: "source.failed",
      message: "twitter — auth failed after 2 retries · source skipped",
      context: {
        stack:
          "TwitterAuthError: Twitter auth failed\n    at resolveTwitterCollectorCookie (collectors/twitter.ts:148)",
        errorClass: "auth",
        retries: 2,
        fatal: false,
      },
    }),
    makeLog({
      id: 4,
      level: "warn",
      event: "enrichment.summary",
      message: "Enrichment — 486 attempted · 351 ok",
    }),
  ],
  failures: [
    makeLog({
      id: 3,
      level: "error",
      stage: "collecting",
      source: "twitter",
      event: "source.failed",
      message: "TwitterAuthError: Twitter auth failed — rotate cookies",
      context: { errorClass: "auth", retries: 2, fatal: false },
    }),
  ],
  live: true,
};

export const legacyFixture: RunObservability = {
  run: {
    runId: "legacy-1",
    status: "completed",
    stage: "completed",
    startedAt: "2026-01-01T09:00:00Z",
    completedAt: "2026-01-01T09:05:00Z",
    isDryRun: false,
    reviewed: true,
  },
  funnel: { collected: null, deduped: null, shortlisted: null, ranked: null },
  sources: [
    {
      sourceType: "hacker_news",
      identifier: "news.ycombinator.com",
      displayName: "news.ycombinator.com",
      itemsFetched: 100,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 5000,
    },
  ],
  enrichment: null,
  stages: [],
  cost: costFixture,
  logs: [],
  failures: [],
  live: false,
};
