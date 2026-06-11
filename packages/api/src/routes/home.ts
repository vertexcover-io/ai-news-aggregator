import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { HomePagePayload, PublicMustReadEntry } from "@newsletter/shared";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
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
  toPublicWire,
  type MustReadRepo,
} from "@api/repositories/must-read.js";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;
// Fetch one extra to absorb the today's-issue exclusion without an undercount.
const RECENT_FETCH_LIMIT = RECENT_LIMIT + 1;

export interface PublicHomeRouterDeps {
  getArchiveRepo: (ctx: TenantContext) => RunArchivesRepo;
  getRawItemsRepo: (ctx: TenantContext) => RawItemsRepo;
  getMustReadRepo: (ctx: TenantContext) => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicHomeRouter(deps: PublicHomeRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:home");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const since = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
      const archiveRepo = deps.getArchiveRepo(resolveTenantCtx(c));
      const rawItemsRepo = deps.getRawItemsRepo(resolveTenantCtx(c));
      const mustReadRepo = deps.getMustReadRepo(resolveTenantCtx(c));

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
        ? toPublicWire(featuredRow)
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
    getArchiveRepo: (ctx) => createRunArchivesRepo(defaultGetDb(), ctx),
    getRawItemsRepo: (ctx) => createRawItemsRepo(defaultGetDb(), ctx),
    getMustReadRepo: (ctx) => createMustReadRepo(defaultGetDb(), ctx),
  });
}
