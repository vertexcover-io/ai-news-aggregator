import { Hono } from "hono";
import { z } from "zod";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";

export interface ArchivesSearchRouterDeps {
  getArchiveRepo: () => RunArchivesRepo;
  getRawItemsRepo: () => RawItemsRepo;
  logger?: ReturnType<typeof createLogger>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  q: z.string().max(200).optional(),
  from: z.string().regex(ISO_DATE_RE).optional(),
  to: z.string().regex(ISO_DATE_RE).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

function parseDate(s: string): Date | null {
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(s: string): Date | null {
  const d = new Date(`${s}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function createArchivesSearchRouter(
  deps: ArchivesSearchRouterDeps,
): Hono {
  const logger = deps.logger ?? createLogger("api:archives-search");
  const router = new Hono();

  router.get("/", async (c) => {
    const rawQ = c.req.query("q");
    if (rawQ !== undefined && rawQ.length > 200) {
      return c.json({ error: "q-too-long" }, 400);
    }

    const parsed = querySchema.safeParse({
      q: rawQ,
      from: c.req.query("from"),
      to: c.req.query("to"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return c.json({ error: "bad-request", issues: parsed.error.issues }, 400);
    }
    const { q, from, to, limit } = parsed.data;

    const fromDate = from ? parseDate(from) : undefined;
    const toDate = to ? endOfDay(to) : undefined;
    if (fromDate === null || toDate === null) {
      return c.json({ error: "bad-request" }, 400);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return c.json({ error: "invalid-range" }, 400);
    }

    const start = Date.now();
    const result = await deps.getArchiveRepo().searchReviewed({
      q,
      from: fromDate,
      to: toDate,
      limit,
      rawItemsRepo: deps.getRawItemsRepo(),
    });
    const durationMs = Date.now() - start;

    logger.info(
      {
        event: "archives.search",
        q,
        from,
        to,
        count: result.archives.length,
        durationMs,
      },
      "archives.search",
    );

    const body: {
      archives: typeof result.archives;
      total: number;
      q?: string;
      from?: string;
      to?: string;
    } = { archives: result.archives, total: result.total };
    if (q !== undefined) body.q = q;
    if (from !== undefined) body.from = from;
    if (to !== undefined) body.to = to;
    return c.json(body);
  });

  return router;
}

export function createDefaultArchivesSearchRouter(): Hono {
  return createArchivesSearchRouter({
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
  });
}
