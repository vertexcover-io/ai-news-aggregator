import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { HomePagePayload, PublicMustReadEntry } from "@newsletter/shared";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  hydrateAsArchiveListItem,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createMustReadRepo,
  type MustReadRepo,
} from "@api/repositories/must-read.js";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;
// Fetch one extra to absorb the today's-issue exclusion without an undercount.
const RECENT_FETCH_LIMIT = RECENT_LIMIT + 1;

export interface PublicHomeRouterDeps {
  getArchiveRepo: () => RunArchivesRepo;
  getRawItemsRepo: () => RawItemsRepo;
  getMustReadRepo: () => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicHomeRouter(deps: PublicHomeRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:home");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const since = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
      const archiveRepo = deps.getArchiveRepo();
      const rawItemsRepo = deps.getRawItemsRepo();
      const mustReadRepo = deps.getMustReadRepo();

      const [todaysIssueRow, featuredRow, recentArchives] = await Promise.all([
        archiveRepo.findLatestReviewedSince(since),
        mustReadRepo.findRandom(),
        archiveRepo.listReviewed({
          rawItemsRepo,
          limit: RECENT_FETCH_LIMIT,
        }),
      ]);

      const todaysIssue = todaysIssueRow
        ? await hydrateAsArchiveListItem(todaysIssueRow, rawItemsRepo)
        : null;

      const recentIssues = (
        todaysIssue
          ? recentArchives.filter((a) => a.runId !== todaysIssue.runId)
          : recentArchives
      ).slice(0, RECENT_LIMIT);

      const featuredCanon: PublicMustReadEntry | null = featuredRow
        ? {
            id: featuredRow.id,
            url: featuredRow.url,
            title: featuredRow.title,
            author: featuredRow.author,
            year: featuredRow.year,
            annotation: featuredRow.annotation,
            addedAt: featuredRow.addedAt.toISOString(),
          }
        : null;

      const body: HomePagePayload = {
        todaysIssue,
        featuredCanon,
        recentIssues,
      };
      return c.json(body);
    } catch (err) {
      logger.error({ err }, "home.fetch_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return app;
}

export function createDefaultPublicHomeRouter(): Hono {
  return createPublicHomeRouter({
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getMustReadRepo: () => createMustReadRepo(defaultGetDb()),
  });
}
