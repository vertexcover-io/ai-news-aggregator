import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import {
  fetchPageStatic,
  type StaticFetchOpts,
  type StaticFetchOk,
  type StaticFetchError,
} from "@newsletter/shared/services/static-page-fetcher";
import { extractPageMetadata } from "@newsletter/shared/services/page-metadata";
import {
  createMustReadRepo,
  type MustReadRepo,
} from "@api/repositories/must-read.js";
import { resolveTenantCtx } from "@api/lib/tenant-ctx.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import {
  createSchema,
  patchSchema,
  previewSchema,
} from "@api/lib/validate-must-read.js";

export interface PreviewSuccess {
  status: "extracted";
  suggested: {
    title: string;
    author: string | null;
    year: number | null;
  };
}

export interface PreviewFailure {
  status: "extraction_failed";
  error: string;
}

type PreviewResponse = PreviewSuccess | PreviewFailure;

export type FetchPageStaticFn = (
  url: string,
  opts: StaticFetchOpts,
) => Promise<StaticFetchOk | { error: StaticFetchError }>;

export interface AdminMustReadRouterDeps {
  getRepo: (ctx: TenantContext) => MustReadRepo;
  fetchPage?: FetchPageStaticFn;
  previewTimeoutMs?: number;
  logger?: ReturnType<typeof createLogger>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function previewUrl(
  url: string,
  fetchPage: FetchPageStaticFn,
  timeoutMs: number,
): Promise<PreviewResponse> {
  try {
    const fetched = await fetchPage(url, { timeoutMs });
    if ("error" in fetched) {
      return { status: "extraction_failed", error: fetchErrorMessage(fetched.error) };
    }
    const meta = safeExtractMetadata(fetched.html, fetched.finalUrl);
    if (meta === null) {
      return { status: "extraction_failed", error: "Could not parse the page HTML." };
    }
    if (!meta.title) {
      return { status: "extraction_failed", error: "Could not extract a title from the page." };
    }
    return {
      status: "extracted",
      suggested: { title: meta.title, author: meta.author, year: meta.year },
    };
  } catch (err) {
    console.error({ err, url }, "admin-must-read.previewUrl.unexpected_error");
    return { status: "extraction_failed", error: "Unexpected error while fetching the URL." };
  }
}

function safeExtractMetadata(
  html: string,
  finalUrl: string,
): ReturnType<typeof extractPageMetadata> | null {
  try {
    return extractPageMetadata(html, finalUrl);
  } catch (err) {
    console.error({ err, finalUrl }, "admin-must-read.safeExtractMetadata.failed");
    return null;
  }
}

function fetchErrorMessage(err: StaticFetchError): string {
  switch (err) {
    case "ssrf":
      return "Refused: URL host is private, loopback, or otherwise blocked.";
    case "timeout":
      return "timeout";
    case "http_4xx":
      return "Source returned an HTTP 4xx response.";
    case "http_5xx":
      return "Source returned an HTTP 5xx response.";
    case "non_html":
      return "Source did not return an HTML document.";
    case "too_large":
      return "Source response exceeded the maximum allowed size.";
    case "network":
      return "Network error while fetching the source.";
  }
}

export function createAdminMustReadRouter(
  deps: AdminMustReadRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:admin-must-read");
  const fetchPage = deps.fetchPage ?? fetchPageStatic;
  const previewTimeoutMs = deps.previewTimeoutMs ?? 15_000;
  const app = new Hono();

  app.post("/preview", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const response = await previewUrl(parsed.data.url, fetchPage, previewTimeoutMs);
    return c.json(response, 200);
  });

  app.post("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const repo = deps.getRepo(resolveTenantCtx(c));
    const existing = await repo.findByUrl(parsed.data.url);
    if (existing) {
      return c.json(
        { error: "duplicate_url", existingId: existing.id },
        409,
      );
    }
    const row = await repo.create({
      url: parsed.data.url,
      title: parsed.data.title,
      author: parsed.data.author,
      year: parsed.data.year,
      annotation: parsed.data.annotation,
    });
    return c.json(row, 201);
  });

  app.get("/", async (c) => {
    const rows = await deps.getRepo(resolveTenantCtx(c)).listAdmin();
    return c.json(rows);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }
    const repo = deps.getRepo(resolveTenantCtx(c));
    if (parsed.data.url !== undefined) {
      const conflict = await repo.findByUrl(parsed.data.url);
      if (conflict && conflict.id !== id) {
        return c.json(
          { error: "duplicate_url", existingId: conflict.id },
          409,
        );
      }
    }
    try {
      const updated = await repo.update(id, parsed.data);
      if (!updated) {
        return c.json({ error: "not_found" }, 404);
      }
      return c.json(updated, 200);
    } catch (err) {
      logger.error({ err, id }, "admin-must-read.patch.failed");
      throw err;
    }
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const removed = await deps.getRepo(resolveTenantCtx(c)).delete(id);
    if (!removed) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}

export function createDefaultAdminMustReadRouter(): Hono {
  return createAdminMustReadRouter({
    getRepo: (ctx) => createMustReadRepo(defaultGetDb(), ctx),
  });
}
