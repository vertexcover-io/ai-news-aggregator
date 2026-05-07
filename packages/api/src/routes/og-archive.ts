import { Hono } from "hono";
import { html } from "hono/html";
import {
  createLogger,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";

export interface OgArchiveRouterDeps {
  getArchiveRepo: () => RunArchivesRepo;
  getRawItemsRepo: () => RawItemsRepo;
  webBaseUrl: string;
  logger?: ReturnType<typeof createLogger>;
}

const FALLBACK_TITLE = "AI news digest";
const FALLBACK_DESCRIPTION =
  "A hand-curated daily digest of what's actually moving in AI.";

function formatIssueDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function createOgArchiveRouter(deps: OgArchiveRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:og-archive");
  const app = new Hono();

  app.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    const canonicalUrl = `${deps.webBaseUrl}/archive/${runId}`;

    let title = FALLBACK_TITLE;
    let description = FALLBACK_DESCRIPTION;
    let imageUrl: string | null = null;

    try {
      const archive = await deps.getArchiveRepo().findById(runId);
      if (archive) {
        const dateLabel = formatIssueDate(archive.completedAt);
        const dateTitle = `AI news - ${dateLabel}`;
        title = archive.digestHeadline ?? dateTitle;
        description = archive.digestSummary ?? FALLBACK_DESCRIPTION;

        const firstRef = archive.rankedItems.at(0);
        if (firstRef) {
          const rows = await deps.getRawItemsRepo().findByIds([firstRef.rawItemId]);
          imageUrl = rows.at(0)?.imageUrl ?? null;
        }
      }
    } catch (err) {
      logger.warn({ err, runId }, "og.fetch_failed");
    }

    const safeTitle = title;
    const safeDescription = description;

    const body = html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:site_name" content="Sieve" />
    ${imageUrl ? html`<meta property="og:image" content="${imageUrl}" />` : ""}
    <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    ${imageUrl ? html`<meta name="twitter:image" content="${imageUrl}" />` : ""}
    <link rel="canonical" href="${canonicalUrl}" />
    <meta http-equiv="refresh" content="0; url=${canonicalUrl}" />
  </head>
  <body>
    <p><a href="${canonicalUrl}">${safeTitle}</a></p>
  </body>
</html>`;

    return c.html(body);
  });

  return app;
}

export function createDefaultOgArchiveRouter(webBaseUrl: string): Hono {
  return createOgArchiveRouter({
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    webBaseUrl,
  });
}
