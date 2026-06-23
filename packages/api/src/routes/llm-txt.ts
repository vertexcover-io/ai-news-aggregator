import { Hono } from "hono";
import type { Context } from "hono";
import {
  createLogger,
  getDb as defaultGetDb,
  formatDateInTimezone,
  safeTimezone,
} from "@newsletter/shared";
import type { RankedItem } from "@newsletter/shared";
import {
  renderIssueLlmTxt,
  type IssueFull,
  type IssueMeta,
  type LlmTxtStory,
} from "@newsletter/shared/llm-txt";
import {
  buildLlmTxtSnapshot,
  type LlmTxtSnapshotData,
} from "@api/services/llm-txt-snapshot.js";
import {
  createRedisLlmTxtCache,
  llmTxtVersionKey,
  type LlmTxtCache,
} from "@api/services/llm-txt-cache.js";
import type IORedis from "ioredis";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchiveRow,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createMustReadRepo,
  toPublicWire,
  type MustReadRepo,
} from "@api/repositories/must-read.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { resolveBaseUrls } from "@api/lib/base-urls.js";

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
} as const;

const FULL_INDEX_ISSUE_LIMIT = 30;

export interface LlmTxtRouterDeps {
  getArchiveRepo: () => RunArchivesRepo;
  getRawItemsRepo: () => RawItemsRepo;
  getMustReadRepo: () => MustReadRepo;
  getSettingsRepo?: () => Pick<UserSettingsRepo, "get">;
  baseUrl: string;
  /** Optional content cache. When set, rendered text is cached and reused
   * until the underlying data changes (version-keyed). */
  cache?: LlmTxtCache;
  logger?: ReturnType<typeof createLogger>;
}

function rowSignature(row: RunArchiveRow): string {
  const completed = row.completedAt.getTime();
  const drafted = row.draftSavedAt?.getTime() ?? 0;
  return `${row.id}:${completed}:${drafted}`;
}

function canonSignature(entry: { id: string; addedAt: string }): string {
  return `${entry.id}:${entry.addedAt}`;
}

// Caches one rendered variant: returns the cached string on a version hit, else
// runs the (possibly expensive) render, stores it, and returns the fresh value.
async function withCache(
  deps: Pick<LlmTxtRouterDeps, "cache" | "logger">,
  key: string,
  render: () => Promise<string>,
): Promise<string> {
  if (!deps.cache) return render();
  try {
    const hit = await deps.cache.get(key);
    if (hit !== null) return hit;
  } catch (err) {
    deps.logger?.warn({ err }, "llm_txt.cache_read_failed");
  }
  const value = await render();
  try {
    await deps.cache.set(key, value);
  } catch (err) {
    deps.logger?.warn({ err }, "llm_txt.cache_write_failed");
  }
  return value;
}

function storyFromRankedItem(item: RankedItem): LlmTxtStory {
  return { title: item.title, url: item.url, recap: item.recap };
}

function issueMetaFromRow(row: RunArchiveRow, issueDate: string): IssueMeta {
  return {
    runId: row.id,
    issueDate,
    digestHeadline: row.digestHeadline,
    digestSummary: row.digestSummary,
  };
}

async function resolveTimezone(
  deps: Pick<LlmTxtRouterDeps, "getSettingsRepo">,
): Promise<string> {
  if (deps.getSettingsRepo === undefined) return "UTC";
  const settings = await deps.getSettingsRepo().get();
  return safeTimezone(settings?.scheduleTimezone);
}

function issueDateOf(row: RunArchiveRow, timezone: string): string {
  return formatDateInTimezone(
    row.publishedAt ?? row.startedAt ?? row.completedAt,
    timezone,
  );
}

async function hydrateIssueStories(
  deps: LlmTxtRouterDeps,
  row: RunArchiveRow,
): Promise<LlmTxtStory[]> {
  const hydrated = await hydrateRankedItems(
    deps.getRawItemsRepo(),
    row.rankedItems,
    row.completedAt,
  );
  return hydrated.map(storyFromRankedItem);
}

export function createLlmTxtRouter(deps: LlmTxtRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:llm-txt");
  const app = new Hono();

  // Loads the cheap metadata (reviewed rows + canon) needed for both the
  // version signature and the render. Story hydration is deferred to the render
  // closure so a cache hit skips it entirely.
  async function loadIndexMeta(): Promise<{
    rows: RunArchiveRow[];
    canon: ReturnType<typeof toPublicWire>[];
    timezone: string;
  }> {
    const timezone = await resolveTimezone(deps);
    const rows = await deps.getArchiveRepo().listReviewedRows(FULL_INDEX_ISSUE_LIMIT);
    const canon = (await deps.getMustReadRepo().listPublic()).map(toPublicWire);
    return { rows, canon, timezone };
  }

  function buildSnapshotData(
    meta: { rows: RunArchiveRow[]; canon: ReturnType<typeof toPublicWire>[]; timezone: string },
    stories: IssueFull["stories"][],
  ): LlmTxtSnapshotData {
    const issues: IssueFull[] = meta.rows.map((row, i) => ({
      meta: issueMetaFromRow(row, issueDateOf(row, meta.timezone)),
      stories: stories[i] ?? [],
    }));
    return { baseUrl: deps.baseUrl, issues, canon: meta.canon };
  }

  app.get("/llms.txt", async (c) => {
    try {
      const meta = await loadIndexMeta();
      const key = llmTxtVersionKey({
        variant: "index",
        baseUrl: deps.baseUrl,
        issueSignatures: meta.rows.map(rowSignature),
        canonSignatures: meta.canon.map(canonSignature),
      });
      const body = await withCache(deps, key, () =>
        // index render needs no story hydration
        Promise.resolve(
          buildLlmTxtSnapshot(buildSnapshotData(meta, [])).index,
        ),
      );
      return c.body(body, 200, TEXT_HEADERS);
    } catch (err) {
      logger.error({ err }, "llm_txt.index_failed");
      return c.body("error generating llms.txt\n", 500, TEXT_HEADERS);
    }
  });

  app.get("/llms-full.txt", async (c) => {
    try {
      const meta = await loadIndexMeta();
      const key = llmTxtVersionKey({
        variant: "full",
        baseUrl: deps.baseUrl,
        issueSignatures: meta.rows.map(rowSignature),
        canonSignatures: meta.canon.map(canonSignature),
      });
      const body = await withCache(deps, key, async () => {
        const stories = await Promise.all(
          meta.rows.map((row) => hydrateIssueStories(deps, row)),
        );
        return buildLlmTxtSnapshot(buildSnapshotData(meta, stories)).indexFull;
      });
      return c.body(body, 200, TEXT_HEADERS);
    } catch (err) {
      logger.error({ err }, "llm_txt.full_index_failed");
      return c.body("error generating llms-full.txt\n", 500, TEXT_HEADERS);
    }
  });

  return app;
}

export function createLlmTxtArchiveRouter(deps: LlmTxtRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:llm-txt");
  const opts = { baseUrl: deps.baseUrl };
  const app = new Hono();

  async function renderIssue(runId: string): Promise<string | null> {
    const row = await deps.getArchiveRepo().findById(runId);
    if (!row || !row.reviewed || row.isDryRun) return null;
    const timezone = await resolveTimezone(deps);
    const meta = issueMetaFromRow(row, issueDateOf(row, timezone));
    const key = llmTxtVersionKey({
      variant: "issue",
      baseUrl: deps.baseUrl,
      scope: runId,
      issueSignatures: [rowSignature(row)],
      canonSignatures: [],
    });
    return withCache(deps, key, async () => {
      const stories = await hydrateIssueStories(deps, row);
      return renderIssueLlmTxt(meta, stories, opts);
    });
  }

  // A single issue's llm.txt already inlines every story with its full recap,
  // so the per-issue file IS the full content. The plural `/llms.txt` and
  // `/llms-full.txt` names mirror the site-index naming and the public archive
  // URL shape (`/archive/:runId`); `/llm.txt` is kept for back-compat.
  const handler = (label: string) => async (c: Context) => {
    const runId = c.req.param("runId") ?? "";
    try {
      const body = await renderIssue(runId);
      if (body === null) return c.body("not found\n", 404, TEXT_HEADERS);
      return c.body(body, 200, TEXT_HEADERS);
    } catch (err) {
      logger.error({ err, runId }, "llm_txt.issue_failed");
      return c.body(`error generating ${label}\n`, 500, TEXT_HEADERS);
    }
  };

  app.get("/:runId/llm.txt", handler("llm.txt"));
  app.get("/:runId/llms.txt", handler("llms.txt"));
  app.get("/:runId/llms-full.txt", handler("llms-full.txt"));

  return app;
}

export interface DefaultLlmTxtOptions {
  baseUrl?: string;
  redis?: Pick<IORedis, "get" | "set">;
}

export function createDefaultLlmTxtRouter(options?: DefaultLlmTxtOptions): Hono {
  return createLlmTxtRouter(defaultLlmTxtDeps(options));
}

export function createDefaultLlmTxtArchiveRouter(options?: DefaultLlmTxtOptions): Hono {
  return createLlmTxtArchiveRouter(defaultLlmTxtDeps(options));
}

function defaultLlmTxtDeps(options?: DefaultLlmTxtOptions): LlmTxtRouterDeps {
  const resolved = options?.baseUrl ?? resolveBaseUrls(process.env).webBaseUrl;
  return {
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getMustReadRepo: () => createMustReadRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    baseUrl: resolved,
    cache: options?.redis ? createRedisLlmTxtCache(options.redis) : undefined,
  };
}
