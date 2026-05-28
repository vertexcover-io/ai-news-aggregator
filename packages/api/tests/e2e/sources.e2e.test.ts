/**
 * E2E tests for GET /api/sources/summary (auto-sources-page feature).
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 *
 * Also includes the REQ-018 JS↔SQL identifier cross-check, which exercises
 * the Postgres CASE expression against the shared `deriveRawItemIdentifier`
 * JS function for at least one URL per `SourceType`.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { config } from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  getDb,
  rawItems,
  runArchives,
  userSettings,
  type SourceType,
} from "@newsletter/shared/db";
import type {
  RankedItemRef,
  RunSourceTelemetry,
  UserSettings,
} from "@newsletter/shared";
import { deriveRawItemIdentifier } from "@newsletter/shared/services";
import { SOURCE_TYPE_ORDER } from "@newsletter/shared/constants";
import {
  createRawItemsRepo,
  deriveRawItemIdentifierSql,
} from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { createPublicSourcesRouter } from "@api/routes/sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const rawItemsRepo = createRawItemsRepo(db);
const archiveRepo = createRunArchivesRepo(db);
const settingsRepo = createUserSettingsRepo(db);

const seedPrefix = `phase4-sources-${String(Date.now())}`;
const seededRawItemIds = new Set<number>();
const seededRunIds = new Set<string>();

interface ScenarioResult {
  readonly id: string;
  readonly name: string;
  passed: boolean;
  error?: string;
}

const scenarios: ScenarioResult[] = [];
const startedAt = new Date().toISOString();

let savedRankingPrompt: string | null = null;
let settingsRowExisted = false;
let savedSettings: UserSettings | null = null;

function buildApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/sources",
    createPublicSourcesRouter({
      getRawItemsRepo: () => rawItemsRepo,
      getArchiveRepo: () => archiveRepo,
      getSettingsRepo: () => settingsRepo,
    }),
  );
  return app;
}

const summarySchema = z.object({
  generatedAt: z.string(),
  range: z.object({
    from: z.string(),
    to: z.string(),
    runsInRange: z.number(),
  }),
  sections: z.array(
    z.object({
      sourceType: z.string(),
      rows: z.array(
        z.object({
          identifier: z.string(),
          displayName: z.string(),
          url: z.string().nullable(),
          fetchedCount: z.number(),
          usedCount: z.number(),
          failureCount: z.number(),
          lastFailureMessage: z.string().nullable(),
        }),
      ),
    }),
  ),
  configured: z.array(
    z.object({
      sourceType: z.string(),
      rows: z.array(
        z.object({
          identifier: z.string(),
          displayName: z.string(),
          url: z.string().nullable(),
        }),
      ),
    }),
  ),
  failures: z.array(
    z.object({
      sourceType: z.string(),
      identifier: z.string(),
      displayName: z.string(),
      runsAffected: z.number(),
      lastErrorMessage: z.string(),
      lastFailedAt: z.string(),
    }),
  ),
  rankingPrompt: z.string(),
});

type SummaryResponse = z.infer<typeof summarySchema>;

interface InsertRawItemArgs {
  readonly sourceType: SourceType;
  readonly externalId: string;
  readonly url: string;
  readonly title: string;
  readonly collectedAt: Date;
}

async function insertRawItem(opts: InsertRawItemArgs): Promise<number> {
  const [row] = await db
    .insert(rawItems)
    .values({
      sourceType: opts.sourceType,
      externalId: `${seedPrefix}-${opts.externalId}`,
      title: opts.title,
      url: opts.url,
      author: "sources-e2e",
      publishedAt: opts.collectedAt,
      collectedAt: opts.collectedAt,
      engagement: { points: 1, commentCount: 0 },
      metadata: { comments: [] },
    })
    .returning({ id: rawItems.id });
  seededRawItemIds.add(row.id);
  return row.id;
}

interface InsertArchiveArgs {
  readonly rankedRawItemIds: readonly number[];
  readonly completedAt: Date;
  readonly telemetry: RunSourceTelemetry | null;
  readonly reviewed: boolean;
}

async function insertArchive(opts: InsertArchiveArgs): Promise<string> {
  const runId = randomUUID();
  const rankedItems: RankedItemRef[] = opts.rankedRawItemIds.map(
    (rawItemId, index) => ({
      rawItemId,
      score: 1 - index * 0.1,
      rationale: `ranked ${String(index + 1)}`,
    }),
  );
  await db.insert(runArchives).values({
    id: runId,
    status: "completed",
    rankedItems,
    topN: rankedItems.length,
    reviewed: opts.reviewed,
    completedAt: opts.completedAt,
    startedAt: new Date(opts.completedAt.getTime() - 60_000),
    sourceTypes: ["hn", "reddit"],
    digestHeadline: "Sources e2e digest",
    digestSummary: "Sources e2e digest summary",
    sourceTelemetry: opts.telemetry,
  });
  seededRunIds.add(runId);
  return runId;
}

interface SeededIds {
  readonly localLlamaToday: readonly number[];
  readonly localLlamaWeek: readonly number[];
  readonly hnToday: readonly number[];
  readonly blogToday: number;
  readonly twitterToday: number;
  readonly noTelemetryBlog: number;
  readonly machineLearningToday: readonly number[];
  readonly archiveRunId: string;
}

async function seedSources(): Promise<SeededIds> {
  const now = new Date();
  // Seed slightly in the past so items always fall inside the route's
  // [now-7d, now] window regardless of wall-clock time of day.
  const today = new Date(now.getTime() - 60 * 60 * 1000);
  const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);

  const localLlamaToday: number[] = [];
  for (let i = 0; i < 5; i++) {
    localLlamaToday.push(
      await insertRawItem({
        sourceType: "reddit",
        externalId: `localllama-today-${String(i)}`,
        url: `https://reddit.com/r/localllama/comments/today${String(i)}/post`,
        title: `LocalLLaMA today ${String(i)}`,
        collectedAt: today,
      }),
    );
  }

  const localLlamaWeek: number[] = [];
  for (let i = 0; i < 3; i++) {
    localLlamaWeek.push(
      await insertRawItem({
        sourceType: "reddit",
        externalId: `localllama-week-${String(i)}`,
        url: `https://reddit.com/r/localllama/comments/week${String(i)}/post`,
        title: `LocalLLaMA week ${String(i)}`,
        collectedAt: fiveDaysAgo,
      }),
    );
  }

  const hnToday: number[] = [];
  for (let i = 0; i < 4; i++) {
    hnToday.push(
      await insertRawItem({
        sourceType: "hn",
        externalId: `hn-today-${String(i)}`,
        url: `https://news.ycombinator.com/item?id=${String(1000 + i)}`,
        title: `HN today ${String(i)}`,
        collectedAt: today,
      }),
    );
  }

  const blogToday = await insertRawItem({
    sourceType: "blog",
    externalId: "blog-today",
    url: "https://anthropic.com/engineering/today-post",
    title: "Anthropic engineering today",
    collectedAt: today,
  });

  const twitterToday = await insertRawItem({
    sourceType: "twitter",
    externalId: "twitter-today",
    url: "https://x.com/karpathy/status/1234567890",
    title: "Karpathy tweet today",
    collectedAt: today,
  });

  const noTelemetryBlog = await insertRawItem({
    sourceType: "blog",
    externalId: "noname-blog-today",
    url: "https://noname.example.com/post",
    title: "Noname blog post",
    collectedAt: today,
  });

  const machineLearningToday: number[] = [];
  for (let i = 0; i < 2; i++) {
    machineLearningToday.push(
      await insertRawItem({
        sourceType: "reddit",
        externalId: `ml-today-${String(i)}`,
        url: `https://reddit.com/r/machinelearning/comments/today${String(i)}/post`,
        title: `MachineLearning today ${String(i)}`,
        collectedAt: today,
      }),
    );
  }

  const telemetry: RunSourceTelemetry = {
    sources: [
      {
        sourceType: "reddit",
        identifier: "r/localllama",
        displayName: "r/localllama",
        itemsFetched: 5,
        status: "completed",
        errors: [],
        retries: 0,
        durationMs: 200,
      },
      {
        sourceType: "hn",
        identifier: "news.ycombinator.com",
        displayName: "Hacker News",
        itemsFetched: 4,
        status: "completed",
        errors: [],
        retries: 0,
        durationMs: 200,
      },
      {
        sourceType: "reddit",
        identifier: "r/machinelearning",
        displayName: "r/machinelearning",
        itemsFetched: 0,
        status: "failed",
        errors: ["boom"],
        retries: 0,
        durationMs: 200,
      },
    ],
    totalItemsFetched: 9,
    totalErrors: 1,
  };

  const archiveRunId = await insertArchive({
    rankedRawItemIds: [
      localLlamaToday[0],
      localLlamaToday[1],
      hnToday[0],
    ],
    completedAt: today,
    telemetry,
    reviewed: true,
  });

  return {
    localLlamaToday,
    localLlamaWeek,
    hnToday,
    blogToday,
    twitterToday,
    noTelemetryBlog,
    machineLearningToday,
    archiveRunId,
  };
}

async function seedSettings(rankingPrompt: string): Promise<UserSettings> {
  const existing = await settingsRepo.get();
  const base: UserSettings = existing ?? ({
    id: "settings",
    topN: 12,
    shortlistSize: 30,
    shortlistPrompt: "Shortlist top items.",
    halfLifeHours: 24,
    hnEnabled: true,
    hnConfig: null,
    redditEnabled: true,
    redditConfig: null,
    webEnabled: true,
    webConfig: null,
    twitterEnabled: true,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "07:00",
    pipelineTime: "07:00",
    emailTime: "07:30",
    linkedinTime: "07:45",
    twitterTime: "08:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt,
    updatedAt: new Date().toISOString(),
  } as UserSettings);
  const next: UserSettings = {
    ...base,
    hnEnabled: true,
    redditEnabled: true,
    redditConfig: {
      subreddits: ["LocalLLaMA", "MachineLearning"],
      sort: "hot",
      limit: 25,
      sinceDays: 1,
    },
    webEnabled: true,
    webConfig: {
      sources: [
        { name: "Anthropic", listingUrl: "https://anthropic.com/news" },
      ],
      maxItems: 10,
      sinceDays: 7,
    },
    twitterEnabled: true,
    twitterConfig: {
      listIds: [],
      users: [{ handle: "karpathy", userId: "u-karpathy" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    },
    rankingPrompt,
  };
  await settingsRepo.upsert(next);
  return next;
}

async function cleanupSeeds(): Promise<void> {
  if (seededRunIds.size > 0) {
    await db
      .delete(runArchives)
      .where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededRawItemIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawItemIds]));
    seededRawItemIds.clear();
  }
}

function record(id: string, name: string, fn: () => void | Promise<void>) {
  return async (): Promise<void> => {
    try {
      await fn();
      scenarios.push({ id, name, passed: true });
    } catch (err) {
      scenarios.push({
        id,
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

beforeAll(async () => {
  const existing = await settingsRepo.get();
  settingsRowExisted = existing !== null;
  if (existing) {
    savedSettings = existing;
    savedRankingPrompt = existing.rankingPrompt;
  }
});

afterEach(async () => {
  await cleanupSeeds();
});

afterAll(async () => {
  await cleanupSeeds();
  if (savedSettings && savedRankingPrompt !== null) {
    await settingsRepo.upsert({
      ...savedSettings,
      rankingPrompt: savedRankingPrompt,
    });
  } else if (!settingsRowExisted) {
    await db.delete(userSettings).where(eq(userSettings.singleton, true));
  }

  const reportPath = resolve(
    REPO_ROOT,
    "docs/spec/auto-sources-page/e2e-report.json",
  );
  mkdirSync(dirname(reportPath), { recursive: true });
  const passed = scenarios.filter((s) => s.passed).length;
  const failed = scenarios.length - passed;
  const report = {
    spec: "auto-sources-page",
    ranAt: startedAt,
    passed,
    failed,
    scenarios,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
});

async function getSummary(): Promise<SummaryResponse> {
  const res = await buildApp().request("/api/sources/summary");
  expect(res.status).toBe(200);
  return summarySchema.parse(await res.json());
}

function findRow(
  summary: SummaryResponse,
  sourceType: SourceType,
  identifier: string,
) {
  const section = summary.sections.find((s) => s.sourceType === sourceType);
  return section?.rows.find((r) => r.identifier === identifier);
}

describe("GET /api/sources/summary (e2e)", () => {
  it(
    "VS-1: sections filtered to configured sources only, in SOURCE_TYPE_ORDER",
    record("VS-1", "section order configured-only", async () => {
      await seedSettings("the prompt");
      await seedSources();
      const body = await getSummary();
      const order = body.sections.map((s) => s.sourceType);
      const orderInExpected = order.map((t) =>
        SOURCE_TYPE_ORDER.indexOf(t as SourceType),
      );
      const sorted = [...orderInExpected].sort((a, b) => a - b);
      expect(orderInExpected).toEqual(sorted);
      // Configured-only filter: outbound link hosts on Reddit and the
      // 'noname.example.com' blog are dropped, only the explicitly
      // configured identifiers remain.
      const redditSection = body.sections.find((s) => s.sourceType === "reddit");
      const redditIds = redditSection?.rows.map((r) => r.identifier) ?? [];
      expect(redditIds).toContain("r/localllama");
      expect(redditIds).toContain("r/machinelearning");
      const blogSection = body.sections.find((s) => s.sourceType === "blog");
      const blogIds = blogSection?.rows.map((r) => r.identifier) ?? [];
      expect(blogIds).toContain("anthropic.com");
      expect(blogIds).not.toContain("noname.example.com");
    }),
  );

  it(
    "VS-3: fetchedCount and usedCount counts are accurate",
    record("VS-3", "counts accurate", async () => {
      await seedSettings("the prompt");
      await seedSources();
      const body = await getSummary();
      const reddit = findRow(body, "reddit", "r/localllama");
      expect(reddit).toBeDefined();
      expect(reddit?.fetchedCount).toBe(8); // 5 today + 3 from 5 days ago, all in 7d window
      expect(reddit?.usedCount).toBe(2);
      const hn = findRow(body, "hn", "news.ycombinator.com");
      expect(hn?.usedCount).toBe(1);
    }),
  );

  it(
    "VS-4: telemetry.status=failed surfaces as failureCount > 0",
    record("VS-4", "failureCount from telemetry", async () => {
      await seedSettings("the prompt");
      await seedSources();
      const body = await getSummary();
      const ml = findRow(body, "reddit", "r/machinelearning");
      expect(ml).toBeDefined();
      expect(ml?.failureCount).toBeGreaterThanOrEqual(1);
      expect(ml?.lastFailureMessage).toBeTruthy();
    }),
  );

  it(
    "VS-6: rankingPrompt is the live user_settings value",
    record("VS-6", "rankingPrompt live value", async () => {
      const before = await seedSettings("baseline-prompt");
      const initial = await getSummary();
      expect(initial.rankingPrompt).toBe(before.rankingPrompt);

      const sentinel = `SENTINEL_${randomUUID()}`;
      await settingsRepo.upsert({ ...before, rankingPrompt: sentinel });
      const after = await getSummary();
      expect(after.rankingPrompt).toBe(sentinel);

      await settingsRepo.upsert({ ...before, rankingPrompt: before.rankingPrompt });
      const restored = await getSummary();
      expect(restored.rankingPrompt).toBe(before.rankingPrompt);
    }),
  );

  it(
    "VS-8: rows sorted alphabetically (case-insensitive) by displayName",
    record("VS-8", "row sort order", async () => {
      await seedSettings("the prompt");
      await seedSources();
      const body = await getSummary();
      const reddit = body.sections.find((s) => s.sourceType === "reddit");
      expect(reddit).toBeDefined();
      const names = reddit?.rows.map((r) => r.displayName.toLowerCase()) ?? [];
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    }),
  );

  it(
    "VS-9: configured field reflects user_settings",
    record("VS-9", "configured reflects settings", async () => {
      await seedSettings("the prompt");
      const body = await getSummary();
      const byType = new Map(
        body.configured.map((s) => [s.sourceType, s] as const),
      );
      expect(byType.get("hn")?.rows[0]?.displayName).toBe("Hacker News");
      expect(
        byType.get("reddit")?.rows.map((r) => r.displayName),
      ).toContain("r/localllama");
      expect(byType.get("blog")?.rows[0]?.displayName).toBe("Anthropic");
      expect(byType.get("twitter")?.rows[0]?.displayName).toBe("@karpathy");
    }),
  );

  it(
    "VS-10: public access without admin cookie returns 200 with valid shape",
    record("VS-10", "public access", async () => {
      await seedSettings("the prompt");
      await seedSources();
      const res = await buildApp().request("/api/sources/summary");
      expect(res.status).toBe(200);
      const body = summarySchema.parse(await res.json());
      expect(body.generatedAt).toMatch(/T\d{2}:\d{2}:\d{2}/);
      expect(typeof body.range.from).toBe("string");
      expect(typeof body.range.to).toBe("string");
    }),
  );
});

describe("JS↔SQL identifier cross-check (REQ-018 / VS-5)", () => {
  interface ProbeCase {
    readonly sourceType: SourceType;
    readonly url: string;
    readonly metadata?: { readonly query?: string };
  }

  const cases: readonly ProbeCase[] = [
    // Canonical URLs (regex hits).
    { sourceType: "hn", url: "https://news.ycombinator.com/item?id=42" },
    {
      sourceType: "reddit",
      url: "https://reddit.com/r/localllama/comments/abc/post",
    },
    {
      sourceType: "twitter",
      url: "https://x.com/karpathy/status/1234567890",
    },
    { sourceType: "rss", url: "https://www.theverge.com/rss/index.xml" },
    {
      sourceType: "github",
      url: "https://github.com/anthropics/claude-code/blob/main/x.py",
    },
    {
      sourceType: "blog",
      url: "https://anthropic.com/engineering/post-x",
    },
    {
      sourceType: "newsletter",
      url: "https://stratechery.com/2026/example/",
    },
    {
      sourceType: "web_search",
      url: "https://example.com/from-search",
    },
    // web_search with metadata.query → identifier should be the query string.
    {
      sourceType: "web_search",
      url: "https://example.com/q-result",
      metadata: { query: "Claude Code OR Cursor OR Aider" },
    },
    // web_search with blank/whitespace-only query falls back to 'web search'.
    {
      sourceType: "web_search",
      url: "https://example.com/blank-q",
      metadata: { query: "   " },
    },
    // Malformed URLs (regex miss → hostname fallback). REQ-018 requires
    // the SQL CASE to fall through to hostname before 'unknown', matching
    // JS deriveRawItemIdentifier's hostnameFallback.
    {
      sourceType: "reddit",
      url: "https://example.com/no-r-prefix",
    },
    {
      sourceType: "twitter",
      url: "https://x.com/karpathy",
    },
    {
      sourceType: "twitter",
      url: "https://twitter.com/simonw",
    },
    { sourceType: "github", url: "https://github.com/" },
    // www-prefixed hosts should be normalised to bare host.
    { sourceType: "blog", url: "https://www.anthropic.com/engineering/post" },
    { sourceType: "rss", url: "https://www.example.com/feed" },
    // Uppercase hosts lowercased.
    { sourceType: "blog", url: "https://BLOG.OpenAI.com/post" },
    // Uppercase hostname in the keyword-matching regexes — JS uses /i, so
    // SQL must also match case-insensitively (via the (?i) inline flag).
    // Without it, these would fall through to the hostname fallback and
    // diverge from JS.
    {
      sourceType: "twitter",
      url: "https://X.com/karpathy/status/1234567890",
    },
    {
      sourceType: "github",
      url: "https://GitHub.com/anthropics/claude-code",
    },
    {
      sourceType: "reddit",
      url: "https://www.Reddit.com/R/LocalLLaMA/comments/abc",
    },
  ];

  it(
    "REQ-018: Postgres CASE expression matches JS deriveRawItemIdentifier",
    record("VS-5", "JS vs SQL identifier alignment", async () => {
      const caseSql = deriveRawItemIdentifierSql();
      for (const c of cases) {
        const metadataJson = JSON.stringify(c.metadata ?? {});
        const rows = await db.execute<{ identifier: string }>(sql`
          SELECT (${caseSql}) AS identifier
          FROM (VALUES (
            ${c.sourceType}::text,
            ${c.url}::text,
            NULL::text,
            ${metadataJson}::jsonb
          )) AS t(source_type, url, source_url, metadata)
        `);
        const sqlResult = rows[0]?.identifier;
        const jsResult = deriveRawItemIdentifier({
          sourceType: c.sourceType,
          url: c.url,
          sourceUrl: null,
          metadata: c.metadata ?? null,
        });
        expect(
          sqlResult,
          `mismatch for ${c.sourceType} ${c.url}`,
        ).toBe(jsResult);
      }
    }),
  );
});
