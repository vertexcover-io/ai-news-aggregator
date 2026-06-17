import { Hono } from "hono";
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
  logger?: ReturnType<typeof createLogger>;
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

  // Loads reviewed issues. When `withStories` is false (the /llms.txt index
  // path) story hydration is skipped — the index only needs headlines/links.
  async function loadSnapshotData(withStories: boolean): Promise<LlmTxtSnapshotData> {
    const timezone = await resolveTimezone(deps);
    const rows = await deps.getArchiveRepo().listReviewedRows(FULL_INDEX_ISSUE_LIMIT);
    const issues: IssueFull[] = [];
    for (const row of rows) {
      issues.push({
        meta: issueMetaFromRow(row, issueDateOf(row, timezone)),
        stories: withStories ? await hydrateIssueStories(deps, row) : [],
      });
    }
    const canon = (await deps.getMustReadRepo().listPublic()).map(toPublicWire);
    return { baseUrl: deps.baseUrl, issues, canon };
  }

  app.get("/llms.txt", async (c) => {
    try {
      const snapshot = buildLlmTxtSnapshot(await loadSnapshotData(false));
      return c.body(snapshot.index, 200, TEXT_HEADERS);
    } catch (err) {
      logger.error({ err }, "llm_txt.index_failed");
      return c.body("error generating llms.txt\n", 500, TEXT_HEADERS);
    }
  });

  app.get("/llms-full.txt", async (c) => {
    try {
      const snapshot = buildLlmTxtSnapshot(await loadSnapshotData(true));
      return c.body(snapshot.indexFull, 200, TEXT_HEADERS);
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

  app.get("/:runId/llm.txt", async (c) => {
    const runId = c.req.param("runId");
    try {
      const row = await deps.getArchiveRepo().findById(runId);
      if (!row || !row.reviewed || row.isDryRun) {
        return c.body("not found\n", 404, TEXT_HEADERS);
      }
      const timezone = await resolveTimezone(deps);
      const meta = issueMetaFromRow(row, issueDateOf(row, timezone));
      const stories = await hydrateIssueStories(deps, row);
      return c.body(renderIssueLlmTxt(meta, stories, opts), 200, TEXT_HEADERS);
    } catch (err) {
      logger.error({ err, runId }, "llm_txt.issue_failed");
      return c.body("error generating llm.txt\n", 500, TEXT_HEADERS);
    }
  });

  return app;
}

export function createDefaultLlmTxtRouter(baseUrl?: string): Hono {
  return createLlmTxtRouter(defaultLlmTxtDeps(baseUrl));
}

export function createDefaultLlmTxtArchiveRouter(baseUrl?: string): Hono {
  return createLlmTxtArchiveRouter(defaultLlmTxtDeps(baseUrl));
}

function defaultLlmTxtDeps(baseUrl?: string): LlmTxtRouterDeps {
  const resolved = baseUrl ?? resolveBaseUrls(process.env).webBaseUrl;
  return {
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getMustReadRepo: () => createMustReadRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    baseUrl: resolved,
  };
}
