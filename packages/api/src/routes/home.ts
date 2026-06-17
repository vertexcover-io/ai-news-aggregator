import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type { HomePagePayload, PublicMustReadEntry } from "@newsletter/shared";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromPublicHost } from "@api/auth/tenant-scope.js";
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
  getArchiveRepo: (scope?: TenantScope) => RunArchivesRepo;
  getRawItemsRepo: (scope?: TenantScope) => RawItemsRepo;
  getMustReadRepo: (scope?: TenantScope) => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createPublicHomeRouter(deps: PublicHomeRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:home");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const since = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
      // Composite reads fenced by the Host-resolved tenant (P7, REQ-044).
      const scope = tenantScopeFromPublicHost(c);
      const archiveRepo = deps.getArchiveRepo(scope);
      const rawItemsRepo = deps.getRawItemsRepo(scope);
      const mustReadRepo = deps.getMustReadRepo(scope);

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

      // Canon disabled for this tenant (Fix #4): suppress the "From the Canon"
      // home block. App-host/legacy requests (no publicTenant) are unaffected.
      const publicTenant = c.get("publicTenant");
      const canonEnabled =
        publicTenant === undefined || publicTenant.featureCanon;
      const featuredCanon: PublicMustReadEntry | null =
        canonEnabled && featuredRow ? toPublicWire(featuredRow) : null;

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
    getArchiveRepo: (scope) => createRunArchivesRepo(defaultGetDb(), scope),
    getRawItemsRepo: (scope) => createRawItemsRepo(defaultGetDb(), scope),
    getMustReadRepo: (scope) => createMustReadRepo(defaultGetDb(), scope),
  });
}
