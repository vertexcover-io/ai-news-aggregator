import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import type {
  HomePagePayload,
  PublicMustReadEntry,
  TenantBranding,
} from "@newsletter/shared";
import { BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
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
import {
  createTenantsRepo,
  type TenantsRepo,
} from "@api/repositories/tenants.js";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;
// Fetch one extra to absorb the today's-issue exclusion without an undercount.
const RECENT_FETCH_LIMIT = RECENT_LIMIT + 1;

export interface PublicHomeRouterDeps {
  getTenantsRepo: () => TenantsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  getRawItemsRepo: () => RawItemsRepo;
  getMustReadRepo: () => MustReadRepo;
  logger?: ReturnType<typeof createLogger>;
}

/** Derive public branding from a tenant row. */
function toTenantBranding(row: {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoBytes: Uint8Array | null;
  featureCanon: boolean;
}): TenantBranding {
  return {
    name: row.name,
    headline: row.headline,
    topicStrip: row.topicStrip,
    subtagline: row.subtagline,
    logoUrl: row.logoBytes != null ? `/api/logo/${row.slug}` : null,
    flags: {
      canon: row.featureCanon,
      // Tenant 0 is AGENTLOOP — the platform owner. Check by id.
      isTenantZero: row.id === "00000000-0000-0000-0000-000000000000",
    },
  };
}

export function createPublicHomeRouter(deps: PublicHomeRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:home");
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const since = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
      const tenantsRepo = deps.getTenantsRepo();
      const archiveRepo = deps.getArchiveRepo();
      const rawItemsRepo = deps.getRawItemsRepo();
      const mustReadRepo = deps.getMustReadRepo();

      // Read tenantId from the resolve-tenant middleware (Phase 5).
      // Falls back to AGENTLOOP (tenant 0) if no tenant context is set.
      const tenantCtx = c.get("tenantCtx");
      const tenantId = tenantCtx?.tenantId ?? "00000000-0000-0000-0000-000000000000";

      const [tenant, todaysIssueRow, featuredRow, recentArchives] =
        await Promise.all([
          tenantsRepo.findById(tenantId),
          archiveRepo.findLatestReviewedSince(since),
          mustReadRepo.findRandom(),
          archiveRepo.listReviewed({
            rawItemsRepo,
            limit: RECENT_FETCH_LIMIT,
          }),
        ]);

      const branding: TenantBranding = tenant
        ? toTenantBranding(tenant)
        : {
            name: "Newsletter",
            headline: null,
            topicStrip: null,
            subtagline: null,
            logoUrl: null,
            flags: { canon: false, isTenantZero: false },
          };

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
        branding,
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
  const db = defaultGetDb();
  return createPublicHomeRouter({
    getTenantsRepo: () => createTenantsRepo(db),
    getArchiveRepo: () => createRunArchivesRepo(db, BOOTSTRAP_CONTEXT),
    getRawItemsRepo: () => createRawItemsRepo(db, BOOTSTRAP_CONTEXT),
    getMustReadRepo: () => createMustReadRepo(db, BOOTSTRAP_CONTEXT),
  });
}
